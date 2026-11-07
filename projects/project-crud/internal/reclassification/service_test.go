package reclassification

import (
	"context"
	"testing"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	orig string
	sug  *Suggestion
	err  error

	storedSug *Suggestion
	storedID  int64
	storeErr  error
}

func (r *fakeRepo) Get(_ context.Context, _ int64) (string, *Suggestion, error) {
	return r.orig, r.sug, r.err
}

func (r *fakeRepo) StoreSuggestion(_ context.Context, complaintID int64, s Suggestion) error {
	r.storedID = complaintID
	r.storedSug = &s
	if r.storeErr != nil {
		return r.storeErr
	}
	r.orig = OriginalSubCategory
	clone := s
	r.sug = &clone
	return nil
}

func validReq() StoreRequest {
	return StoreRequest{
		AIGeneratedSubCategory: "Lack of response from RTA / Improper service",
		Confidence:             87,
		Reasoning:              "Investor explicitly states the RTA hasn't replied.",
	}
}

func TestService_Get_NoSuggestionYet(t *testing.T) {
	t.Parallel()
	r := &fakeRepo{orig: "Others"}
	out, err := NewService(r).Get(context.Background(), 1234)
	require.NoError(t, err)
	assert.Equal(t, "Others", out.OriginalSubCategory)
	assert.Nil(t, out.Suggestion)
}

func TestService_Store_HappyPath(t *testing.T) {
	t.Parallel()
	r := &fakeRepo{}
	out, err := NewService(r).Store(context.Background(), 4242, validReq())
	require.NoError(t, err)

	require.NotNil(t, r.storedSug)
	assert.Equal(t, int64(4242), r.storedID)
	assert.Equal(t, validReq().AIGeneratedSubCategory, r.storedSug.AIGeneratedSubCategory)
	assert.Equal(t, 87, r.storedSug.Confidence)

	require.NotNil(t, out.Suggestion)
	assert.Equal(t, OriginalSubCategory, out.OriginalSubCategory)
}

func TestService_Store_Validation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		mut  func(*StoreRequest)
		want string
	}{
		{"empty ai_generated", func(r *StoreRequest) { r.AIGeneratedSubCategory = "  " }, "ai_generated_sub_category"},
		{"self-suggestion as Others", func(r *StoreRequest) { r.AIGeneratedSubCategory = "Others" }, "cannot itself be 'Others'"},
		{"empty reasoning", func(r *StoreRequest) { r.Reasoning = "" }, "reasoning"},
		{"confidence > 100", func(r *StoreRequest) { r.Confidence = 101 }, "confidence"},
		{"confidence < 0", func(r *StoreRequest) { r.Confidence = -1 }, "confidence"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			req := validReq()
			tt.mut(&req)
			_, err := NewService(&fakeRepo{}).Store(context.Background(), 1, req)
			require.Error(t, err)
			assert.ErrorIs(t, err, apperror.ErrValidation)
			assert.Contains(t, err.Error(), tt.want)
		})
	}
}

func TestService_Store_TrimsAndCapsLongFields(t *testing.T) {
	t.Parallel()
	r := &fakeRepo{}
	req := validReq()
	req.AIGeneratedSubCategory = " " + req.AIGeneratedSubCategory + " "
	req.Reasoning = ""
	for i := 0; i < 3000; i++ {
		req.Reasoning += "x"
	}
	_, err := NewService(r).Store(context.Background(), 1, req)
	require.NoError(t, err)
	assert.Equal(t, "Lack of response from RTA / Improper service", r.storedSug.AIGeneratedSubCategory)
	assert.Len(t, r.storedSug.Reasoning, 2000)
}

func TestService_Store_PropagatesRepoError(t *testing.T) {
	t.Parallel()
	r := &fakeRepo{storeErr: apperror.ErrValidation.WithMessage("complaint not found or not in sub_category 'Others'")}
	_, err := NewService(r).Store(context.Background(), 7, validReq())
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

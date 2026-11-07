package complaintsummary

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeRepo mirrors the real Mongo behavior: $setOnInsert seeds CreatedAt on
// insert, then $set preserves it on subsequent updates.
type fakeRepo struct {
	store      map[int64]Summary
	upsertErr  error
	getErr     error
	lastUpsert *Summary
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{store: map[int64]Summary{}}
}

func (r *fakeRepo) Upsert(_ context.Context, s Summary) error {
	if r.upsertErr != nil {
		return r.upsertErr
	}
	clone := s
	r.lastUpsert = &clone
	if existing, ok := r.store[s.ComplaintID]; ok {
		s.CreatedAt = existing.CreatedAt
	} else {
		s.CreatedAt = s.UpdatedAt
	}
	r.store[s.ComplaintID] = s
	return nil
}

func (r *fakeRepo) GetByComplaintID(_ context.Context, id int64) (Summary, error) {
	if r.getErr != nil {
		return Summary{}, r.getErr
	}
	s, ok := r.store[id]
	if !ok {
		return Summary{}, apperror.ErrNotFound
	}
	return s, nil
}

func newTestService(now time.Time) (*Service, *fakeRepo) {
	repo := newFakeRepo()
	svc := &Service{repo: repo, now: func() time.Time { return now }}
	return svc, repo
}

func TestStore_InsertSetsCreatedAndUpdated(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	svc, _ := newTestService(now)

	req := StoreRequest{
		ComplaintDetails: "raw text",
		Summary: SummaryPayload{
			BriefSummary: "two sentences",
			KeyIssues:    []string{"unreachable"},
			Demands:      []string{"refund"},
			Sentiment:    "frustrated",
		},
	}

	out, err := svc.Store(context.Background(), 7, req)
	require.NoError(t, err)
	assert.Equal(t, int64(7), out.ComplaintID)
	assert.Equal(t, now, out.UpdatedAt)
	assert.Equal(t, now, out.CreatedAt)
	assert.Equal(t, "raw text", out.ComplaintDetails)
	assert.Equal(t, "frustrated", out.Summary.Sentiment)
}

func TestStore_UpdatePreservesCreatedAt(t *testing.T) {
	t.Parallel()
	insertAt := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	updateAt := insertAt.Add(3 * time.Hour)

	svc, _ := newTestService(insertAt)
	_, err := svc.Store(context.Background(), 1, StoreRequest{ComplaintDetails: "x"})
	require.NoError(t, err)

	svc.now = func() time.Time { return updateAt }
	out, err := svc.Store(context.Background(), 1, StoreRequest{
		ComplaintDetails: "x",
		Summary:          SummaryPayload{BriefSummary: "updated"},
	})
	require.NoError(t, err)
	assert.Equal(t, insertAt, out.CreatedAt)
	assert.Equal(t, updateAt, out.UpdatedAt)
	assert.Equal(t, "updated", out.Summary.BriefSummary)
}

func TestStore_NilSliceFieldsBecomeEmpty(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(time.Now().UTC())

	out, err := svc.Store(context.Background(), 1, StoreRequest{
		ComplaintDetails: "x",
		Summary:          SummaryPayload{BriefSummary: "y"},
		// KeyIssues, Demands left nil
	})
	require.NoError(t, err)
	require.NotNil(t, out.Summary.KeyIssues)
	require.NotNil(t, out.Summary.Demands)
	assert.Equal(t, 0, len(out.Summary.KeyIssues))
	assert.Equal(t, 0, len(out.Summary.Demands))
}

func TestStore_RepoErrorIsWrapped(t *testing.T) {
	t.Parallel()
	svc, repo := newTestService(time.Now().UTC())
	repo.upsertErr = errors.New("mongo down")

	_, err := svc.Store(context.Background(), 1, StoreRequest{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "store complaint summary")
}

func TestGet_NotFound(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(time.Now().UTC())

	_, err := svc.Get(context.Background(), 404)
	require.Error(t, err)
	assert.True(t, errors.Is(err, apperror.ErrNotFound))
}

func TestGet_Found(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(time.Now().UTC())
	_, err := svc.Store(context.Background(), 1, StoreRequest{ComplaintDetails: "x"})
	require.NoError(t, err)

	out, err := svc.Get(context.Background(), 1)
	require.NoError(t, err)
	assert.Equal(t, int64(1), out.ComplaintID)
}

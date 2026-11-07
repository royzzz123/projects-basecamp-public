package complaintworkflowanalysis

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeRepo is an in-memory Repository. It preserves CreatedAt across updates,
// just like the real Mongo $setOnInsert / $set split.
type fakeRepo struct {
	store     map[int64]Analysis
	upsertErr error
	getErr    error
	// lastUpsert captures the input passed to Upsert so tests can inspect
	// derived fields like UpdatedAt without re-fetching.
	lastUpsert *Analysis
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{store: map[int64]Analysis{}}
}

func (r *fakeRepo) Upsert(_ context.Context, a Analysis) error {
	if r.upsertErr != nil {
		return r.upsertErr
	}
	clone := a
	r.lastUpsert = &clone
	if existing, ok := r.store[a.ComplaintID]; ok {
		// Preserve CreatedAt on update — same semantics as $setOnInsert.
		a.CreatedAt = existing.CreatedAt
	} else {
		a.CreatedAt = a.UpdatedAt
	}
	r.store[a.ComplaintID] = a
	return nil
}

func (r *fakeRepo) GetByComplaintID(_ context.Context, id int64) (Analysis, error) {
	if r.getErr != nil {
		return Analysis{}, r.getErr
	}
	a, ok := r.store[id]
	if !ok {
		return Analysis{}, apperror.ErrNotFound
	}
	return a, nil
}

func newTestService(now time.Time) (*Service, *fakeRepo) {
	repo := newFakeRepo()
	svc := &Service{repo: repo, now: func() time.Time { return now }}
	return svc, repo
}

func TestStore_InsertSetsCreatedAndUpdated(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	svc, repo := newTestService(now)

	overall := "looks fine"
	req := StoreRequest{
		WorkflowAnalysis: WorkflowAnalysis{OverallSummary: &overall},
	}

	out, err := svc.Store(context.Background(), 42, req)
	require.NoError(t, err)

	assert.Equal(t, int64(42), out.ComplaintID)
	assert.Equal(t, now, out.UpdatedAt)
	assert.Equal(t, now, out.CreatedAt)
	assert.Equal(t, overall, *out.WorkflowAnalysis.OverallSummary)
	require.NotNil(t, repo.lastUpsert)
	assert.Equal(t, now, repo.lastUpsert.UpdatedAt)
}

func TestStore_UpdatePreservesCreatedAt(t *testing.T) {
	t.Parallel()
	insertAt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	updateAt := insertAt.Add(2 * time.Hour)

	svc, _ := newTestService(insertAt)
	_, err := svc.Store(context.Background(), 99, StoreRequest{})
	require.NoError(t, err)

	// Advance the clock, then store again.
	svc.now = func() time.Time { return updateAt }
	newSummary := "updated"
	out, err := svc.Store(context.Background(), 99, StoreRequest{
		WorkflowAnalysis: WorkflowAnalysis{OverallSummary: &newSummary},
	})
	require.NoError(t, err)

	assert.Equal(t, insertAt, out.CreatedAt, "CreatedAt must be preserved on update")
	assert.Equal(t, updateAt, out.UpdatedAt, "UpdatedAt must advance")
	assert.Equal(t, newSummary, *out.WorkflowAnalysis.OverallSummary)
}

func TestStore_DefaultsNilTimelineAndDocSummaries(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(time.Now().UTC())

	// One entry with nil DocSummaries; one with explicitly empty.
	role := "Investor"
	req := StoreRequest{
		EnrichedTimeline: []EnrichedTimelineEntry{
			{Role: &role}, // DocSummaries left nil
			{Role: &role, DocSummaries: []DocSummary{}},
		},
	}
	out, err := svc.Store(context.Background(), 1, req)
	require.NoError(t, err)

	require.Len(t, out.EnrichedTimeline, 2)
	for i, e := range out.EnrichedTimeline {
		assert.NotNil(t, e.DocSummaries, "entry %d DocSummaries should not be nil", i)
		assert.Equal(t, 0, len(e.DocSummaries))
	}
}

func TestStore_NilTimelineBecomesEmptySlice(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(time.Now().UTC())

	out, err := svc.Store(context.Background(), 7, StoreRequest{EnrichedTimeline: nil})
	require.NoError(t, err)
	require.NotNil(t, out.EnrichedTimeline)
	assert.Equal(t, 0, len(out.EnrichedTimeline))
}

func TestStore_RepoUpsertErrorIsWrapped(t *testing.T) {
	t.Parallel()
	svc, repo := newTestService(time.Now().UTC())
	repo.upsertErr = errors.New("mongo unavailable")

	_, err := svc.Store(context.Background(), 1, StoreRequest{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "store workflow analysis")
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
	_, err := svc.Store(context.Background(), 1, StoreRequest{})
	require.NoError(t, err)

	out, err := svc.Get(context.Background(), 1)
	require.NoError(t, err)
	assert.Equal(t, int64(1), out.ComplaintID)
}

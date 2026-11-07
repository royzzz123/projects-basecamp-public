package entity

import (
	"context"
	"errors"
	"testing"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- fake repo -----------------------------------------------------------

type fakeRepo struct {
	// FilterPage
	filterPage     []FilterItem
	lastFilterArgs FilterQuery
	filterErr      error

	// ListPage
	listPage     []ListRow
	lastListArgs ListFilter
	listErr      error

	// CountFiltered
	total           int64
	lastCountFilter ListFilter
	countFilterErr  error

	// CountComplaintsForEntities
	countResp    []ComplaintCount
	lastCountIDs []string
	countErr     error
}

func (r *fakeRepo) FilterPage(_ context.Context, f FilterQuery) ([]FilterItem, error) {
	r.lastFilterArgs = f
	if r.filterErr != nil {
		return nil, r.filterErr
	}
	return r.filterPage, nil
}

func (r *fakeRepo) ListPage(_ context.Context, f ListFilter) ([]ListRow, error) {
	r.lastListArgs = f
	if r.listErr != nil {
		return nil, r.listErr
	}
	return r.listPage, nil
}

func (r *fakeRepo) CountFiltered(_ context.Context, f ListFilter) (int64, error) {
	r.lastCountFilter = f
	if r.countFilterErr != nil {
		return 0, r.countFilterErr
	}
	return r.total, nil
}

func (r *fakeRepo) CountComplaintsForEntities(_ context.Context, ids []string) ([]ComplaintCount, error) {
	r.lastCountIDs = ids
	if r.countErr != nil {
		return nil, r.countErr
	}
	return r.countResp, nil
}

func newSvc() (*Service, *fakeRepo) {
	repo := &fakeRepo{}
	// filter pair 20/100, list pair 20/50 (mirrors prod defaults — list pair
	// is kept small because each page triggers a tr_complaints lookup).
	return NewService(repo, 20, 100, 20, 50), repo
}

// ===== Service.Filter (typeahead) =========================================

func TestFilter_DefaultLimit(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	_, err := svc.Filter(context.Background(), FilterParams{})
	require.NoError(t, err)
	assert.Equal(t, 21, repo.lastFilterArgs.Limit, "service asks repo for default+1")
}

func TestFilter_LimitClampedToMax(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	_, err := svc.Filter(context.Background(), FilterParams{Limit: 9999})
	require.NoError(t, err)
	assert.Equal(t, 101, repo.lastFilterArgs.Limit)
}

func TestFilter_QueryIsTrimmed(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	_, err := svc.Filter(context.Background(), FilterParams{Query: "  HDFC  "})
	require.NoError(t, err)
	assert.Equal(t, "HDFC", repo.lastFilterArgs.Query)
}

func TestFilter_BadCursor_ValidationError(t *testing.T) {
	t.Parallel()
	svc, _ := newSvc()
	_, err := svc.Filter(context.Background(), FilterParams{After: "not-base64!!"})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

func TestFilter_NextCursorWhenPageIsFull(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.filterPage = []FilterItem{
		{ID: "a", Name: "Alpha"},
		{ID: "b", Name: "Bravo"},
		{ID: "c", Name: "Charlie"},
		{ID: "d", Name: "Delta"}, // extra → triggers next_cursor
	}
	out, err := svc.Filter(context.Background(), FilterParams{Limit: 3})
	require.NoError(t, err)
	require.NotNil(t, out.NextCursor)
	assert.Len(t, out.Items, 3)

	decoded, err := decodeFilterCursor(*out.NextCursor)
	require.NoError(t, err)
	require.NotNil(t, decoded)
	assert.Equal(t, "c", *decoded, "cursor points at the last kept userid")
}

func TestFilter_NoNextCursorWhenPageNotFull(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.filterPage = []FilterItem{{ID: "a", Name: "Alpha"}}
	out, err := svc.Filter(context.Background(), FilterParams{Limit: 3})
	require.NoError(t, err)
	assert.Nil(t, out.NextCursor)
}

func TestFilter_RepoErrorPropagates(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.filterErr = errors.New("boom")
	_, err := svc.Filter(context.Background(), FilterParams{})
	require.Error(t, err)
}

func TestFilterCursor_RoundTrip(t *testing.T) {
	t.Parallel()
	encoded := encodeFilterCursor("stb10700")
	decoded, err := decodeFilterCursor(encoded)
	require.NoError(t, err)
	require.NotNil(t, decoded)
	assert.Equal(t, "stb10700", *decoded)
}

// ===== Service.List (full list + counts) ==================================

func makeRow(id string, uid int64, entity string) ListRow {
	return ListRow{
		ListItem: ListItem{ID: id, Entity: entity, EntityType: "intermediary"},
		UID:      uid,
	}
}

func makeRowCC(id string, uid, cc int64, entity string) ListRow {
	r := makeRow(id, uid, entity)
	r.ComplaintCount = cc
	return r
}

func TestList_DefaultLimit(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	_, err := svc.List(context.Background(), ListParams{})
	require.NoError(t, err)
	assert.Equal(t, 21, repo.lastListArgs.Limit, "service asks repo for list-default+1")
}

func TestList_LimitClampedToListMax(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	_, err := svc.List(context.Background(), ListParams{Limit: 9999})
	require.NoError(t, err)
	assert.Equal(t, 51, repo.lastListArgs.Limit, "clamps to list-max+1, NOT filter-max")
}

func TestList_BadCursor_ValidationError(t *testing.T) {
	t.Parallel()
	svc, _ := newSvc()
	_, err := svc.List(context.Background(), ListParams{After: "not-base64!!"})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

func TestList_FilterPassThrough(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	_, err := svc.List(context.Background(), ListParams{
		CategoryCodes: []string{"cat12", "  ", "cat2"},
		EntityTypes:   []string{"intermediary", ""},
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"cat12", "cat2"}, repo.lastListArgs.CategoryCodes, "empties dropped, order kept")
	assert.Equal(t, []string{"intermediary"}, repo.lastListArgs.EntityTypes)
}

func TestList_CountMerge(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.listPage = []ListRow{
		makeRow("e1", 100, "Alpha"),
		makeRow("e2", 90, "Bravo"),
		makeRow("e3", 80, "Charlie"), // will have zero complaints
	}
	repo.countResp = []ComplaintCount{
		{EntityID: "e1", Open: 3, Closed: 7, FirstLevelReviewEscalated: 4, SecondLevelReviewEscalated: 1},
		{EntityID: "e2", Open: 0, Closed: 5, FirstLevelReviewEscalated: 0, SecondLevelReviewEscalated: 0},
		// e3 deliberately omitted — service should fold to zeros
	}

	out, err := svc.List(context.Background(), ListParams{Limit: 3})
	require.NoError(t, err)
	require.Len(t, out.Items, 3)

	assert.Equal(t, int64(3), out.Items[0].OpenComplaints)
	assert.Equal(t, int64(7), out.Items[0].ClosedComplaints)
	assert.Equal(t, int64(10), out.Items[0].TotalComplaints)
	assert.Equal(t, int64(4), out.Items[0].FirstLevelReviewEscalated)
	assert.InDelta(t, 40.0, out.Items[0].FirstLevelReviewEscalationPct, 0.001, "4/10 = 40%")
	assert.Equal(t, int64(1), out.Items[0].SecondLevelReviewEscalated)
	assert.InDelta(t, 10.0, out.Items[0].SecondLevelReviewEscalationPct, 0.001, "1/10 = 10%")

	assert.Equal(t, int64(0), out.Items[1].OpenComplaints)
	assert.Equal(t, int64(5), out.Items[1].ClosedComplaints)
	assert.Equal(t, int64(5), out.Items[1].TotalComplaints)
	assert.Equal(t, int64(0), out.Items[1].FirstLevelReviewEscalated)
	assert.InDelta(t, 0.0, out.Items[1].FirstLevelReviewEscalationPct, 0.001)

	assert.Equal(t, int64(0), out.Items[2].OpenComplaints, "missing entity → zero open")
	assert.Equal(t, int64(0), out.Items[2].ClosedComplaints, "missing entity → zero closed")
	assert.Equal(t, int64(0), out.Items[2].TotalComplaints, "missing entity → zero total")
	assert.InDelta(t, 0.0, out.Items[2].FirstLevelReviewEscalationPct, 0.001, "no complaints → 0% (not NaN)")
	assert.InDelta(t, 0.0, out.Items[2].SecondLevelReviewEscalationPct, 0.001)

	assert.Equal(t, []string{"e1", "e2", "e3"}, repo.lastCountIDs, "all kept IDs handed to Phase B")
}

func TestList_EscalationPercentRounding(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.listPage = []ListRow{makeRow("e1", 100, "Alpha")}
	// 1/3 → 33.333…% → rounded to 33.33; 2/3 → 66.666…% → rounded to 66.67.
	repo.countResp = []ComplaintCount{
		{EntityID: "e1", Open: 1, Closed: 2, FirstLevelReviewEscalated: 1, SecondLevelReviewEscalated: 2},
	}

	out, err := svc.List(context.Background(), ListParams{Limit: 1})
	require.NoError(t, err)
	require.Len(t, out.Items, 1)

	assert.Equal(t, 33.33, out.Items[0].FirstLevelReviewEscalationPct, "rounded to 2dp")
	assert.Equal(t, 66.67, out.Items[0].SecondLevelReviewEscalationPct, "rounded up to 2dp")
}

func TestList_NextCursorWhenPageIsFull(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.listPage = []ListRow{
		makeRowCC("e1", 100, 50, "Alpha"),
		makeRowCC("e2", 90, 30, "Bravo"),
		makeRowCC("e3", 80, 20, "Charlie"),
		makeRowCC("e4", 70, 10, "Delta"), // extra → triggers next_cursor
	}
	out, err := svc.List(context.Background(), ListParams{Limit: 3})
	require.NoError(t, err)
	require.NotNil(t, out.NextCursor)
	require.Len(t, out.Items, 3)

	decoded, err := decodeListCursor(*out.NextCursor)
	require.NoError(t, err)
	require.NotNil(t, decoded)
	assert.Equal(t, int64(20), decoded.ComplaintCount, "cursor encodes last kept row's complaint_count (e3)")
	assert.Equal(t, int64(80), decoded.UID, "cursor encodes last kept row's uid (e3)")

	// Phase B was called with the trimmed page only, not the discarded e4.
	assert.NotContains(t, repo.lastCountIDs, "e4")
}

func TestList_NoNextCursorWhenPageNotFull(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.listPage = []ListRow{makeRow("e1", 100, "Alpha")}
	out, err := svc.List(context.Background(), ListParams{Limit: 3})
	require.NoError(t, err)
	assert.Nil(t, out.NextCursor)
}

func TestList_RepoListErrorPropagates(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.listErr = errors.New("boom")
	_, err := svc.List(context.Background(), ListParams{})
	require.Error(t, err)
}

func TestList_TotalReflectsFilteredCount(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.listPage = []ListRow{makeRow("e1", 100, "Alpha")}
	repo.total = 873

	out, err := svc.List(context.Background(), ListParams{
		EntityTypes: []string{"intermediary"},
	})
	require.NoError(t, err)
	assert.Equal(t, int64(873), out.Total, "total comes from CountFiltered, independent of page size")
	assert.Equal(t, []string{"intermediary"}, repo.lastCountFilter.EntityTypes,
		"count must see the same filter axes the user passed")
}

func TestList_RepoCountFilterErrorPropagates(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.countFilterErr = errors.New("boom")
	_, err := svc.List(context.Background(), ListParams{})
	require.Error(t, err)
}

func TestList_RepoCountErrorPropagates(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.listPage = []ListRow{makeRow("e1", 100, "Alpha")}
	repo.countErr = errors.New("boom")
	_, err := svc.List(context.Background(), ListParams{})
	require.Error(t, err)
}

func TestListCursor_RoundTrip(t *testing.T) {
	t.Parallel()
	encoded := encodeListCursor(42, 2147483647)
	decoded, err := decodeListCursor(encoded)
	require.NoError(t, err)
	require.NotNil(t, decoded)
	assert.Equal(t, int64(42), decoded.ComplaintCount)
	assert.Equal(t, int64(2147483647), decoded.UID)
}

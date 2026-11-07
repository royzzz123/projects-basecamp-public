package complaint

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- fake repository ----------------------------------------------------

type fakeRepo struct {
	page            []ListItem
	lastFilter      ListFilter
	listErr         error
	total           int64
	lastCountFilter ListFilter
	countErr        error
	statuses        []string
	categories      []CategoryOption
	subCategories   []SubCategoryOption

	detail        Detail
	detailErr     error
	timeline      []ActivityEntry
	timelineErr   error
	lastGetID     int64
	lastListLogID int64
}

func (r *fakeRepo) ListPage(_ context.Context, f ListFilter) ([]ListItem, error) {
	r.lastFilter = f
	if r.listErr != nil {
		return nil, r.listErr
	}
	return r.page, nil
}

func (r *fakeRepo) CountFiltered(_ context.Context, f ListFilter) (int64, error) {
	r.lastCountFilter = f
	if r.countErr != nil {
		return 0, r.countErr
	}
	return r.total, nil
}

func (r *fakeRepo) DistinctStatuses(_ context.Context) ([]string, error) { return r.statuses, nil }
func (r *fakeRepo) AllCategories(_ context.Context) ([]CategoryOption, error) {
	return r.categories, nil
}
func (r *fakeRepo) AllSubCategories(_ context.Context) ([]SubCategoryOption, error) {
	return r.subCategories, nil
}

func (r *fakeRepo) GetByID(_ context.Context, id int64) (Detail, error) {
	r.lastGetID = id
	if r.detailErr != nil {
		return Detail{}, r.detailErr
	}
	return r.detail, nil
}

func (r *fakeRepo) ListWorkflow(_ context.Context, id int64) ([]ActivityEntry, error) {
	r.lastListLogID = id
	if r.timelineErr != nil {
		return nil, r.timelineErr
	}
	return r.timeline, nil
}

func newSvc() (*Service, *fakeRepo) {
	repo := &fakeRepo{}
	return NewService(repo, 50, 200), repo
}

// ---- List: limit handling -----------------------------------------------

func TestList_LimitDefaultsWhenUnset(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	_, err := svc.List(context.Background(), ListParams{})
	require.NoError(t, err)
	assert.Equal(t, 51, repo.lastFilter.Limit, "should ask repo for default+1")
}

func TestList_LimitClampedToMax(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	_, err := svc.List(context.Background(), ListParams{Limit: 9999})
	require.NoError(t, err)
	assert.Equal(t, 201, repo.lastFilter.Limit, "should clamp to max+1")
}

func TestList_NegativeLimitFallsBackToDefault(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	_, err := svc.List(context.Background(), ListParams{Limit: -5})
	require.NoError(t, err)
	assert.Equal(t, 51, repo.lastFilter.Limit)
}

// ---- List: cursor encoding ----------------------------------------------

func TestList_NoNextCursorWhenPageNotFull(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.page = []ListItem{
		{ComplaintID: 3}, {ComplaintID: 2}, {ComplaintID: 1},
	}
	out, err := svc.List(context.Background(), ListParams{Limit: 50})
	require.NoError(t, err)
	assert.Nil(t, out.NextCursor)
	assert.Equal(t, 3, len(out.Items))
	assert.Equal(t, 50, out.Limit)
}

func TestList_NextCursorRoundTrip(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	// repo returns limit+1 → service trims one and encodes the cursor from the last kept item
	repo.page = []ListItem{
		{ComplaintID: 30}, {ComplaintID: 20}, {ComplaintID: 10}, {ComplaintID: 5},
	}
	out, err := svc.List(context.Background(), ListParams{Limit: 3})
	require.NoError(t, err)

	require.NotNil(t, out.NextCursor, "page is full → cursor must be set")
	assert.Equal(t, 3, len(out.Items))

	// Cursor decodes back to the last kept item's complaint_id
	decoded, err := decodeCursor(*out.NextCursor)
	require.NoError(t, err)
	require.NotNil(t, decoded)
	assert.Equal(t, int64(10), *decoded)
}

func TestList_InvalidCursorReturnsValidationError(t *testing.T) {
	t.Parallel()
	svc, _ := newSvc()
	_, err := svc.List(context.Background(), ListParams{After: "not-base64!!"})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

// ---- List: filter passthrough -------------------------------------------

func TestList_PassesFiltersToRepo(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	_, err := svc.List(context.Background(), ListParams{
		EntityScreenIDs: []string{"stb10700", " stb10523 "},
		Statuses:        []string{"CLOSED", "START"},
		CategoryCodes:   []string{"cat12"},
		SubCategories:   []string{"Others"},
		CreatedFrom:     "2024-10-01T00:00:00Z",
		CreatedTo:       "2024-12-31T23:59:59Z",
	})
	require.NoError(t, err)

	assert.Equal(t, []string{"stb10700", "stb10523"}, repo.lastFilter.EntityScreenIDs, "should trim and keep order")
	assert.Equal(t, []string{"CLOSED", "START"}, repo.lastFilter.Statuses)
	assert.Equal(t, []string{"cat12"}, repo.lastFilter.CategoryCodes)
	assert.Equal(t, []string{"Others"}, repo.lastFilter.SubCategories)
	require.NotNil(t, repo.lastFilter.CreatedFrom)
	require.NotNil(t, repo.lastFilter.CreatedTo)
	assert.Equal(t, "2024-10-01T00:00:00Z", repo.lastFilter.CreatedFrom.UTC().Format(time.RFC3339))
}

func TestList_EmptyStringsInFiltersAreDropped(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	_, err := svc.List(context.Background(), ListParams{
		Statuses: []string{"", "  ", "OPEN"},
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"OPEN"}, repo.lastFilter.Statuses)
}

func TestList_BadCreatedFromTimestamp(t *testing.T) {
	t.Parallel()
	svc, _ := newSvc()
	_, err := svc.List(context.Background(), ListParams{CreatedFrom: "yesterday"})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

func TestList_ReversedDateRange_Rejected(t *testing.T) {
	t.Parallel()
	svc, _ := newSvc()
	_, err := svc.List(context.Background(), ListParams{
		CreatedFrom: "2025-01-01T00:00:00Z",
		CreatedTo:   "2024-01-01T00:00:00Z",
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

// ---- List: total --------------------------------------------------------

func TestList_TotalReflectsFilteredCount(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.page = []ListItem{{ComplaintID: 3}, {ComplaintID: 2}}
	repo.total = 412

	out, err := svc.List(context.Background(), ListParams{
		Statuses: []string{"CLOSED"},
	})
	require.NoError(t, err)
	assert.Equal(t, int64(412), out.Total, "total comes from CountFiltered, independent of page size")

	// Count must see the same filter axes as ListPage but without the cursor —
	// the filter struct passed in has AfterComplaintID nil, so the count and
	// list filters match here.
	assert.Equal(t, []string{"CLOSED"}, repo.lastCountFilter.Statuses)
}

func TestList_RepoCountErrorPropagates(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.countErr = errors.New("boom")
	_, err := svc.List(context.Background(), ListParams{})
	require.Error(t, err)
}

// ---- List: repo error propagation ---------------------------------------

func TestList_RepoErrorPropagates(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.listErr = errors.New("boom")
	_, err := svc.List(context.Background(), ListParams{})
	require.Error(t, err)
}

// ---- Filters ------------------------------------------------------------

func TestFilters_FansOutInParallel(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.statuses = []string{"CLOSED", "START"}
	repo.categories = []CategoryOption{{Code: "cat12", Name: "Stock Broker"}}
	repo.subCategories = []SubCategoryOption{{Name: "Others"}}

	out, err := svc.Filters(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []string{"CLOSED", "START"}, out.Statuses)
	assert.Len(t, out.Categories, 1)
	assert.Equal(t, "cat12", out.Categories[0].Code)
	assert.Len(t, out.SubCategories, 1)
	assert.Equal(t, "Others", out.SubCategories[0].Name)
}

// ---- Cursor helper ------------------------------------------------------

func TestCursor_EncodeDecodeRoundTrip(t *testing.T) {
	t.Parallel()
	encoded := encodeCursor(1773175)
	decoded, err := decodeCursor(encoded)
	require.NoError(t, err)
	require.NotNil(t, decoded)
	assert.Equal(t, int64(1773175), *decoded)
}

func TestCursor_EmptyStringIsNilWithoutError(t *testing.T) {
	t.Parallel()
	decoded, err := decodeCursor("")
	require.NoError(t, err)
	assert.Nil(t, decoded)
}

// ---- Get: derivations ---------------------------------------------------

func ptrStr(s string) *string { return &s }

// simpleClosedTimeline matches the "1743319" example: START is reached at
// filing, the entity replies with ATR (one row carrying doc_urls), and the
// system closes the case. The complaint's live wfstate is CLOSED.
func simpleClosedTimeline() (Detail, []ActivityEntry) {
	filed := time.Date(2024, 10, 3, 13, 0, 33, 0, time.UTC)
	closed := time.Date(2024, 11, 8, 21, 0, 5, 0, time.UTC)
	startState := "START"
	awaitState := "AWAITING_FOR_REVIEW"
	investor := "Investor"
	entity := "Entity"
	system := "System"
	atrRemarks := "Please find attached ATR"
	d := Detail{
		ComplaintID:     1743319,
		ComplaintCode:   "SEBIE/TN24/KANC/033849/3",
		CreatedAt:       filed,
		FiledDate:       filed,
		ModifiedDateRaw: closed,
		ClosedAt:        &closed,
		CurrentStatus:   "CLOSED",
		Entity:          DetailEntity{ScreenID: "stb10523"},
	}
	timeline := []ActivityEntry{
		{LogID: 1, At: filed, Role: &investor, Action: "level_created", WFState: &startState, DocURLs: []string{}},
		{LogID: 2, At: filed.Add(time.Minute), Role: &investor, Action: "level_auto_assign", WFState: &startState, DocURLs: []string{}},
		{LogID: 3, At: filed.Add(21 * 24 * time.Hour), Role: &entity, Action: "ATR", WFState: &startState, Remarks: &atrRemarks, DocURLs: []string{"doc-a", "doc-b"}},
		{LogID: 4, At: filed.Add(35 * 24 * time.Hour), Role: &system, Action: "CLOSED_BY_SYSTEM", WFState: &awaitState, DocURLs: []string{"doc-b", "doc-c"}},
		{LogID: 5, At: closed, Role: &system, Action: "CLOSED_BY_SYSTEM", WFState: ptrStr("CLOSED"), DocURLs: []string{}},
	}
	return d, timeline
}

func TestGet_DerivesProgression_UniqueInOrder(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.detail, repo.timeline = simpleClosedTimeline()

	out, err := svc.Get(context.Background(), 1743319)
	require.NoError(t, err)

	got := make([]string, 0, len(out.StatusProgression))
	for _, s := range out.StatusProgression {
		got = append(got, s.State)
	}
	assert.Equal(t, []string{"START", "AWAITING_FOR_REVIEW", "CLOSED"}, got, "progression must dedupe and stay chronological")
	assert.True(t, out.StatusProgression[len(out.StatusProgression)-1].Current, "live wfstate gets current=true")
	assert.False(t, out.StatusProgression[0].Current)
}

func TestGet_DerivesProgression_SyntheticCurrentWhenAbsentFromLogs(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	d, timeline := simpleClosedTimeline()
	// Drop the final CLOSED log; tt_complaints still says CLOSED.
	repo.detail = d
	repo.timeline = timeline[:len(timeline)-1]

	out, err := svc.Get(context.Background(), 1743319)
	require.NoError(t, err)

	last := out.StatusProgression[len(out.StatusProgression)-1]
	assert.Equal(t, "CLOSED", last.State, "current_status must appear even without a matching log row")
	assert.True(t, last.ReachedAt.IsZero(), "synthetic step has no reached_at")
	assert.True(t, last.Current)
}

func TestGet_FlattensDocURLs_PreservesOrderAndDedupes(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.detail, repo.timeline = simpleClosedTimeline()

	out, err := svc.Get(context.Background(), 1743319)
	require.NoError(t, err)
	assert.Equal(t, []string{"doc-a", "doc-b", "doc-c"}, out.DocURLs)
}

func TestGet_TimeTaken_NilWhenOpen(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	d, timeline := simpleClosedTimeline()
	d.ClosedAt = nil
	d.CurrentStatus = "AWAITING_FOR_REVIEW"
	repo.detail, repo.timeline = d, timeline

	out, err := svc.Get(context.Background(), 1743319)
	require.NoError(t, err)
	assert.Nil(t, out.TimeTakenSeconds)
	assert.Nil(t, out.TimeTakenLabel)
}

func TestGet_TimeTaken_ComputedWhenClosed(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.detail, repo.timeline = simpleClosedTimeline()

	out, err := svc.Get(context.Background(), 1743319)
	require.NoError(t, err)
	require.NotNil(t, out.TimeTakenSeconds)
	require.NotNil(t, out.TimeTakenLabel)
	// 2024-10-03T13:00:33Z → 2024-11-08T21:00:05Z = 36d 7h 59m 32s → 36d 7h
	assert.Equal(t, int64(36*86400+7*3600+59*60+32), *out.TimeTakenSeconds)
	assert.Equal(t, "36d 7h", *out.TimeTakenLabel)
}

func TestGet_UpdatedAt_FallsBackToModifiedDate_WhenTimelineEmpty(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	d, _ := simpleClosedTimeline()
	repo.detail = d
	repo.timeline = nil

	out, err := svc.Get(context.Background(), 1743319)
	require.NoError(t, err)
	assert.Equal(t, d.ModifiedDateRaw, out.UpdatedAt)
}

func TestGet_UpdatedAt_UsesLastTimelineRowOtherwise(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.detail, repo.timeline = simpleClosedTimeline()

	out, err := svc.Get(context.Background(), 1743319)
	require.NoError(t, err)
	assert.Equal(t, repo.timeline[len(repo.timeline)-1].At, out.UpdatedAt)
}

func TestGet_PropagatesNotFound(t *testing.T) {
	t.Parallel()
	svc, repo := newSvc()
	repo.detailErr = apperror.ErrNotFound

	_, err := svc.Get(context.Background(), 999)
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrNotFound)
}

package dashboard

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- fake repo -----------------------------------------------------------

type fakeRepo struct {
	counts    SummaryCounts
	countsErr error

	subcat    []SubcategoryCount
	subcatErr error

	cat    []CategoryCount
	catErr error

	trend    []CategoryTrendSeries
	trendErr error

	subTrend    []SubcategoryTrendSeries
	subTrendErr error

	total    int64
	totalErr error

	// captured inputs from the most recent call, for assertions.
	gotSummaryFilter Filter
	gotSubcatFilter  Filter
	gotSubcatLimit   int
	gotCatFrom       *time.Time
	gotCatTo         *time.Time
	gotCountFilter   Filter
	gotTrendFrom     *time.Time
	gotTrendTo       *time.Time
	gotTrendGran     string
	gotTrendCodes    []string
}

func (r *fakeRepo) Summary(_ context.Context, f Filter) (SummaryCounts, error) {
	r.gotSummaryFilter = f
	return r.counts, r.countsErr
}

func (r *fakeRepo) VolumeBySubcategory(_ context.Context, f Filter, limit int) ([]SubcategoryCount, error) {
	r.gotSubcatFilter = f
	r.gotSubcatLimit = limit
	return r.subcat, r.subcatErr
}

func (r *fakeRepo) VolumeByCategory(_ context.Context, from, to *time.Time) ([]CategoryCount, error) {
	r.gotCatFrom, r.gotCatTo = from, to
	return r.cat, r.catErr
}

func (r *fakeRepo) CountFiltered(_ context.Context, f Filter) (int64, error) {
	r.gotCountFilter = f
	return r.total, r.totalErr
}

func (r *fakeRepo) VolumeByCategoryTrend(_ context.Context, from, to *time.Time, granularity string, codes []string) ([]CategoryTrendSeries, error) {
	r.gotTrendFrom, r.gotTrendTo, r.gotTrendGran, r.gotTrendCodes = from, to, granularity, codes
	return r.trend, r.trendErr
}

func (r *fakeRepo) VolumeBySubcategoryTrend(_ context.Context, _, _ *time.Time, _ string, _ []string, _ int) ([]SubcategoryTrendSeries, error) {
	return r.subTrend, r.subTrendErr
}

func newService(repo Repository) *Service { return NewService(repo, 50, 200) }

// ===== resolutionRate =====================================================

func TestResolutionRate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		closed, total int64
		want          float64
	}{
		{"zero total -> 0", 0, 0, 0},
		{"no closures", 0, 100, 0},
		{"two thirds", 2, 3, 66.67},
		{"typical", 1034, 1234, 83.79},
		{"full", 50, 50, 100},
		{"catch-up exceeds 100", 5, 4, 125},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.InDelta(t, tt.want, resolutionRate(tt.closed, tt.total), 0.001)
		})
	}
}

// ===== Summary ============================================================

func TestService_Summary_MapsCountsAndParsesFilter(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{counts: SummaryCounts{Total: 1234, Open: 200, Closed: 1034}}

	out, err := newService(repo).Summary(context.Background(), SummaryParams{
		CategoryCodes: []string{" cat12 ", "", "cat8"},
		CreatedFrom:   "2024-01-01T00:00:00Z",
		CreatedTo:     "2024-01-31T00:00:00Z",
	})
	require.NoError(t, err)

	assert.Equal(t, int64(1234), out.Total)
	assert.Equal(t, int64(200), out.Open)
	assert.Equal(t, int64(1034), out.Closed)
	assert.InDelta(t, 83.79, out.ResolutionRate, 0.001)

	// Filter was parsed: codes trimmed/de-blanked, date range bound.
	assert.Equal(t, []string{"cat12", "cat8"}, repo.gotSummaryFilter.CategoryCodes)
	require.NotNil(t, repo.gotSummaryFilter.CreatedFrom)
	require.NotNil(t, repo.gotSummaryFilter.CreatedTo)
	assert.True(t, repo.gotSummaryFilter.HasDateRange())
}

func TestService_Summary_NoDateRange(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{counts: SummaryCounts{Total: 10, Open: 4, Closed: 6}}

	_, err := newService(repo).Summary(context.Background(), SummaryParams{})
	require.NoError(t, err)
	assert.False(t, repo.gotSummaryFilter.HasDateRange(), "no bounds supplied")
	assert.Empty(t, repo.gotSummaryFilter.CategoryCodes)
}

func TestService_Summary_BadDates(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		p    SummaryParams
	}{
		{"bad from", SummaryParams{CreatedFrom: "nonsense"}},
		{"bad to", SummaryParams{CreatedTo: "2024/01/01"}},
		{"from after to", SummaryParams{CreatedFrom: "2024-02-01T00:00:00Z", CreatedTo: "2024-01-01T00:00:00Z"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			_, err := newService(&fakeRepo{}).Summary(context.Background(), tt.p)
			require.Error(t, err)
			assert.ErrorIs(t, err, apperror.ErrValidation)
		})
	}
}

func TestService_Summary_RepoErrorPropagates(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{countsErr: errors.New("boom")}
	_, err := newService(repo).Summary(context.Background(), SummaryParams{})
	require.Error(t, err)
}

// ===== VolumeBySubcategory ================================================

func TestService_VolumeBySubcategory_OK(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{
		subcat: []SubcategoryCount{{SubCategory: "Others", Complaints: 5}},
		total:  42,
	}
	out, err := newService(repo).VolumeBySubcategory(context.Background(), SubcategoryParams{
		CategoryCodes: []string{"cat12"},
		CreatedFrom:   "2024-01-01T00:00:00Z",
	})
	require.NoError(t, err)

	require.Len(t, out.Items, 1)
	assert.Equal(t, "Others", out.Items[0].SubCategory)
	assert.Equal(t, int64(42), out.Total)
	assert.Equal(t, 50, out.Limit, "default limit applied")
	// The same filter feeds both the grouped query and the total count.
	assert.Equal(t, []string{"cat12"}, repo.gotSubcatFilter.CategoryCodes)
	assert.Equal(t, []string{"cat12"}, repo.gotCountFilter.CategoryCodes)
}

func TestService_VolumeBySubcategory_LimitClamp(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   int
		want int
	}{
		{"zero -> default", 0, 50},
		{"negative -> default", -3, 50},
		{"within bounds", 10, 10},
		{"over max -> max", 1000, 200},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeRepo{}
			out, err := newService(repo).VolumeBySubcategory(context.Background(), SubcategoryParams{Limit: tt.in})
			require.NoError(t, err)
			assert.Equal(t, tt.want, out.Limit)
			assert.Equal(t, tt.want, repo.gotSubcatLimit, "clamped limit reaches the repo")
		})
	}
}

func TestService_VolumeBySubcategory_NilItemsBecomeEmpty(t *testing.T) {
	t.Parallel()
	out, err := newService(&fakeRepo{subcat: nil}).VolumeBySubcategory(context.Background(), SubcategoryParams{})
	require.NoError(t, err)
	assert.NotNil(t, out.Items)
	assert.Empty(t, out.Items)
}

func TestService_VolumeBySubcategory_BadDate(t *testing.T) {
	t.Parallel()
	_, err := newService(&fakeRepo{}).VolumeBySubcategory(context.Background(), SubcategoryParams{CreatedFrom: "nope"})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

// ===== VolumeByCategory ===================================================

func TestService_VolumeByCategory_OK(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{
		cat:   []CategoryCount{{CategoryCode: "cat12", CategoryName: "Stock Broker", Complaints: 9}},
		total: 100,
	}
	out, err := newService(repo).VolumeByCategory(context.Background(), CategoryParams{
		CreatedFrom: "2024-01-01T00:00:00Z",
		CreatedTo:   "2024-01-31T00:00:00Z",
	})
	require.NoError(t, err)

	require.Len(t, out.Items, 1)
	assert.Equal(t, "Stock Broker", out.Items[0].CategoryName)
	assert.Equal(t, int64(100), out.Total)
	require.NotNil(t, repo.gotCatFrom)
	require.NotNil(t, repo.gotCatTo)
	// No category filter on this endpoint — count is date-only.
	assert.Empty(t, repo.gotCountFilter.CategoryCodes)
}

func TestService_VolumeByCategory_NilItemsBecomeEmpty(t *testing.T) {
	t.Parallel()
	out, err := newService(&fakeRepo{cat: nil}).VolumeByCategory(context.Background(), CategoryParams{})
	require.NoError(t, err)
	assert.NotNil(t, out.Items)
	assert.Empty(t, out.Items)
}

func TestService_VolumeByCategory_BadDate(t *testing.T) {
	t.Parallel()
	_, err := newService(&fakeRepo{}).VolumeByCategory(context.Background(), CategoryParams{CreatedTo: "bad"})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

// ===== VolumeByCategoryTrend ==============================================

func TestService_VolumeByCategoryTrend_OK(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{
		trend: []CategoryTrendSeries{
			{
				CategoryCode: "cat12", CategoryName: "Stock Broker", Total: 5,
				Points: []TrendPoint{{Date: "2024-09-01", Count: 3}, {Date: "2024-09-02", Count: 2}},
			},
		},
	}
	out, err := newService(repo).VolumeByCategoryTrend(context.Background(), CategoryTrendParams{
		CreatedFrom:   "2024-09-01T00:00:00Z",
		CreatedTo:     "2024-09-30T00:00:00Z",
		Granularity:   "  Week  ",
		CategoryCodes: []string{" cat12 ", ""},
	})
	require.NoError(t, err)
	assert.Equal(t, "week", out.Granularity)
	require.Len(t, out.Series, 1)
	assert.Equal(t, "Stock Broker", out.Series[0].CategoryName)
	assert.Len(t, out.Series[0].Points, 2)
	// Granularity is normalised and propagated to the repo.
	assert.Equal(t, "week", repo.gotTrendGran)
	// Blank codes are stripped before reaching the repo.
	assert.Equal(t, []string{"cat12"}, repo.gotTrendCodes)
}

func TestService_VolumeByCategoryTrend_DefaultsToDay(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{trend: []CategoryTrendSeries{}}
	out, err := newService(repo).VolumeByCategoryTrend(context.Background(), CategoryTrendParams{})
	require.NoError(t, err)
	assert.Equal(t, "day", out.Granularity)
	assert.Equal(t, "day", repo.gotTrendGran)
	assert.NotNil(t, out.Series)
}

func TestService_VolumeByCategoryTrend_InvalidGranularity(t *testing.T) {
	t.Parallel()
	_, err := newService(&fakeRepo{}).VolumeByCategoryTrend(context.Background(), CategoryTrendParams{Granularity: "year"})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

func TestService_VolumeByCategoryTrend_BadDate(t *testing.T) {
	t.Parallel()
	_, err := newService(&fakeRepo{}).VolumeByCategoryTrend(context.Background(), CategoryTrendParams{CreatedFrom: "nonsense"})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

func TestService_VolumeByCategoryTrend_NilPointsBecomeEmpty(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{trend: []CategoryTrendSeries{{CategoryCode: "cat12", CategoryName: "Stock Broker", Total: 0, Points: nil}}}
	out, err := newService(repo).VolumeByCategoryTrend(context.Background(), CategoryTrendParams{})
	require.NoError(t, err)
	require.Len(t, out.Series, 1)
	assert.NotNil(t, out.Series[0].Points)
}

// ===== VolumeBySubcategoryTrend ===========================================

func TestService_VolumeBySubcategoryTrend_OK(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{
		subTrend: []SubcategoryTrendSeries{
			{SubCategory: "Others", Total: 5, Points: []TrendPoint{{Date: "2024-09-01", Count: 3}}},
		},
	}
	out, err := newService(repo).VolumeBySubcategoryTrend(context.Background(), SubcategoryTrendParams{
		CreatedFrom: "2024-09-01T00:00:00Z",
		CreatedTo:   "2024-09-30T00:00:00Z",
		Granularity: "week",
	})
	require.NoError(t, err)
	assert.Equal(t, "week", out.Granularity)
	assert.Equal(t, 50, out.Limit, "default limit applied")
	require.Len(t, out.Series, 1)
	assert.Equal(t, "Others", out.Series[0].SubCategory)
}

func TestService_VolumeBySubcategoryTrend_DefaultsAndLimitClamp(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{subTrend: []SubcategoryTrendSeries{}}
	out, err := newService(repo).VolumeBySubcategoryTrend(context.Background(), SubcategoryTrendParams{Limit: 5000})
	require.NoError(t, err)
	assert.Equal(t, "day", out.Granularity)
	assert.Equal(t, 200, out.Limit, "clamped to max")
	assert.NotNil(t, out.Series)
}

func TestService_VolumeBySubcategoryTrend_InvalidGranularity(t *testing.T) {
	t.Parallel()
	_, err := newService(&fakeRepo{}).VolumeBySubcategoryTrend(context.Background(), SubcategoryTrendParams{Granularity: "decade"})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

func TestService_VolumeBySubcategoryTrend_BadDate(t *testing.T) {
	t.Parallel()
	_, err := newService(&fakeRepo{}).VolumeBySubcategoryTrend(context.Background(), SubcategoryTrendParams{CreatedTo: "nope"})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

func TestService_VolumeBySubcategoryTrend_NilPointsBecomeEmpty(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{subTrend: []SubcategoryTrendSeries{{SubCategory: "Others", Total: 0, Points: nil}}}
	out, err := newService(repo).VolumeBySubcategoryTrend(context.Background(), SubcategoryTrendParams{})
	require.NoError(t, err)
	require.Len(t, out.Series, 1)
	assert.NotNil(t, out.Series[0].Points)
}

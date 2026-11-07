package dashboard

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"golang.org/x/sync/errgroup"
)

// SummaryParams / SubcategoryParams / CategoryParams are the wire-shaped inputs
// the handler hands to the service. All strings are raw query values; the
// service parses, trims and validates them.
type SummaryParams struct {
	CategoryCodes []string
	CreatedFrom   string
	CreatedTo     string
}

type SubcategoryParams struct {
	CategoryCodes []string
	CreatedFrom   string
	CreatedTo     string
	Limit         int
}

type CategoryParams struct {
	CreatedFrom string
	CreatedTo   string
}

// CategoryTrendParams is the wire-shaped input for the
// /v1/dashboard/volume-by-category-trend endpoint. Granularity controls the
// bucket size and accepts "day" (default), "week" or "month". CategoryCodes
// optionally narrows the series returned — useful when the dashboard has the
// category multi-select active.
type CategoryTrendParams struct {
	CategoryCodes []string
	CreatedFrom   string
	CreatedTo     string
	Granularity   string
}

// SubcategoryTrendParams mirrors CategoryTrendParams but groups by
// complaint_sub_category. Limit caps the number of returned series the same
// way as the aggregate volume-by-subcategory endpoint (defaults / max from
// config); category codes scope the contributing complaints.
type SubcategoryTrendParams struct {
	CategoryCodes []string
	CreatedFrom   string
	CreatedTo     string
	Granularity   string
	Limit         int
}

var validTrendGranularities = map[string]struct{}{
	"day":   {},
	"week":  {},
	"month": {},
}

type Service struct {
	repo               Repository
	subcatLimitDefault int
	subcatLimitMax     int
}

func NewService(repo Repository, subcatLimitDefault, subcatLimitMax int) *Service {
	return &Service{
		repo:               repo,
		subcatLimitDefault: subcatLimitDefault,
		subcatLimitMax:     subcatLimitMax,
	}
}

// Summary returns total / open / closed counts plus the derived resolution
// rate. See SummaryResponse for the (intentionally non-summing) semantics.
func (s *Service) Summary(ctx context.Context, p SummaryParams) (SummaryResponse, error) {
	f, err := buildFilter(p.CategoryCodes, p.CreatedFrom, p.CreatedTo)
	if err != nil {
		return SummaryResponse{}, err
	}
	counts, err := s.repo.Summary(ctx, f)
	if err != nil {
		return SummaryResponse{}, err
	}
	return SummaryResponse{
		Total:          counts.Total,
		Open:           counts.Open,
		Closed:         counts.Closed,
		ResolutionRate: resolutionRate(counts.Closed, counts.Total),
	}, nil
}

// VolumeBySubcategory returns the top sub-categories by filed-complaint volume.
// The grouped page and the unfiltered total are fetched in parallel.
func (s *Service) VolumeBySubcategory(ctx context.Context, p SubcategoryParams) (SubcategoryVolumeResponse, error) {
	f, err := buildFilter(p.CategoryCodes, p.CreatedFrom, p.CreatedTo)
	if err != nil {
		return SubcategoryVolumeResponse{}, err
	}
	limit := s.resolveLimit(p.Limit)

	var (
		items []SubcategoryCount
		total int64
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		v, err := s.repo.VolumeBySubcategory(gctx, f, limit)
		items = v
		return err
	})
	g.Go(func() error {
		v, err := s.repo.CountFiltered(gctx, f)
		total = v
		return err
	})
	if err := g.Wait(); err != nil {
		return SubcategoryVolumeResponse{}, err
	}
	if items == nil {
		items = []SubcategoryCount{}
	}
	return SubcategoryVolumeResponse{Items: items, Total: total, Limit: limit}, nil
}

// VolumeByCategory returns every category by filed-complaint volume. It takes
// no category filter (category is the group key); only the date range applies.
func (s *Service) VolumeByCategory(ctx context.Context, p CategoryParams) (CategoryVolumeResponse, error) {
	created, err := parseRange(p.CreatedFrom, p.CreatedTo, "created_at")
	if err != nil {
		return CategoryVolumeResponse{}, err
	}
	f := Filter{CreatedFrom: created.from, CreatedTo: created.to}

	var (
		items []CategoryCount
		total int64
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		v, err := s.repo.VolumeByCategory(gctx, created.from, created.to)
		items = v
		return err
	})
	g.Go(func() error {
		v, err := s.repo.CountFiltered(gctx, f)
		total = v
		return err
	})
	if err := g.Wait(); err != nil {
		return CategoryVolumeResponse{}, err
	}
	if items == nil {
		items = []CategoryCount{}
	}
	return CategoryVolumeResponse{Items: items, Total: total}, nil
}

// VolumeByCategoryTrend returns per-bucket complaint counts per category for
// stacked-time-series rendering. Series are sorted by total descending; each
// series' points are sorted by bucket ascending; only non-zero buckets are
// returned (the frontend zero-fills against its own date axis).
func (s *Service) VolumeByCategoryTrend(ctx context.Context, p CategoryTrendParams) (CategoryTrendResponse, error) {
	created, err := parseRange(p.CreatedFrom, p.CreatedTo, "created_at")
	if err != nil {
		return CategoryTrendResponse{}, err
	}
	granularity, err := resolveTrendGranularity(p.Granularity)
	if err != nil {
		return CategoryTrendResponse{}, err
	}

	series, err := s.repo.VolumeByCategoryTrend(ctx, created.from, created.to, granularity, cleanStrings(p.CategoryCodes))
	if err != nil {
		return CategoryTrendResponse{}, err
	}
	if series == nil {
		series = []CategoryTrendSeries{}
	}
	// Defensive: ensure Points is never null on the wire when a series has no
	// data (shouldn't happen given the pipeline, but cheap to enforce).
	for i := range series {
		if series[i].Points == nil {
			series[i].Points = []TrendPoint{}
		}
	}
	return CategoryTrendResponse{Granularity: granularity, Series: series}, nil
}

// VolumeBySubcategoryTrend returns per-bucket complaint counts per
// sub-category for stacked-time-series rendering. Series are sorted by total
// descending, capped at the configured top-N limit; each series' points are
// sorted by bucket ascending and only non-zero buckets are returned (the
// frontend zero-fills against its own date axis).
func (s *Service) VolumeBySubcategoryTrend(ctx context.Context, p SubcategoryTrendParams) (SubcategoryTrendResponse, error) {
	created, err := parseRange(p.CreatedFrom, p.CreatedTo, "created_at")
	if err != nil {
		return SubcategoryTrendResponse{}, err
	}
	granularity, err := resolveTrendGranularity(p.Granularity)
	if err != nil {
		return SubcategoryTrendResponse{}, err
	}
	limit := s.resolveLimit(p.Limit)

	series, err := s.repo.VolumeBySubcategoryTrend(ctx, created.from, created.to, granularity, cleanStrings(p.CategoryCodes), limit)
	if err != nil {
		return SubcategoryTrendResponse{}, err
	}
	if series == nil {
		series = []SubcategoryTrendSeries{}
	}
	for i := range series {
		if series[i].Points == nil {
			series[i].Points = []TrendPoint{}
		}
	}
	return SubcategoryTrendResponse{Granularity: granularity, Series: series, Limit: limit}, nil
}

func resolveTrendGranularity(raw string) (string, error) {
	g := strings.TrimSpace(strings.ToLower(raw))
	if g == "" {
		return "day", nil
	}
	if _, ok := validTrendGranularities[g]; !ok {
		return "", apperror.ErrValidation.WithMessage("granularity must be one of: day, week, month")
	}
	return g, nil
}

func (s *Service) resolveLimit(raw int) int {
	if raw <= 0 {
		return s.subcatLimitDefault
	}
	if raw > s.subcatLimitMax {
		return s.subcatLimitMax
	}
	return raw
}

// resolutionRate is closed/total as a percentage rounded to two decimals, and 0
// when total is 0. Can exceed 100 because closed and total are different
// populations (see SummaryResponse).
func resolutionRate(closed, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return math.Round(float64(closed)/float64(total)*10000) / 100
}

func buildFilter(categoryCodes []string, fromRaw, toRaw string) (Filter, error) {
	created, err := parseRange(fromRaw, toRaw, "created_at")
	if err != nil {
		return Filter{}, err
	}
	return Filter{
		CategoryCodes: cleanStrings(categoryCodes),
		CreatedFrom:   created.from,
		CreatedTo:     created.to,
	}, nil
}

// --- shared query-value parsing (mirrors internal/complaint/service.go) ------

type parsedRange struct{ from, to *time.Time }

func parseRange(fromRaw, toRaw, field string) (parsedRange, error) {
	from, err := parseRFC3339(fromRaw, field+"_from")
	if err != nil {
		return parsedRange{}, err
	}
	to, err := parseRFC3339(toRaw, field+"_to")
	if err != nil {
		return parsedRange{}, err
	}
	if from != nil && to != nil && from.After(*to) {
		return parsedRange{}, apperror.ErrValidation.WithMessage(field + "_from must be <= " + field + "_to")
	}
	return parsedRange{from: from, to: to}, nil
}

func parseRFC3339(s, field string) (*time.Time, error) {
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, apperror.ErrValidation.WithMessage(field + " must be RFC3339 (e.g. 2024-10-01T00:00:00Z)")
	}
	return &t, nil
}

func cleanStrings(in []string) []string {
	out := in[:0]
	for _, s := range in {
		if t := strings.TrimSpace(s); t != "" {
			out = append(out, t)
		}
	}
	return out
}

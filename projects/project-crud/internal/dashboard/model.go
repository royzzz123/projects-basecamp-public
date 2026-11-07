package dashboard

import "time"

// Filter is the storage-layer view of the dashboard query parameters. The
// service owns parsing/validation/clamping and hands the repo clean, validated
// values. CreatedFrom/CreatedTo bound the "filed in period" window
// (created_date) and are nil when the caller supplied no date range.
type Filter struct {
	CategoryCodes []string
	CreatedFrom   *time.Time
	CreatedTo     *time.Time
}

// HasDateRange reports whether the caller supplied any created_date bound. It
// gates the cohort's created_date clause (and, on the summary, the closed
// count's date_of_closure clause) plus the two volume endpoints' date filter.
func (f Filter) HasDateRange() bool {
	return f.CreatedFrom != nil || f.CreatedTo != nil
}

// SummaryCounts is the raw repository output for the summary endpoint. open is
// derived as total - closed, so total == open + closed.
type SummaryCounts struct {
	Total  int64
	Open   int64
	Closed int64
}

// SummaryResponse is the GET /v1/dashboard/summary payload.
//
// Cohort-progress model. The cohort is the complaints FILED in the date range
// (created_date; all-time when no range), after the category filter:
//   - total  = complaints filed in the window.
//   - closed = of those, the ones that ALSO closed WITHIN the same window
//     (date_of_closure in range; currently-closed when no range is given).
//   - open   = total - closed: filed in the window but not resolved within it
//     (carryover, including any closed later).
//
// total == open + closed.
type SummaryResponse struct {
	Total  int64 `json:"total"`
	Open   int64 `json:"open"`
	Closed int64 `json:"closed"`
	// ResolutionRate is closed/total*100 rounded to two decimals (0 when total
	// is 0): of the complaints filed in the window, the share closed within it.
	ResolutionRate float64 `json:"resolution_rate"`
}

// SubcategoryCount is one row of the volume-by-subcategory breakdown. The bson
// tags decode the aggregation's projected output directly; the json tags shape
// the wire response.
type SubcategoryCount struct {
	SubCategory string `bson:"sub_category" json:"sub_category"`
	Complaints  int64  `bson:"count"        json:"complaints"`
}

// SubcategoryVolumeResponse is the GET /v1/dashboard/volume-by-subcategory
// payload. Items is sorted by complaint count descending and capped at Limit;
// Total is the full matched count (>= the sum of the returned items).
type SubcategoryVolumeResponse struct {
	Items []SubcategoryCount `json:"items"`
	Total int64              `json:"total"`
	Limit int                `json:"limit"`
}

// CategoryCount is one row of the volume-by-category breakdown, with the
// category name resolved from category_master inside the aggregation.
type CategoryCount struct {
	CategoryCode string `bson:"code"  json:"category_code"`
	CategoryName string `bson:"name"  json:"category_name"`
	Complaints   int64  `bson:"count" json:"complaints"`
}

// CategoryVolumeResponse is the GET /v1/dashboard/volume-by-category payload.
// Every category that appears in the filtered window is returned (sorted by
// count descending); Total is the full matched complaint count.
type CategoryVolumeResponse struct {
	Items []CategoryCount `json:"items"`
	Total int64           `json:"total"`
}

// TrendPoint is a single (bucket, count) inside a category's trend series. The
// bucket Date is the bucket start in YYYY-MM-DD form (e.g. "2024-09-01" for
// daily, the Monday for weekly, the 1st for monthly). Buckets with zero
// complaints in the source data are omitted from points — the frontend builds
// the full axis from the request's date range and zero-fills.
type TrendPoint struct {
	Date  string `bson:"date"  json:"date"`
	Count int64  `bson:"count" json:"count"`
}

// CategoryTrendSeries is one category's per-bucket counts. Total is the sum
// across Points (a convenience for legends/sorting).
type CategoryTrendSeries struct {
	CategoryCode string       `bson:"code"   json:"category_code"`
	CategoryName string       `bson:"name"   json:"category_name"`
	Total        int64        `bson:"total"  json:"total"`
	Points       []TrendPoint `bson:"points" json:"points"`
}

// CategoryTrendResponse is the GET /v1/dashboard/volume-by-category-trend
// payload. Series is sorted by Total descending so the largest categories
// stack on top in a typical stacked-area render. Granularity echoes the
// resolved bucket size ("day" | "week" | "month").
type CategoryTrendResponse struct {
	Granularity string                `json:"granularity"`
	Series      []CategoryTrendSeries `json:"series"`
}

// SubcategoryTrendSeries is one sub-category's per-bucket counts. Sub-categories
// have no master-table lookup (they are free-form strings on the complaint
// itself), so there is no resolved name field — only SubCategory.
type SubcategoryTrendSeries struct {
	SubCategory string       `bson:"sub_category" json:"sub_category"`
	Total       int64        `bson:"total"        json:"total"`
	Points      []TrendPoint `bson:"points"       json:"points"`
}

// SubcategoryTrendResponse is the GET /v1/dashboard/volume-by-subcategory-trend
// payload. Series is sorted by Total descending and capped at Limit (the
// effective cap after clamping, same convention as the aggregate
// volume-by-subcategory endpoint).
type SubcategoryTrendResponse struct {
	Granularity string                   `json:"granularity"`
	Series      []SubcategoryTrendSeries `json:"series"`
	Limit       int                      `json:"limit"`
}

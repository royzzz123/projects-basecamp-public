package heatmap

import "time"

// Filter is the storage-layer view of the dashboard filters that scope the
// heatmap. Same shape as the dashboard package's Filter — both bound the
// "filed in period" window (created_date) and OR-combined category codes.
// All zero values mean "no filter" so unfiltered callers (legacy) keep
// working without change.
type Filter struct {
	CategoryCodes []string
	CreatedFrom   *time.Time
	CreatedTo     *time.Time
}

// HasAny reports whether any filter is set. Cheap guard so the repo can skip
// the extra $match stage when callers don't filter.
func (f Filter) HasAny() bool {
	return f.CreatedFrom != nil || f.CreatedTo != nil || len(f.CategoryCodes) > 0
}

// CodeCount is the raw repository output before name resolution: a 2-letter state
// code or a 4-letter district code with its complaint count.
type CodeCount struct {
	Code  string `bson:"_id"`
	Count int64  `bson:"count"`
}

// StateCount is one row of the state-level heatmap.
type StateCount struct {
	StateCode  string `json:"state_code"`
	StateName  string `json:"state_name"`
	Complaints int64  `json:"complaints"`
}

// StateHeatmapResponse is the GET /v1/heatmap payload. Items covers every
// state/UT (zero-filled) so the choropleth colors fully; UnresolvedComplaints
// counts complaints whose 2-letter code did not map to a known state.
type StateHeatmapResponse struct {
	Items                []StateCount `json:"items"`
	Total                int64        `json:"total"`
	UnresolvedComplaints int64        `json:"unresolved_complaints"`
}

// DistrictCount is one row of a state drill-down. Ambiguous is true when the
// 4-letter SEBI code is shared by multiple districts in the state, in which case
// DistrictName is the alphabetically-first candidate.
type DistrictCount struct {
	DistrictCode string `json:"district_code"`
	DistrictName string `json:"district_name"`
	Complaints   int64  `json:"complaints"`
	Ambiguous    bool   `json:"ambiguous,omitempty"`
}

// StateDrilldownResponse is the GET /v1/heatmap/{state_code} payload: the state
// total plus the per-district breakdown. Unresolved holds district codes that
// did not match a known district in the state (kept separate so the state total
// still reconciles).
type StateDrilldownResponse struct {
	StateCode       string          `json:"state_code"`
	StateName       string          `json:"state_name"`
	TotalComplaints int64           `json:"total_complaints"`
	Districts       []DistrictCount `json:"districts"`
	Unresolved      []DistrictCount `json:"unresolved"`
}

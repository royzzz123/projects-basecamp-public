package complaint

import "time"

// ListItem is the wire DTO returned by GET /v1/complaints — exactly the
// columns the supervisory UI shows. The aggregation pipeline projects directly
// into this shape, so the bson tags match the projected field names rather
// than the raw tt_complaints field names.
type ListItem struct {
	ComplaintID      int64     `bson:"complaint_id"      json:"complaint_id"`
	EntityScreenID   string    `bson:"entityscreenid"    json:"entityscreenid"`
	IntermediaryName *string   `bson:"intermediary_name" json:"intermediary_name"`
	Category         *string   `bson:"category"          json:"category"`
	SubCategory      string    `bson:"sub_category"      json:"sub_category"`
	Status           string    `bson:"status"            json:"status"`
	CreatedDate      time.Time `bson:"created_date"      json:"created_date"`
	ModifiedDate     time.Time `bson:"modified_date"     json:"modified_date"`

	// ConciseSummary is the one-line AI summary from complaint_summary.summary.
	// Joined via $lookup at list time so the FE can render an "at-a-glance"
	// column without per-row fetches. Null when the summary hasn't been
	// generated yet for this complaint.
	ConciseSummary *string `bson:"concise_summary" json:"concise_summary,omitempty"`
}

type ListResponse struct {
	Items      []ListItem `json:"items"`
	NextCursor *string    `json:"next_cursor,omitempty"`
	Limit      int        `json:"limit"`
	// Total is the count of complaints matching the request's filters,
	// independent of pagination (cursor + limit).
	Total int64 `json:"total"`
}

type CategoryOption struct {
	Code string `bson:"category_code" json:"code"`
	Name string `bson:"category_name" json:"name"`
}

type SubCategoryOption struct {
	Name string `bson:"sub_category_name" json:"name"`
}

type FiltersResponse struct {
	Statuses      []string            `json:"statuses"`
	Categories    []CategoryOption    `json:"categories"`
	SubCategories []SubCategoryOption `json:"sub_categories"`
}

// ---- Detail (/v1/complaints/:complaint_id) -------------------------------

// Detail is the wire DTO returned by GET /v1/complaints/{complaint_id}. The
// repository populates the raw fields (complaint + entity lookups); the
// service fills in the derived ones — status_progression, doc_urls,
// time_taken_*, updated_at — from the workflow log.
type Detail struct {
	ComplaintID      int64           `bson:"complaint_id"      json:"complaint_id"`
	ComplaintCode    string          `bson:"complaint_code"    json:"complaint_code"`
	ComplaintDetails string          `bson:"complaint_details" json:"complaint_details"`
	SubCategory      string          `bson:"sub_category"      json:"sub_category"`
	Category         *DetailCategory `bson:"category"          json:"category"`

	FiledDate         time.Time  `bson:"filed_date"          json:"filed_date"`
	CreatedAt         time.Time  `bson:"created_at"          json:"created_at"`
	UpdatedAt         time.Time  `bson:"-"                   json:"updated_at"`
	ClosedAt          *time.Time `bson:"closed_at,omitempty" json:"closed_at"`
	TimeTakenSeconds  *int64     `bson:"-"                   json:"time_taken_seconds"`
	TimeTakenLabel    *string    `bson:"-"                   json:"time_taken_label"`
	ModifiedDateRaw   time.Time  `bson:"modified_date_raw"   json:"-"`

	CurrentStatus string       `bson:"current_status" json:"current_status"`
	Entity        DetailEntity `bson:"entity"         json:"entity"`

	StatusProgression []StatusStep    `bson:"-" json:"status_progression"`
	ActivityTimeline  []ActivityEntry `bson:"-" json:"activity_timeline"`
	DocURLs           []string        `bson:"-" json:"doc_urls"`
}

type DetailCategory struct {
	Code string  `bson:"code" json:"code"`
	Name *string `bson:"name" json:"name"`
}

type DetailEntity struct {
	ScreenID           string  `bson:"screen_id"           json:"screen_id"`
	Name               *string `bson:"name"                json:"name"`
	Type               *string `bson:"type"                json:"type"`
	CategoryCode       *string `bson:"category_code"       json:"category_code"`
	CategoryName       *string `bson:"category_name"       json:"category_name"`
	RegistrationNumber *string `bson:"registration_number" json:"registration_number"`
}

// StatusStep is one milestone on the progress bar — the first time the
// complaint entered this wfstate. `Current` marks the most recently reached
// state when it equals the complaint's live wfstate.
type StatusStep struct {
	State     string    `json:"state"`
	ReachedAt time.Time `json:"reached_at"`
	Current   bool      `json:"current"`
}

// ActivityEntry is one row from tr_complaints, surfaced raw to the client.
// DocURLs is populated by the repository — it parses the JSON-encoded
// `doc_url` string column into a Go slice before returning.
type ActivityEntry struct {
	LogID                int64     `bson:"logid"                  json:"log_id"`
	At                   time.Time `bson:"created_date"           json:"at"`
	Role                 *string   `bson:"role"                   json:"role"`
	Action               string    `bson:"action"                 json:"action"`
	WFState              *string   `bson:"wfstate"                json:"wfstate"`
	Remarks              *string   `bson:"remarks"                json:"remarks"`
	DocURLs              []string  `bson:"-"                      json:"doc_urls"`
	CurrentAssigneeRole  *string   `bson:"currentassignerole"     json:"current_assignee_role"`
	DocURLRaw            *string   `bson:"doc_url"                json:"-"`
}

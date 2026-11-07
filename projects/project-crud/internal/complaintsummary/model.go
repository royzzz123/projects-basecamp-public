package complaintsummary

import "time"

// SummaryPayload is the AI-generated structured summary of a single complaint.
type SummaryPayload struct {
	BriefSummary   string   `bson:"brief_summary"   json:"brief_summary"`
	ConciseSummary string   `bson:"concise_summary" json:"concise_summary"` // one-line summary of the complaint
	KeyIssues      []string `bson:"key_issues"      json:"key_issues"`
	Demands        []string `bson:"demands"         json:"demands"`
	Sentiment      string   `bson:"sentiment"       json:"sentiment"`
	Priority       string   `bson:"priority"        json:"priority"`
}

// Summary is the stored document and the response shape for GET and POST.
// ComplaintID is the unique key (one summary per complaint).
type Summary struct {
	ComplaintID      int64          `bson:"complaint_id"             json:"complaint_id"`
	ComplaintCode    *string        `bson:"complaint_code,omitempty" json:"complaint_code,omitempty"`
	Category         *string        `bson:"category,omitempty"       json:"category,omitempty"`
	SubCategory      *string        `bson:"sub_category,omitempty"   json:"sub_category,omitempty"`
	EntityName       *string        `bson:"entity_name,omitempty"    json:"entity_name,omitempty"`
	FiledAt          *time.Time     `bson:"filed_at,omitempty"       json:"filed_at,omitempty"`
	ComplaintDetails string         `bson:"complaint_details"        json:"complaint_details"`
	Summary          SummaryPayload `bson:"summary"                  json:"summary"`
	CreatedAt        time.Time      `bson:"created_at"               json:"created_at"`
	UpdatedAt        time.Time      `bson:"updated_at"               json:"updated_at"`
}

// StoreRequest is the POST body. complaint_id is taken from the URL path.
type StoreRequest struct {
	ComplaintCode    *string        `json:"complaint_code,omitempty"`
	Category         *string        `json:"category,omitempty"`
	SubCategory      *string        `json:"sub_category,omitempty"`
	EntityName       *string        `json:"entity_name,omitempty"`
	FiledAt          *time.Time     `json:"filed_at,omitempty"`
	ComplaintDetails string         `json:"complaint_details"`
	Summary          SummaryPayload `json:"summary"`
}

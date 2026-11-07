package complaintworkflowanalysis

import "time"

// DocSummary mirrors the AI backend's DocSummary Pydantic model: a per-document
// summary produced for one timeline attachment, or an error explaining why the
// summary could not be generated.
type DocSummary struct {
	UUID            string  `bson:"uuid"                        json:"uuid"`
	Summary         *string `bson:"summary,omitempty"           json:"summary,omitempty"`
	Error           *string `bson:"error,omitempty"             json:"error,omitempty"`
	AIGeneratedName *string `bson:"ai_generated_name,omitempty" json:"ai_generated_name,omitempty"`
}

// EnrichedTimelineEntry mirrors the AI backend's EnrichedTimelineEntry. All
// fields are optional because the AI backend produces partial entries when
// upstream data is missing.
type EnrichedTimelineEntry struct {
	At                  *time.Time   `bson:"at,omitempty"                    json:"at,omitempty"`
	Role                *string      `bson:"role,omitempty"                  json:"role,omitempty"`
	Action              *string      `bson:"action,omitempty"                json:"action,omitempty"`
	WFState             *string      `bson:"wfstate,omitempty"               json:"wfstate,omitempty"`
	Remarks             *string      `bson:"remarks,omitempty"               json:"remarks,omitempty"`
	CurrentAssigneeRole *string      `bson:"current_assignee_role,omitempty" json:"current_assignee_role,omitempty"`
	DocSummaries        []DocSummary `bson:"doc_summaries"                   json:"doc_summaries"`
}

// WorkflowAnalysis mirrors the qualitative LLM-generated assessment fields.
type WorkflowAnalysis struct {
	TimelineQuality             *string `bson:"timeline_quality,omitempty"              json:"timeline_quality,omitempty"`
	EntityConduct               *string `bson:"entity_conduct,omitempty"                json:"entity_conduct,omitempty"`
	InvestorGrievanceAssessment *string `bson:"investor_grievance_assessment,omitempty" json:"investor_grievance_assessment,omitempty"`
	OverallSummary              *string `bson:"overall_summary,omitempty"               json:"overall_summary,omitempty"`
}

// Analysis is the stored document and the response shape for GET and POST.
// ComplaintID is the unique key (one analysis per complaint).
type Analysis struct {
	ComplaintID      int64                   `bson:"complaint_id"               json:"complaint_id"`
	ComplaintCode    *string                 `bson:"complaint_code,omitempty"   json:"complaint_code,omitempty"`
	Category         *string                 `bson:"category,omitempty"         json:"category,omitempty"`
	SubCategory      *string                 `bson:"sub_category,omitempty"     json:"sub_category,omitempty"`
	EntityName       *string                 `bson:"entity_name,omitempty"      json:"entity_name,omitempty"`
	FiledAt          *time.Time              `bson:"filed_at,omitempty"         json:"filed_at,omitempty"`
	ClosedAt         *time.Time              `bson:"closed_at,omitempty"        json:"closed_at,omitempty"`
	TimeTakenLabel   *string                 `bson:"time_taken_label,omitempty" json:"time_taken_label,omitempty"`
	CurrentStatus    *string                 `bson:"current_status,omitempty"   json:"current_status,omitempty"`
	EnrichedTimeline []EnrichedTimelineEntry `bson:"enriched_timeline"          json:"enriched_timeline"`
	WorkflowAnalysis WorkflowAnalysis        `bson:"workflow_analysis"          json:"workflow_analysis"`
	CreatedAt        time.Time               `bson:"created_at"                 json:"created_at"`
	UpdatedAt        time.Time               `bson:"updated_at"                 json:"updated_at"`
}

// StoreRequest is the POST body. complaint_id is taken from the URL path, not
// the body — keeps the request and the route in lockstep.
type StoreRequest struct {
	ComplaintCode    *string                 `json:"complaint_code,omitempty"`
	Category         *string                 `json:"category,omitempty"`
	SubCategory      *string                 `json:"sub_category,omitempty"`
	EntityName       *string                 `json:"entity_name,omitempty"`
	FiledAt          *time.Time              `json:"filed_at,omitempty"`
	ClosedAt         *time.Time              `json:"closed_at,omitempty"`
	TimeTakenLabel   *string                 `json:"time_taken_label,omitempty"`
	CurrentStatus    *string                 `json:"current_status,omitempty"`
	EnrichedTimeline []EnrichedTimelineEntry `json:"enriched_timeline"`
	WorkflowAnalysis WorkflowAnalysis        `json:"workflow_analysis"`
}

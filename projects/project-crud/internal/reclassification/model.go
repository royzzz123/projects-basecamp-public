package reclassification

import "time"

// OriginalSubCategory is the sentinel sub-category we re-classify *out of*.
const OriginalSubCategory = "Others"

// Suggestion is the AI's output written by POST .../reclassification. It is
// stored in the complaint_reclassifications collection — never on tt_complaints.
type Suggestion struct {
	AIGeneratedSubCategory string     `bson:"ai_generated_sub_category" json:"ai_generated_sub_category"`
	Confidence             int        `bson:"confidence"                json:"confidence"`
	Reasoning              string     `bson:"reasoning"                 json:"reasoning"`
	CreatedAt              *time.Time `bson:"created_at"                json:"created_at,omitempty"`
}

// StoreRequest is the body POSTed by the AI service / backfill script.
// Confidence is 0–100; the service rejects everything outside that range.
type StoreRequest struct {
	AIGeneratedSubCategory string `json:"ai_generated_sub_category" binding:"required"`
	Confidence             int    `json:"confidence"                binding:"required,min=0,max=100"`
	Reasoning              string `json:"reasoning"                 binding:"required"`
}

// Response is the shape returned by GET and POST.
type Response struct {
	ComplaintID         int64       `json:"complaint_id"`
	OriginalSubCategory string      `json:"original_sub_category"`
	Suggestion          *Suggestion `json:"suggestion,omitempty"`
}

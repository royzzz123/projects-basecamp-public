package entity

// ---- Typeahead (/v1/entities/filter) -------------------------------------

// FilterItem is the wire DTO returned by GET /v1/entities/filter. `userid` in
// entity_master is the same identifier the complaints list accepts as
// `entityscreenid` — we expose it on the wire as `id`.
type FilterItem struct {
	ID   string `bson:"userid" json:"id"`
	Name string `bson:"name"   json:"name"`
}

type FilterResponse struct {
	Items      []FilterItem `json:"items"`
	NextCursor *string      `json:"next_cursor,omitempty"`
	Limit      int          `json:"limit"`
}

// ---- Full list with counts (/v1/entities) --------------------------------

// ListItem is the wire DTO returned by GET /v1/entities. The Phase-A
// aggregation projects the first five fields into this struct via bson tags;
// the three count fields are populated in-process from the Phase-B group
// query (so their bson tags are `-`).
type ListItem struct {
	ID                 string  `bson:"id"                  json:"id"`
	Entity             string  `bson:"entity"              json:"entity"`
	EntityType         string  `bson:"entity_type"         json:"entity_type"`
	Category           *string `bson:"category"            json:"category"`
	RegistrationNumber *string `bson:"registration_number" json:"registration_number"`
	TotalComplaints    int64   `bson:"-"                   json:"total_complaints"`
	OpenComplaints     int64   `bson:"-"                   json:"open_complaints"`
	ClosedComplaints   int64   `bson:"-"                   json:"closed_complaints"`
	// Escalation counts are the number of distinct complaints for this entity
	// that have at least one tr_complaints row whose `action` is
	// FIRST_LEVEL_REVIEW / SECOND_LEVEL_REVIEW respectively. Percentages are
	// over TotalComplaints; 0 when TotalComplaints is 0.
	FirstLevelReviewEscalated      int64   `bson:"-" json:"first_level_review_escalated"`
	FirstLevelReviewEscalationPct  float64 `bson:"-" json:"first_level_review_escalation_pct"`
	SecondLevelReviewEscalated     int64   `bson:"-" json:"second_level_review_escalated"`
	SecondLevelReviewEscalationPct float64 `bson:"-" json:"second_level_review_escalation_pct"`
}

type ListResponse struct {
	Items      []ListItem `json:"items"`
	NextCursor *string    `json:"next_cursor,omitempty"`
	Limit      int        `json:"limit"`
	// Total is the count of entities matching the request's filters,
	// independent of pagination (cursor + limit).
	Total int64 `json:"total"`
}

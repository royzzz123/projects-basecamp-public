package keyword

// Keyword is a single extracted term with its document frequency.
type Keyword struct {
	Word  string `json:"word"`
	Count int    `json:"count"` // number of complaints containing this word
}

// Response is the GET /v1/keywords payload.
type Response struct {
	Keywords       []Keyword `json:"keywords"`
	ComplaintCount int       `json:"complaint_count"`
}

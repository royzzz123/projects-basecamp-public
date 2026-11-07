package geo

import "strings"

// ParseComplaintCode extracts the canonical state code and the 4-letter district
// prefix from a SEBI complaint code like "SEBIE/UP24/GOND/034396/1".
//
//	"SEBIE/UP24/GOND/034396/1" -> ("UP", "GOND", true)
//	"SEBIE/TS24/HYDE/000001/1" -> ("TG", "HYDE", true)  // TS aliased to TG
//
// The state is canonicalized (aliases resolved). ok is false when the code is
// missing the expected segments. The aggregation does the equivalent split in
// MongoDB for counting; this function is the single-code resolver used by tests
// and any ad-hoc validation.
func ParseComplaintCode(code string) (state, district string, ok bool) {
	parts := strings.Split(code, "/")
	if len(parts) < 3 {
		return "", "", false
	}
	region := parts[1] // e.g. "UP24"
	if len(region) < 2 {
		return "", "", false
	}
	state = Canonical(region[:2])
	district = Prefix4(parts[2])
	if state == "" || district == "" {
		return "", "", false
	}
	return state, district, true
}

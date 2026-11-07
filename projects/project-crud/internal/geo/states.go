package geo

import (
	"sort"
	"strings"
)

// State is a canonical state/UT entry for API output.
type State struct {
	Code string `json:"state_code"`
	Name string `json:"state_name"`
}

// AllStates returns every state/UT in canonical-code order. The heatmap uses
// this to zero-fill every region so the choropleth colors fully even where
// there are no complaints.
func AllStates() []State {
	out := make([]State, 0, len(orderedCodes))
	for _, code := range orderedCodes {
		out = append(out, State{Code: code, Name: statesByCode[code].Name})
	}
	return out
}

// StateName returns the display name for a canonical code, and whether it is a
// known state/UT.
func StateName(code string) (string, bool) {
	rec, ok := statesByCode[code]
	if !ok {
		return "", false
	}
	return rec.Name, true
}

// stateAliases maps non-canonical 2-letter codes seen in complaint codes to the
// canonical code used by our dataset. SEBI SCORES uses its own state-code set
// that differs from the RTO/ISO codes for a sizeable group of states — every
// entry below the divider was confirmed against the live complaint data by
// inspecting the district codes filed under it (e.g. DH carries Delhi districts
// North/South/West/Central + Shahdara; KN carries Bengaluru, Dakshina Kannada).
var stateAliases = map[string]string{
	// RTO/ISO/older spellings.
	"OR": "OD", // Odisha (older)
	"TS": "TG", // Telangana (RTO uses TS; we key on TG)
	"UA": "UK", // Uttarakhand (older)
	"UT": "UK", // Uttarakhand (ISO)
	"CT": "CG", // Chhattisgarh (ISO)

	// SEBI SCORES-specific codes (confirmed from the complaint data).
	"DH": "DL", // Delhi
	"KN": "KA", // Karnataka
	"HY": "HR", // Haryana
	"BH": "BR", // Bihar
	"UC": "UK", // Uttarakhand (Uttaranchal)
	"GD": "GA", // Goa
	"PC": "PY", // Puducherry
	"MG": "ML", // Meghalaya
}

// Canonical normalizes a raw 2-letter code (as parsed from a complaint code) to
// the canonical code. Unknown codes are returned uppercased and unchanged.
func Canonical(code string) string {
	code = strings.ToUpper(strings.TrimSpace(code))
	if c, ok := stateAliases[code]; ok {
		return c
	}
	return code
}

// Variants returns every raw 2-letter code that resolves to the given canonical
// code (including the canonical code itself). The drill-down query uses this to
// match complaints stamped with either spelling of a state.
func Variants(canonical string) []string {
	canonical = strings.ToUpper(canonical)
	out := []string{canonical}
	for raw, c := range stateAliases {
		if c == canonical {
			out = append(out, raw)
		}
	}
	sort.Strings(out)
	return out
}

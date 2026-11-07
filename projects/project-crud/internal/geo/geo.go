// Package geo resolves the geography encoded in SEBI SCORES complaint codes.
//
// A complaint code looks like "SEBIE/UP24/GOND/034396/1": segment 1 carries the
// 2-letter state code + filing year ("UP24" -> Uttar Pradesh), and segment 2 is
// the first 4 letters of the complainant's district ("GOND" -> Gonda). There is
// no standard package for the district truncation — it's SEBI-specific — so we
// embed an India states+districts dataset and reverse the truncation by indexing
// each district under (state_code, first-4-letters-uppercased).
//
// The package is pure: no Gin, no Mongo. It is the resolver the heatmap service
// uses to turn raw codes from the aggregation into display names.
package geo

import (
	_ "embed"
	"encoding/json"
	"sort"
	"strings"
)

//go:embed data/states_districts.json
var statesDistrictsJSON []byte

// stateRecord is the embedded shape: canonical code -> {name, districts}.
type stateRecord struct {
	Name      string   `json:"name"`
	Districts []string `json:"districts"`
}

// districtEntry is a resolved district plus whether its 4-letter prefix is shared
// by other districts in the same state (the SEBI code can't tell them apart).
type districtEntry struct {
	Name      string
	Ambiguous bool
}

var (
	// statesByCode maps a canonical 2-letter code (the JSON keys) to its record.
	statesByCode map[string]stateRecord
	// orderedCodes is the sorted list of canonical codes for stable output.
	orderedCodes []string
	// districtIndex[code][prefix4] -> resolved district.
	districtIndex map[string]map[string]districtEntry
)

// init parses the embedded dataset and builds the lookup indexes. A failure here
// means the binary shipped with a corrupt asset — a build-time invariant guarded
// by TestEmbeddedDataset — so we fail loudly rather than serve wrong geography.
func init() {
	if err := json.Unmarshal(statesDistrictsJSON, &statesByCode); err != nil {
		panic("geo: invalid embedded states_districts.json: " + err.Error())
	}

	orderedCodes = make([]string, 0, len(statesByCode))
	for code := range statesByCode {
		orderedCodes = append(orderedCodes, code)
	}
	sort.Strings(orderedCodes)

	districtIndex = make(map[string]map[string]districtEntry, len(statesByCode))
	for code, rec := range statesByCode {
		// Group districts by 4-letter prefix so we can detect collisions
		// (e.g. TN "TIRU" matches six districts).
		byPrefix := make(map[string][]string)
		for _, d := range rec.Districts {
			if p := Prefix4(d); p != "" {
				byPrefix[p] = append(byPrefix[p], d)
			}
		}
		idx := make(map[string]districtEntry, len(byPrefix))
		for p, names := range byPrefix {
			sort.Strings(names)
			idx[p] = districtEntry{Name: names[0], Ambiguous: len(names) > 1}
		}
		districtIndex[code] = idx
	}
}

// Prefix4 normalizes a district name or code to the SEBI key: letters only,
// uppercased, first 4 runes. "Gonda" -> "GOND", "Mon" -> "MON",
// "East Siang" -> "EAST". Non-letters (spaces, digits, punctuation) are dropped
// so both the dataset names and the codes truncate the same way.
func Prefix4(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
			r -= 'a' - 'A'
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r)
		default:
			continue
		}
		if b.Len() == 4 {
			break
		}
	}
	return b.String()
}

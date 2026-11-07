package geo

// DistrictName resolves a (canonical state code, district prefix) to a district
// display name.
//
//   - ambiguous is true when the 4-letter prefix is shared by more than one
//     district in that state; the SEBI code cannot disambiguate, so name is the
//     alphabetically-first candidate. Callers should surface this rather than
//     present it as certain.
//   - ok is false when the state is unknown or no district matches the prefix.
//
// The prefix argument is normalized with Prefix4, so passing either a raw code
// ("GOND") or a full name ("Gonda") works.
func DistrictName(stateCode, prefix string) (name string, ambiguous, ok bool) {
	idx, ok := districtIndex[stateCode]
	if !ok {
		return "", false, false
	}
	e, ok := idx[Prefix4(prefix)]
	if !ok {
		return "", false, false
	}
	return e.Name, e.Ambiguous, true
}

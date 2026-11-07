package geo

import (
	"encoding/json"
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPrefix4(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"Gonda":       "GOND",
		"gonda":       "GOND",
		"Agra":        "AGRA",
		"Kanchipuram": "KANC",
		"Mon":         "MON", // 3-letter district stays 3
		"East Siang":  "EAST",
		"YSR Kadapa":  "YSRK",
		"  ":          "",
		"24":          "",
	}
	for in, want := range cases {
		assert.Equalf(t, want, Prefix4(in), "Prefix4(%q)", in)
	}
}

func TestParseComplaintCode(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		code         string
		wantState    string
		wantDistrict string
		wantOK       bool
	}{
		{"up gonda", "SEBIE/UP24/GOND/034396/1", "UP", "GOND", true},
		{"tn kanchipuram", "SEBIE/TN24/KANC/033849/3", "TN", "KANC", true},
		{"mh ahmednagar", "SEBIE/MH24/AHME/033855/1", "MH", "AHME", true},
		{"up agra", "SEBIE/UP24/AGRA/033850/1", "UP", "AGRA", true},
		{"telangana alias ts->tg", "SEBIE/TS24/HYDE/000001/1", "TG", "HYDE", true},
		{"too few segments", "SEBIE/UP24", "", "", false},
		{"empty", "", "", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			state, district, ok := ParseComplaintCode(tt.code)
			assert.Equal(t, tt.wantOK, ok)
			assert.Equal(t, tt.wantState, state)
			assert.Equal(t, tt.wantDistrict, district)
		})
	}
}

func TestStateName(t *testing.T) {
	t.Parallel()
	name, ok := StateName("UP")
	require.True(t, ok)
	assert.Equal(t, "Uttar Pradesh", name)

	_, ok = StateName("ZZ")
	assert.False(t, ok, "unknown code is not a state")
}

func TestAllStates_CoversCanonicalSet(t *testing.T) {
	t.Parallel()
	all := AllStates()
	assert.GreaterOrEqual(t, len(all), 36, "all states + UTs present")

	byCode := make(map[string]string, len(all))
	for _, s := range all {
		byCode[s.Code] = s.Name
	}
	assert.Equal(t, "Uttar Pradesh", byCode["UP"])
	assert.Equal(t, "Tamil Nadu", byCode["TN"])
	assert.Equal(t, "Maharashtra", byCode["MH"])
	assert.Contains(t, byCode, "AN", "Andaman & Nicobar present")
	assert.Contains(t, byCode, "LA", "Ladakh present")
}

func TestCanonicalAndVariants(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "OD", Canonical("OR"))
	assert.Equal(t, "TG", Canonical("ts"))
	assert.Equal(t, "UP", Canonical("UP"), "canonical passes through")
	assert.Equal(t, "ZZ", Canonical("zz"), "unknown is uppercased, unchanged")

	// SEBI SCORES-specific codes confirmed against the live data.
	assert.Equal(t, "DL", Canonical("DH"), "Delhi")
	assert.Equal(t, "KA", Canonical("KN"), "Karnataka")
	assert.Equal(t, "HR", Canonical("hy"), "Haryana")
	assert.Equal(t, "BR", Canonical("BH"), "Bihar")
	assert.Equal(t, "GA", Canonical("GD"), "Goa")

	assert.Equal(t, []string{"TG", "TS"}, Variants("TG"))
	assert.Equal(t, []string{"UP"}, Variants("UP"))
	assert.Equal(t, []string{"DH", "DL"}, Variants("DL"), "Delhi drill-down matches the SCORES code")
}

func TestDistrictName(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		state, prefix string
		wantName      string
		wantAmbiguous bool
		wantOK        bool
	}{
		{"up gonda", "UP", "GOND", "Gonda", false, true},
		{"up agra", "UP", "AGRA", "Agra", false, true},
		{"tn kanchipuram", "TN", "KANC", "Kanchipuram", false, true},
		{"mh ahmednagar", "MH", "AHME", "Ahmednagar", false, true},
		{"tn tiru is ambiguous", "TN", "TIRU", "Tiruchirappalli", true, true},
		{"unknown district", "UP", "ZZZZ", "", false, false},
		{"unknown state", "ZZ", "GOND", "", false, false},
		{"accepts full name", "UP", "Gonda", "Gonda", false, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			name, ambiguous, ok := DistrictName(tt.state, tt.prefix)
			assert.Equal(t, tt.wantOK, ok)
			assert.Equal(t, tt.wantName, name)
			assert.Equal(t, tt.wantAmbiguous, ambiguous)
		})
	}
}

// TestEmbeddedDataset guards the build-time invariant that init() relies on: the
// embedded JSON parses, every state has a name and at least one district.
func TestEmbeddedDataset(t *testing.T) {
	t.Parallel()
	var data map[string]stateRecord
	require.NoError(t, json.Unmarshal(statesDistrictsJSON, &data), "embedded dataset must be valid JSON")
	require.GreaterOrEqual(t, len(data), 36)
	for code, rec := range data {
		assert.Lenf(t, code, 2, "state code %q must be 2 letters", code)
		assert.NotEmptyf(t, rec.Name, "state %q missing name", code)
		assert.NotEmptyf(t, rec.Districts, "state %q has no districts", code)
	}
}

// TestPrefixCollisions documents (does not fail on) the prefixes shared by more
// than one district in a state — the inherent ambiguity of a 4-letter code.
// These are the cases DistrictName flags as ambiguous.
func TestPrefixCollisions(t *testing.T) {
	t.Parallel()
	total := 0
	for _, code := range orderedCodes {
		byPrefix := make(map[string][]string)
		for _, d := range statesByCode[code].Districts {
			if p := Prefix4(d); p != "" {
				byPrefix[p] = append(byPrefix[p], d)
			}
		}
		prefixes := make([]string, 0, len(byPrefix))
		for p, names := range byPrefix {
			if len(names) > 1 {
				prefixes = append(prefixes, p)
			}
		}
		sort.Strings(prefixes)
		for _, p := range prefixes {
			total++
			t.Logf("%s %s -> %v", code, p, byPrefix[p])
		}
	}
	t.Logf("total ambiguous prefixes: %d", total)
}

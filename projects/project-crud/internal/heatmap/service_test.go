package heatmap

import (
	"context"
	"errors"
	"testing"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/OnFinance/project-crud/internal/geo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- fake repo -----------------------------------------------------------

type fakeRepo struct {
	byState    []CodeCount
	byStateErr error

	byDistrict     []CodeCount
	byDistrictErr  error
	lastStateCodes []string
}

func (r *fakeRepo) CountByState(_ context.Context, _ Filter) ([]CodeCount, error) {
	if r.byStateErr != nil {
		return nil, r.byStateErr
	}
	return r.byState, nil
}

func (r *fakeRepo) CountByDistrict(_ context.Context, _ Filter, codes []string) ([]CodeCount, error) {
	r.lastStateCodes = codes
	if r.byDistrictErr != nil {
		return nil, r.byDistrictErr
	}
	return r.byDistrict, nil
}

func findState(items []StateCount, code string) (StateCount, bool) {
	for _, it := range items {
		if it.StateCode == code {
			return it, true
		}
	}
	return StateCount{}, false
}

// ===== StateHeatmap =======================================================

func TestStateHeatmap_ResolveMergeZeroFillSort(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{byState: []CodeCount{
		{Code: "UP", Count: 152},
		{Code: "TN", Count: 88},
		{Code: "MH", Count: 5},
		{Code: "ZZ", Count: 3}, // unknown -> unresolved
		{Code: "TS", Count: 2}, // alias of TG
		{Code: "TG", Count: 4}, // merges with TS -> 6
	}}
	out, err := NewService(repo).StateHeatmap(context.Background(), Params{})
	require.NoError(t, err)

	// Every state/UT is present (zero-filled) so the choropleth colors fully.
	assert.Len(t, out.Items, len(geo.AllStates()))
	assert.Equal(t, int64(254), out.Total, "total counts every grouped complaint")
	assert.Equal(t, int64(3), out.UnresolvedComplaints, "ZZ did not resolve")

	// Sorted by count desc — UP leads.
	assert.Equal(t, "UP", out.Items[0].StateCode)
	assert.Equal(t, int64(152), out.Items[0].Complaints)

	tg, ok := findState(out.Items, "TG")
	require.True(t, ok)
	assert.Equal(t, int64(6), tg.Complaints, "TS folded into TG")
	assert.Equal(t, "Telangana", tg.StateName)

	ga, ok := findState(out.Items, "GA")
	require.True(t, ok)
	assert.Equal(t, int64(0), ga.Complaints, "states with no complaints are zero-filled")
}

func TestStateHeatmap_RepoErrorPropagates(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{byStateErr: errors.New("boom")}
	_, err := NewService(repo).StateHeatmap(context.Background(), Params{})
	require.Error(t, err)
}

// ===== StateDrilldown =====================================================

func TestStateDrilldown_UnknownState_Validation(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{}
	_, err := NewService(repo).StateDrilldown(context.Background(), "ZZ", Params{})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
	assert.Nil(t, repo.lastStateCodes, "repo not queried for an unknown state")
}

func TestStateDrilldown_ResolvesDistricts(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{byDistrict: []CodeCount{
		{Code: "GOND", Count: 12},
		{Code: "AGRA", Count: 9},
		{Code: "ZZZZ", Count: 2}, // no such district -> unresolved
	}}
	out, err := NewService(repo).StateDrilldown(context.Background(), "UP", Params{})
	require.NoError(t, err)

	assert.Equal(t, []string{"UP"}, repo.lastStateCodes)
	assert.Equal(t, "UP", out.StateCode)
	assert.Equal(t, "Uttar Pradesh", out.StateName)
	assert.Equal(t, int64(23), out.TotalComplaints)

	require.Len(t, out.Districts, 2)
	assert.Equal(t, "Gonda", out.Districts[0].DistrictName, "sorted by count desc")
	assert.Equal(t, int64(12), out.Districts[0].Complaints)
	assert.Equal(t, "Agra", out.Districts[1].DistrictName)

	require.Len(t, out.Unresolved, 1)
	assert.Equal(t, "ZZZZ", out.Unresolved[0].DistrictCode)
	assert.Equal(t, int64(2), out.Unresolved[0].Complaints)
}

func TestStateDrilldown_AmbiguousPrefixFlagged(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{byDistrict: []CodeCount{{Code: "TIRU", Count: 7}}}
	out, err := NewService(repo).StateDrilldown(context.Background(), "TN", Params{})
	require.NoError(t, err)
	require.Len(t, out.Districts, 1)
	assert.True(t, out.Districts[0].Ambiguous, "TIRU matches several TN districts")
	assert.Equal(t, "Tiruchirappalli", out.Districts[0].DistrictName)
}

func TestStateDrilldown_AliasCanonicalized(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{}
	out, err := NewService(repo).StateDrilldown(context.Background(), "OR", Params{}) // Odisha alias
	require.NoError(t, err)
	assert.Equal(t, "OD", out.StateCode)
	assert.Equal(t, "Odisha", out.StateName)
	assert.Equal(t, []string{"OD", "OR"}, repo.lastStateCodes, "matches both spellings")
}

func TestStateDrilldown_LowercaseAccepted(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{}
	out, err := NewService(repo).StateDrilldown(context.Background(), "up", Params{})
	require.NoError(t, err)
	assert.Equal(t, "UP", out.StateCode)
}

func TestStateDrilldown_RepoErrorPropagates(t *testing.T) {
	t.Parallel()
	repo := &fakeRepo{byDistrictErr: errors.New("boom")}
	_, err := NewService(repo).StateDrilldown(context.Background(), "UP", Params{})
	require.Error(t, err)
}

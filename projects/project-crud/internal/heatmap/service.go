package heatmap

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/OnFinance/project-crud/internal/geo"
)

// Params is the wire-shaped input both endpoints accept on every request.
// All fields optional — empty means "no filter" (lifetime aggregate, every
// category) which is how the endpoints behaved before this change.
type Params struct {
	CategoryCodes []string
	CreatedFrom   string
	CreatedTo     string
}

// Service turns the raw code counts from the repository into resolved,
// presentation-ready heatmap payloads using the geo resolver. Like complaints,
// these are public-regulatory records with no per-org owner, so there is no
// org_id scoping (see internal/complaint/service.go).
type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// StateHeatmap returns one row per state/UT (zero-filled), sorted by complaint
// count descending. Complaints whose 2-letter code does not resolve to a known
// state are summed into UnresolvedComplaints rather than dropped. Params
// scopes the cohort (date range + category multi-select) — pass a zero value
// for the legacy unfiltered behaviour.
func (s *Service) StateHeatmap(ctx context.Context, p Params) (StateHeatmapResponse, error) {
	f, err := buildFilter(p)
	if err != nil {
		return StateHeatmapResponse{}, err
	}
	raw, err := s.repo.CountByState(ctx, f)
	if err != nil {
		return StateHeatmapResponse{}, err
	}

	// Fold raw 2-letter codes into canonical codes (OR->OD, TS->TG, ...).
	counts := make(map[string]int64)
	var unresolved, total int64
	for _, rc := range raw {
		total += rc.Count
		canon := geo.Canonical(rc.Code)
		if _, ok := geo.StateName(canon); !ok {
			unresolved += rc.Count
			continue
		}
		counts[canon] += rc.Count
	}

	states := geo.AllStates()
	items := make([]StateCount, 0, len(states))
	for _, st := range states {
		items = append(items, StateCount{
			StateCode:  st.Code,
			StateName:  st.Name,
			Complaints: counts[st.Code],
		})
	}
	sortByCountDesc(items, func(x StateCount) (int64, string) { return x.Complaints, x.StateCode })

	return StateHeatmapResponse{Items: items, Total: total, UnresolvedComplaints: unresolved}, nil
}

// StateDrilldown returns the per-district breakdown for one state. rawCode is the
// path parameter; it is canonicalized and validated against the known states.
// District codes that do not match a known district are returned under
// Unresolved so the state total still reconciles.
func (s *Service) StateDrilldown(ctx context.Context, rawCode string, p Params) (StateDrilldownResponse, error) {
	code := geo.Canonical(rawCode)
	name, ok := geo.StateName(code)
	if !ok {
		return StateDrilldownResponse{}, apperror.ErrValidation.WithMessage("unknown state code: " + rawCode)
	}
	f, err := buildFilter(p)
	if err != nil {
		return StateDrilldownResponse{}, err
	}

	raw, err := s.repo.CountByDistrict(ctx, f, geo.Variants(code))
	if err != nil {
		return StateDrilldownResponse{}, err
	}

	districts := make([]DistrictCount, 0, len(raw))
	unresolved := make([]DistrictCount, 0)
	var total int64
	for _, rc := range raw {
		total += rc.Count
		dName, ambiguous, found := geo.DistrictName(code, rc.Code)
		if !found {
			unresolved = append(unresolved, DistrictCount{DistrictCode: rc.Code, Complaints: rc.Count})
			continue
		}
		districts = append(districts, DistrictCount{
			DistrictCode: rc.Code,
			DistrictName: dName,
			Complaints:   rc.Count,
			Ambiguous:    ambiguous,
		})
	}
	sortByCountDesc(districts, func(x DistrictCount) (int64, string) { return x.Complaints, x.DistrictCode })
	sortByCountDesc(unresolved, func(x DistrictCount) (int64, string) { return x.Complaints, x.DistrictCode })

	return StateDrilldownResponse{
		StateCode:       code,
		StateName:       name,
		TotalComplaints: total,
		Districts:       districts,
		Unresolved:      unresolved,
	}, nil
}

// buildFilter parses and validates the wire-shaped Params into a storage-layer
// Filter. Empty values stay nil/empty so the repository skips the prefilter
// stage and behaves exactly like before this change.
func buildFilter(p Params) (Filter, error) {
	from, err := parseRFC3339(p.CreatedFrom, "created_at_from")
	if err != nil {
		return Filter{}, err
	}
	to, err := parseRFC3339(p.CreatedTo, "created_at_to")
	if err != nil {
		return Filter{}, err
	}
	if from != nil && to != nil && from.After(*to) {
		return Filter{}, apperror.ErrValidation.WithMessage("created_at_from must be <= created_at_to")
	}
	return Filter{
		CategoryCodes: cleanStrings(p.CategoryCodes),
		CreatedFrom:   from,
		CreatedTo:     to,
	}, nil
}

func parseRFC3339(s, field string) (*time.Time, error) {
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, apperror.ErrValidation.WithMessage(field + " must be RFC3339 (e.g. 2024-10-01T00:00:00Z)")
	}
	return &t, nil
}

func cleanStrings(in []string) []string {
	out := in[:0]
	for _, s := range in {
		if t := strings.TrimSpace(s); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// sortByCountDesc sorts in place by count descending, breaking ties on a string
// key ascending so output order is deterministic. key extracts (count, tiebreak)
// from an element.
func sortByCountDesc[T any](s []T, key func(T) (int64, string)) {
	sort.Slice(s, func(i, j int) bool {
		ci, ki := key(s[i])
		cj, kj := key(s[j])
		if ci != cj {
			return ci > cj
		}
		return ki < kj
	})
}

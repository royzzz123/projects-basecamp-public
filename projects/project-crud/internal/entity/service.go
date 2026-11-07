package entity

import (
	"context"
	"math"
	"strings"

	"golang.org/x/sync/errgroup"
)

// ---- Wire-shaped service inputs ------------------------------------------

type FilterParams struct {
	Limit int
	Query string
	After string
}

type ListParams struct {
	Limit         int
	After         string
	CategoryCodes []string
	EntityTypes   []string
}

// ---- Service -------------------------------------------------------------

// Service owns paging logic for both entity endpoints. The two endpoints
// have separate page-bound pairs because their use cases differ — the
// typeahead is small (20/100), the table list is bigger (50/200).
type Service struct {
	repo              Repository
	filterPageDefault int
	filterPageMax     int
	listPageDefault   int
	listPageMax       int
}

func NewService(repo Repository, filterDefault, filterMax, listDefault, listMax int) *Service {
	return &Service{
		repo:              repo,
		filterPageDefault: filterDefault,
		filterPageMax:     filterMax,
		listPageDefault:   listDefault,
		listPageMax:       listMax,
	}
}

// ---- Typeahead (/v1/entities/filter) -------------------------------------

func (s *Service) Filter(ctx context.Context, p FilterParams) (FilterResponse, error) {
	limit := clampLimit(p.Limit, s.filterPageDefault, s.filterPageMax)

	after, err := decodeFilterCursor(p.After)
	if err != nil {
		return FilterResponse{}, err
	}

	items, err := s.repo.FilterPage(ctx, FilterQuery{
		Limit:    limit + 1,
		Query:    strings.TrimSpace(p.Query),
		AfterUID: after,
	})
	if err != nil {
		return FilterResponse{}, err
	}

	var nextCursor *string
	if len(items) > limit {
		items = items[:limit]
		c := encodeFilterCursor(items[len(items)-1].ID)
		nextCursor = &c
	}

	return FilterResponse{
		Items:      items,
		NextCursor: nextCursor,
		Limit:      limit,
	}, nil
}

// ---- Full list (/v1/entities) --------------------------------------------

func (s *Service) List(ctx context.Context, p ListParams) (ListResponse, error) {
	limit := clampLimit(p.Limit, s.listPageDefault, s.listPageMax)

	after, err := decodeListCursor(p.After)
	if err != nil {
		return ListResponse{}, err
	}

	filter := ListFilter{
		Limit:         limit + 1,
		After:         after,
		CategoryCodes: cleanStrings(p.CategoryCodes),
		EntityTypes:   cleanStrings(p.EntityTypes),
	}

	// Phase A (paginated rows) and the filtered total count are independent —
	// fan out so we don't pay them sequentially. Phase B (per-entity complaint
	// counts) depends on the page's IDs and runs after this group resolves.
	var (
		rows  []ListRow
		total int64
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		v, err := s.repo.ListPage(gctx, filter)
		rows = v
		return err
	})
	g.Go(func() error {
		v, err := s.repo.CountFiltered(gctx, filter)
		total = v
		return err
	})
	if err := g.Wait(); err != nil {
		return ListResponse{}, err
	}

	var nextCursor *string
	if len(rows) > limit {
		rows = rows[:limit]
		last := rows[len(rows)-1]
		c := encodeListCursor(last.ComplaintCount, last.UID)
		nextCursor = &c
	}

	// Phase B: count complaints for this page in one round-trip.
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	counts, err := s.repo.CountComplaintsForEntities(ctx, ids)
	if err != nil {
		return ListResponse{}, err
	}

	countByID := make(map[string]ComplaintCount, len(counts))
	for _, c := range counts {
		countByID[c.EntityID] = c
	}

	items := make([]ListItem, 0, len(rows))
	for _, r := range rows {
		item := r.ListItem
		if c, ok := countByID[r.ID]; ok {
			item.OpenComplaints = c.Open
			item.ClosedComplaints = c.Closed
			item.TotalComplaints = c.Open + c.Closed
			item.FirstLevelReviewEscalated = c.FirstLevelReviewEscalated
			item.SecondLevelReviewEscalated = c.SecondLevelReviewEscalated
			if item.TotalComplaints > 0 {
				total := float64(item.TotalComplaints)
				item.FirstLevelReviewEscalationPct = roundPct(float64(c.FirstLevelReviewEscalated) / total * 100)
				item.SecondLevelReviewEscalationPct = roundPct(float64(c.SecondLevelReviewEscalated) / total * 100)
			}
		}
		items = append(items, item)
	}

	return ListResponse{
		Items:      items,
		NextCursor: nextCursor,
		Limit:      limit,
		Total:      total,
	}, nil
}

// ---- helpers -------------------------------------------------------------

func clampLimit(raw, def, maxN int) int {
	if raw <= 0 {
		return def
	}
	if raw > maxN {
		return maxN
	}
	return raw
}

// roundPct rounds a percentage to two decimal places.
func roundPct(v float64) float64 {
	return math.Round(v*100) / 100
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

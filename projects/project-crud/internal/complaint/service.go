package complaint

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"golang.org/x/sync/errgroup"
)

// ListParams is the wire-shaped input the handler hands to the service.
// All strings are raw query values; the service is responsible for parsing,
// trimming, and validating.
type ListParams struct {
	Limit           int
	After           string
	EntityScreenIDs []string
	Statuses        []string
	CategoryCodes   []string
	SubCategories   []string
	CreatedFrom     string
	CreatedTo       string
	ModifiedFrom    string
	ModifiedTo      string
}

type Service struct {
	repo        Repository
	pageDefault int
	pageMax     int
}

func NewService(repo Repository, pageDefault, pageMax int) *Service {
	return &Service{repo: repo, pageDefault: pageDefault, pageMax: pageMax}
}

// List paginates complaints. Per CLAUDE.md §8 the org-scoping rule applies
// "EXCEPT when the resource has no org_id" — SEBI complaints are public-regulatory
// records with no per-org owner, so we authenticate + require business_user
// but do not filter by claims.OrgID.
func (s *Service) List(ctx context.Context, p ListParams) (ListResponse, error) {
	limit := s.resolveLimit(p.Limit)

	after, err := decodeCursor(p.After)
	if err != nil {
		return ListResponse{}, err
	}

	created, err := parseRange(p.CreatedFrom, p.CreatedTo, "created_at")
	if err != nil {
		return ListResponse{}, err
	}
	modified, err := parseRange(p.ModifiedFrom, p.ModifiedTo, "modified_at")
	if err != nil {
		return ListResponse{}, err
	}

	filter := ListFilter{
		Limit:                    limit + 1,
		AfterComplaintID:         after,
		EntityScreenIDs:          cleanStrings(p.EntityScreenIDs),
		Statuses:                 cleanStrings(p.Statuses),
		CategoryCodes:            cleanStrings(p.CategoryCodes),
		SubCategories:            cleanStrings(p.SubCategories),
		CreatedFrom:              created.from,
		CreatedTo:                created.to,
		ModifiedFrom: modified.from,
		ModifiedTo:   modified.to,
	}

	// Page fetch and filtered count are independent — fan out so total latency
	// is max(page, count) instead of page + count.
	var (
		items []ListItem
		total int64
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		v, err := s.repo.ListPage(gctx, filter)
		items = v
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
	if len(items) > limit {
		items = items[:limit]
		c := encodeCursor(items[len(items)-1].ComplaintID)
		nextCursor = &c
	}

	return ListResponse{
		Items:      items,
		NextCursor: nextCursor,
		Limit:      limit,
		Total:      total,
	}, nil
}

// Filters fans the three lookup queries out in parallel — they're independent
// and against three different collections, so there's no reason to serialise.
func (s *Service) Filters(ctx context.Context) (FiltersResponse, error) {
	var (
		statuses      []string
		categories    []CategoryOption
		subCategories []SubCategoryOption
	)

	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		v, err := s.repo.DistinctStatuses(gctx)
		statuses = v
		return err
	})
	g.Go(func() error {
		v, err := s.repo.AllCategories(gctx)
		categories = v
		return err
	})
	g.Go(func() error {
		v, err := s.repo.AllSubCategories(gctx)
		subCategories = v
		return err
	})
	if err := g.Wait(); err != nil {
		return FiltersResponse{}, err
	}

	return FiltersResponse{
		Statuses:      statuses,
		Categories:    categories,
		SubCategories: subCategories,
	}, nil
}

// Get returns the complaint detail page payload. It fans GetByID and
// ListWorkflow out in parallel, then derives status_progression, the flat
// doc_urls union, updated_at, and time_taken_* in process.
func (s *Service) Get(ctx context.Context, complaintID int64) (Detail, error) {
	var (
		detail   Detail
		timeline []ActivityEntry
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		v, err := s.repo.GetByID(gctx, complaintID)
		detail = v
		return err
	})
	g.Go(func() error {
		v, err := s.repo.ListWorkflow(gctx, complaintID)
		timeline = v
		return err
	})
	if err := g.Wait(); err != nil {
		return Detail{}, err
	}

	detail.ActivityTimeline = timeline
	detail.StatusProgression = deriveProgression(timeline, detail.CurrentStatus)
	detail.DocURLs = flattenDocURLs(timeline)
	detail.UpdatedAt = deriveUpdatedAt(timeline, detail.ModifiedDateRaw)
	if detail.ClosedAt != nil {
		secs, label := timeTaken(detail.CreatedAt, *detail.ClosedAt)
		detail.TimeTakenSeconds = &secs
		detail.TimeTakenLabel = &label
	}
	return detail, nil
}

// deriveProgression walks the timeline in chronological order and records
// the first time the complaint entered each distinct wfstate. The most
// recently reached state gets `current=true` when it matches the live
// wfstate on the complaint.
func deriveProgression(timeline []ActivityEntry, currentStatus string) []StatusStep {
	seen := make(map[string]struct{}, 4)
	steps := make([]StatusStep, 0, 4)
	for _, e := range timeline {
		if e.WFState == nil || *e.WFState == "" {
			continue
		}
		state := *e.WFState
		if _, ok := seen[state]; ok {
			continue
		}
		seen[state] = struct{}{}
		steps = append(steps, StatusStep{State: state, ReachedAt: e.At})
	}
	// Make sure the live current_status shows up even when the timeline
	// never wrote a log row carrying it (e.g. a state reached purely via
	// a tt_complaints update).
	if currentStatus != "" {
		if _, ok := seen[currentStatus]; !ok {
			steps = append(steps, StatusStep{State: currentStatus})
		}
	}
	for i := range steps {
		if steps[i].State == currentStatus {
			steps[i].Current = true
		}
	}
	return steps
}

// flattenDocURLs returns the union of every step's doc_urls in
// chronological order of first appearance, deduplicated.
func flattenDocURLs(timeline []ActivityEntry) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0)
	for _, e := range timeline {
		for _, id := range e.DocURLs {
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	return out
}

func deriveUpdatedAt(timeline []ActivityEntry, fallback time.Time) time.Time {
	if len(timeline) == 0 {
		return fallback
	}
	return timeline[len(timeline)-1].At
}

// timeTaken returns the duration between filing and closure as a whole
// number of seconds plus a compact "Nd Hh" human label. Negative diffs
// (clock skew, dirty data) are clamped at zero.
func timeTaken(start, end time.Time) (int64, string) {
	d := end.Sub(start)
	if d < 0 {
		d = 0
	}
	secs := int64(d.Seconds())
	days := secs / 86400
	hours := (secs % 86400) / 3600
	return secs, fmt.Sprintf("%dd %dh", days, hours)
}

func (s *Service) resolveLimit(raw int) int {
	if raw <= 0 {
		return s.pageDefault
	}
	if raw > s.pageMax {
		return s.pageMax
	}
	return raw
}

type parsedRange struct{ from, to *time.Time }

func parseRange(fromRaw, toRaw, field string) (parsedRange, error) {
	from, err := parseRFC3339(fromRaw, field+"_from")
	if err != nil {
		return parsedRange{}, err
	}
	to, err := parseRFC3339(toRaw, field+"_to")
	if err != nil {
		return parsedRange{}, err
	}
	if from != nil && to != nil && from.After(*to) {
		return parsedRange{}, apperror.ErrValidation.WithMessage(field + "_from must be <= " + field + "_to")
	}
	return parsedRange{from: from, to: to}, nil
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


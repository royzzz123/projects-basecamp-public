package complaintworkflowanalysis

import (
	"context"
	"fmt"
	"time"
)

type Service struct {
	repo Repository
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

// Store upserts the analysis for the given complaint. The first call sets
// created_at; subsequent calls only refresh updated_at and content.
func (s *Service) Store(ctx context.Context, complaintID int64, req StoreRequest) (Analysis, error) {
	now := s.now().UTC()

	timeline := req.EnrichedTimeline
	if timeline == nil {
		timeline = []EnrichedTimelineEntry{}
	}
	// Backfill empty DocSummaries slices for cleaner wire output.
	for i := range timeline {
		if timeline[i].DocSummaries == nil {
			timeline[i].DocSummaries = []DocSummary{}
		}
	}

	a := Analysis{
		ComplaintID:      complaintID,
		ComplaintCode:    req.ComplaintCode,
		Category:         req.Category,
		SubCategory:      req.SubCategory,
		EntityName:       req.EntityName,
		FiledAt:          req.FiledAt,
		ClosedAt:         req.ClosedAt,
		TimeTakenLabel:   req.TimeTakenLabel,
		CurrentStatus:    req.CurrentStatus,
		EnrichedTimeline: timeline,
		WorkflowAnalysis: req.WorkflowAnalysis,
		UpdatedAt:        now,
		// CreatedAt is set by the repo via $setOnInsert on the first upsert
		// and preserved on subsequent ones.
	}

	if err := s.repo.Upsert(ctx, a); err != nil {
		return Analysis{}, fmt.Errorf("store workflow analysis: %w", err)
	}
	// Re-fetch so the response reflects the persisted CreatedAt (especially
	// important on the first insert — the in-memory `a` has no CreatedAt set).
	return s.repo.GetByComplaintID(ctx, complaintID)
}

func (s *Service) Get(ctx context.Context, complaintID int64) (Analysis, error) {
	return s.repo.GetByComplaintID(ctx, complaintID)
}

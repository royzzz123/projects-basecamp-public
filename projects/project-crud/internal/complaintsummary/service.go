package complaintsummary

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

// Store upserts the summary for the given complaint. The first call sets
// created_at; subsequent calls refresh updated_at and content while
// preserving created_at.
func (s *Service) Store(ctx context.Context, complaintID int64, req StoreRequest) (Summary, error) {
	now := s.now().UTC()

	payload := req.Summary
	if payload.KeyIssues == nil {
		payload.KeyIssues = []string{}
	}
	if payload.Demands == nil {
		payload.Demands = []string{}
	}

	doc := Summary{
		ComplaintID:      complaintID,
		ComplaintCode:    req.ComplaintCode,
		Category:         req.Category,
		SubCategory:      req.SubCategory,
		EntityName:       req.EntityName,
		FiledAt:          req.FiledAt,
		ComplaintDetails: req.ComplaintDetails,
		Summary:          payload,
		UpdatedAt:        now,
		// CreatedAt is set by the repo via $setOnInsert on first upsert.
	}

	if err := s.repo.Upsert(ctx, doc); err != nil {
		return Summary{}, fmt.Errorf("store complaint summary: %w", err)
	}
	// Re-fetch so the response reflects the persisted CreatedAt.
	return s.repo.GetByComplaintID(ctx, complaintID)
}

func (s *Service) Get(ctx context.Context, complaintID int64) (Summary, error) {
	return s.repo.GetByComplaintID(ctx, complaintID)
}

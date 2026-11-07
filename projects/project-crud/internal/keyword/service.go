package keyword

import (
	"context"
	"fmt"
)

const defaultTopN = 5

// Service computes keyword extraction for a given scope.
type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) ForEntity(ctx context.Context, entityID string, n int) (*Response, error) {
	if n <= 0 {
		n = defaultTopN
	}
	texts, total, err := s.repo.FetchEntityTexts(ctx, entityID)
	if err != nil {
		return nil, fmt.Errorf("keyword.ForEntity: %w", err)
	}
	return &Response{
		Keywords:       TopKeywords(texts, n),
		ComplaintCount: total,
	}, nil
}

func (s *Service) ForSubcategory(ctx context.Context, categoryCode, subCategory string, n int) (*Response, error) {
	if n <= 0 {
		n = defaultTopN
	}
	texts, total, err := s.repo.FetchSubcategoryTexts(ctx, categoryCode, subCategory)
	if err != nil {
		return nil, fmt.Errorf("keyword.ForSubcategory: %w", err)
	}
	return &Response{
		Keywords:       TopKeywords(texts, n),
		ComplaintCount: total,
	}, nil
}

package reclassification

import (
	"context"
	"strings"

	"github.com/OnFinance/project-crud/internal/apperror"
)

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Get(ctx context.Context, complaintID int64) (Response, error) {
	orig, sug, err := s.repo.Get(ctx, complaintID)
	if err != nil {
		return Response{}, err
	}
	return Response{
		ComplaintID:         complaintID,
		OriginalSubCategory: orig,
		Suggestion:          sug,
	}, nil
}

func (s *Service) Store(ctx context.Context, complaintID int64, req StoreRequest) (Response, error) {
	aiGenerated := strings.TrimSpace(req.AIGeneratedSubCategory)
	reasoning := strings.TrimSpace(req.Reasoning)

	if aiGenerated == "" {
		return Response{}, apperror.ErrValidation.WithMessage("ai_generated_sub_category is required")
	}
	if aiGenerated == OriginalSubCategory {
		return Response{}, apperror.ErrValidation.WithMessage("ai_generated_sub_category cannot itself be 'Others'")
	}
	if reasoning == "" {
		return Response{}, apperror.ErrValidation.WithMessage("reasoning is required")
	}
	if req.Confidence < 0 || req.Confidence > 100 {
		return Response{}, apperror.ErrValidation.WithMessage("confidence must be between 0 and 100")
	}

	if len(aiGenerated) > 256 {
		aiGenerated = aiGenerated[:256]
	}
	if len(reasoning) > 2000 {
		reasoning = reasoning[:2000]
	}

	sug := Suggestion{
		AIGeneratedSubCategory: aiGenerated,
		Confidence:             req.Confidence,
		Reasoning:              reasoning,
	}
	if err := s.repo.StoreSuggestion(ctx, complaintID, sug); err != nil {
		return Response{}, err
	}
	return s.Get(ctx, complaintID)
}

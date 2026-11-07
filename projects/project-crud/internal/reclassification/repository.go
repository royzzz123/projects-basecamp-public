package reclassification

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Repository is the storage-layer view of the reclassification feature.
// Suggestions live in a dedicated complaint_reclassifications collection so
// tt_complaints stays clean. The original complaint_sub_category is read from
// tt_complaints on Get so the response can show what was filed vs. what the
// AI suggested.
type Repository interface {
	// Get reads the suggestion for one complaint. Returns ErrNotFound when the
	// complaint doesn't exist in tt_complaints. Returns orig, nil, nil when the
	// complaint exists but no suggestion has been stored yet.
	Get(ctx context.Context, complaintID int64) (orig string, s *Suggestion, err error)

	// StoreSuggestion writes (or replaces) a suggestion. The complaint's
	// complaint_sub_category MUST be "Others"; returns ErrValidation otherwise.
	StoreSuggestion(ctx context.Context, complaintID int64, sug Suggestion) error
}

type mongoRepository struct {
	complaints        *mongo.Collection
	reclassifications *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) Repository {
	return &mongoRepository{
		complaints:        db.Collection("tt_complaints"),
		reclassifications: db.Collection("complaint_reclassifications"),
	}
}

// document mirrors the complaint_reclassifications collection shape.
type document struct {
	ComplaintID            int64     `bson:"complaint_id"`
	AIGeneratedSubCategory string    `bson:"ai_generated_sub_category"`
	Confidence             int       `bson:"confidence"`
	Reasoning              string    `bson:"reasoning"`
	CreatedAt              time.Time `bson:"created_at"`
}

func (r *mongoRepository) Get(ctx context.Context, complaintID int64) (string, *Suggestion, error) {
	var comp struct {
		Original string `bson:"complaint_sub_category"`
	}
	err := r.complaints.FindOne(
		ctx,
		bson.M{"complaintid": complaintID},
		options.FindOne().SetProjection(bson.M{"_id": 0, "complaint_sub_category": 1}),
	).Decode(&comp)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return "", nil, apperror.ErrNotFound.WithMessage(fmt.Sprintf("complaint %d not found", complaintID))
	}
	if err != nil {
		return "", nil, fmt.Errorf("reclassification get complaint: %w", err)
	}

	var doc document
	err = r.reclassifications.FindOne(ctx, bson.M{"complaint_id": complaintID}).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return comp.Original, nil, nil
	}
	if err != nil {
		return "", nil, fmt.Errorf("reclassification get suggestion: %w", err)
	}

	sug := &Suggestion{
		AIGeneratedSubCategory: doc.AIGeneratedSubCategory,
		Confidence:             doc.Confidence,
		Reasoning:              doc.Reasoning,
		CreatedAt:              &doc.CreatedAt,
	}
	return comp.Original, sug, nil
}

func (r *mongoRepository) StoreSuggestion(ctx context.Context, complaintID int64, s Suggestion) error {
	n, err := r.complaints.CountDocuments(
		ctx,
		bson.M{"complaintid": complaintID, "complaint_sub_category": OriginalSubCategory},
	)
	if err != nil {
		return fmt.Errorf("reclassification verify complaint: %w", err)
	}
	if n == 0 {
		return apperror.ErrValidation.WithMessage("complaint not found or not in sub_category 'Others'")
	}

	now := time.Now().UTC()
	_, err = r.reclassifications.UpdateOne(
		ctx,
		bson.M{"complaint_id": complaintID},
		bson.M{"$set": bson.M{
			"complaint_id":             complaintID,
			"ai_generated_sub_category": s.AIGeneratedSubCategory,
			"confidence":               s.Confidence,
			"reasoning":                s.Reasoning,
			"created_at":               now,
		}},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		return fmt.Errorf("reclassification store: %w", err)
	}
	return nil
}

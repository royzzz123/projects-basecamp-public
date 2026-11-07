package complaintsummary

import (
	"context"
	"errors"
	"fmt"

	"github.com/OnFinance/project-crud/internal/apperror"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type Repository interface {
	// Upsert writes the summary keyed by complaint_id. created_at is only
	// set on the insert path (via $setOnInsert); subsequent calls preserve
	// the original created_at while refreshing updated_at and content.
	Upsert(ctx context.Context, s Summary) error
	// GetByComplaintID returns the stored summary. Returns apperror.ErrNotFound
	// when no document matches.
	GetByComplaintID(ctx context.Context, complaintID int64) (Summary, error)
}

type mongoRepository struct {
	coll *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) Repository {
	return &mongoRepository{coll: db.Collection("complaint_summary")}
}

func (r *mongoRepository) Upsert(ctx context.Context, s Summary) error {
	set := bson.M{
		"complaint_id":      s.ComplaintID,
		"complaint_code":    s.ComplaintCode,
		"category":          s.Category,
		"sub_category":      s.SubCategory,
		"entity_name":       s.EntityName,
		"filed_at":          s.FiledAt,
		"complaint_details": s.ComplaintDetails,
		"summary":           s.Summary,
		"updated_at":        s.UpdatedAt,
	}
	update := bson.M{
		"$set":         set,
		"$setOnInsert": bson.M{"created_at": s.UpdatedAt},
	}
	_, err := r.coll.UpdateOne(
		ctx,
		bson.M{"complaint_id": s.ComplaintID},
		update,
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		return fmt.Errorf("upsert complaint summary: %w", err)
	}
	return nil
}

func (r *mongoRepository) GetByComplaintID(ctx context.Context, complaintID int64) (Summary, error) {
	var out Summary
	err := r.coll.FindOne(ctx, bson.M{"complaint_id": complaintID}).Decode(&out)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return Summary{}, apperror.ErrNotFound.WithMessage("complaint summary not found")
		}
		return Summary{}, fmt.Errorf("find complaint summary: %w", err)
	}
	return out, nil
}

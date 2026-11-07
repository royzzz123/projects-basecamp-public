package complaintworkflowanalysis

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
	// Upsert writes the analysis keyed by complaint_id. created_at is only
	// set on the insert path (via $setOnInsert); subsequent calls preserve
	// the original created_at while refreshing updated_at and content.
	Upsert(ctx context.Context, a Analysis) error
	// GetByComplaintID returns the stored analysis. Returns apperror.ErrNotFound
	// when no document matches.
	GetByComplaintID(ctx context.Context, complaintID int64) (Analysis, error)
}

type mongoRepository struct {
	coll *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) Repository {
	return &mongoRepository{coll: db.Collection("complaint_workflow_analysis")}
}

func (r *mongoRepository) Upsert(ctx context.Context, a Analysis) error {
	// Build $set without created_at so we never overwrite the original
	// insertion timestamp on subsequent upserts.
	set := bson.M{
		"complaint_id":      a.ComplaintID,
		"complaint_code":    a.ComplaintCode,
		"category":          a.Category,
		"sub_category":      a.SubCategory,
		"entity_name":       a.EntityName,
		"filed_at":          a.FiledAt,
		"closed_at":         a.ClosedAt,
		"time_taken_label":  a.TimeTakenLabel,
		"current_status":    a.CurrentStatus,
		"enriched_timeline": a.EnrichedTimeline,
		"workflow_analysis": a.WorkflowAnalysis,
		"updated_at":        a.UpdatedAt,
	}
	update := bson.M{
		"$set":         set,
		"$setOnInsert": bson.M{"created_at": a.UpdatedAt},
	}
	_, err := r.coll.UpdateOne(
		ctx,
		bson.M{"complaint_id": a.ComplaintID},
		update,
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		return fmt.Errorf("upsert workflow analysis: %w", err)
	}
	return nil
}

func (r *mongoRepository) GetByComplaintID(ctx context.Context, complaintID int64) (Analysis, error) {
	var out Analysis
	err := r.coll.FindOne(ctx, bson.M{"complaint_id": complaintID}).Decode(&out)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return Analysis{}, apperror.ErrNotFound.WithMessage("workflow analysis not found")
		}
		return Analysis{}, fmt.Errorf("find workflow analysis: %w", err)
	}
	return out, nil
}

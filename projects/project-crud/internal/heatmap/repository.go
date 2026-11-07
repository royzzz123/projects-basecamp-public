package heatmap

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// Repository counts complaints grouped by the geography encoded in complaint_code.
// Parsing happens inside MongoDB ($split); name resolution stays in the service.
// The Filter argument scopes the cohort to the dashboard's date range +
// category multi-select — an empty filter means "all complaints" so existing
// callers keep working.
type Repository interface {
	// CountByState groups every complaint by the 2-letter state code (segment 1,
	// first two characters of complaint_code), returning raw code -> count.
	CountByState(ctx context.Context, f Filter) ([]CodeCount, error)
	// CountByDistrict groups complaints whose state code is in stateCodes by the
	// 4-letter district code (segment 2), returning raw code -> count.
	CountByDistrict(ctx context.Context, f Filter, stateCodes []string) ([]CodeCount, error)
}

type mongoRepository struct {
	complaints *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) Repository {
	return &mongoRepository{complaints: db.Collection("tt_complaints")}
}

// codeSegmentsStages is the shared head of both pipelines. When the filter has
// any criterion set we prepend an extra $match so the date-range / category
// scope runs *before* the (slightly heavier) $split + $size validation —
// indexes on created_date and complaint_category make the prefilter fast.
// Returns a fresh slice each call so callers can append without aliasing.
func codeSegmentsStages(f Filter) mongo.Pipeline {
	stages := mongo.Pipeline{}
	if f.HasAny() {
		filter := bson.M{}
		if f.CreatedFrom != nil || f.CreatedTo != nil {
			r := bson.M{}
			if f.CreatedFrom != nil {
				r["$gte"] = *f.CreatedFrom
			}
			if f.CreatedTo != nil {
				r["$lte"] = *f.CreatedTo
			}
			filter["created_date"] = r
		}
		if len(f.CategoryCodes) > 0 {
			filter["complaint_category"] = bson.M{"$in": f.CategoryCodes}
		}
		stages = append(stages, bson.D{{Key: "$match", Value: filter}})
	}
	stages = append(stages,
		bson.D{{Key: "$match", Value: bson.M{"complaint_code": bson.M{"$type": "string"}}}},
		bson.D{{Key: "$project", Value: bson.M{"seg": bson.M{"$split": bson.A{"$complaint_code", "/"}}}}},
		bson.D{{Key: "$match", Value: bson.M{"$expr": bson.M{"$gte": bson.A{bson.M{"$size": "$seg"}, 3}}}}},
	)
	return stages
}

// state2Expr extracts the uppercased 2-letter state code from segment 1 ("UP24" -> "UP").
func state2Expr() bson.M {
	return bson.M{"$toUpper": bson.M{"$substrCP": bson.A{
		bson.M{"$arrayElemAt": bson.A{"$seg", 1}}, 0, 2,
	}}}
}

func (r *mongoRepository) CountByState(ctx context.Context, f Filter) ([]CodeCount, error) {
	pipeline := codeSegmentsStages(f)
	pipeline = append(
		pipeline,
		bson.D{{Key: "$project", Value: bson.M{"state2": state2Expr()}}},
		bson.D{{Key: "$group", Value: bson.M{"_id": "$state2", "count": bson.M{"$sum": 1}}}},
	)
	return r.aggregateCounts(ctx, pipeline, "count complaints by state")
}

func (r *mongoRepository) CountByDistrict(ctx context.Context, f Filter, stateCodes []string) ([]CodeCount, error) {
	if len(stateCodes) == 0 {
		return nil, nil
	}
	pipeline := codeSegmentsStages(f)
	pipeline = append(
		pipeline,
		bson.D{{Key: "$project", Value: bson.M{
			"state2":    state2Expr(),
			"district4": bson.M{"$toUpper": bson.M{"$arrayElemAt": bson.A{"$seg", 2}}},
		}}},
		bson.D{{Key: "$match", Value: bson.M{"state2": bson.M{"$in": stateCodes}}}},
		bson.D{{Key: "$group", Value: bson.M{"_id": "$district4", "count": bson.M{"$sum": 1}}}},
	)
	return r.aggregateCounts(ctx, pipeline, "count complaints by district")
}

func (r *mongoRepository) aggregateCounts(ctx context.Context, pipeline mongo.Pipeline, what string) ([]CodeCount, error) {
	cur, err := r.complaints.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", what, err)
	}
	defer func() { _ = cur.Close(ctx) }() // close error after read is unactionable

	var out []CodeCount
	if err := cur.All(ctx, &out); err != nil {
		return nil, fmt.Errorf("decode %s: %w", what, err)
	}
	return out, nil
}

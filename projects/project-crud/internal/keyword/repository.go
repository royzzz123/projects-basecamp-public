package keyword

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)


// Repository fetches raw complaint text for a given scope.
type Repository interface {
	FetchEntityTexts(ctx context.Context, entityID string) ([]string, int, error)
	FetchSubcategoryTexts(ctx context.Context, categoryCode, subCategory string) ([]string, int, error)
}

type mongoRepository struct {
	complaints *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) Repository {
	return &mongoRepository{
		complaints: db.Collection("tt_complaints"),
	}
}

// FetchEntityTexts returns complaint_details for all complaints filed against entityID.
// entityID is the company_name field value (= userid in entity_master).
func (r *mongoRepository) FetchEntityTexts(ctx context.Context, entityID string) ([]string, int, error) {
	opts := options.Find().SetProjection(bson.M{"_id": 0, "complaint_details": 1})
	cur, err := r.complaints.Find(ctx, bson.M{"company_name": entityID}, opts)
	if err != nil {
		return nil, 0, fmt.Errorf("find entity complaints: %w", err)
	}
	defer cur.Close(ctx)
	return decodeTexts(ctx, cur)
}

// FetchSubcategoryTexts returns complaint_details for all complaints in a given
// (category, sub_category) pair. tt_complaints carries a complaint_category field
// directly (same codes the dashboard uses), so we match on it rather than joining
// through entity_master (which only covers intermediaries, not listed companies).
func (r *mongoRepository) FetchSubcategoryTexts(ctx context.Context, categoryCode, subCategory string) ([]string, int, error) {
	filter := bson.M{"complaint_sub_category": subCategory}
	if categoryCode != "" {
		filter["complaint_category"] = categoryCode
	}
	opts := options.Find().SetProjection(bson.M{"_id": 0, "complaint_details": 1})
	cur, err := r.complaints.Find(ctx, filter, opts)
	if err != nil {
		return nil, 0, fmt.Errorf("find subcategory complaints: %w", err)
	}
	defer cur.Close(ctx)
	return decodeTexts(ctx, cur)
}

// decodeTexts streams cursor rows and extracts complaint_details strings.
// Some rows have complaint_details stored as integers (dirty data) — those are
// decoded via bson.Raw and skipped rather than failing the whole batch.
func decodeTexts(ctx context.Context, cur *mongo.Cursor) ([]string, int, error) {
	var count int
	texts := make([]string, 0, 64)
	for cur.Next(ctx) {
		count++
		var raw bson.Raw
		if err := cur.Decode(&raw); err != nil {
			continue // malformed doc — skip
		}
		v, err := raw.LookupErr("complaint_details")
		if err != nil {
			continue // field absent
		}
		s, ok := v.StringValueOK()
		if ok && s != "" {
			texts = append(texts, s)
		}
	}
	if err := cur.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate complaint texts: %w", err)
	}
	return texts, count, nil
}

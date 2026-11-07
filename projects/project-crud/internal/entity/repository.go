package entity

import (
	"context"
	"fmt"
	"regexp"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// ---- Typeahead filter (/v1/entities/filter) ------------------------------

type FilterQuery struct {
	// Limit is what to ask Mongo for. Service passes PageLimit+1 to detect a next page.
	Limit    int
	Query    string  // prefix; empty = no name filter
	AfterUID *string // cursor on userid
}

// ---- Full list with counts (/v1/entities) --------------------------------

type ListFilter struct {
	Limit         int
	After         *ListCursor // keyset cursor on (complaint_count, uid)
	CategoryCodes []string
	EntityTypes   []string
}

// ListRow is Phase-A output: the ListItem display fields plus the sort-key
// fields (uid, complaint_count) the service needs to derive the next cursor.
// Open/closed counts are filled in Phase B.
type ListRow struct {
	ListItem       `bson:",inline"`
	UID            int64 `bson:"uid"`
	ComplaintCount int64 `bson:"complaint_count"`
}

// ComplaintCount is the Phase-B group result, one row per entity that has at
// least one complaint.
type ComplaintCount struct {
	EntityID                   string
	Open                       int64
	Closed                     int64
	FirstLevelReviewEscalated  int64
	SecondLevelReviewEscalated int64
}

type Repository interface {
	// FilterPage powers the typeahead (sort by userid ASC, prefix match on name).
	FilterPage(ctx context.Context, f FilterQuery) ([]FilterItem, error)
	// ListPage runs the entity-list Phase A: filter + sort by uid DESC + lookup category.
	ListPage(ctx context.Context, f ListFilter) ([]ListRow, error)
	// CountFiltered returns the number of entities matching the same filters
	// as ListPage, ignoring the cursor (AfterUID) and Limit. Service runs it
	// in parallel with ListPage to populate `total`.
	CountFiltered(ctx context.Context, f ListFilter) (int64, error)
	// CountComplaintsForEntities runs the entity-list Phase B: one $group on
	// tt_complaints over the page's IDs.
	CountComplaintsForEntities(ctx context.Context, entityIDs []string) ([]ComplaintCount, error)
}

type mongoRepository struct {
	entities   *mongo.Collection
	complaints *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) Repository {
	return &mongoRepository{
		entities:   db.Collection("entity_master"),
		complaints: db.Collection("tt_complaints"),
	}
}

// ---- Typeahead -----------------------------------------------------------

func (r *mongoRepository) FilterPage(ctx context.Context, f FilterQuery) ([]FilterItem, error) {
	filter := bson.M{}
	if f.Query != "" {
		// Anchored, case-insensitive prefix match. Mongo 5.0+ can use the
		// {name: 1} index for anchored regexes even with `i`.
		filter["name"] = bson.M{
			"$regex":   "^" + regexp.QuoteMeta(f.Query),
			"$options": "i",
		}
	}
	if f.AfterUID != nil {
		filter["userid"] = bson.M{"$gt": *f.AfterUID}
	}

	opts := options.Find().
		SetProjection(bson.M{"_id": 0, "userid": 1, "name": 1}).
		SetSort(bson.D{{Key: "userid", Value: 1}}).
		SetLimit(int64(f.Limit))

	cur, err := r.entities.Find(ctx, filter, opts)
	if err != nil {
		return nil, fmt.Errorf("find entities: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }() // close error after read is unactionable

	var out []FilterItem
	if err := cur.All(ctx, &out); err != nil {
		return nil, fmt.Errorf("decode entities: %w", err)
	}
	return out, nil
}

// ---- Full list — Phase A -------------------------------------------------

// buildListMatch builds the $match shared by ListPage and CountFiltered.
// includeCursor=false drops the cursor so the count reflects the full
// filtered universe rather than the slice past the current page.
//
// Sort order is (complaint_count DESC, uid DESC). Keyset pagination after a
// row with (cc, u) means: every doc with complaint_count < cc, plus rows
// tied at cc but with a smaller uid.
func (r *mongoRepository) buildListMatch(f ListFilter, includeCursor bool) bson.M {
	match := bson.M{}
	if len(f.CategoryCodes) > 0 {
		match["categorycode"] = bson.M{"$in": f.CategoryCodes}
	}
	if len(f.EntityTypes) > 0 {
		match["entitytype"] = bson.M{"$in": f.EntityTypes}
	}
	if includeCursor && f.After != nil {
		match["$or"] = bson.A{
			bson.M{"complaint_count": bson.M{"$lt": f.After.ComplaintCount}},
			bson.M{"complaint_count": f.After.ComplaintCount, "uid": bson.M{"$lt": f.After.UID}},
		}
	}
	return match
}

func (r *mongoRepository) ListPage(ctx context.Context, f ListFilter) ([]ListRow, error) {
	match := r.buildListMatch(f, true)

	pipeline := mongo.Pipeline{}
	if len(match) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: match}})
	}
	pipeline = append(pipeline,
		bson.D{{Key: "$sort", Value: bson.D{
			{Key: "complaint_count", Value: -1},
			{Key: "uid", Value: -1},
		}}},
		bson.D{{Key: "$limit", Value: int64(f.Limit)}},
		bson.D{{Key: "$lookup", Value: bson.M{
			"from":         "category_master",
			"localField":   "categorycode",
			"foreignField": "category_code",
			"as":           "_category",
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$project", Value: bson.M{"_id": 0, "category_name": 1}}},
			},
		}}},
		bson.D{{Key: "$project", Value: bson.M{
			"_id":                 0,
			"id":                  "$userid",
			"uid":                 "$uid",
			"complaint_count":     bson.M{"$ifNull": bson.A{"$complaint_count", 0}},
			"entity":              "$name",
			"entity_type":         "$entitytype",
			"category":            bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_category.category_name", 0}}, nil}},
			"registration_number": bson.M{"$ifNull": bson.A{"$registrationnumber", nil}},
		}}},
	)

	cur, err := r.entities.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("aggregate entities: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }() // close error after read is unactionable

	var rows []ListRow
	if err := cur.All(ctx, &rows); err != nil {
		return nil, fmt.Errorf("decode entity rows: %w", err)
	}
	return rows, nil
}

func (r *mongoRepository) CountFiltered(ctx context.Context, f ListFilter) (int64, error) {
	match := r.buildListMatch(f, false)
	n, err := r.entities.CountDocuments(ctx, match)
	if err != nil {
		return 0, fmt.Errorf("count entities: %w", err)
	}
	return n, nil
}

// ---- Full list — Phase B -------------------------------------------------

// CountComplaintsForEntities returns one row per entity that has at least one
// complaint. Entities with zero complaints don't appear; the service layer
// treats their counts as 0.
//
// The pipeline starts from tt_complaints, joins each complaint into
// tr_complaints (filtered to the two escalation actions only) to discover
// whether the complaint was ever escalated to first- or second-level review,
// then groups by entity to produce open/closed/FLR/SLR counts in one round-trip.
func (r *mongoRepository) CountComplaintsForEntities(ctx context.Context, entityIDs []string) ([]ComplaintCount, error) {
	if len(entityIDs) == 0 {
		return nil, nil
	}
	const (
		actionFLR = "FIRST_LEVEL_REVIEW"
		actionSLR = "SECOND_LEVEL_REVIEW"
	)
	pipeline := mongo.Pipeline{
		bson.D{{Key: "$match", Value: bson.M{
			"entityscreenid": bson.M{"$in": entityIDs},
		}}},
		bson.D{{Key: "$lookup", Value: bson.M{
			"from":         "tr_complaints",
			"localField":   "complaintid",
			"foreignField": "complaintid",
			"as":           "_esc",
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$match", Value: bson.M{
					"action": bson.M{"$in": bson.A{actionFLR, actionSLR}},
				}}},
				bson.D{{Key: "$project", Value: bson.M{"_id": 0, "action": 1}}},
			},
		}}},
		bson.D{{Key: "$addFields", Value: bson.M{
			"has_flr": bson.M{"$in": bson.A{actionFLR, "$_esc.action"}},
			"has_slr": bson.M{"$in": bson.A{actionSLR, "$_esc.action"}},
		}}},
		bson.D{{Key: "$group", Value: bson.M{
			"_id":    "$entityscreenid",
			"open":   bson.M{"$sum": bson.M{"$cond": bson.A{bson.M{"$eq": bson.A{"$wfstate", "CLOSED"}}, 0, 1}}},
			"closed": bson.M{"$sum": bson.M{"$cond": bson.A{bson.M{"$eq": bson.A{"$wfstate", "CLOSED"}}, 1, 0}}},
			"flr":    bson.M{"$sum": bson.M{"$cond": bson.A{"$has_flr", 1, 0}}},
			"slr":    bson.M{"$sum": bson.M{"$cond": bson.A{"$has_slr", 1, 0}}},
		}}},
	}

	cur, err := r.complaints.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("aggregate complaint counts: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }() // close error after read is unactionable

	type groupRow struct {
		EntityID string `bson:"_id"`
		Open     int64  `bson:"open"`
		Closed   int64  `bson:"closed"`
		FLR      int64  `bson:"flr"`
		SLR      int64  `bson:"slr"`
	}
	var raw []groupRow
	if err := cur.All(ctx, &raw); err != nil {
		return nil, fmt.Errorf("decode complaint counts: %w", err)
	}

	out := make([]ComplaintCount, 0, len(raw))
	for _, g := range raw {
		out = append(out, ComplaintCount{
			EntityID:                   g.EntityID,
			Open:                       g.Open,
			Closed:                     g.Closed,
			FirstLevelReviewEscalated:  g.FLR,
			SecondLevelReviewEscalated: g.SLR,
		})
	}
	return out, nil
}

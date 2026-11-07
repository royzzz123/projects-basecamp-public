package complaint

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// ListFilter is the storage-layer view of the query parameters. The service
// owns clamping/parsing and hands the repo a clean, validated value.
type ListFilter struct {
	// Limit is the count the repo should fetch from Mongo. Service passes
	// PageLimit+1 so it can detect whether there's a next page.
	Limit            int
	AfterComplaintID *int64
	EntityScreenIDs  []string
	Statuses         []string
	CategoryCodes    []string
	SubCategories    []string
	CreatedFrom      *time.Time
	CreatedTo        *time.Time
	ModifiedFrom     *time.Time
	ModifiedTo       *time.Time
}

type Repository interface {
	ListPage(ctx context.Context, f ListFilter) ([]ListItem, error)
	// CountFiltered returns the count of complaints matching the same filters
	// as ListPage, ignoring the cursor (AfterComplaintID) and Limit. The
	// service runs it in parallel with ListPage to populate `total`.
	CountFiltered(ctx context.Context, f ListFilter) (int64, error)
	DistinctStatuses(ctx context.Context) ([]string, error)
	AllCategories(ctx context.Context) ([]CategoryOption, error)
	AllSubCategories(ctx context.Context) ([]SubCategoryOption, error)
	// GetByID returns the rich detail view for a single complaint. Joins
	// entity_master + category_master in a single aggregation. Returns
	// apperror.ErrNotFound when no document matches.
	GetByID(ctx context.Context, complaintID int64) (Detail, error)
	// ListWorkflow returns every tr_complaints row for the complaint, sorted
	// chronologically. doc_url is JSON-encoded in storage; this method parses
	// it into DocURLs.
	ListWorkflow(ctx context.Context, complaintID int64) ([]ActivityEntry, error)
}

type mongoRepository struct {
	complaints    *mongo.Collection
	workflow      *mongo.Collection
	categories    *mongo.Collection
	subCategories *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) Repository {
	return &mongoRepository{
		complaints:    db.Collection("tt_complaints"),
		workflow:      db.Collection("tr_complaints"),
		categories:    db.Collection("category_master"),
		subCategories: db.Collection("subcategory_master"),
	}
}

// buildListMatch builds the $match stage shared by ListPage and CountFiltered.
// Pass includeCursor=false from the count path so the total reflects all
// complaints matching the user's filters, not just the ones after the cursor.
func (r *mongoRepository) buildListMatch(f ListFilter, includeCursor bool) bson.M {
	match := bson.M{}
	if len(f.EntityScreenIDs) > 0 {
		match["entityscreenid"] = bson.M{"$in": f.EntityScreenIDs}
	}
	if len(f.Statuses) > 0 {
		match["wfstate"] = bson.M{"$in": f.Statuses}
	}
	if len(f.CategoryCodes) > 0 {
		match["complaint_category"] = bson.M{"$in": f.CategoryCodes}
	}
	if len(f.SubCategories) > 0 {
		match["complaint_sub_category"] = bson.M{"$in": f.SubCategories}
	}
	if f.CreatedFrom != nil || f.CreatedTo != nil {
		match["created_date"] = dateRange(f.CreatedFrom, f.CreatedTo)
	}
	if f.ModifiedFrom != nil || f.ModifiedTo != nil {
		match["modified_date"] = dateRange(f.ModifiedFrom, f.ModifiedTo)
	}
	if includeCursor && f.AfterComplaintID != nil {
		match["complaintid"] = bson.M{"$lt": *f.AfterComplaintID}
	}
	return match
}

func (r *mongoRepository) ListPage(ctx context.Context, f ListFilter) ([]ListItem, error) {
	match := r.buildListMatch(f, true)

	pipeline := mongo.Pipeline{}
	if len(match) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: match}})
	}
	pipeline = append(pipeline,
		bson.D{{Key: "$sort", Value: bson.D{{Key: "complaintid", Value: -1}}}},
		bson.D{{Key: "$limit", Value: int64(f.Limit)}},
		bson.D{{Key: "$lookup", Value: bson.M{
			"from":         "entity_master",
			"localField":   "entityscreenid",
			"foreignField": "userid",
			"as":           "_entity",
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$project", Value: bson.M{"_id": 0, "name": 1}}},
			},
		}}},
		bson.D{{Key: "$lookup", Value: bson.M{
			"from":         "category_master",
			"localField":   "complaint_category",
			"foreignField": "category_code",
			"as":           "_category",
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$project", Value: bson.M{"_id": 0, "category_name": 1}}},
			},
		}}},
		// Pull the AI one-liner if one exists. Lookup is indexed (uniq_complaint_id
		// on complaint_summary) and projects only the one field we need, so it's
		// effectively a hash-join.
		bson.D{{Key: "$lookup", Value: bson.M{
			"from":         "complaint_summary",
			"localField":   "complaintid",
			"foreignField": "complaint_id",
			"as":           "_summary",
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$project", Value: bson.M{"_id": 0, "concise_summary": "$summary.concise_summary"}}},
			},
		}}},
		bson.D{{Key: "$project", Value: bson.M{
			"_id":                     0,
			"complaint_id":            "$complaintid",
			"entityscreenid":          "$entityscreenid",
			"intermediary_name":       bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_entity.name", 0}}, nil}},
			"category":                bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_category.category_name", 0}}, nil}},
			"sub_category":    "$complaint_sub_category",
			"status":          "$wfstate",
			"created_date":    "$created_date",
			"modified_date":   "$modified_date",
			"concise_summary": bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_summary.concise_summary", 0}}, nil}},
		}}},
	)

	cursor, err := r.complaints.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("aggregate complaints: %w", err)
	}
	defer func() { _ = cursor.Close(ctx) }() // close error after read is unactionable

	var items []ListItem
	if err := cursor.All(ctx, &items); err != nil {
		return nil, fmt.Errorf("decode complaints: %w", err)
	}
	return items, nil
}

func (r *mongoRepository) CountFiltered(ctx context.Context, f ListFilter) (int64, error) {
	match := r.buildListMatch(f, false)
	n, err := r.complaints.CountDocuments(ctx, match)
	if err != nil {
		return 0, fmt.Errorf("count complaints: %w", err)
	}
	return n, nil
}

func (r *mongoRepository) DistinctStatuses(ctx context.Context) ([]string, error) {
	res := r.complaints.Distinct(ctx, "wfstate", bson.M{})
	var raw []string
	if err := res.Decode(&raw); err != nil {
		return nil, fmt.Errorf("distinct wfstate: %w", err)
	}
	out := raw[:0]
	for _, s := range raw {
		if s != "" {
			out = append(out, s)
		}
	}
	slices.Sort(out)
	return out, nil
}

func (r *mongoRepository) AllCategories(ctx context.Context) ([]CategoryOption, error) {
	opts := options.Find().
		SetProjection(bson.M{"_id": 0, "category_code": 1, "category_name": 1}).
		SetSort(bson.D{{Key: "category_name", Value: 1}})
	cur, err := r.categories.Find(ctx, bson.M{}, opts)
	if err != nil {
		return nil, fmt.Errorf("find categories: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }() // close error after read is unactionable

	var out []CategoryOption
	if err := cur.All(ctx, &out); err != nil {
		return nil, fmt.Errorf("decode categories: %w", err)
	}
	return out, nil
}

func (r *mongoRepository) AllSubCategories(ctx context.Context) ([]SubCategoryOption, error) {
	opts := options.Find().
		SetProjection(bson.M{"_id": 0, "sub_category_name": 1}).
		SetSort(bson.D{{Key: "sub_category_name", Value: 1}})
	cur, err := r.subCategories.Find(ctx, bson.M{}, opts)
	if err != nil {
		return nil, fmt.Errorf("find sub_categories: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }() // close error after read is unactionable

	var out []SubCategoryOption
	if err := cur.All(ctx, &out); err != nil {
		return nil, fmt.Errorf("decode sub_categories: %w", err)
	}
	return out, nil
}

func (r *mongoRepository) GetByID(ctx context.Context, complaintID int64) (Detail, error) {
	pipeline := mongo.Pipeline{
		bson.D{{Key: "$match", Value: bson.M{"complaintid": complaintID}}},
		bson.D{{Key: "$limit", Value: int64(1)}},
		bson.D{{Key: "$lookup", Value: bson.M{
			"from":         "entity_master",
			"localField":   "entityscreenid",
			"foreignField": "userid",
			"as":           "_entity",
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$project", Value: bson.M{
					"_id":                0,
					"name":               1,
					"entitytype":         1,
					"categorycode":       1,
					"registrationnumber": 1,
				}}},
			},
		}}},
		bson.D{{Key: "$lookup", Value: bson.M{
			"from":         "category_master",
			"localField":   "complaint_category",
			"foreignField": "category_code",
			"as":           "_complaint_category",
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$project", Value: bson.M{"_id": 0, "category_name": 1}}},
			},
		}}},
		bson.D{{Key: "$lookup", Value: bson.M{
			"from":         "category_master",
			"localField":   "_entity.categorycode",
			"foreignField": "category_code",
			"as":           "_entity_category",
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$project", Value: bson.M{"_id": 0, "category_name": 1}}},
			},
		}}},
		bson.D{{Key: "$project", Value: bson.M{
			"_id":               0,
			"complaint_id":      "$complaintid",
			"complaint_code":    "$complaint_code",
			"complaint_details": "$complaint_details",
			"sub_category":      "$complaint_sub_category",
			"category": bson.M{
				"$cond": bson.A{
					bson.M{"$ifNull": bson.A{"$complaint_category", false}},
					bson.M{
						"code": "$complaint_category",
						"name": bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_complaint_category.category_name", 0}}, nil}},
					},
					nil,
				},
			},
			"filed_date":        "$created_date",
			"created_at":        "$created_date",
			"modified_date_raw": "$modified_date",
			"closed_at":         bson.M{"$ifNull": bson.A{"$date_of_closure", nil}},
			"current_status":    "$wfstate",
			"entity": bson.M{
				"screen_id":           "$entityscreenid",
				"name":                bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_entity.name", 0}}, nil}},
				"type":                bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_entity.entitytype", 0}}, nil}},
				"category_code":       bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_entity.categorycode", 0}}, nil}},
				"category_name":       bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_entity_category.category_name", 0}}, nil}},
				"registration_number": bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_entity.registrationnumber", 0}}, nil}},
			},
		}}},
	}

	cur, err := r.complaints.Aggregate(ctx, pipeline)
	if err != nil {
		return Detail{}, fmt.Errorf("aggregate complaint detail: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }() // close error after read is unactionable

	var rows []Detail
	if err := cur.All(ctx, &rows); err != nil {
		return Detail{}, fmt.Errorf("decode complaint detail: %w", err)
	}
	if len(rows) == 0 {
		return Detail{}, apperror.ErrNotFound.WithMessage("complaint not found")
	}
	return rows[0], nil
}

func (r *mongoRepository) ListWorkflow(ctx context.Context, complaintID int64) ([]ActivityEntry, error) {
	opts := options.Find().SetSort(bson.D{{Key: "created_date", Value: 1}})
	cur, err := r.workflow.Find(ctx, bson.M{"complaintid": complaintID}, opts)
	if err != nil {
		return nil, fmt.Errorf("find workflow logs: %w", err)
	}
	defer func() { _ = cur.Close(ctx) }() // close error after read is unactionable

	var rows []ActivityEntry
	if err := cur.All(ctx, &rows); err != nil {
		return nil, fmt.Errorf("decode workflow logs: %w", err)
	}

	for i := range rows {
		rows[i].DocURLs = parseDocURLs(rows[i].DocURLRaw)
		rows[i].DocURLRaw = nil
	}
	return rows, nil
}

// parseDocURLs decodes the JSON-encoded doc_url string stored in
// tr_complaints. Storage forms we've seen: nil, "" / "null", "[]", and
// `["uuid-a","uuid-b"]`. Anything we can't parse is treated as empty —
// the timeline row is still useful without attachments.
func parseDocURLs(raw *string) []string {
	if raw == nil {
		return []string{}
	}
	s := strings.TrimSpace(*raw)
	if s == "" || s == "null" || s == "[]" {
		return []string{}
	}
	var ids []string
	if err := json.Unmarshal([]byte(s), &ids); err != nil {
		return []string{}
	}
	out := ids[:0]
	for _, id := range ids {
		if t := strings.TrimSpace(id); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func dateRange(from, to *time.Time) bson.M {
	r := bson.M{}
	if from != nil {
		r["$gte"] = *from
	}
	if to != nil {
		r["$lte"] = *to
	}
	return r
}

package dashboard

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"golang.org/x/sync/errgroup"
)

// closedState is the terminal wfstate. Closed ⇔ wfstate == "CLOSED"; everything
// else (START, AWAITING_FOR_REVIEW, …) is open. Matches the convention used by
// internal/entity and internal/complaint.
const closedState = "CLOSED"

// Repository computes dashboard aggregates over tt_complaints. Like complaints
// and heatmap, these are public-regulatory records with no per-org owner, so
// there is no org_id scoping.
type Repository interface {
	// Summary returns the three independent populations for the summary card:
	// total (filed in range, or all-time), open (currently pending, never
	// date-bounded) and closed (resolved in range, or all-time). The category
	// filter applies to all three.
	Summary(ctx context.Context, f Filter) (SummaryCounts, error)
	// VolumeBySubcategory groups complaints filed in the window (created_date)
	// by complaint_sub_category, sorted by count descending and capped at limit.
	VolumeBySubcategory(ctx context.Context, f Filter, limit int) ([]SubcategoryCount, error)
	// VolumeByCategory groups complaints filed in the window (created_date) by
	// complaint_category, resolving the category name from category_master.
	VolumeByCategory(ctx context.Context, from, to *time.Time) ([]CategoryCount, error)
	// VolumeByCategoryTrend groups complaints filed in the window by
	// (bucket, complaint_category), where bucket is created_date truncated to
	// the granularity ("day" | "week" | "month"). Series are returned sorted by
	// total descending; only non-zero buckets are present in points — the
	// frontend zero-fills against the requested range.
	VolumeByCategoryTrend(ctx context.Context, from, to *time.Time, granularity string, categoryCodes []string) ([]CategoryTrendSeries, error)
	// VolumeBySubcategoryTrend is the sub-category cousin of
	// VolumeByCategoryTrend. It groups by (bucket, complaint_sub_category) and
	// caps the returned series at `limit` (sub-categories are open-ended free
	// text and can be many). The optional categoryCodes filter scopes which
	// complaints contribute — useful when the dashboard has a category filter
	// active.
	VolumeBySubcategoryTrend(ctx context.Context, from, to *time.Time, granularity string, categoryCodes []string, limit int) ([]SubcategoryTrendSeries, error)
	// CountFiltered returns the count of complaints matching the created_date
	// range + category filter. It backs the `total` of the two volume endpoints
	// and runs in parallel with the grouped query.
	CountFiltered(ctx context.Context, f Filter) (int64, error)
}

type mongoRepository struct {
	complaints *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) Repository {
	return &mongoRepository{complaints: db.Collection("tt_complaints")}
}

func (r *mongoRepository) Summary(ctx context.Context, f Filter) (SummaryCounts, error) {
	// Cohort-progress model: the cohort is complaints FILED in the window
	// (created_date), after the category filter. `closed` is the slice of that
	// cohort that ALSO closed within the SAME window (date_of_closure in range);
	// `open` = total - closed is the remainder — filed in the window but not
	// resolved within it (carryover, including any closed later). With no date
	// range the cohort is all complaints and `closed` is the currently-closed
	// count (wfstate=="CLOSED").
	base := categoryMatch(f.CategoryCodes)
	if f.HasDateRange() {
		base["created_date"] = dateRange(f.CreatedFrom, f.CreatedTo)
	}

	closedMatch := cloneMatch(base)
	if f.HasDateRange() {
		closedMatch["date_of_closure"] = dateRange(f.CreatedFrom, f.CreatedTo)
	} else {
		closedMatch["wfstate"] = closedState
	}

	// total and closed are independent counts — fan out so latency is
	// max(count), not the sum.
	var counts SummaryCounts
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		n, err := r.complaints.CountDocuments(gctx, base)
		if err != nil {
			return fmt.Errorf("count total: %w", err)
		}
		counts.Total = n
		return nil
	})
	g.Go(func() error {
		n, err := r.complaints.CountDocuments(gctx, closedMatch)
		if err != nil {
			return fmt.Errorf("count closed: %w", err)
		}
		counts.Closed = n
		return nil
	})
	if err := g.Wait(); err != nil {
		return SummaryCounts{}, err
	}
	// closed is a subset of the cohort, so open is non-negative except for a
	// transient race between the two counts on a live write — clamp it.
	counts.Open = counts.Total - counts.Closed
	if counts.Open < 0 {
		counts.Open = 0
	}
	return counts, nil
}

func (r *mongoRepository) VolumeBySubcategory(ctx context.Context, f Filter, limit int) ([]SubcategoryCount, error) {
	match := categoryMatch(f.CategoryCodes)
	if f.HasDateRange() {
		match["created_date"] = dateRange(f.CreatedFrom, f.CreatedTo)
	}

	pipeline := mongo.Pipeline{}
	if len(match) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: match}})
	}
	pipeline = append(
		pipeline,
		bson.D{{Key: "$group", Value: bson.M{"_id": "$complaint_sub_category", "count": bson.M{"$sum": 1}}}},
		// Coerce a null/absent sub_category to "" so it decodes into a string and
		// sorts deterministically rather than erroring.
		bson.D{{Key: "$project", Value: bson.M{
			"_id":          0,
			"sub_category": bson.M{"$ifNull": bson.A{"$_id", ""}},
			"count":        1,
		}}},
		bson.D{{Key: "$sort", Value: bson.D{{Key: "count", Value: -1}, {Key: "sub_category", Value: 1}}}},
		bson.D{{Key: "$limit", Value: int64(limit)}},
	)
	return aggregate[SubcategoryCount](ctx, r.complaints, pipeline, "volume by subcategory")
}

func (r *mongoRepository) VolumeByCategory(ctx context.Context, from, to *time.Time) ([]CategoryCount, error) {
	pipeline := mongo.Pipeline{}
	if from != nil || to != nil {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: bson.M{"created_date": dateRange(from, to)}}})
	}
	pipeline = append(
		pipeline,
		bson.D{{Key: "$group", Value: bson.M{"_id": "$complaint_category", "count": bson.M{"$sum": 1}}}},
		bson.D{{Key: "$lookup", Value: bson.M{
			"from":         "category_master",
			"localField":   "_id",
			"foreignField": "category_code",
			"as":           "_cat",
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$project", Value: bson.M{"_id": 0, "category_name": 1}}},
			},
		}}},
		bson.D{{Key: "$project", Value: bson.M{
			"_id":   0,
			"code":  bson.M{"$ifNull": bson.A{"$_id", ""}},
			"name":  bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_cat.category_name", 0}}, ""}},
			"count": 1,
		}}},
		bson.D{{Key: "$sort", Value: bson.D{{Key: "count", Value: -1}, {Key: "code", Value: 1}}}},
	)
	return aggregate[CategoryCount](ctx, r.complaints, pipeline, "volume by category")
}

func (r *mongoRepository) VolumeByCategoryTrend(ctx context.Context, from, to *time.Time, granularity string, categoryCodes []string) ([]CategoryTrendSeries, error) {
	match := bson.M{}
	if from != nil || to != nil {
		match["created_date"] = dateRange(from, to)
	}
	if len(categoryCodes) > 0 {
		match["complaint_category"] = bson.M{"$in": categoryCodes}
	}

	pipeline := mongo.Pipeline{}
	if len(match) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: match}})
	}
	pipeline = append(
		pipeline,
		// 1. Group by (bucket-start, category) and count.
		bson.D{{Key: "$group", Value: bson.M{
			"_id": bson.M{
				"bucket":   bson.M{"$dateTrunc": bson.M{"date": "$created_date", "unit": granularity}},
				"category": "$complaint_category",
			},
			"count": bson.M{"$sum": 1},
		}}},
		// 2. Order by bucket so the subsequent $push preserves chronological order
		//    inside each series.
		bson.D{{Key: "$sort", Value: bson.D{{Key: "_id.bucket", Value: 1}}}},
		// 3. Collapse buckets into per-category points lists.
		bson.D{{Key: "$group", Value: bson.M{
			"_id": "$_id.category",
			"points": bson.M{"$push": bson.M{
				// Format the bucket as YYYY-MM-DD so the wire shape is stable across granularities.
				"date":  bson.M{"$dateToString": bson.M{"format": "%Y-%m-%d", "date": "$_id.bucket"}},
				"count": "$count",
			}},
			"total": bson.M{"$sum": "$count"},
		}}},
		// 4. Resolve the category name from category_master.
		bson.D{{Key: "$lookup", Value: bson.M{
			"from":         "category_master",
			"localField":   "_id",
			"foreignField": "category_code",
			"as":           "_cat",
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$project", Value: bson.M{"_id": 0, "category_name": 1}}},
			},
		}}},
		bson.D{{Key: "$project", Value: bson.M{
			"_id":    0,
			"code":   bson.M{"$ifNull": bson.A{"$_id", ""}},
			"name":   bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_cat.category_name", 0}}, ""}},
			"total":  1,
			"points": 1,
		}}},
		// 5. Largest category first so the legend / stack order is intuitive.
		bson.D{{Key: "$sort", Value: bson.D{{Key: "total", Value: -1}, {Key: "code", Value: 1}}}},
	)
	return aggregate[CategoryTrendSeries](ctx, r.complaints, pipeline, "volume by category trend")
}

func (r *mongoRepository) VolumeBySubcategoryTrend(ctx context.Context, from, to *time.Time, granularity string, categoryCodes []string, limit int) ([]SubcategoryTrendSeries, error) {
	match := bson.M{}
	if from != nil || to != nil {
		match["created_date"] = dateRange(from, to)
	}
	if len(categoryCodes) > 0 {
		match["complaint_category"] = bson.M{"$in": categoryCodes}
	}

	pipeline := mongo.Pipeline{}
	if len(match) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: match}})
	}
	pipeline = append(
		pipeline,
		bson.D{{Key: "$group", Value: bson.M{
			"_id": bson.M{
				"bucket":      bson.M{"$dateTrunc": bson.M{"date": "$created_date", "unit": granularity}},
				"subcategory": "$complaint_sub_category",
			},
			"count": bson.M{"$sum": 1},
		}}},
		bson.D{{Key: "$sort", Value: bson.D{{Key: "_id.bucket", Value: 1}}}},
		bson.D{{Key: "$group", Value: bson.M{
			"_id": "$_id.subcategory",
			"points": bson.M{"$push": bson.M{
				"date":  bson.M{"$dateToString": bson.M{"format": "%Y-%m-%d", "date": "$_id.bucket"}},
				"count": "$count",
			}},
			"total": bson.M{"$sum": "$count"},
		}}},
		// Coerce null/absent sub_category to "" so it decodes into a string and
		// sorts deterministically (mirrors VolumeBySubcategory).
		bson.D{{Key: "$project", Value: bson.M{
			"_id":          0,
			"sub_category": bson.M{"$ifNull": bson.A{"$_id", ""}},
			"total":        1,
			"points":       1,
		}}},
		bson.D{{Key: "$sort", Value: bson.D{{Key: "total", Value: -1}, {Key: "sub_category", Value: 1}}}},
		bson.D{{Key: "$limit", Value: int64(limit)}},
	)
	return aggregate[SubcategoryTrendSeries](ctx, r.complaints, pipeline, "volume by subcategory trend")
}

func (r *mongoRepository) CountFiltered(ctx context.Context, f Filter) (int64, error) {
	match := categoryMatch(f.CategoryCodes)
	if f.HasDateRange() {
		match["created_date"] = dateRange(f.CreatedFrom, f.CreatedTo)
	}
	n, err := r.complaints.CountDocuments(ctx, match)
	if err != nil {
		return 0, fmt.Errorf("count filtered complaints: %w", err)
	}
	return n, nil
}

// categoryMatch returns a fresh $match fragment scoping complaint_category to
// the given codes, or an empty (but non-nil) map when no codes are supplied so
// callers can safely add more keys.
func categoryMatch(codes []string) bson.M {
	m := bson.M{}
	if len(codes) > 0 {
		m["complaint_category"] = bson.M{"$in": codes}
	}
	return m
}

// cloneMatch shallow-copies a $match map so callers can add top-level keys
// without mutating the shared base. Values are never mutated in place, so a
// shallow copy is safe.
func cloneMatch(m bson.M) bson.M {
	out := make(bson.M, len(m)+1)
	for k, v := range m {
		out[k] = v
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

// aggregate runs pipeline against coll and decodes every row into a []T. `what`
// labels the operation in wrapped errors.
func aggregate[T any](ctx context.Context, coll *mongo.Collection, pipeline mongo.Pipeline, what string) ([]T, error) {
	cur, err := coll.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", what, err)
	}
	defer func() { _ = cur.Close(ctx) }() // close error after read is unactionable

	var out []T
	if err := cur.All(ctx, &out); err != nil {
		return nil, fmt.Errorf("decode %s: %w", what, err)
	}
	return out, nil
}

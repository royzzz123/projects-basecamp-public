package mongodb

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// EnsureIndexes is the single source of truth for index definitions.
// It is called once at server startup and is idempotent.
func EnsureIndexes(ctx context.Context, db *mongo.Database) error {
	if err := ensureUserIndexes(ctx, db); err != nil {
		return fmt.Errorf("users indexes: %w", err)
	}
	if err := ensureOrgIndexes(ctx, db); err != nil {
		return fmt.Errorf("orgs indexes: %w", err)
	}
	if err := ensureComplaintIndexes(ctx, db); err != nil {
		return fmt.Errorf("complaints indexes: %w", err)
	}
	if err := ensureWorkflowIndexes(ctx, db); err != nil {
		return fmt.Errorf("workflow indexes: %w", err)
	}
	if err := ensureMasterIndexes(ctx, db); err != nil {
		return fmt.Errorf("master indexes: %w", err)
	}
	if err := ensureEntityIndexes(ctx, db); err != nil {
		return fmt.Errorf("entity indexes: %w", err)
	}
	if err := ensureComplaintWorkflowAnalysisIndexes(ctx, db); err != nil {
		return fmt.Errorf("complaint workflow analysis indexes: %w", err)
	}
	if err := ensureComplaintSummaryIndexes(ctx, db); err != nil {
		return fmt.Errorf("complaint summary indexes: %w", err)
	}
	if err := ensureReclassificationIndexes(ctx, db); err != nil {
		return fmt.Errorf("reclassification indexes: %w", err)
	}
	return nil
}

func ensureUserIndexes(ctx context.Context, db *mongo.Database) error {
	models := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "email", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("uniq_email"),
		},
		{
			Keys:    bson.D{{Key: "org_id", Value: 1}},
			Options: options.Index().SetName("by_org"),
		},
	}
	_, err := db.Collection("users").Indexes().CreateMany(ctx, models)
	return err
}

func ensureOrgIndexes(ctx context.Context, db *mongo.Database) error {
	models := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "slug", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("uniq_slug"),
		},
	}
	_, err := db.Collection("orgs").Indexes().CreateMany(ctx, models)
	return err
}

func ensureComplaintIndexes(ctx context.Context, db *mongo.Database) error {
	models := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "complaintid", Value: -1}},
			Options: options.Index().SetUnique(true).SetName("uniq_complaintid"),
		},
		{
			Keys:    bson.D{{Key: "entityscreenid", Value: 1}, {Key: "complaintid", Value: -1}},
			Options: options.Index().SetName("by_entity_recent"),
		},
		{
			Keys:    bson.D{{Key: "wfstate", Value: 1}, {Key: "complaintid", Value: -1}},
			Options: options.Index().SetName("by_status_recent"),
		},
		{
			Keys:    bson.D{{Key: "complaint_category", Value: 1}, {Key: "complaintid", Value: -1}},
			Options: options.Index().SetName("by_category_recent"),
		},
		{
			Keys:    bson.D{{Key: "created_date", Value: -1}},
			Options: options.Index().SetName("by_created_date"),
		},
		{
			Keys:    bson.D{{Key: "modified_date", Value: -1}},
			Options: options.Index().SetName("by_modified_date"),
		},
		{
			// Backs the dashboard summary's "closed within the window" count
			// (date_of_closure ∈ range). For narrow windows date_of_closure is
			// far more selective than created_date, so this lets the planner scan
			// only the closed rows (e.g. ~1.4k vs ~6.6k) instead of the whole
			// filed-cohort. A compound {created_date, date_of_closure} does NOT
			// help — created_date is used as a range, so the second key can't
			// bound the scan; keeping both single-field indexes lets the planner
			// pick the more selective date per query.
			Keys:    bson.D{{Key: "date_of_closure", Value: -1}},
			Options: options.Index().SetName("by_date_of_closure"),
		},
	}
	_, err := db.Collection("tt_complaints").Indexes().CreateMany(ctx, models)
	return err
}

func ensureWorkflowIndexes(ctx context.Context, db *mongo.Database) error {
	models := []mongo.IndexModel{
		{
			// Backs GET /v1/complaints/{id} — selective lookup on complaintid
			// with created_date already sorted ASC for the activity timeline.
			Keys:    bson.D{{Key: "complaintid", Value: 1}, {Key: "created_date", Value: 1}},
			Options: options.Index().SetName("by_complaint_chronological"),
		},
		{
			// Backs the GET /v1/entities escalation-counts $lookup, which filters
			// each complaint's workflow rows by (complaintid, action IN {FLR,SLR}).
			Keys:    bson.D{{Key: "complaintid", Value: 1}, {Key: "action", Value: 1}},
			Options: options.Index().SetName("by_complaint_action"),
		},
	}
	_, err := db.Collection("tr_complaints").Indexes().CreateMany(ctx, models)
	return err
}

func ensureMasterIndexes(ctx context.Context, db *mongo.Database) error {
	categoryModels := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "category_code", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("uniq_category_code"),
		},
	}
	if _, err := db.Collection("category_master").Indexes().CreateMany(ctx, categoryModels); err != nil {
		return fmt.Errorf("category_master: %w", err)
	}
	subCategoryModels := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "sub_category_name", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("uniq_sub_category_name"),
		},
	}
	if _, err := db.Collection("subcategory_master").Indexes().CreateMany(ctx, subCategoryModels); err != nil {
		return fmt.Errorf("subcategory_master: %w", err)
	}
	return nil
}

func ensureComplaintWorkflowAnalysisIndexes(ctx context.Context, db *mongo.Database) error {
	models := []mongo.IndexModel{
		{
			// Unique key — one analysis per complaint. The unique constraint
			// is also what makes the service-layer upsert race-safe.
			Keys:    bson.D{{Key: "complaint_id", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("uniq_complaint_id"),
		},
	}
	_, err := db.Collection("complaint_workflow_analysis").Indexes().CreateMany(ctx, models)
	return err
}

func ensureComplaintSummaryIndexes(ctx context.Context, db *mongo.Database) error {
	models := []mongo.IndexModel{
		{
			// One summary per complaint — same race-safe upsert pattern as
			// complaint_workflow_analysis.
			Keys:    bson.D{{Key: "complaint_id", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("uniq_complaint_id"),
		},
	}
	_, err := db.Collection("complaint_summary").Indexes().CreateMany(ctx, models)
	return err
}

func ensureEntityIndexes(ctx context.Context, db *mongo.Database) error {
	models := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "userid", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("uniq_userid"),
		},
		{
			Keys:    bson.D{{Key: "name", Value: 1}},
			Options: options.Index().SetName("by_name"),
		},
		{
			Keys:    bson.D{{Key: "uid", Value: -1}},
			Options: options.Index().SetUnique(true).SetName("uniq_uid"),
		},
		{
			// Backs GET /v1/entities — list sorts by (complaint_count DESC,
			// uid DESC). uid tail keeps the keyset cursor deterministic on ties.
			Keys:    bson.D{{Key: "complaint_count", Value: -1}, {Key: "uid", Value: -1}},
			Options: options.Index().SetName("by_complaints_desc"),
		},
		{
			Keys:    bson.D{{Key: "categorycode", Value: 1}, {Key: "uid", Value: -1}},
			Options: options.Index().SetName("by_category_recent"),
		},
		{
			Keys:    bson.D{{Key: "entitytype", Value: 1}, {Key: "uid", Value: -1}},
			Options: options.Index().SetName("by_entitytype_recent"),
		},
	}
	_, err := db.Collection("entity_master").Indexes().CreateMany(ctx, models)
	return err
}

func ensureReclassificationIndexes(ctx context.Context, db *mongo.Database) error {
	models := []mongo.IndexModel{
		{
			// One reclassification per complaint — unique constraint makes the
			// service-layer upsert race-safe.
			Keys:    bson.D{{Key: "complaint_id", Value: 1}},
			Options: options.Index().SetUnique(true).SetName("uniq_complaint_id"),
		},
		{
			// Backs the dashboard's AI-suggested sub-category grouping.
			Keys:    bson.D{{Key: "ai_generated_sub_category", Value: 1}},
			Options: options.Index().SetName("by_ai_generated_sub_category"),
		},
	}
	_, err := db.Collection("complaint_reclassifications").Indexes().CreateMany(ctx, models)
	return err
}

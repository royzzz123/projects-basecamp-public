package mongodb

import (
	"context"
	"fmt"
	"time"

	"github.com/OnFinance/project-crud/internal/config"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// NewClient connects to MongoDB and verifies connectivity.
// Caller is responsible for calling Disconnect when shutting down.
func NewClient(ctx context.Context, cfg config.Config) (*mongo.Client, error) {
	opts := options.Client().
		ApplyURI(cfg.MongoURI).
		SetConnectTimeout(10 * time.Second).
		SetServerSelectionTimeout(10 * time.Second).
		SetAppName("sebi-crud")

	client, err := mongo.Connect(opts)
	if err != nil {
		return nil, fmt.Errorf("connecting to mongo: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, nil); err != nil {
		// Parent ctx may already be cancelled; use a fresh bounded ctx for cleanup.
		disconnectCtx, disconnectCancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = client.Disconnect(disconnectCtx) //nolint:contextcheck // parent ctx may be cancelled; cleanup uses fresh ctx
		disconnectCancel()
		return nil, fmt.Errorf("pinging mongo: %w", err)
	}
	return client, nil
}

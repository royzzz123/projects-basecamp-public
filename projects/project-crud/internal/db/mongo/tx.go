package mongodb

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/mongo"
)

// WithTransaction runs fn inside a Mongo session + transaction.
// The caller's fn MUST use the provided context (a session-bound context) for all
// driver calls so they participate in the transaction.
func WithTransaction(ctx context.Context, client *mongo.Client, fn func(sessCtx context.Context) (any, error)) (any, error) {
	session, err := client.StartSession()
	if err != nil {
		return nil, fmt.Errorf("starting session: %w", err)
	}
	defer session.EndSession(ctx)

	result, err := session.WithTransaction(ctx, func(sc context.Context) (any, error) {
		return fn(sc)
	})
	if err != nil {
		return nil, fmt.Errorf("transaction: %w", err)
	}
	return result, nil
}

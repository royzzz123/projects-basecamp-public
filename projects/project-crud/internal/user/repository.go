package user

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// Repository is the storage contract for users. Services depend on this
// interface (not the Mongo impl) so they can be unit-tested with a mock.
type Repository interface {
	Create(ctx context.Context, u *User) error
	GetByID(ctx context.Context, id bson.ObjectID) (*User, error)
	GetByEmail(ctx context.Context, email string) (*User, error)
}

type mongoRepository struct {
	coll *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) Repository {
	return &mongoRepository{coll: db.Collection("users")}
}

func (r *mongoRepository) Create(ctx context.Context, u *User) error {
	if u.ID.IsZero() {
		u.ID = bson.NewObjectID()
	}
	now := time.Now().UTC()
	if u.CreatedAt.IsZero() {
		u.CreatedAt = now
	}
	u.UpdatedAt = now

	if _, err := r.coll.InsertOne(ctx, u); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return apperror.ErrConflict.WithMessage("user with this email already exists")
		}
		return fmt.Errorf("inserting user: %w", err)
	}
	return nil
}

func (r *mongoRepository) GetByID(ctx context.Context, id bson.ObjectID) (*User, error) {
	var u User
	err := r.coll.FindOne(ctx, bson.M{
		"_id":        id,
		"deleted_at": bson.M{"$exists": false},
	}).Decode(&u)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, apperror.ErrNotFound
		}
		return nil, fmt.Errorf("finding user by id: %w", err)
	}
	return &u, nil
}

func (r *mongoRepository) GetByEmail(ctx context.Context, email string) (*User, error) {
	var u User
	err := r.coll.FindOne(ctx, bson.M{
		"email":      email,
		"deleted_at": bson.M{"$exists": false},
	}).Decode(&u)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, apperror.ErrNotFound
		}
		return nil, fmt.Errorf("finding user by email: %w", err)
	}
	return &u, nil
}

package user

import (
	"time"

	"github.com/OnFinance/project-crud/internal/auth"
	"go.mongodb.org/mongo-driver/v2/bson"
)

// User is the Mongo document stored in the `users` collection.
// password_hash is intentionally non-exported in JSON — DTOs control wire shape.
type User struct {
	ID           bson.ObjectID  `bson:"_id,omitempty"`
	Email        string         `bson:"email"`
	PasswordHash string         `bson:"password_hash"`
	Role         auth.Role      `bson:"role"`
	OrgID        *bson.ObjectID `bson:"org_id,omitempty"`
	CreatedAt    time.Time      `bson:"created_at"`
	UpdatedAt    time.Time      `bson:"updated_at"`
	DeletedAt    *time.Time     `bson:"deleted_at,omitempty"`
}

// ---- Request DTOs --------------------------------------------------------

type SignupRequest struct {
	Email    string    `json:"email"    binding:"required,email"`
	Password string    `json:"password" binding:"required,min=12,max=128"`
	Role     auth.Role `json:"role"     binding:"required,oneof=developer admin business_user"`
	OrgID    *string   `json:"org_id,omitempty"` // required for non-developer roles; validated in service
}

type LoginRequest struct {
	Email    string `json:"email"    binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// ---- Response DTOs -------------------------------------------------------

type UserResponse struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Role      auth.Role `json:"role"`
	OrgID     *string   `json:"org_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AuthResponse struct {
	Token     string       `json:"token"`
	ExpiresAt time.Time    `json:"expires_at"`
	User      UserResponse `json:"user"`
}

func toResponse(u *User) UserResponse {
	resp := UserResponse{
		ID:        u.ID.Hex(),
		Email:     u.Email,
		Role:      u.Role,
		CreatedAt: u.CreatedAt,
		UpdatedAt: u.UpdatedAt,
	}
	if u.OrgID != nil {
		s := u.OrgID.Hex()
		resp.OrgID = &s
	}
	return resp
}

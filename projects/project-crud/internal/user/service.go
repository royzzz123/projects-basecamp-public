package user

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/OnFinance/project-crud/internal/auth"
	"go.mongodb.org/mongo-driver/v2/bson"
)

type Service struct {
	repo   Repository
	issuer *auth.Issuer
}

func NewService(repo Repository, issuer *auth.Issuer) *Service {
	return &Service{repo: repo, issuer: issuer}
}

// Signup creates a user on behalf of an authenticated caller (admin or developer).
// Authorization rules:
//   - caller must be admin or developer
//   - admin callers may not create developer users (no privilege escalation)
//   - admin callers can only create users in their own org
//   - developer callers may create any role; if role != developer they must provide org_id
//   - developer users themselves have no org_id
func (s *Service) Signup(ctx context.Context, caller auth.Claims, req SignupRequest) (AuthResponse, error) {
	if !caller.Role.Includes(auth.RoleAdmin) {
		return AuthResponse{}, apperror.ErrForbidden
	}
	if !req.Role.Valid() {
		return AuthResponse{}, apperror.ErrValidation.WithMessage("invalid role")
	}
	if !caller.Role.Includes(req.Role) {
		return AuthResponse{}, apperror.ErrForbidden.WithMessage("cannot create a user with a higher role than your own")
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))

	var orgID *bson.ObjectID
	switch req.Role {
	case auth.RoleDeveloper:
		// developers are cross-org; ignore any provided org_id
		orgID = nil
	default:
		// admin/business_user must be assigned to an org
		assigned, err := s.resolveOrgID(caller, req.OrgID)
		if err != nil {
			return AuthResponse{}, err
		}
		orgID = assigned
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		return AuthResponse{}, fmt.Errorf("hashing password: %w", err)
	}

	u := &User{
		Email:        email,
		PasswordHash: hash,
		Role:         req.Role,
		OrgID:        orgID,
	}
	if err := s.repo.Create(ctx, u); err != nil {
		return AuthResponse{}, err
	}

	token, exp, err := s.issuer.Issue(auth.Claims{
		UserID: u.ID,
		OrgID:  u.OrgID,
		Role:   u.Role,
	})
	if err != nil {
		return AuthResponse{}, err
	}
	return AuthResponse{
		Token:     token,
		ExpiresAt: exp,
		User:      toResponse(u),
	}, nil
}

// Login exchanges email+password for a JWT. The same error is returned for
// "no such email" and "wrong password" — never leak user existence.
func (s *Service) Login(ctx context.Context, req LoginRequest) (AuthResponse, error) {
	email := strings.ToLower(strings.TrimSpace(req.Email))

	u, err := s.repo.GetByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, apperror.ErrNotFound) {
			return AuthResponse{}, apperror.ErrInvalidCreds
		}
		return AuthResponse{}, err
	}
	if u.DeletedAt != nil {
		return AuthResponse{}, apperror.ErrInvalidCreds
	}
	if err := auth.CheckPassword(req.Password, u.PasswordHash); err != nil {
		return AuthResponse{}, apperror.ErrInvalidCreds
	}

	token, exp, err := s.issuer.Issue(auth.Claims{
		UserID: u.ID,
		OrgID:  u.OrgID,
		Role:   u.Role,
	})
	if err != nil {
		return AuthResponse{}, err
	}
	return AuthResponse{
		Token:     token,
		ExpiresAt: exp,
		User:      toResponse(u),
	}, nil
}

// Me returns the authenticated user's record.
func (s *Service) Me(ctx context.Context, caller auth.Claims) (UserResponse, error) {
	u, err := s.repo.GetByID(ctx, caller.UserID)
	if err != nil {
		return UserResponse{}, err
	}
	return toResponse(u), nil
}

func (s *Service) resolveOrgID(caller auth.Claims, requested *string) (*bson.ObjectID, error) {
	switch caller.Role {
	case auth.RoleAdmin:
		// admin always creates within their own org; ignore client-provided org_id
		if caller.OrgID == nil {
			return nil, apperror.ErrUnprocessable.WithMessage("admin caller is missing an org_id")
		}
		return caller.OrgID, nil

	case auth.RoleDeveloper:
		if requested == nil || *requested == "" {
			return nil, apperror.ErrValidation.WithMessage("org_id is required when creating non-developer users")
		}
		oid, err := bson.ObjectIDFromHex(*requested)
		if err != nil {
			return nil, apperror.ErrValidation.WithMessage("org_id is not a valid ObjectID")
		}
		return &oid, nil

	default:
		return nil, apperror.ErrForbidden
	}
}

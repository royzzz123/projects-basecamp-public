package user

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/OnFinance/project-crud/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mongodb.org/mongo-driver/v2/bson"
)

// --- in-memory test repo (faster + clearer than a mock library) -----------

type fakeRepo struct {
	byEmail map[string]*User
	byID    map[string]*User
	createErr error
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{byEmail: map[string]*User{}, byID: map[string]*User{}}
}

func (r *fakeRepo) Create(_ context.Context, u *User) error {
	if r.createErr != nil {
		return r.createErr
	}
	if _, exists := r.byEmail[u.Email]; exists {
		return apperror.ErrConflict
	}
	if u.ID.IsZero() {
		u.ID = bson.NewObjectID()
	}
	u.CreatedAt = time.Now().UTC()
	u.UpdatedAt = u.CreatedAt
	clone := *u
	r.byEmail[u.Email] = &clone
	r.byID[u.ID.Hex()] = &clone
	return nil
}

func (r *fakeRepo) GetByID(_ context.Context, id bson.ObjectID) (*User, error) {
	u, ok := r.byID[id.Hex()]
	if !ok {
		return nil, apperror.ErrNotFound
	}
	if u.DeletedAt != nil {
		return nil, apperror.ErrNotFound
	}
	return u, nil
}

func (r *fakeRepo) GetByEmail(_ context.Context, email string) (*User, error) {
	u, ok := r.byEmail[email]
	if !ok {
		return nil, apperror.ErrNotFound
	}
	if u.DeletedAt != nil {
		return nil, apperror.ErrNotFound
	}
	return u, nil
}

// --- helpers --------------------------------------------------------------

func newTestService(t *testing.T) (*Service, *fakeRepo) {
	t.Helper()
	repo := newFakeRepo()
	issuer := auth.NewIssuer(config.Config{
		JWTSecret: strings.Repeat("k", 32),
		JWTIssuer: "test",
		JWTTTL:    time.Hour,
	})
	return NewService(repo, issuer), repo
}

func devClaims() auth.Claims {
	return auth.Claims{UserID: bson.NewObjectID(), Role: auth.RoleDeveloper}
}

func adminClaims(orgID bson.ObjectID) auth.Claims {
	return auth.Claims{UserID: bson.NewObjectID(), OrgID: &orgID, Role: auth.RoleAdmin}
}

func bizUserClaims(orgID bson.ObjectID) auth.Claims {
	return auth.Claims{UserID: bson.NewObjectID(), OrgID: &orgID, Role: auth.RoleBusinessUser}
}

const goodPassword = "this-is-long-enough-12345"

// --- Signup ---------------------------------------------------------------

func TestSignup_AsDeveloper_CreatesAdmin(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	orgID := bson.NewObjectID().Hex()

	out, err := svc.Signup(context.Background(), devClaims(), SignupRequest{
		Email: "alice@example.com", Password: goodPassword, Role: auth.RoleAdmin, OrgID: &orgID,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, out.Token)
	assert.Equal(t, auth.RoleAdmin, out.User.Role)
	require.NotNil(t, out.User.OrgID)
	assert.Equal(t, orgID, *out.User.OrgID)
}

func TestSignup_AsAdmin_UsesCallerOrg(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	callerOrg := bson.NewObjectID()
	rogueOrg := bson.NewObjectID().Hex()

	out, err := svc.Signup(context.Background(), adminClaims(callerOrg), SignupRequest{
		Email: "bob@example.com", Password: goodPassword, Role: auth.RoleBusinessUser, OrgID: &rogueOrg, // ignored
	})
	require.NoError(t, err)
	require.NotNil(t, out.User.OrgID)
	assert.Equal(t, callerOrg.Hex(), *out.User.OrgID, "admin caller's org must win over the request body's org_id")
}

func TestSignup_AsAdmin_CannotCreateDeveloper(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	_, err := svc.Signup(context.Background(), adminClaims(bson.NewObjectID()), SignupRequest{
		Email: "x@example.com", Password: goodPassword, Role: auth.RoleDeveloper,
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrForbidden)
}

func TestSignup_AsBusinessUser_Forbidden(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	_, err := svc.Signup(context.Background(), bizUserClaims(bson.NewObjectID()), SignupRequest{
		Email: "x@example.com", Password: goodPassword, Role: auth.RoleBusinessUser,
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrForbidden)
}

func TestSignup_DeveloperWithoutOrgID_ForAdminRole_Fails(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	_, err := svc.Signup(context.Background(), devClaims(), SignupRequest{
		Email: "no-org@example.com", Password: goodPassword, Role: auth.RoleAdmin,
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrValidation)
}

func TestSignup_DeveloperCreatesDeveloper_HasNilOrgID(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	out, err := svc.Signup(context.Background(), devClaims(), SignupRequest{
		Email: "dev2@example.com", Password: goodPassword, Role: auth.RoleDeveloper,
	})
	require.NoError(t, err)
	assert.Nil(t, out.User.OrgID, "developers have no org_id")
}

func TestSignup_DuplicateEmail_Conflict(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	orgID := bson.NewObjectID().Hex()
	req := SignupRequest{Email: "dup@example.com", Password: goodPassword, Role: auth.RoleAdmin, OrgID: &orgID}

	_, err := svc.Signup(context.Background(), devClaims(), req)
	require.NoError(t, err)

	_, err = svc.Signup(context.Background(), devClaims(), req)
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrConflict)
}

// --- Login ----------------------------------------------------------------

func TestLogin_Success(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	orgID := bson.NewObjectID().Hex()
	_, err := svc.Signup(context.Background(), devClaims(), SignupRequest{
		Email: "login@example.com", Password: goodPassword, Role: auth.RoleAdmin, OrgID: &orgID,
	})
	require.NoError(t, err)

	out, err := svc.Login(context.Background(), LoginRequest{Email: "login@example.com", Password: goodPassword})
	require.NoError(t, err)
	assert.NotEmpty(t, out.Token)
	assert.Equal(t, "login@example.com", out.User.Email)
}

func TestLogin_WrongPassword_ReturnsInvalidCreds(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	orgID := bson.NewObjectID().Hex()
	_, err := svc.Signup(context.Background(), devClaims(), SignupRequest{
		Email: "wp@example.com", Password: goodPassword, Role: auth.RoleAdmin, OrgID: &orgID,
	})
	require.NoError(t, err)

	_, err = svc.Login(context.Background(), LoginRequest{Email: "wp@example.com", Password: "wrong-password-123"})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrInvalidCreds)
}

func TestLogin_NoSuchEmail_ReturnsSameInvalidCreds(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	_, err := svc.Login(context.Background(), LoginRequest{Email: "ghost@example.com", Password: goodPassword})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrInvalidCreds, "no-such-email and wrong-password MUST map to the same error code (no user enumeration)")
}

func TestLogin_SoftDeletedUser_Fails(t *testing.T) {
	t.Parallel()
	svc, repo := newTestService(t)
	orgID := bson.NewObjectID().Hex()
	_, err := svc.Signup(context.Background(), devClaims(), SignupRequest{
		Email: "ghost2@example.com", Password: goodPassword, Role: auth.RoleAdmin, OrgID: &orgID,
	})
	require.NoError(t, err)

	now := time.Now().UTC()
	repo.byEmail["ghost2@example.com"].DeletedAt = &now

	_, err = svc.Login(context.Background(), LoginRequest{Email: "ghost2@example.com", Password: goodPassword})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrInvalidCreds)
}

// --- Me -------------------------------------------------------------------

func TestMe_ReturnsCallerRecord(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	orgID := bson.NewObjectID().Hex()
	signup, err := svc.Signup(context.Background(), devClaims(), SignupRequest{
		Email: "me@example.com", Password: goodPassword, Role: auth.RoleAdmin, OrgID: &orgID,
	})
	require.NoError(t, err)

	uid, err := bson.ObjectIDFromHex(signup.User.ID)
	require.NoError(t, err)

	got, err := svc.Me(context.Background(), auth.Claims{UserID: uid, Role: auth.RoleAdmin})
	require.NoError(t, err)
	assert.Equal(t, "me@example.com", got.Email)
}

func TestMe_NotFound(t *testing.T) {
	t.Parallel()
	svc, _ := newTestService(t)
	_, err := svc.Me(context.Background(), auth.Claims{UserID: bson.NewObjectID(), Role: auth.RoleAdmin})
	require.Error(t, err)
	assert.ErrorIs(t, err, apperror.ErrNotFound)
}

package user

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/OnFinance/project-crud/internal/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func init() { gin.SetMode(gin.TestMode) }

// testMiddleware mirrors auth.Middleware's interface but skips token verification
// in favour of trusting context-set claims. Lets us drive RBAC behavior in tests
// without minting real JWTs.
type testMiddleware struct {
	claims *auth.Claims
}

func (m *testMiddleware) Authenticate() gin.HandlerFunc {
	return func(c *gin.Context) {
		if m.claims == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized,
				gin.H{"error": gin.H{"code": "auth.invalid_token"}})
			return
		}
		c.Set(auth.CtxClaims, *m.claims)
		c.Next()
	}
}

func (m *testMiddleware) Require(required auth.Role) gin.HandlerFunc {
	return func(c *gin.Context) {
		v, ok := c.Get(auth.CtxClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized,
				gin.H{"error": gin.H{"code": "auth.invalid_token"}})
			return
		}
		claims := v.(auth.Claims)
		if !claims.Role.Includes(required) {
			c.AbortWithStatusJSON(http.StatusForbidden,
				gin.H{"error": gin.H{"code": "forbidden"}})
			return
		}
		c.Next()
	}
}

// registerForTest mirrors RegisterRoutes but takes the test middleware.
func registerForTest(rg *gin.RouterGroup, h *Handler, mw *testMiddleware) {
	authGroup := rg.Group("/auth")
	authGroup.POST("/login", h.Login)
	protected := authGroup.Group("", mw.Authenticate())
	protected.GET("/me", mw.Require(auth.RoleBusinessUser), h.Me)
	protected.POST("/signup", mw.Require(auth.RoleAdmin), h.Signup)
}

func buildRouter(t *testing.T, claims *auth.Claims) (*gin.Engine, *fakeRepo, *Service) {
	t.Helper()
	repo := newFakeRepo()
	issuer := auth.NewIssuer(config.Config{
		JWTSecret: strings.Repeat("k", 32),
		JWTIssuer: "test",
		JWTTTL:    time.Hour,
	})
	svc := NewService(repo, issuer)
	h := NewHandler(svc)

	r := gin.New()
	v1 := r.Group("/v1")
	registerForTest(v1, h, &testMiddleware{claims: claims})
	return r, repo, svc
}

func doJSON(t *testing.T, r http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&buf).Encode(body))
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ---- Login ---------------------------------------------------------------

func TestHandler_Login_Success(t *testing.T) {
	t.Parallel()
	r, _, svc := buildRouter(t, nil)

	orgID := bson.NewObjectID().Hex()
	_, err := svc.Signup(t.Context(),
		auth.Claims{UserID: bson.NewObjectID(), Role: auth.RoleDeveloper},
		SignupRequest{Email: "h-login@example.com", Password: goodPassword, Role: auth.RoleAdmin, OrgID: &orgID})
	require.NoError(t, err)

	w := doJSON(t, r, http.MethodPost, "/v1/auth/login",
		LoginRequest{Email: "h-login@example.com", Password: goodPassword})
	require.Equal(t, http.StatusOK, w.Code)

	var out AuthResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.NotEmpty(t, out.Token)
	assert.Equal(t, "h-login@example.com", out.User.Email)
	assert.NotContains(t, w.Body.String(), "password_hash", "response must not leak the hash")
	assert.NotContains(t, w.Body.String(), "PasswordHash")
}

func TestHandler_Login_BadCredentials_401(t *testing.T) {
	t.Parallel()
	r, _, _ := buildRouter(t, nil)
	w := doJSON(t, r, http.MethodPost, "/v1/auth/login",
		LoginRequest{Email: "nobody@example.com", Password: "anything-12345678"})
	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Contains(t, w.Body.String(), "invalid_credentials")
}

func TestHandler_Login_ValidationError_400(t *testing.T) {
	t.Parallel()
	r, _, _ := buildRouter(t, nil)
	w := doJSON(t, r, http.MethodPost, "/v1/auth/login", map[string]string{"email": "not-an-email"})
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// ---- Signup --------------------------------------------------------------

func TestHandler_Signup_NoToken_401(t *testing.T) {
	t.Parallel()
	r, _, _ := buildRouter(t, nil)
	w := doJSON(t, r, http.MethodPost, "/v1/auth/signup",
		SignupRequest{Email: "x@example.com", Password: goodPassword, Role: auth.RoleAdmin})
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestHandler_Signup_BusinessUserCaller_403(t *testing.T) {
	t.Parallel()
	orgID := bson.NewObjectID()
	bu := bizUserClaims(orgID)
	r, _, _ := buildRouter(t, &bu)

	orgHex := orgID.Hex()
	w := doJSON(t, r, http.MethodPost, "/v1/auth/signup",
		SignupRequest{Email: "blocked@example.com", Password: goodPassword, Role: auth.RoleBusinessUser, OrgID: &orgHex})
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestHandler_Signup_DeveloperCaller_201(t *testing.T) {
	t.Parallel()
	dev := devClaims()
	r, _, _ := buildRouter(t, &dev)

	orgHex := bson.NewObjectID().Hex()
	w := doJSON(t, r, http.MethodPost, "/v1/auth/signup",
		SignupRequest{Email: "new-admin@example.com", Password: goodPassword, Role: auth.RoleAdmin, OrgID: &orgHex})
	require.Equal(t, http.StatusCreated, w.Code, "body=%s", w.Body.String())

	var out AuthResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.NotEmpty(t, out.Token)
	assert.Equal(t, auth.RoleAdmin, out.User.Role)
}

func TestHandler_Signup_DuplicateEmail_409(t *testing.T) {
	t.Parallel()
	dev := devClaims()
	r, _, _ := buildRouter(t, &dev)

	orgHex := bson.NewObjectID().Hex()
	req := SignupRequest{Email: "dup-h@example.com", Password: goodPassword, Role: auth.RoleAdmin, OrgID: &orgHex}

	w1 := doJSON(t, r, http.MethodPost, "/v1/auth/signup", req)
	require.Equal(t, http.StatusCreated, w1.Code)

	w2 := doJSON(t, r, http.MethodPost, "/v1/auth/signup", req)
	assert.Equal(t, http.StatusConflict, w2.Code)
}

// ---- Me ------------------------------------------------------------------

func TestHandler_Me_NoToken_401(t *testing.T) {
	t.Parallel()
	r, _, _ := buildRouter(t, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestHandler_Me_Authenticated_200(t *testing.T) {
	t.Parallel()
	// Pre-seed a user with a known ID, then build a router whose injected
	// claims point at that ID.
	uid := bson.NewObjectID()
	claims := auth.Claims{UserID: uid, Role: auth.RoleDeveloper}
	r, repo, _ := buildRouter(t, &claims)

	require.NoError(t, repo.Create(t.Context(), &User{
		ID: uid, Email: "me-h@example.com", PasswordHash: "x", Role: auth.RoleDeveloper,
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())

	var out UserResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "me-h@example.com", out.Email)
	assert.NotContains(t, w.Body.String(), "password_hash")
}

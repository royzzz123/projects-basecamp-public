package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/OnFinance/project-crud/internal/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func init() { gin.SetMode(gin.TestMode) }

const testSystemKey = "system-key-aaaaaaaaaaaaaaaaaaaaaaaa" // 36 chars, >= 32

func newTestMiddleware(t *testing.T, systemKey string) (*Middleware, *Issuer) {
	t.Helper()
	iss := NewIssuer(config.Config{
		JWTSecret: strings.Repeat("k", 32),
		JWTIssuer: "test",
		JWTTTL:    time.Hour,
	})
	return NewMiddleware(iss, systemKey), iss
}

// withMiddlewareRouter builds a tiny router that runs SystemKey → Authenticate
// → Require(admin) → terminal handler that writes 200 and exposes whether the
// request was system-authed.
func withMiddlewareRouter(t *testing.T, systemKey string) (*gin.Engine, *Issuer) {
	t.Helper()
	mw, iss := newTestMiddleware(t, systemKey)
	r := gin.New()
	g := r.Group("/v1", mw.SystemKey())
	protected := g.Group("", mw.Authenticate())
	protected.GET("/probe", mw.Require(RoleAdmin), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"system": IsSystem(c)})
	})
	return r, iss
}

func TestSystemKey_DisabledWhenEmpty(t *testing.T) {
	t.Parallel()
	r, _ := withMiddlewareRouter(t, "")

	// Header is silently ignored when key is empty — falls through to JWT, no JWT → 401.
	req := httptest.NewRequest(http.MethodGet, "/v1/probe", nil)
	req.Header.Set("X-System-Key", "anything")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestSystemKey_ValidHeaderBypassesAuthAndRBAC(t *testing.T) {
	t.Parallel()
	r, _ := withMiddlewareRouter(t, testSystemKey)

	req := httptest.NewRequest(http.MethodGet, "/v1/probe", nil)
	req.Header.Set("X-System-Key", testSystemKey)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"system":true`)
}

func TestSystemKey_WrongHeaderFallsThroughTo401(t *testing.T) {
	t.Parallel()
	r, _ := withMiddlewareRouter(t, testSystemKey)

	req := httptest.NewRequest(http.MethodGet, "/v1/probe", nil)
	req.Header.Set("X-System-Key", "wrong-value")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Contains(t, w.Body.String(), "auth.invalid_token")
}

func TestSystemKey_MissingHeaderFallsThroughTo401(t *testing.T) {
	t.Parallel()
	r, _ := withMiddlewareRouter(t, testSystemKey)

	req := httptest.NewRequest(http.MethodGet, "/v1/probe", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthenticate_ValidJWTStillWorksWhenSystemKeyConfigured(t *testing.T) {
	t.Parallel()
	r, iss := withMiddlewareRouter(t, testSystemKey)

	token, _, err := iss.Issue(Claims{UserID: bson.NewObjectID(), Role: RoleAdmin})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/v1/probe", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	// Real JWT path → not system-authed.
	assert.Contains(t, w.Body.String(), `"system":false`)
}

func TestRequire_RejectsInsufficientRoleWhenNoSystemKey(t *testing.T) {
	t.Parallel()
	r, iss := withMiddlewareRouter(t, testSystemKey)

	token, _, err := iss.Issue(Claims{UserID: bson.NewObjectID(), Role: RoleBusinessUser})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/v1/probe", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestSystemKey_BypassesEvenWithoutMatchingRole(t *testing.T) {
	t.Parallel()
	// Confirms the bypass is total: even if a downstream Require(Developer)
	// is chained, the system key wins.
	mw, _ := newTestMiddleware(t, testSystemKey)
	r := gin.New()
	g := r.Group("/v1", mw.SystemKey())
	g.GET("/dev-only",
		mw.Authenticate(),
		mw.Require(RoleDeveloper),
		func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) },
	)

	req := httptest.NewRequest(http.MethodGet, "/v1/dev-only", nil)
	req.Header.Set("X-System-Key", testSystemKey)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

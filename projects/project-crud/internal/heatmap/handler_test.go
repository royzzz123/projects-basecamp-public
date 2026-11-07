package heatmap

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func init() { gin.SetMode(gin.TestMode) }

// testMW mirrors the real auth.Middleware contract (Authenticate + Require)
// without JWTs, matching the pattern in internal/entity/handler_test.go.
type testMW struct {
	claims *auth.Claims
}

func (m *testMW) Authenticate() gin.HandlerFunc {
	return func(c *gin.Context) {
		if m.claims == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": gin.H{"code": "auth.invalid_token"}})
			return
		}
		c.Set(auth.CtxClaims, *m.claims)
		c.Next()
	}
}

func (m *testMW) Require(required auth.Role) gin.HandlerFunc {
	return func(c *gin.Context) {
		v, ok := c.Get(auth.CtxClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": gin.H{"code": "auth.invalid_token"}})
			return
		}
		if !v.(auth.Claims).Role.Includes(required) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": gin.H{"code": "forbidden"}})
			return
		}
		c.Next()
	}
}

func registerForTest(rg *gin.RouterGroup, h *Handler, mw *testMW) {
	g := rg.Group("/heatmap", mw.Authenticate(), mw.Require(auth.RoleBusinessUser))
	g.GET("", h.StateHeatmap)
	g.GET("/:state_code", h.StateDrilldown)
}

func buildRouter(claims *auth.Claims) (*gin.Engine, *fakeRepo) {
	repo := &fakeRepo{}
	h := NewHandler(NewService(repo))
	r := gin.New()
	v1 := r.Group("/v1")
	registerForTest(v1, h, &testMW{claims: claims})
	return r, repo
}

func bizUser() auth.Claims {
	return auth.Claims{UserID: bson.NewObjectID(), Role: auth.RoleBusinessUser}
}

// ===== GET /v1/heatmap ====================================================

func TestHandler_StateHeatmap_NoToken_401(t *testing.T) {
	t.Parallel()
	r, _ := buildRouter(nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/heatmap", nil))
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestHandler_StateHeatmap_WrongRole_403(t *testing.T) {
	t.Parallel()
	claims := auth.Claims{UserID: bson.NewObjectID(), Role: auth.Role("guest")}
	r, _ := buildRouter(&claims)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/heatmap", nil))
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestHandler_StateHeatmap_OK(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildRouter(&bu)
	repo.byState = []CodeCount{{Code: "UP", Count: 10}, {Code: "TN", Count: 4}}

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/heatmap", nil))
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())

	var out StateHeatmapResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(14), out.Total)
	assert.NotEmpty(t, out.Items)
	assert.Equal(t, "UP", out.Items[0].StateCode, "highest count first")
}

// ===== GET /v1/heatmap/:state_code ========================================

func TestHandler_Drilldown_OK(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildRouter(&bu)
	repo.byDistrict = []CodeCount{{Code: "GOND", Count: 3}}

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/heatmap/UP", nil))
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())

	var out StateDrilldownResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "UP", out.StateCode)
	assert.Equal(t, "Uttar Pradesh", out.StateName)
	require.Len(t, out.Districts, 1)
	assert.Equal(t, "Gonda", out.Districts[0].DistrictName)
}

func TestHandler_Drilldown_UnknownState_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildRouter(&bu)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/heatmap/ZZ", nil))
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandler_Drilldown_NoToken_401(t *testing.T) {
	t.Parallel()
	r, _ := buildRouter(nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/heatmap/UP", nil))
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

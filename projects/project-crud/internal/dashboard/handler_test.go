package dashboard

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
// without JWTs, matching the pattern in internal/heatmap/handler_test.go.
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
	g := rg.Group("/dashboard", mw.Authenticate(), mw.Require(auth.RoleBusinessUser))
	g.GET("/summary", h.Summary)
	g.GET("/volume-by-subcategory", h.VolumeBySubcategory)
	g.GET("/volume-by-category", h.VolumeByCategory)
}

func buildTestRouter(claims *auth.Claims) (*gin.Engine, *fakeRepo) {
	repo := &fakeRepo{}
	h := NewHandler(newService(repo))
	r := gin.New()
	v1 := r.Group("/v1")
	registerForTest(v1, h, &testMW{claims: claims})
	return r, repo
}

func bizUser() auth.Claims {
	return auth.Claims{UserID: bson.NewObjectID(), Role: auth.RoleBusinessUser}
}

func get(r *gin.Engine, target string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, target, nil))
	return w
}

// ===== GET /v1/dashboard/summary ==========================================

func TestHandler_Summary_NoToken_401(t *testing.T) {
	t.Parallel()
	r, _ := buildTestRouter(nil)
	assert.Equal(t, http.StatusUnauthorized, get(r, "/v1/dashboard/summary").Code)
}

func TestHandler_Summary_WrongRole_403(t *testing.T) {
	t.Parallel()
	claims := auth.Claims{UserID: bson.NewObjectID(), Role: auth.Role("guest")}
	r, _ := buildTestRouter(&claims)
	assert.Equal(t, http.StatusForbidden, get(r, "/v1/dashboard/summary").Code)
}

func TestHandler_Summary_OK(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildTestRouter(&bu)
	repo.counts = SummaryCounts{Total: 1234, Open: 200, Closed: 1034}

	w := get(r, "/v1/dashboard/summary?created_at_from=2024-01-01T00:00:00Z&category=cat12")
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())

	var out SummaryResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(1234), out.Total)
	assert.Equal(t, int64(200), out.Open)
	assert.Equal(t, int64(1034), out.Closed)
	assert.InDelta(t, 83.79, out.ResolutionRate, 0.001)
	assert.Equal(t, []string{"cat12"}, repo.gotSummaryFilter.CategoryCodes)
}

func TestHandler_Summary_BadDate_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildTestRouter(&bu)
	assert.Equal(t, http.StatusBadRequest, get(r, "/v1/dashboard/summary?created_at_from=nonsense").Code)
}

// ===== GET /v1/dashboard/volume-by-subcategory ============================

func TestHandler_VolumeBySubcategory_OK(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildTestRouter(&bu)
	repo.subcat = []SubcategoryCount{{SubCategory: "Others", Complaints: 5}}
	repo.total = 42

	w := get(r, "/v1/dashboard/volume-by-subcategory?limit=5&category=cat12")
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())

	var out SubcategoryVolumeResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Len(t, out.Items, 1)
	assert.Equal(t, "Others", out.Items[0].SubCategory)
	assert.Equal(t, int64(42), out.Total)
	assert.Equal(t, 5, out.Limit)
	assert.Equal(t, 5, repo.gotSubcatLimit)
}

func TestHandler_VolumeBySubcategory_BadLimit_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildTestRouter(&bu)
	assert.Equal(t, http.StatusBadRequest, get(r, "/v1/dashboard/volume-by-subcategory?limit=abc").Code)
}

func TestHandler_VolumeBySubcategory_BadDate_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildTestRouter(&bu)
	assert.Equal(t, http.StatusBadRequest, get(r, "/v1/dashboard/volume-by-subcategory?created_at_to=bad").Code)
}

// ===== GET /v1/dashboard/volume-by-category ===============================

func TestHandler_VolumeByCategory_OK(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildTestRouter(&bu)
	repo.cat = []CategoryCount{{CategoryCode: "cat12", CategoryName: "Stock Broker", Complaints: 9}}
	repo.total = 100

	w := get(r, "/v1/dashboard/volume-by-category")
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())

	var out CategoryVolumeResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Len(t, out.Items, 1)
	assert.Equal(t, "cat12", out.Items[0].CategoryCode)
	assert.Equal(t, "Stock Broker", out.Items[0].CategoryName)
	assert.Equal(t, int64(100), out.Total)
}

func TestHandler_VolumeByCategory_NoToken_401(t *testing.T) {
	t.Parallel()
	r, _ := buildTestRouter(nil)
	assert.Equal(t, http.StatusUnauthorized, get(r, "/v1/dashboard/volume-by-category").Code)
}

package entity

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
		claims := v.(auth.Claims)
		if !claims.Role.Includes(required) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": gin.H{"code": "forbidden"}})
			return
		}
		c.Next()
	}
}

func registerForTest(rg *gin.RouterGroup, h *Handler, mw *testMW) {
	g := rg.Group("/entities", mw.Authenticate(), mw.Require(auth.RoleBusinessUser))
	g.GET("", h.List)
	g.GET("/filter", h.Filter)
}

func buildRouter(claims *auth.Claims) (*gin.Engine, *fakeRepo) {
	repo := &fakeRepo{}
	svc := NewService(repo, 20, 100, 20, 50)
	h := NewHandler(svc)
	r := gin.New()
	v1 := r.Group("/v1")
	registerForTest(v1, h, &testMW{claims: claims})
	return r, repo
}

func bizUser() auth.Claims {
	return auth.Claims{UserID: bson.NewObjectID(), Role: auth.RoleBusinessUser}
}

// ===== GET /v1/entities/filter ============================================

func TestHandler_Filter_NoToken_401(t *testing.T) {
	t.Parallel()
	r, _ := buildRouter(nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/entities/filter", nil))
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestHandler_Filter_WrongRole_403(t *testing.T) {
	t.Parallel()
	claims := auth.Claims{UserID: bson.NewObjectID(), Role: auth.Role("guest")}
	r, _ := buildRouter(&claims)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/entities/filter", nil))
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestHandler_Filter_OK(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildRouter(&bu)
	repo.filterPage = []FilterItem{{ID: "stb10700", Name: "HDFC SECURITIES LTD."}}

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/entities/filter?q=HDFC&limit=5", nil))
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())

	var out FilterResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, 5, out.Limit)
	require.Len(t, out.Items, 1)
	assert.Equal(t, "stb10700", out.Items[0].ID)
	assert.Equal(t, "HDFC", repo.lastFilterArgs.Query)
}

func TestHandler_Filter_BadCursor_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildRouter(&bu)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/entities/filter?after=not-base64!!", nil))
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandler_Filter_BadLimit_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildRouter(&bu)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/entities/filter?limit=abc", nil))
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// ===== GET /v1/entities ===================================================

func TestHandler_List_NoToken_401(t *testing.T) {
	t.Parallel()
	r, _ := buildRouter(nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/entities", nil))
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestHandler_List_WrongRole_403(t *testing.T) {
	t.Parallel()
	claims := auth.Claims{UserID: bson.NewObjectID(), Role: auth.Role("guest")}
	r, _ := buildRouter(&claims)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/entities", nil))
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestHandler_List_OK_BodyShape(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildRouter(&bu)
	cat := "Stock Broker"
	regno := "INZ000186937"
	repo.listPage = []ListRow{{
		ListItem: ListItem{
			ID: "stb10700", Entity: "HDFC SECURITIES LTD.", EntityType: "intermediary",
			Category: &cat, RegistrationNumber: &regno,
		},
		UID: 45747,
	}}
	repo.countResp = []ComplaintCount{
		{
			EntityID: "stb10700", Open: 12, Closed: 130,
			FirstLevelReviewEscalated: 34, SecondLevelReviewEscalated: 11,
		},
	}
	repo.total = 9

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/entities?limit=5", nil))
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())

	var out ListResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, 5, out.Limit)
	assert.Equal(t, int64(9), out.Total)
	require.Len(t, out.Items, 1)
	item := out.Items[0]
	assert.Equal(t, "stb10700", item.ID)
	assert.Equal(t, "HDFC SECURITIES LTD.", item.Entity)
	assert.Equal(t, "intermediary", item.EntityType)
	require.NotNil(t, item.Category)
	assert.Equal(t, "Stock Broker", *item.Category)
	assert.Equal(t, int64(12), item.OpenComplaints)
	assert.Equal(t, int64(130), item.ClosedComplaints)
	assert.Equal(t, int64(142), item.TotalComplaints)
	assert.Equal(t, int64(34), item.FirstLevelReviewEscalated)
	assert.InDelta(t, 23.94, item.FirstLevelReviewEscalationPct, 0.01, "34/142 = 23.94%")
	assert.Equal(t, int64(11), item.SecondLevelReviewEscalated)
	assert.InDelta(t, 7.75, item.SecondLevelReviewEscalationPct, 0.01, "11/142 = 7.75%")

	// Also verify the fields are serialised under their snake_case JSON names.
	var raw map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &raw))
	items := raw["items"].([]any)
	require.Len(t, items, 1)
	firstItem := items[0].(map[string]any)
	assert.Contains(t, firstItem, "first_level_review_escalated")
	assert.Contains(t, firstItem, "first_level_review_escalation_pct")
	assert.Contains(t, firstItem, "second_level_review_escalated")
	assert.Contains(t, firstItem, "second_level_review_escalation_pct")
}

func TestHandler_List_RepeatedQueryKeysReachService(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildRouter(&bu)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet,
		"/v1/entities?category=cat12&category=cat2&entity_type=intermediary&entity_type=listed", nil))
	require.Equal(t, http.StatusOK, w.Code)

	assert.Equal(t, []string{"cat12", "cat2"}, repo.lastListArgs.CategoryCodes)
	assert.Equal(t, []string{"intermediary", "listed"}, repo.lastListArgs.EntityTypes)
}

func TestHandler_List_BadCursor_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildRouter(&bu)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/entities?after=not-base64!!", nil))
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandler_List_BadLimit_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildRouter(&bu)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/entities?limit=abc", nil))
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

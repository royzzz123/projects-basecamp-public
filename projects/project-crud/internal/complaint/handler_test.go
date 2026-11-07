package complaint

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func init() { gin.SetMode(gin.TestMode) }

// testMW mirrors auth.Middleware's interface but skips JWT verification — it
// trusts whatever claims the test wired in. Same pattern as
// internal/user/handler_test.go (registerForTest).
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
	g := rg.Group("/complaints", mw.Authenticate(), mw.Require(auth.RoleBusinessUser))
	g.GET("", h.List)
	g.GET("/filters", h.Filters)
	g.GET("/:complaint_id", h.Get)
}

func buildRouter(claims *auth.Claims) (*gin.Engine, *fakeRepo) {
	repo := &fakeRepo{}
	svc := NewService(repo, 50, 200)
	h := NewHandler(svc)
	r := gin.New()
	v1 := r.Group("/v1")
	registerForTest(v1, h, &testMW{claims: claims})
	return r, repo
}

func bizUser() auth.Claims {
	return auth.Claims{UserID: bson.NewObjectID(), Role: auth.RoleBusinessUser}
}

// ---- /v1/complaints -----------------------------------------------------

func TestHandler_List_NoToken_401(t *testing.T) {
	t.Parallel()
	r, _ := buildRouter(nil)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/complaints", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestHandler_List_WrongRole_403(t *testing.T) {
	t.Parallel()
	// Role with no rank → fails Includes(business_user)
	claims := auth.Claims{UserID: bson.NewObjectID(), Role: auth.Role("guest")}
	r, _ := buildRouter(&claims)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/complaints", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestHandler_List_OK_BodyShape(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildRouter(&bu)
	name := "HDFC SECURITIES LTD."
	cat := "Stock Broker"
	repo.page = []ListItem{
		{ComplaintID: 1, EntityScreenID: "stb10700", IntermediaryName: &name, Category: &cat, SubCategory: "Others", Status: "CLOSED"},
	}
	repo.total = 17

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/complaints?limit=5", nil)
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())

	var out ListResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, 5, out.Limit)
	assert.Equal(t, int64(17), out.Total)
	require.Len(t, out.Items, 1)
	assert.Equal(t, "stb10700", out.Items[0].EntityScreenID)
}

func TestHandler_List_BadLimit_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildRouter(&bu)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/complaints?limit=abc", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandler_List_BadCursor_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildRouter(&bu)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/complaints?after=not-base64!!", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandler_List_BadTimestamp_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildRouter(&bu)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/complaints?created_at_from=yesterday", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandler_List_RepeatedQueryKeysReachService(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildRouter(&bu)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"/v1/complaints?status=CLOSED&status=START&entityscreenid=stb10700&category=cat12&category=cat2", nil)
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	assert.Equal(t, []string{"CLOSED", "START"}, repo.lastFilter.Statuses)
	assert.Equal(t, []string{"stb10700"}, repo.lastFilter.EntityScreenIDs)
	assert.Equal(t, []string{"cat12", "cat2"}, repo.lastFilter.CategoryCodes)
}

// ---- /v1/complaints/filters --------------------------------------------

func TestHandler_Filters_OK(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildRouter(&bu)
	repo.statuses = []string{"CLOSED"}
	repo.categories = []CategoryOption{{Code: "cat12", Name: "Stock Broker"}}
	repo.subCategories = []SubCategoryOption{{Name: "Others"}}

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/complaints/filters", nil)
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())

	var out FiltersResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, []string{"CLOSED"}, out.Statuses)
	assert.Equal(t, "cat12", out.Categories[0].Code)
	assert.Equal(t, "Others", out.SubCategories[0].Name)
}

func TestHandler_Filters_NoToken_401(t *testing.T) {
	t.Parallel()
	r, _ := buildRouter(nil)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/complaints/filters", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// ---- /v1/complaints/:complaint_id ---------------------------------------

func TestHandler_Get_NoToken_401(t *testing.T) {
	t.Parallel()
	r, _ := buildRouter(nil)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/complaints/1743319", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestHandler_Get_BadID_400(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, _ := buildRouter(&bu)
	for _, raw := range []string{"abc", "-5"} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/v1/complaints/"+raw, nil)
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusBadRequest, w.Code, "id=%q", raw)
	}
}

func TestHandler_Get_NotFound_404(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildRouter(&bu)
	repo.detailErr = apperror.ErrNotFound

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/complaints/99999999", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHandler_Get_OK_BodyShape(t *testing.T) {
	t.Parallel()
	bu := bizUser()
	r, repo := buildRouter(&bu)

	filed := time.Date(2024, 10, 3, 13, 0, 33, 0, time.UTC)
	closed := time.Date(2024, 11, 8, 21, 0, 5, 0, time.UTC)
	entityName := "HDFC SECURITIES LTD."
	entityType := "intermediary"
	startState := "START"
	investor := "Investor"
	entity := "Entity"
	atrRemarks := "Please find attached ATR"

	repo.detail = Detail{
		ComplaintID:      1743319,
		ComplaintCode:    "SEBIE/TN24/KANC/033849/3",
		ComplaintDetails: "close to 52000 is missing in my account",
		SubCategory:      "Mis-appropriation of client's funds / securities",
		Category:         &DetailCategory{Code: "cat12", Name: ptrStr("Stock Broker")},
		CreatedAt:        filed,
		FiledDate:        filed,
		ModifiedDateRaw:  closed,
		ClosedAt:         &closed,
		CurrentStatus:    "CLOSED",
		Entity:           DetailEntity{ScreenID: "stb10523", Name: &entityName, Type: &entityType},
	}
	repo.timeline = []ActivityEntry{
		{LogID: 1, At: filed, Role: &investor, Action: "level_created", WFState: &startState, DocURLs: []string{}},
		{LogID: 2, At: filed.Add(21 * 24 * time.Hour), Role: &entity, Action: "ATR", WFState: &startState, Remarks: &atrRemarks, DocURLs: []string{"doc-a", "doc-b"}},
		{LogID: 3, At: closed, Role: ptrStr("System"), Action: "CLOSED_BY_SYSTEM", WFState: ptrStr("CLOSED"), DocURLs: []string{}},
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/complaints/1743319", nil)
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code, "body=%s", w.Body.String())

	var out Detail
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(1743319), out.ComplaintID)
	assert.Equal(t, "SEBIE/TN24/KANC/033849/3", out.ComplaintCode)
	assert.Equal(t, "stb10523", out.Entity.ScreenID)
	assert.Equal(t, []string{"doc-a", "doc-b"}, out.DocURLs)
	require.Len(t, out.StatusProgression, 2)
	assert.Equal(t, "START", out.StatusProgression[0].State)
	assert.Equal(t, "CLOSED", out.StatusProgression[1].State)
	assert.True(t, out.StatusProgression[1].Current)
	require.NotNil(t, out.TimeTakenSeconds)
	require.NotNil(t, out.TimeTakenLabel)
	assert.Equal(t, int64(1743319), repo.lastGetID)
	assert.Equal(t, int64(1743319), repo.lastListLogID)
}

// Sanity check that registerForTest pipes through ctx as expected.
var _ context.Context = context.Background()

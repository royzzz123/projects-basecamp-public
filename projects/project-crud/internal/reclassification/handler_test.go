package reclassification

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func init() { gin.SetMode(gin.TestMode) }

func buildRouter(t *testing.T) (*gin.Engine, *fakeRepo) {
	t.Helper()
	repo := &fakeRepo{}
	h := NewHandler(NewService(repo))

	r := gin.New()
	g := r.Group("/v1/complaints/:complaint_id/reclassification")
	g.GET("", h.Get)
	g.POST("", h.Store)
	return r, repo
}

func do(r *gin.Engine, method, path string, body any) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestHandler_Get_NoSuggestion(t *testing.T) {
	t.Parallel()
	r, repo := buildRouter(t)
	repo.orig = "Others"

	w := do(r, http.MethodGet, "/v1/complaints/42/reclassification", nil)
	require.Equal(t, http.StatusOK, w.Code)

	var resp Response
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, int64(42), resp.ComplaintID)
	assert.Equal(t, "Others", resp.OriginalSubCategory)
	assert.Nil(t, resp.Suggestion)
}

func TestHandler_Store_BadConfidence(t *testing.T) {
	t.Parallel()
	r, _ := buildRouter(t)

	body := validReq()
	body.Confidence = 101
	w := do(r, http.MethodPost, "/v1/complaints/1/reclassification", body)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandler_Store_RoundTrip(t *testing.T) {
	t.Parallel()
	r, repo := buildRouter(t)

	w := do(r, http.MethodPost, "/v1/complaints/100/reclassification", validReq())
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, int64(100), repo.storedID)

	w = do(r, http.MethodGet, "/v1/complaints/100/reclassification", nil)
	require.Equal(t, http.StatusOK, w.Code)
	var resp Response
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.NotNil(t, resp.Suggestion)
	assert.Equal(t, validReq().AIGeneratedSubCategory, resp.Suggestion.AIGeneratedSubCategory)
}

func TestHandler_InvalidComplaintID(t *testing.T) {
	t.Parallel()
	r, _ := buildRouter(t)
	for _, path := range []string{
		"/v1/complaints/abc/reclassification",
		"/v1/complaints/0/reclassification",
		"/v1/complaints/-3/reclassification",
	} {
		w := do(r, http.MethodGet, path, nil)
		assert.Equal(t, http.StatusBadRequest, w.Code, "path: %s", path)
	}
}

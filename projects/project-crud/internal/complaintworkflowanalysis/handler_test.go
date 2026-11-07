package complaintworkflowanalysis

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func init() { gin.SetMode(gin.TestMode) }

// buildHandlerRouter wires the handlers into a gin engine WITHOUT auth — the
// auth surface is tested separately in the auth package. Tests here focus on
// request parsing, error mapping, and response shape.
func buildHandlerRouter(t *testing.T) (*gin.Engine, *fakeRepo) {
	t.Helper()
	repo := newFakeRepo()
	svc := &Service{repo: repo, now: func() time.Time {
		return time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	}}
	h := NewHandler(svc)

	r := gin.New()
	g := r.Group("/v1/complaint-workflow-analysis")
	g.GET("/:complaint_id", h.Get)
	g.POST("/:complaint_id", h.Store)
	return r, repo
}

func doRequest(r *gin.Engine, method, path string, body any) *httptest.ResponseRecorder {
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

func TestHandler_StoreThenGet_RoundTrip(t *testing.T) {
	t.Parallel()
	r, _ := buildHandlerRouter(t)

	overall := "ok"
	body := StoreRequest{WorkflowAnalysis: WorkflowAnalysis{OverallSummary: &overall}}

	w := doRequest(r, http.MethodPost, "/v1/complaint-workflow-analysis/12345", body)
	require.Equal(t, http.StatusOK, w.Code)

	var stored Analysis
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &stored))
	assert.Equal(t, int64(12345), stored.ComplaintID)
	require.NotNil(t, stored.WorkflowAnalysis.OverallSummary)
	assert.Equal(t, overall, *stored.WorkflowAnalysis.OverallSummary)

	w = doRequest(r, http.MethodGet, "/v1/complaint-workflow-analysis/12345", nil)
	require.Equal(t, http.StatusOK, w.Code)
	var fetched Analysis
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &fetched))
	assert.Equal(t, stored, fetched)
}

func TestHandler_Get_NotFound(t *testing.T) {
	t.Parallel()
	r, _ := buildHandlerRouter(t)

	w := doRequest(r, http.MethodGet, "/v1/complaint-workflow-analysis/9999", nil)
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), `"code":"not_found"`)
}

func TestHandler_InvalidComplaintID(t *testing.T) {
	t.Parallel()
	r, _ := buildHandlerRouter(t)

	cases := []struct {
		name string
		path string
	}{
		{"non-numeric", "/v1/complaint-workflow-analysis/abc"},
		{"zero", "/v1/complaint-workflow-analysis/0"},
		{"negative", "/v1/complaint-workflow-analysis/-1"},
	}
	for _, tc := range cases {
		t.Run("GET "+tc.name, func(t *testing.T) {
			w := doRequest(r, http.MethodGet, tc.path, nil)
			assert.Equal(t, http.StatusBadRequest, w.Code)
			assert.Contains(t, w.Body.String(), `"code":"validation"`)
		})
		t.Run("POST "+tc.name, func(t *testing.T) {
			w := doRequest(r, http.MethodPost, tc.path, StoreRequest{})
			assert.Equal(t, http.StatusBadRequest, w.Code)
		})
	}
}

func TestHandler_Store_MalformedJSON(t *testing.T) {
	t.Parallel()
	r, _ := buildHandlerRouter(t)

	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/complaint-workflow-analysis/1",
		bytes.NewBufferString("{not valid json"),
	)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandler_DocSummary_AIGeneratedName_RoundTrip(t *testing.T) {
	t.Parallel()
	r, _ := buildHandlerRouter(t)

	name := "Investor Complaint Letter"
	body := StoreRequest{
		EnrichedTimeline: []EnrichedTimelineEntry{
			{DocSummaries: []DocSummary{{UUID: "abc-123", AIGeneratedName: &name}}},
		},
	}

	w := doRequest(r, http.MethodPost, "/v1/complaint-workflow-analysis/55", body)
	require.Equal(t, http.StatusOK, w.Code)

	var stored Analysis
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &stored))
	require.Len(t, stored.EnrichedTimeline, 1)
	require.Len(t, stored.EnrichedTimeline[0].DocSummaries, 1)
	doc := stored.EnrichedTimeline[0].DocSummaries[0]
	require.NotNil(t, doc.AIGeneratedName)
	assert.Equal(t, name, *doc.AIGeneratedName)
}

func TestHandler_Store_UpsertOverwrites(t *testing.T) {
	t.Parallel()
	r, _ := buildHandlerRouter(t)

	first := "first"
	second := "second"

	w := doRequest(r, http.MethodPost, "/v1/complaint-workflow-analysis/1",
		StoreRequest{WorkflowAnalysis: WorkflowAnalysis{OverallSummary: &first}})
	require.Equal(t, http.StatusOK, w.Code)
	var v1 Analysis
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &v1))

	w = doRequest(r, http.MethodPost, "/v1/complaint-workflow-analysis/1",
		StoreRequest{WorkflowAnalysis: WorkflowAnalysis{OverallSummary: &second}})
	require.Equal(t, http.StatusOK, w.Code)
	var v2 Analysis
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &v2))

	assert.Equal(t, second, *v2.WorkflowAnalysis.OverallSummary)
	assert.True(t, v1.CreatedAt.Equal(v2.CreatedAt), "CreatedAt preserved across upsert")
}

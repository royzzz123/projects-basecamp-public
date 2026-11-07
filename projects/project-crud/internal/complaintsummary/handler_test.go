package complaintsummary

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

func buildHandlerRouter(t *testing.T) (*gin.Engine, *fakeRepo) {
	t.Helper()
	repo := newFakeRepo()
	svc := &Service{repo: repo, now: func() time.Time {
		return time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	}}
	h := NewHandler(svc)

	r := gin.New()
	g := r.Group("/v1/complaint-summary")
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

	body := StoreRequest{
		ComplaintDetails: "the raw text",
		Summary: SummaryPayload{
			BriefSummary:   "summary",
			ConciseSummary: "one line",
			KeyIssues:      []string{"a", "b"},
			Demands:        []string{"refund"},
			Sentiment:      "angry",
		},
	}

	w := doRequest(r, http.MethodPost, "/v1/complaint-summary/42", body)
	require.Equal(t, http.StatusOK, w.Code)
	var stored Summary
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &stored))
	assert.Equal(t, int64(42), stored.ComplaintID)
	assert.Equal(t, "the raw text", stored.ComplaintDetails)
	assert.Equal(t, "one line", stored.Summary.ConciseSummary)
	assert.Equal(t, []string{"a", "b"}, stored.Summary.KeyIssues)

	w = doRequest(r, http.MethodGet, "/v1/complaint-summary/42", nil)
	require.Equal(t, http.StatusOK, w.Code)
	var fetched Summary
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &fetched))
	assert.Equal(t, stored, fetched)
}

func TestHandler_Get_NotFound(t *testing.T) {
	t.Parallel()
	r, _ := buildHandlerRouter(t)

	w := doRequest(r, http.MethodGet, "/v1/complaint-summary/9999", nil)
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
		{"non-numeric", "/v1/complaint-summary/abc"},
		{"zero", "/v1/complaint-summary/0"},
		{"negative", "/v1/complaint-summary/-1"},
	}
	for _, tc := range cases {
		t.Run("GET "+tc.name, func(t *testing.T) {
			w := doRequest(r, http.MethodGet, tc.path, nil)
			assert.Equal(t, http.StatusBadRequest, w.Code)
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
		"/v1/complaint-summary/1",
		bytes.NewBufferString("{nope"),
	)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestHandler_Store_UpsertOverwrites(t *testing.T) {
	t.Parallel()
	r, _ := buildHandlerRouter(t)

	first := StoreRequest{ComplaintDetails: "v1", Summary: SummaryPayload{BriefSummary: "one"}}
	second := StoreRequest{ComplaintDetails: "v2", Summary: SummaryPayload{BriefSummary: "two"}}

	w := doRequest(r, http.MethodPost, "/v1/complaint-summary/1", first)
	require.Equal(t, http.StatusOK, w.Code)
	var v1 Summary
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &v1))

	w = doRequest(r, http.MethodPost, "/v1/complaint-summary/1", second)
	require.Equal(t, http.StatusOK, w.Code)
	var v2 Summary
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &v2))

	assert.Equal(t, "two", v2.Summary.BriefSummary)
	assert.Equal(t, "v2", v2.ComplaintDetails)
	assert.True(t, v1.CreatedAt.Equal(v2.CreatedAt), "CreatedAt preserved across upsert")
}

package middleware

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// TestRequestID_Concurrent exercises the middleware from many goroutines at
// once. With the old shared ulid.Monotonic entropy source this panicked with
// "slice bounds out of range" under -race; ulid.Make is concurrency-safe.
func TestRequestID_Concurrent(t *testing.T) {
	t.Parallel()

	r := gin.New()
	r.Use(RequestID())
	r.GET("/", func(c *gin.Context) {
		if c.GetString(CtxRequestID) == "" {
			t.Error("request_id not set on context")
		}
		c.Status(http.StatusOK)
	})

	const n = 200
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			r.ServeHTTP(w, req)
			if w.Code != http.StatusOK {
				t.Errorf("got status %d, want 200", w.Code)
			}
			if w.Header().Get(HeaderRequestID) == "" {
				t.Error("missing X-Request-Id response header")
			}
		}()
	}
	wg.Wait()
}

// TestRequestID_TrustsClientHeader verifies a client-supplied ID is preserved.
func TestRequestID_TrustsClientHeader(t *testing.T) {
	t.Parallel()

	const supplied = "client-supplied-id"
	r := gin.New()
	r.Use(RequestID())
	r.GET("/", func(c *gin.Context) {
		if got := c.GetString(CtxRequestID); got != supplied {
			t.Errorf("got request_id %q, want %q", got, supplied)
		}
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderRequestID, supplied)
	r.ServeHTTP(w, req)

	if got := w.Header().Get(HeaderRequestID); got != supplied {
		t.Errorf("got response header %q, want %q", got, supplied)
	}
}

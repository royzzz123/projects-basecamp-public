package middleware

import (
	"sync"
	"time"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/gin-gonic/gin"
)

// RateLimit is a simple per-IP token bucket. Single-instance only — replace
// with a Redis-backed limiter when this service scales horizontally.
func RateLimit(maxRequests int, window time.Duration) gin.HandlerFunc {
	type bucket struct {
		tokens     float64
		lastRefill time.Time
	}

	var (
		mu      sync.Mutex
		buckets = make(map[string]*bucket)
	)
	refillRate := float64(maxRequests) / window.Seconds()

	return func(c *gin.Context) {
		ip := c.ClientIP()
		now := time.Now()

		mu.Lock()
		b, ok := buckets[ip]
		if !ok {
			b = &bucket{tokens: float64(maxRequests), lastRefill: now}
			buckets[ip] = b
		}
		elapsed := now.Sub(b.lastRefill).Seconds()
		b.tokens += elapsed * refillRate
		if b.tokens > float64(maxRequests) {
			b.tokens = float64(maxRequests)
		}
		b.lastRefill = now

		if b.tokens < 1 {
			mu.Unlock()
			apperror.Write(c, &apperror.Error{
				Code:       "rate_limited",
				Message:    "too many requests",
				HTTPStatus: 429,
			})
			return
		}
		b.tokens--
		mu.Unlock()

		c.Next()
	}
}

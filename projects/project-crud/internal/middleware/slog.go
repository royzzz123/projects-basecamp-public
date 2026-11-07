package middleware

import (
	"log/slog"
	"time"

	"github.com/OnFinance/project-crud/internal/observability"
	"github.com/gin-gonic/gin"
)

// SLog attaches a request-scoped logger to the context and emits one log line
// per request with method, route, status, latency, and request_id.
func SLog(base *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		requestID := c.GetString(CtxRequestID)
		l := base.With("request_id", requestID)

		ctx := observability.WithLogger(c.Request.Context(), l)
		c.Request = c.Request.WithContext(ctx)

		c.Next()

		route := c.FullPath()
		if route == "" {
			route = "unknown"
		}
		l.LogAttrs(ctx, slog.LevelInfo, "http_request",
			slog.String("method", c.Request.Method),
			slog.String("route", route),
			slog.Int("status", c.Writer.Status()),
			slog.Duration("latency", time.Since(start)),
			slog.String("client_ip", c.ClientIP()),
		)
	}
}

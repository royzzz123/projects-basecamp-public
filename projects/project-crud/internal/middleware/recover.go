package middleware

import (
	"log/slog"
	"runtime/debug"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/gin-gonic/gin"
)

// Recover catches panics, logs them with a stack trace via slog, and returns a
// structured 500. Use this instead of gin.Recovery() so the error envelope and
// logging stay consistent.
func Recover(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if rec := recover(); rec != nil {
				logger.Error("panic recovered",
					"request_id", c.GetString(CtxRequestID),
					"panic", rec,
					"stack", string(debug.Stack()),
					"path", c.Request.URL.Path,
				)
				apperror.Write(c, apperror.ErrInternal)
			}
		}()
		c.Next()
	}
}

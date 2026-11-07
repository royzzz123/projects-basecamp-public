package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/oklog/ulid/v2"
)

const (
	HeaderRequestID = "X-Request-Id"
	CtxRequestID    = "request_id"
)

// RequestID sets a per-request ULID on the context and the response header.
// If the client supplied a request ID, we trust it (handy for distributed tracing).
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader(HeaderRequestID)
		if id == "" {
			// ulid.Make uses a package-level, mutex-protected monotonic
			// entropy source, so it is safe to call from concurrent requests.
			id = ulid.Make().String()
		}
		c.Set(CtxRequestID, id)
		c.Writer.Header().Set(HeaderRequestID, id)
		c.Next()
	}
}

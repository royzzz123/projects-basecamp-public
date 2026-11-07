package auth

import (
	"crypto/subtle"
	"strings"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/gin-gonic/gin"
)

type Middleware struct {
	issuer    *Issuer
	systemKey string
}

func NewMiddleware(issuer *Issuer, systemKey string) *Middleware {
	return &Middleware{issuer: issuer, systemKey: systemKey}
}

// SystemKey is a pre-auth middleware that flags the request as system-authed
// when the X-System-Key header matches the configured shared secret. It never
// rejects — absence (or mismatch) of the header simply falls through to the
// downstream JWT check. Mount this once on a parent group; downstream
// Authenticate and Require both short-circuit when the flag is set.
//
// When the configured key is empty, the middleware is a no-op: this is the
// safe default so missing config never accidentally permits empty headers.
func (m *Middleware) SystemKey() gin.HandlerFunc {
	if m.systemKey == "" {
		return func(c *gin.Context) { c.Next() }
	}
	expected := []byte(m.systemKey)
	return func(c *gin.Context) {
		got := c.GetHeader("X-System-Key")
		if got != "" && subtle.ConstantTimeCompare([]byte(got), expected) == 1 {
			c.Set(CtxSystemAuthed, true)
		}
		c.Next()
	}
}

// Authenticate parses the Authorization header, verifies the JWT, and stores
// the resulting Claims on the Gin context. Any failure returns 401 with
// auth.invalid_token — never 403, to distinguish authentication from authorization.
//
// Short-circuits when SystemKey has already flagged the request as system-authed.
func (m *Middleware) Authenticate() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetBool(CtxSystemAuthed) {
			c.Next()
			return
		}
		header := c.GetHeader("Authorization")
		const prefix = "Bearer "
		if !strings.HasPrefix(header, prefix) {
			apperror.Write(c, apperror.ErrInvalidToken)
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(header, prefix))
		if token == "" {
			apperror.Write(c, apperror.ErrInvalidToken)
			return
		}
		claims, err := m.issuer.Verify(token)
		if err != nil {
			apperror.Write(c, apperror.ErrInvalidToken)
			return
		}
		c.Set(CtxClaims, claims)
		c.Next()
	}
}

// Require enforces that the authenticated caller has at least the given role.
// Must be chained after Authenticate. Short-circuits for system-authed requests.
func (m *Middleware) Require(required Role) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetBool(CtxSystemAuthed) {
			c.Next()
			return
		}
		v, ok := c.Get(CtxClaims)
		if !ok {
			apperror.Write(c, apperror.ErrInvalidToken)
			return
		}
		claims, ok := v.(Claims)
		if !ok {
			apperror.Write(c, apperror.ErrInvalidToken)
			return
		}
		if !claims.Role.Includes(required) {
			apperror.Write(c, apperror.ErrForbidden)
			return
		}
		c.Next()
	}
}

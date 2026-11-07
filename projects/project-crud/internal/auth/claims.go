package auth

import (
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/v2/bson"
)

const (
	CtxClaims = "claims"
	// CtxSystemAuthed is set to true by the SystemKey middleware when a
	// request presents a valid X-System-Key header. Downstream auth checks
	// (Authenticate, Require) treat such requests as fully authorized and
	// skip JWT / role enforcement. System-authed requests have no Claims —
	// handlers that need user identity must guard with IsSystem(c).
	CtxSystemAuthed = "system_authed"
)

// IsSystem reports whether the current request was authenticated via the
// X-System-Key bypass rather than a JWT.
func IsSystem(c *gin.Context) bool { return c.GetBool(CtxSystemAuthed) }

type Claims struct {
	UserID bson.ObjectID  `json:"sub"`
	OrgID  *bson.ObjectID `json:"org_id,omitempty"`
	Role   Role           `json:"role"`
	jwt.RegisteredClaims
}

// MustClaims returns the authenticated Claims attached by the Authenticate middleware.
// Panics if called outside an authenticated route group; the Recover middleware
// converts that into a 500, which signals a routing bug.
func MustClaims(c *gin.Context) Claims {
	v, ok := c.Get(CtxClaims)
	if !ok {
		panic("auth.MustClaims called outside an authenticated route")
	}
	claims, ok := v.(Claims)
	if !ok {
		panic("auth: claims context value has wrong type")
	}
	return claims
}

package user

import (
	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts the auth surface on the given group.
// Mount this on the /v1 group (so the final paths are /v1/auth/...).
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, mw *auth.Middleware) {
	authGroup := rg.Group("/auth")

	// Public
	authGroup.POST("/login", h.Login)

	// Authenticated
	protected := authGroup.Group("", mw.Authenticate())
	protected.GET("/me", mw.Require(auth.RoleBusinessUser), h.Me)
	protected.POST("/signup", mw.Require(auth.RoleAdmin), h.Signup)
}

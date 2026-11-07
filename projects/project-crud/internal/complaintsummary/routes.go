package complaintsummary

import (
	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts the complaint-summary surface on /v1.
// GET requires business_user (UI consumption); POST requires developer
// (intended for the AI backend). Service-to-service callers may bypass both
// role checks by presenting a valid X-System-Key header — see auth.SystemKey.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, mw *auth.Middleware) {
	g := rg.Group("/complaint-summary", mw.Authenticate())
	g.GET("/:complaint_id", mw.Require(auth.RoleBusinessUser), h.Get)
	g.POST("/:complaint_id", mw.Require(auth.RoleDeveloper), h.Store)
}

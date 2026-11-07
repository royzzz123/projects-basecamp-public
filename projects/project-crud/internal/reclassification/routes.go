package reclassification

import (
	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts the reclassification surface as a sub-resource of
// /v1/complaints/:complaint_id/reclassification.
//
// RBAC:
//   - GET  business_user — anyone with read access can see the current suggestion
//   - POST developer     — write a fresh AI suggestion
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, mw *auth.Middleware) {
	g := rg.Group("/complaints/:complaint_id/reclassification", mw.Authenticate())
	g.GET("", mw.Require(auth.RoleBusinessUser), h.Get)
	g.POST("", mw.Require(auth.RoleDeveloper), h.Store)
}

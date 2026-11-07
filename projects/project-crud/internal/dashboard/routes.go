package dashboard

import (
	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts the dashboard surface on the /v1 group. Same RBAC as
// complaints/heatmap: authenticated business users and above. These are
// public-regulatory aggregates with no per-org owner, so there is no org
// scoping.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, mw *auth.Middleware) {
	g := rg.Group("/dashboard", mw.Authenticate(), mw.Require(auth.RoleBusinessUser))
	g.GET("/summary", h.Summary)
	g.GET("/volume-by-subcategory", h.VolumeBySubcategory)
	g.GET("/volume-by-subcategory-trend", h.VolumeBySubcategoryTrend)
	g.GET("/volume-by-category", h.VolumeByCategory)
	g.GET("/volume-by-category-trend", h.VolumeByCategoryTrend)
}

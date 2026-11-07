package heatmap

import (
	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts the heatmap surface on the /v1 group, so the final paths
// are /v1/heatmap and /v1/heatmap/{state_code}. Same RBAC as complaints:
// authenticated business users and above.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, mw *auth.Middleware) {
	g := rg.Group("/heatmap", mw.Authenticate(), mw.Require(auth.RoleBusinessUser))
	g.GET("", h.StateHeatmap)
	g.GET("/:state_code", h.StateDrilldown)
}

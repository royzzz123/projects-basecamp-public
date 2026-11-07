package complaint

import (
	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts the complaints surface. Mount on the /v1 group so the
// final paths are /v1/complaints and /v1/complaints/filters.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, mw *auth.Middleware) {
	g := rg.Group("/complaints", mw.Authenticate(), mw.Require(auth.RoleBusinessUser))
	g.GET("", h.List)
	g.GET("/filters", h.Filters)
	g.GET("/:complaint_id", h.Get)
}

package entity

import (
	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts the entities surface on the /v1 group:
//
//   - GET /v1/entities         — full entity list with rolled-up complaint counts (table view)
//   - GET /v1/entities/filter  — typeahead source for the complaints filter dropdown
//
// /v1/entities/:id is reserved for a future entity-detail endpoint.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, mw *auth.Middleware) {
	g := rg.Group("/entities", mw.Authenticate(), mw.Require(auth.RoleBusinessUser))
	g.GET("", h.List)
	g.GET("/filter", h.Filter)
}

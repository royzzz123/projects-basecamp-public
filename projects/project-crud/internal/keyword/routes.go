package keyword

import (
	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/gin-gonic/gin"
)

// RegisterRoutes mounts GET /v1/keywords. Same auth level as dashboard —
// authenticated business users and above.
func RegisterRoutes(rg *gin.RouterGroup, h *Handler, mw *auth.Middleware) {
	g := rg.Group("/keywords", mw.Authenticate(), mw.Require(auth.RoleBusinessUser))
	g.GET("", h.Keywords)
}

package heatmap

import (
	"net/http"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// StateHeatmap handles GET /v1/heatmap — one row per state/UT with counts.
// Accepts the same created_at_from / created_at_to / category query params as
// the dashboard endpoints so the choropleth can mirror the dashboard's filter
// bar. With no query params the response is the lifetime aggregate (legacy
// behaviour).
func (h *Handler) StateHeatmap(c *gin.Context) {
	out, err := h.svc.StateHeatmap(c.Request.Context(), queryParams(c))
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// StateDrilldown handles GET /v1/heatmap/:state_code — per-district breakdown
// for one state. An unknown state code yields 400. Same filter query params as
// StateHeatmap.
func (h *Handler) StateDrilldown(c *gin.Context) {
	out, err := h.svc.StateDrilldown(c.Request.Context(), c.Param("state_code"), queryParams(c))
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// queryParams pulls the (optional) filter query params off the request. Empty
// strings / missing keys all flow through to the service as "no filter".
func queryParams(c *gin.Context) Params {
	return Params{
		CategoryCodes: c.QueryArray("category"),
		CreatedFrom:   c.Query("created_at_from"),
		CreatedTo:     c.Query("created_at_to"),
	}
}

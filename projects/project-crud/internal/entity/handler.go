package entity

import (
	"net/http"
	"strconv"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Filter serves GET /v1/entities/filter — typeahead over entity_master.name.
func (h *Handler) Filter(c *gin.Context) {
	limit, err := parseLimitQuery(c.Query("limit"))
	if err != nil {
		apperror.Write(c, err)
		return
	}
	out, err := h.svc.Filter(c.Request.Context(), FilterParams{
		Limit: limit,
		Query: c.Query("q"),
		After: c.Query("after"),
	})
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// List serves GET /v1/entities — full entity list with rolled-up complaint counts.
func (h *Handler) List(c *gin.Context) {
	limit, err := parseLimitQuery(c.Query("limit"))
	if err != nil {
		apperror.Write(c, err)
		return
	}
	out, err := h.svc.List(c.Request.Context(), ListParams{
		Limit:         limit,
		After:         c.Query("after"),
		CategoryCodes: c.QueryArray("category"),
		EntityTypes:   c.QueryArray("entity_type"),
	})
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func parseLimitQuery(raw string) (int, error) {
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, apperror.ErrValidation.WithMessage("limit must be an integer")
	}
	return n, nil
}

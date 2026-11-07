package dashboard

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

// Summary handles GET /v1/dashboard/summary — total / open / closed / resolution rate.
func (h *Handler) Summary(c *gin.Context) {
	out, err := h.svc.Summary(c.Request.Context(), SummaryParams{
		CategoryCodes: c.QueryArray("category"),
		CreatedFrom:   c.Query("created_at_from"),
		CreatedTo:     c.Query("created_at_to"),
	})
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// VolumeBySubcategory handles GET /v1/dashboard/volume-by-subcategory.
func (h *Handler) VolumeBySubcategory(c *gin.Context) {
	limit, err := parseLimitQuery(c.Query("limit"))
	if err != nil {
		apperror.Write(c, err)
		return
	}
	out, err := h.svc.VolumeBySubcategory(c.Request.Context(), SubcategoryParams{
		CategoryCodes: c.QueryArray("category"),
		CreatedFrom:   c.Query("created_at_from"),
		CreatedTo:     c.Query("created_at_to"),
		Limit:         limit,
	})
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// VolumeByCategory handles GET /v1/dashboard/volume-by-category.
func (h *Handler) VolumeByCategory(c *gin.Context) {
	out, err := h.svc.VolumeByCategory(c.Request.Context(), CategoryParams{
		CreatedFrom: c.Query("created_at_from"),
		CreatedTo:   c.Query("created_at_to"),
	})
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// VolumeByCategoryTrend handles GET /v1/dashboard/volume-by-category-trend —
// per-bucket complaint counts per category for stacked-time-series rendering.
func (h *Handler) VolumeByCategoryTrend(c *gin.Context) {
	out, err := h.svc.VolumeByCategoryTrend(c.Request.Context(), CategoryTrendParams{
		CategoryCodes: c.QueryArray("category"),
		CreatedFrom:   c.Query("created_at_from"),
		CreatedTo:     c.Query("created_at_to"),
		Granularity:   c.Query("granularity"),
	})
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// VolumeBySubcategoryTrend handles GET /v1/dashboard/volume-by-subcategory-trend
// — the sub-category cousin of VolumeByCategoryTrend.
func (h *Handler) VolumeBySubcategoryTrend(c *gin.Context) {
	limit, err := parseLimitQuery(c.Query("limit"))
	if err != nil {
		apperror.Write(c, err)
		return
	}
	out, err := h.svc.VolumeBySubcategoryTrend(c.Request.Context(), SubcategoryTrendParams{
		CategoryCodes: c.QueryArray("category"),
		CreatedFrom:   c.Query("created_at_from"),
		CreatedTo:     c.Query("created_at_to"),
		Granularity:   c.Query("granularity"),
		Limit:         limit,
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

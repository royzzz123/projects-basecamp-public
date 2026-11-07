package complaint

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

func (h *Handler) List(c *gin.Context) {
	limit, err := parseLimitQuery(c.Query("limit"))
	if err != nil {
		apperror.Write(c, err)
		return
	}

	params := ListParams{
		Limit:                    limit,
		After:                    c.Query("after"),
		EntityScreenIDs:          c.QueryArray("entityscreenid"),
		Statuses:                 c.QueryArray("status"),
		CategoryCodes:            c.QueryArray("category"),
		SubCategories:            c.QueryArray("sub_category"),
		CreatedFrom:              c.Query("created_at_from"),
		CreatedTo:                c.Query("created_at_to"),
		ModifiedFrom: c.Query("modified_at_from"),
		ModifiedTo:   c.Query("modified_at_to"),
	}

	out, err := h.svc.List(c.Request.Context(), params)
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) Filters(c *gin.Context) {
	out, err := h.svc.Filters(c.Request.Context())
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) Get(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("complaint_id"), 10, 64)
	if err != nil || id <= 0 {
		apperror.Write(c, apperror.ErrValidation.WithMessage("complaint_id must be a positive integer"))
		return
	}
	out, err := h.svc.Get(c.Request.Context(), id)
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

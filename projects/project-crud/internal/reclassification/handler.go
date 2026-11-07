package reclassification

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

func (h *Handler) Get(c *gin.Context) {
	id, err := parseComplaintID(c.Param("complaint_id"))
	if err != nil {
		apperror.Write(c, err)
		return
	}
	out, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) Store(c *gin.Context) {
	id, err := parseComplaintID(c.Param("complaint_id"))
	if err != nil {
		apperror.Write(c, err)
		return
	}
	var req StoreRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apperror.WriteValidation(c, err)
		return
	}
	out, err := h.svc.Store(c.Request.Context(), id, req)
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func parseComplaintID(raw string) (int64, error) {
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, apperror.ErrValidation.WithMessage("complaint_id must be a positive integer")
	}
	return id, nil
}

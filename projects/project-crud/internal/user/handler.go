package user

import (
	"net/http"

	"github.com/OnFinance/project-crud/internal/apperror"
	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Signup(c *gin.Context) {
	var req SignupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apperror.WriteValidation(c, err)
		return
	}
	out, err := h.svc.Signup(c.Request.Context(), auth.MustClaims(c), req)
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		apperror.WriteValidation(c, err)
		return
	}
	out, err := h.svc.Login(c.Request.Context(), req)
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) Me(c *gin.Context) {
	out, err := h.svc.Me(c.Request.Context(), auth.MustClaims(c))
	if err != nil {
		apperror.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

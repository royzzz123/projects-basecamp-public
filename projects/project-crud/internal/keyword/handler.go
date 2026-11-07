package keyword

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler serves GET /v1/keywords.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Keywords handles:
//
//	GET /v1/keywords?scope=entity&entity_id=stb11048&limit=5
//	GET /v1/keywords?scope=subcategory&category=INZ001&sub_category=Improper+Service&limit=5
func (h *Handler) Keywords(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "5"))
	if limit <= 0 || limit > 20 {
		limit = defaultTopN
	}

	switch c.Query("scope") {
	case "entity":
		entityID := c.Query("entity_id")
		if entityID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "entity_id is required for scope=entity"})
			return
		}
		resp, err := h.svc.ForEntity(c.Request.Context(), entityID, limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)

	case "subcategory":
		category := c.Query("category")
		subCategory := c.Query("sub_category")
		if category == "" || subCategory == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "category and sub_category are required for scope=subcategory"})
			return
		}
		resp, err := h.svc.ForSubcategory(c.Request.Context(), category, subCategory, limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "scope must be 'entity' or 'subcategory'"})
	}
}

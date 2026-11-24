package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spd.web/services/rooms/internal/domain"
)

// Presentaciones propias del formato individual. La identidad del presentador es la del JWT: el
// cliente no manda user_id, así que no puede adjudicarse la presentación de otro.

func (h *Handler) roomUserPresentations(c *gin.Context) {
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	list, err := h.svc.RoomUserPresentations(c.Request.Context(), id)
	h.reply(c, http.StatusOK, list, err)
}

func (h *Handler) getMyPresentation(c *gin.Context) {
	caller, ok := h.requireUser(c)
	if !ok {
		return
	}
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	p, err := h.svc.UserPresentation(c.Request.Context(), caller, id)
	h.reply(c, http.StatusOK, p, err)
}

func (h *Handler) setMyPresentation(c *gin.Context) {
	caller, ok := h.requireUser(c)
	if !ok {
		return
	}
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	var in domain.NewPresentation
	if !bind(c, &in) {
		return
	}
	p, err := h.svc.SetUserPresentation(c.Request.Context(), caller, id, in)
	h.reply(c, http.StatusOK, p, err)
}

func (h *Handler) removeMyPresentation(c *gin.Context) {
	caller, ok := h.requireUser(c)
	if !ok {
		return
	}
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	h.noContent(c, h.svc.RemoveUserPresentation(c.Request.Context(), caller, id))
}

func (h *Handler) publishMyPresentation(c *gin.Context) {
	caller, ok := h.requireUser(c)
	if !ok {
		return
	}
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	ls, err := h.svc.PublishMyPresentation(c.Request.Context(), caller, id)
	h.reply(c, http.StatusOK, ls, err)
}

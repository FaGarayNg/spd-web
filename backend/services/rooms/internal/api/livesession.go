package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spd.web/internal/platform"
)

// Sesión en vivo de una sala: qué presentación se está proyectando. La publican los anfitriones
// y la consultan los espectadores para saber a qué entrar.

// liveSessionIn son los datos para lanzar (o reemplazar) la sesión en vivo.
type liveSessionIn struct {
	PresentationID string `json:"presentation_id"`
}

// getLiveSession devuelve la sesión en vivo de la sala; 404 si no hay ninguna.
func (h *Handler) getLiveSession(c *gin.Context) {
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	ls, err := h.svc.LiveSession(c.Request.Context(), id)
	h.reply(c, http.StatusOK, ls, err)
}

// setLiveSession publica la sesión en vivo: la presentación se proyecta desde ahora. PUT es
// reemplazo (200, no 201): lanzar otra presentación siempre sustituye a la anterior. Solo el
// anfitrión puede.
func (h *Handler) setLiveSession(c *gin.Context) {
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	var in liveSessionIn
	if !bind(c, &in) {
		return
	}
	caller, ok := h.currentUser(c)
	if !ok {
		return
	}
	presentationID, canonical := platform.CanonicalUUID(in.PresentationID)
	if !canonical {
		platform.WriteError(c, http.StatusBadRequest, "presentation_id inválido")
		return
	}
	ls, err := h.svc.SetLiveSession(c.Request.Context(), caller, id, presentationID)
	h.reply(c, http.StatusOK, ls, err)
}

// clearLiveSession da por terminada la sesión en vivo de la sala. Solo el anfitrión.
// Idempotente: 204 aunque no hubiera ninguna.
func (h *Handler) clearLiveSession(c *gin.Context) {
	caller, ok := h.currentUser(c)
	if !ok {
		return
	}
	id, ok := idParam(c, "id")
	if !ok {
		return
	}
	h.noContent(c, h.svc.ClearLiveSession(c.Request.Context(), caller, id))
}

package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"spd.web/internal/platform"
	"spd.web/services/rooms/internal/domain"
)

// Autenticación: login (emite el JWT) y "quién soy" (lo verifica). La identidad también la usa
// el resto de los handlers para las reglas de autorización (ver domain/authz.go).

// loginIn son los datos del login.
type loginIn struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// loginResponse es lo que devuelve el login: el token para la cabecera Authorization y el
// usuario (sin el hash, como siempre).
type loginResponse struct {
	Token string      `json:"token"`
	User  domain.User `json:"user"`
}

// login atiende POST /api/auth/login: correo y contraseña → JWT de 24 h. Sin sesión previa.
func (h *Handler) login(c *gin.Context) {
	var in loginIn
	if !bind(c, &in) {
		return
	}
	u, err := h.svc.Login(c.Request.Context(), domain.Credentials{Email: in.Email, Password: in.Password})
	if err != nil {
		h.fail(c, err)
		return
	}
	token, err := platform.IssueToken(h.tokenSecret, u.ID, platform.TokenTTL)
	if err != nil {
		h.fail(c, err)
		return
	}
	h.reply(c, http.StatusOK, loginResponse{Token: token, User: u}, nil)
}

// me atiende GET /api/users/me: el usuario de la sesión (401 si no hay una válida).
func (h *Handler) me(c *gin.Context) {
	caller, ok := h.currentUser(c)
	if !ok || caller == 0 {
		platform.WriteError(c, http.StatusUnauthorized, domain.ErrUnauthenticated.Error())
		return
	}
	u, err := h.svc.GetUser(c.Request.Context(), caller)
	h.reply(c, http.StatusOK, u, err)
}

// requireUser es currentUser pero además exige que haya identidad: la usan los endpoints que
// actúan sobre el usuario de la sesión (presentación propia, perfil, etc.).
func (h *Handler) requireUser(c *gin.Context) (uint, bool) {
	caller, ok := h.currentUser(c)
	if !ok {
		return 0, false
	}
	if caller == 0 {
		platform.WriteError(c, http.StatusUnauthorized, domain.ErrUnauthenticated.Error())
		return 0, false
	}
	return caller, true
}

// currentUser extrae la identidad de la cabecera Authorization (Bearer <token>). Sin cabecera
// devuelve (0, false) y la petición sigue como anónima; con cabecera inválida responde 401 y
// corta (un token vencido o falsificado no pasa como anónimo).
func (h *Handler) currentUser(c *gin.Context) (uint, bool) {
	raw, ok := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer ")
	if !ok || raw == "" {
		return 0, true // sin cabecera: anónimo
	}
	id, err := platform.TokenUser(h.tokenSecret, raw)
	if err != nil {
		platform.WriteError(c, http.StatusUnauthorized, platform.ErrTokenInvalid.Error())
		return 0, false
	}
	return id, true
}

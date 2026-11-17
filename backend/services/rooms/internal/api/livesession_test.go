package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"spd.web/internal/platform"
	"spd.web/services/rooms/internal/domain"
)

// Tests de integración de la sesión en vivo: HTTP → servicio → PostgreSQL. La validación de la
// presentación la hace el fakeCatalog: pres existe, unknown no y downPID no responde.

// newRoom crea una sala de prueba (con dueño, como exige la API) y devuelve su id más la
// cabecera de sesión de ese dueño.
func newRoom(t *testing.T, srv *httptest.Server) (string, map[string]string) {
	t.Helper()
	uid := want(t, srv, http.StatusCreated, http.MethodPost, "/api/users", map[string]any{
		"full_name": "Anfitrión", "email": "dueño@example.com", "password": "secreta123"})["id"]
	out := want(t, srv, http.StatusCreated, http.MethodPost, "/api/rooms",
		map[string]any{"name": "Sala en vivo"}, session(t, uid))
	return fmt.Sprint(out["id"]), session(t, uid)
}

func TestLiveSessionEndpoints(t *testing.T) {
	srv := newServer(t)
	room, owner := newRoom(t, srv)
	path := "/api/rooms/" + room + "/live-session"

	// Sin sesión lanzada, consultarla es 404 con el error del dominio.
	errBody := want(t, srv, http.StatusNotFound, http.MethodGet, path, nil)
	if errBody["error"] != "la sala no tiene una presentación en vivo" {
		t.Fatalf("GET sin sesión = %v", errBody)
	}

	// Lanzar es cosa del anfitrión: anónimo es 401 y otro usuario es 403.
	otro := session(t, want(t, srv, http.StatusCreated, http.MethodPost, "/api/users", map[string]any{
		"full_name": "Otro", "email": "otro@example.com", "password": "secreta123"})["id"])
	want(t, srv, http.StatusUnauthorized, http.MethodPut, path, map[string]any{"presentation_id": pres})
	want(t, srv, http.StatusForbidden, http.MethodPut, path, map[string]any{"presentation_id": pres}, otro)

	// El anfitrión lanza: PUT es reemplazo (200), no se crea un recurso nuevo con 201.
	launched := want(t, srv, http.StatusOK, http.MethodPut, path, map[string]any{"presentation_id": pres}, owner)
	if fmt.Sprint(launched["room_id"]) != room || launched["presentation_id"] != pres {
		t.Fatalf("PUT = %v", launched)
	}
	started, err := time.Parse(time.RFC3339Nano, fmt.Sprint(launched["started_at"]))
	if err != nil {
		t.Fatalf("started_at = %v (%v)", launched["started_at"], err)
	}
	if time.Since(started) > time.Minute {
		t.Fatalf("started_at no es de ahora: %v", started)
	}

	// Consultar devuelve la sesión lanzada.
	got := want(t, srv, http.StatusOK, http.MethodGet, path, nil)
	if got["presentation_id"] != pres {
		t.Fatalf("GET = %v", got)
	}

	// Relanzar (aunque sea la misma presentación) reemplaza la fila y reinicia started_at.
	time.Sleep(20 * time.Millisecond) // margen para que la diferencia de fechas sea medible
	relaunched := want(t, srv, http.StatusOK, http.MethodPut, path, map[string]any{"presentation_id": pres}, owner)
	restarted, _ := time.Parse(time.RFC3339Nano, fmt.Sprint(relaunched["started_at"]))
	if !restarted.After(started) {
		t.Fatalf("started_at no se reinició: %v no es después de %v", restarted, started)
	}

	// Finalizar es cosa del anfitrión: anónimo es 401, otro usuario 403. Idempotente: 204 las
	// dos veces, y después consultar es 404.
	want(t, srv, http.StatusUnauthorized, http.MethodDelete, path, nil)
	want(t, srv, http.StatusForbidden, http.MethodDelete, path, nil, otro)
	want(t, srv, http.StatusNoContent, http.MethodDelete, path, nil, owner)
	want(t, srv, http.StatusNoContent, http.MethodDelete, path, nil, owner)
	want(t, srv, http.StatusNotFound, http.MethodGet, path, nil)
}

func TestLiveSessionValidation(t *testing.T) {
	srv := newServer(t)
	room, owner := newRoom(t, srv)
	path := "/api/rooms/" + room + "/live-session"

	// presentation_id tiene que ser un UUID.
	want(t, srv, http.StatusBadRequest, http.MethodPut, path, map[string]any{"presentation_id": "no-es-uuid"}, owner)
	// Y tiene que existir en el servicio presentations.
	want(t, srv, http.StatusUnprocessableEntity, http.MethodPut, path, map[string]any{"presentation_id": unknown}, owner)
	// Si presentations no responde, no se lanza nada.
	want(t, srv, http.StatusServiceUnavailable, http.MethodPut, path, map[string]any{"presentation_id": downPID}, owner)

	// La sala tiene que existir; id inexistente es 404 en los tres verbos.
	ghost := "/api/rooms/999/live-session"
	want(t, srv, http.StatusNotFound, http.MethodGet, ghost, nil)
	want(t, srv, http.StatusNotFound, http.MethodPut, ghost, map[string]any{"presentation_id": pres}, owner)
	want(t, srv, http.StatusNotFound, http.MethodDelete, ghost, nil, owner)

	// El id de la ruta tiene que ser numérico.
	want(t, srv, http.StatusBadRequest, http.MethodGet, "/api/rooms/abc/live-session", nil)
}

// El miembro de una sala puede asignar la presentación de un grupo; quien no pertenece, no.
func TestMemberAssignsPresentation(t *testing.T) {
	srv := newServer(t)
	uid := want(t, srv, http.StatusCreated, http.MethodPost, "/api/users", map[string]any{
		"full_name": "Ana", "email": "ana@example.com", "password": "secreta123"})["id"]
	ana := session(t, uid)
	rid := fmt.Sprint(want(t, srv, http.StatusCreated, http.MethodPost, "/api/rooms", map[string]any{"name": "Clase"}, ana)["id"])
	gid := fmt.Sprint(want(t, srv, http.StatusCreated, http.MethodPost, "/api/rooms/"+rid+"/groups",
		map[string]any{"limit": 5, "priority": 1}, ana)["id"])
	list := "/api/groups/" + gid + "/presentations"

	// Anónimo: 401 antes que nada.
	want(t, srv, http.StatusUnauthorized, http.MethodPost, list, map[string]any{"presentation_id": pres})

	// Beto se hace miembro de la sala (sin clave: entra directo) y asigna la presentación de
	// su grupo; Caro, que no pertenece, no puede.
	betoID := want(t, srv, http.StatusCreated, http.MethodPost, "/api/users", map[string]any{
		"full_name": "Beto", "email": "beto@example.com", "password": "secreta123"})["id"]
	beto := session(t, betoID)
	want(t, srv, http.StatusCreated, http.MethodPost, "/api/rooms/"+rid+"/members", map[string]any{"user_id": betoID})
	want(t, srv, http.StatusCreated, http.MethodPost, list, map[string]any{"presentation_id": pres}, beto)

	caro := session(t, want(t, srv, http.StatusCreated, http.MethodPost, "/api/users", map[string]any{
		"full_name": "Caro", "email": "caro@example.com", "password": "secreta123"})["id"])
	want(t, srv, http.StatusForbidden, http.MethodPost, list, map[string]any{"presentation_id": pres}, caro)
}

func TestLoginAndMe(t *testing.T) {
	srv := newServer(t)
	want(t, srv, http.StatusCreated, http.MethodPost, "/api/users", map[string]any{
		"full_name": "Ana", "email": "ana@example.com", "password": "secreta123"})

	// Login correcto: token + usuario (sin el hash de la contraseña).
	out := want(t, srv, http.StatusOK, http.MethodPost, "/api/auth/login", map[string]any{
		"email": "ana@example.com", "password": "secreta123"})
	token, ok := out["token"].(string)
	if !ok || strings.Count(token, ".") != 2 || out["user"] == nil {
		t.Fatalf("login = %v", out)
	}
	ana := map[string]string{"Authorization": "Bearer " + token}

	// Con el token: /users/me dice quién es.
	me := want(t, srv, http.StatusOK, http.MethodGet, "/api/users/me", nil, ana)
	if me["email"] != "ana@example.com" {
		t.Fatalf("me = %v", me)
	}

	// El correo es case-insensitive (se guarda normalizado).
	want(t, srv, http.StatusOK, http.MethodPost, "/api/auth/login", map[string]any{
		"email": "ANA@example.com", "password": "secreta123"})

	// Credenciales equivocadas: el mismo 401 no importa qué campo esté mal.
	for _, bad := range []map[string]any{
		{"email": "nadie@example.com", "password": "secreta123"},
		{"email": "ana@example.com", "password": "otra-clave"},
	} {
		errBody := want(t, srv, http.StatusUnauthorized, http.MethodPost, "/api/auth/login", bad)
		if errBody["error"] != domain.ErrWrongCredentials.Error() {
			t.Fatalf("login erróneo = %v", errBody)
		}
	}

	// Token inválido: ni firmado ni parseable. Sin cabecera, en cambio, es anónimo (401 solo
	// en lo que exige sesión, como /users/me).
	want(t, srv, http.StatusUnauthorized, http.MethodGet, "/api/users/me", nil,
		map[string]string{"Authorization": "Bearer " + token + "x"})
	want(t, srv, http.StatusUnauthorized, http.MethodGet, "/api/users/me", nil,
		map[string]string{"Authorization": "Bearer no-es-un-jwt"})
	want(t, srv, http.StatusUnauthorized, http.MethodGet, "/api/users/me", nil)

	// El token vence: uno con expiración ya pasada es 401.
	expired, err := platform.IssueToken(testSecret, 1, -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	want(t, srv, http.StatusUnauthorized, http.MethodGet, "/api/users/me", nil,
		map[string]string{"Authorization": "Bearer " + expired})
}

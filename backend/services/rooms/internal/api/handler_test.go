package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spd.web/internal/platform"
	"spd.web/services/rooms/internal/dbtest"
	"spd.web/services/rooms/internal/domain"
	"spd.web/services/rooms/internal/store"
)

// Tests de integración: HTTP → servicio → PostgreSQL (ver dbtest.Open).

const (
	pres    = "6f1c1a52-2a0e-4b6b-9a59-6a1d8f3f1c11" // 4 diapositivas
	unknown = "11111111-2222-4333-8444-555555555555" // no existe en presentations
	downPID = "22222222-3333-4444-8555-666666666666" // presentations no responde
	// Secreto de los JWT de test: el mismo que newServer le pasa al Handler.
	testSecret = "test-secret"
)

type fakeCatalog struct{}

func (fakeCatalog) SlideCount(_ context.Context, id string) (int, error) {
	switch id {
	case pres:
		return 4, nil
	case downPID:
		return 0, errors.New("dial tcp 10.0.0.7:8081: connection refused")
	}
	return 0, domain.ErrPresentationUnknown
}

func (c fakeCatalog) Preview(ctx context.Context, id string) (domain.PresentationPreview, error) {
	n, err := c.SlideCount(ctx, id)
	if err != nil {
		return domain.PresentationPreview{}, err
	}
	slides := make([]domain.SlidePreview, 0, n)
	for i := 1; i <= n; i++ {
		slides = append(slides, domain.SlidePreview{Slide: i, File: fmt.Sprintf("%03d.png", i)})
	}
	return domain.PresentationPreview{PresentationID: id, SlideCount: n, Slides: slides}, nil
}

func (c fakeCatalog) SlideImage(ctx context.Context, id, _ string) (domain.SlideImage, error) {
	if _, err := c.SlideCount(ctx, id); err != nil {
		return domain.SlideImage{}, err
	}
	return domain.SlideImage{ContentType: "image/png", Body: io.NopCloser(strings.NewReader("img"))}, nil
}

func newServer(t *testing.T) *httptest.Server {
	t.Helper()
	gin.SetMode(gin.TestMode)
	log := slog.New(slog.DiscardHandler)
	engine := platform.NewEngine(log)
	New(domain.NewService(store.New(dbtest.Open(t)), fakeCatalog{}), log, testSecret).Register(engine)
	srv := httptest.NewServer(engine)
	t.Cleanup(srv.Close)
	return srv
}

// call envía la petición (body se codifica como JSON salvo que ya sea un string; headers se
// copan tal cual) y devuelve la respuesta con su cuerpo.
func call(t *testing.T, srv *httptest.Server, method, path string, body any, headers ...map[string]string) (*http.Response, []byte) {
	t.Helper()
	var r io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		r = strings.NewReader(b)
	default:
		data, _ := json.Marshal(b)
		r = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, srv.URL+path, r)
	req.Header.Set("Content-Type", "application/json")
	for _, h := range headers {
		for k, v := range h {
			req.Header.Set(k, v)
		}
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp, data
}

// want comprueba el estado y devuelve el cuerpo decodificado como objeto JSON.
func want(t *testing.T, srv *httptest.Server, status int, method, path string, body any, headers ...map[string]string) map[string]any {
	t.Helper()
	resp, data := call(t, srv, method, path, body, headers...)
	if resp.StatusCode != status {
		t.Fatalf("%s %s = %d %s; se esperaba %d", method, path, resp.StatusCode, data, status)
	}
	var out map[string]any
	_ = json.Unmarshal(data, &out)
	return out
}

// session es la cabecera Authorization que representa al usuario (el token lo firma el propio
// test con el secreto del server; equivale a lo que el login devolvería).
func session(t *testing.T, userID any) map[string]string {
	t.Helper()
	id, ok := userID.(float64)
	if !ok {
		t.Fatalf("session espera un id numérico de la API, got %T", userID)
	}
	token, err := platform.IssueToken(testSecret, uint(id), time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]string{"Authorization": "Bearer " + token}
}

func TestUserEndpoints(t *testing.T) {
	srv := newServer(t)
	if _, data := call(t, srv, http.MethodGet, "/api/users", nil); string(data) != "[]" {
		t.Fatalf("lista vacía = %s, se esperaba []", data)
	}

	resp, data := call(t, srv, http.MethodPost, "/api/users", map[string]any{
		"full_name": "Ana López", "email": "ana@example.com", "password": "secreta123", "roles": []string{"admin"}})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("alta = %d %s", resp.StatusCode, data)
	}
	var u map[string]any
	_ = json.Unmarshal(data, &u)
	id := fmt.Sprint(u["id"])
	if resp.Header.Get("Location") != "/api/users/"+id || u["email"] != "ana@example.com" || bytes.Contains(data, []byte("password")) {
		t.Fatalf("alta: Location = %q, cuerpo = %s", resp.Header.Get("Location"), data)
	}

	want(t, srv, http.StatusOK, http.MethodGet, "/api/users/"+id, nil)
	got := want(t, srv, http.StatusOK, http.MethodPatch, "/api/users/"+id, map[string]any{"full_name": "Ana María"})
	if got["full_name"] != "Ana María" || got["email"] != "ana@example.com" {
		t.Fatalf("PATCH = %v", got)
	}
	errBody := want(t, srv, http.StatusConflict, http.MethodPost, "/api/users", map[string]any{
		"full_name": "Otra", "email": "ANA@example.com", "password": "secreta123"})
	if errBody["error"] != domain.ErrEmailTaken.Error() {
		t.Fatalf("409 = %v", errBody)
	}
	want(t, srv, http.StatusBadRequest, http.MethodPost, "/api/users", map[string]any{
		"full_name": "Sin correo", "password": "secreta123"})

	want(t, srv, http.StatusNoContent, http.MethodDelete, "/api/users/"+id, nil)
	want(t, srv, http.StatusNotFound, http.MethodGet, "/api/users/"+id, nil)
	want(t, srv, http.StatusNotFound, http.MethodDelete, "/api/users/"+id, nil)
}

func TestRequestErrors(t *testing.T) {
	srv := newServer(t)
	cases := []struct {
		name, method, path string
		body               any
		status             int
		msg                string // fragmento esperado del mensaje de error
	}{
		{"id no numérico", http.MethodGet, "/api/users/abc", nil, http.StatusBadRequest, "id inválido"},
		{"id cero", http.MethodGet, "/api/rooms/0", nil, http.StatusBadRequest, "id inválido"},
		{"id fuera de rango", http.MethodGet, "/api/groups/9223372036854775808", nil, http.StatusBadRequest, "id inválido"},
		{"user_id inválido", http.MethodDelete, "/api/rooms/1/members/x", nil, http.StatusBadRequest, "user_id inválido"},
		{"presentation_id inválido", http.MethodGet, "/api/groups/1/presentations/no-es-uuid", nil, http.StatusBadRequest, "presentation_id inválido"},
		{"campo desconocido", http.MethodPost, "/api/rooms", `{"nombre":"Clase"}`, http.StatusBadRequest, `campo desconocido "nombre"`},
		{"tipo incorrecto", http.MethodPost, "/api/rooms/1/groups", `{"limit":"diez","priority":1}`, http.StatusBadRequest, "el campo limit debe ser de tipo int"},
		{"JSON mal formado", http.MethodPost, "/api/rooms", `{"name":`, http.StatusBadRequest, "JSON mal formado"},
		{"sin cuerpo", http.MethodPost, "/api/rooms", nil, http.StatusBadRequest, "falta el cuerpo"},
		{"datos de más", http.MethodPost, "/api/rooms", `{"name":"a"} {"name":"b"}`, http.StatusBadRequest, "después del objeto"},
		{"cuerpo que no es un objeto", http.MethodPost, "/api/rooms", `[]`, http.StatusBadRequest, "el cuerpo debe ser un objeto JSON"},
		{"cuerpo enorme", http.MethodPost, "/api/rooms", `{"name":"` + strings.Repeat("a", 2<<20) + `"}`, http.StatusRequestEntityTooLarge, "1 MB"},
		{"ruta inexistente", http.MethodGet, "/api/salas", nil, http.StatusNotFound, "ruta no encontrada"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, data := call(t, srv, tc.method, tc.path, tc.body)
			var body map[string]string
			_ = json.Unmarshal(data, &body)
			if resp.StatusCode != tc.status || !strings.Contains(body["error"], tc.msg) {
				t.Fatalf("= %d %s; se esperaba %d con %q", resp.StatusCode, data, tc.status, tc.msg)
			}
		})
	}
}

func TestRoomsGroupsAndPresentations(t *testing.T) {
	srv := newServer(t)
	user := want(t, srv, http.StatusCreated, http.MethodPost, "/api/users", map[string]any{
		"full_name": "Ana", "email": "ana@example.com", "password": "secreta123"})
	uid := user["id"]
	ana := session(t, uid)

	// Solo con sesión: el creador queda como dueño (anfitrión) de la sala.
	want(t, srv, http.StatusUnauthorized, http.MethodPost, "/api/rooms", map[string]any{"name": "Anónima"})
	r := want(t, srv, http.StatusCreated, http.MethodPost, "/api/rooms", map[string]any{
		"name": "Clase 1", "url": "https://spd.example/salas/clase-1", "access_key": "1234"}, ana)
	if r["has_access_key"] != true || r["access_key"] != nil || r["access_key_hash"] != nil || r["owner_id"] != uid {
		t.Fatalf("sala = %v", r)
	}
	if r["format"] != "" {
		t.Fatalf("sala nueva sin formato confirmado: %v", r)
	}
	rid := fmt.Sprint(r["id"])

	// Confirmar el formato es cosa del anfitrión (anónimo 401), y el valor tiene que ser uno de
	// los dos válidos.
	want(t, srv, http.StatusUnauthorized, http.MethodPatch, "/api/rooms/"+rid, map[string]any{"format": domain.FormatGroups})
	want(t, srv, http.StatusBadRequest, http.MethodPatch, "/api/rooms/"+rid, map[string]any{"format": "otro"}, ana)
	if got := want(t, srv, http.StatusOK, http.MethodPatch, "/api/rooms/"+rid, map[string]any{"format": domain.FormatGroups}, ana); got["format"] != domain.FormatGroups {
		t.Fatalf("PATCH formato = %v", got)
	}
	// Sin sesión no se puede ni confirmarlo.
	want(t, srv, http.StatusUnauthorized, http.MethodPatch, "/api/rooms/"+rid, map[string]any{"format": domain.FormatGroups})

	// Miembros (DetalleSala).
	members := "/api/rooms/" + rid + "/members"
	want(t, srv, http.StatusForbidden, http.MethodPost, members, map[string]any{"user_id": uid, "access_key": "0000"})
	m := want(t, srv, http.StatusCreated, http.MethodPost, members, map[string]any{"user_id": uid, "access_key": "1234"})
	if m["joined_at"] == nil || fmt.Sprint(m["room_id"]) != rid {
		t.Fatalf("pertenencia = %v", m)
	}
	want(t, srv, http.StatusOK, http.MethodPost, members, map[string]any{"user_id": uid, "access_key": "1234"})
	want(t, srv, http.StatusNotFound, http.MethodPost, members, map[string]any{"user_id": 9999, "access_key": "1234"})
	// Los demás ven el nombre y los roles de cada miembro, nunca su correo.
	if _, data := call(t, srv, http.MethodGet, members, nil); !bytes.Contains(data, []byte(`"full_name":"Ana"`)) ||
		!bytes.Contains(data, []byte(`"joined_at"`)) || bytes.Contains(data, []byte("email")) || bytes.Contains(data, []byte("password")) {
		t.Fatalf("miembros = %s", data)
	}
	if _, data := call(t, srv, http.MethodGet, fmt.Sprintf("/api/users/%v/rooms", uid), nil); !bytes.Contains(data, []byte(`"name":"Clase 1"`)) {
		t.Fatalf("salas del usuario = %s", data)
	}
	want(t, srv, http.StatusNoContent, http.MethodDelete, fmt.Sprintf("%s/%v", members, uid), nil)
	want(t, srv, http.StatusNotFound, http.MethodDelete, fmt.Sprintf("%s/%v", members, uid), nil)

	// Grupos: armar la grilla es cosa del anfitrión; un miembro cualquiera no puede.
	resp, data := call(t, srv, http.MethodPost, "/api/rooms/"+rid+"/groups", map[string]any{"limit": 30, "priority": 1}, ana)
	var g map[string]any
	_ = json.Unmarshal(data, &g)
	gid := fmt.Sprint(g["id"])
	if resp.StatusCode != http.StatusCreated || resp.Header.Get("Location") != "/api/groups/"+gid {
		t.Fatalf("grupo = %d %s (Location %q)", resp.StatusCode, data, resp.Header.Get("Location"))
	}
	otro := session(t, want(t, srv, http.StatusCreated, http.MethodPost, "/api/users", map[string]any{
		"full_name": "Beto", "email": "beto@example.com", "password": "secreta123"})["id"])
	want(t, srv, http.StatusForbidden, http.MethodPost, "/api/rooms/"+rid+"/groups", map[string]any{"limit": 30, "priority": 2}, otro)
	want(t, srv, http.StatusBadRequest, http.MethodPost, "/api/rooms/"+rid+"/groups", map[string]any{"priority": 1}, ana)
	want(t, srv, http.StatusBadRequest, http.MethodPost, "/api/rooms/"+rid+"/groups", map[string]any{"limit": 0, "priority": 1}, ana)
	if got := want(t, srv, http.StatusOK, http.MethodPatch, "/api/groups/"+gid, map[string]any{"limit": 25}, ana); got["limit"] != 25.0 || got["priority"] != 1.0 {
		t.Fatalf("PATCH grupo = %v", got)
	}
	want(t, srv, http.StatusForbidden, http.MethodPatch, "/api/groups/"+gid, map[string]any{"limit": 25}, otro)

	// Presentaciones asignadas al grupo: las asigna el dueño; beto (que no es miembro de la
	// sala) no puede, aunque el PATCH de diapositivas sí queda en manos de quien pertenece.
	list := "/api/groups/" + gid + "/presentations"
	want(t, srv, http.StatusForbidden, http.MethodPost, list, map[string]any{"presentation_id": pres}, otro)
	resp, data = call(t, srv, http.MethodPost, list, map[string]any{"presentation_id": pres, "slides": []int{2, 4}}, ana)
	if resp.StatusCode != http.StatusCreated || resp.Header.Get("Location") != list+"/"+pres || !bytes.Contains(data, []byte(`"slides":[2,4]`)) {
		t.Fatalf("asignar = %d %s (Location %q)", resp.StatusCode, data, resp.Header.Get("Location"))
	}
	want(t, srv, http.StatusConflict, http.MethodPost, list, map[string]any{"presentation_id": pres}, ana)
	want(t, srv, http.StatusBadRequest, http.MethodPost, list, map[string]any{"presentation_id": unknown[:8]}, ana)
	want(t, srv, http.StatusUnprocessableEntity, http.MethodPost, list, map[string]any{"presentation_id": unknown}, ana)
	down := want(t, srv, http.StatusServiceUnavailable, http.MethodPost, list, map[string]any{"presentation_id": downPID}, ana)
	if down["error"] != domain.ErrCatalogUnavailable.Error() {
		t.Fatalf("503 debe dar el mensaje genérico, sin detalles internos: %v", down)
	}
	if got := want(t, srv, http.StatusOK, http.MethodPatch, list+"/"+pres, map[string]any{"slides": []int{1}}, ana); fmt.Sprint(got["slides"]) != "[1]" {
		t.Fatalf("PATCH diapositivas = %v", got)
	}
	want(t, srv, http.StatusBadRequest, http.MethodPatch, list+"/"+pres, map[string]any{"slides": []int{5}}, ana)
	want(t, srv, http.StatusOK, http.MethodGet, list+"/"+pres, nil)

	// Desasignar es cosa del anfitrión (aunque beto sea miembro de la sala).
	want(t, srv, http.StatusForbidden, http.MethodDelete, list+"/"+pres, nil, otro)
	want(t, srv, http.StatusNoContent, http.MethodDelete, list+"/"+pres, nil, ana)

	// Borrar la sala borra en cascada su grupo y la presentación asignada; solo el anfitrión puede.
	want(t, srv, http.StatusForbidden, http.MethodDelete, "/api/rooms/"+rid, nil, otro)
	want(t, srv, http.StatusNoContent, http.MethodDelete, "/api/rooms/"+rid, nil, ana)
	want(t, srv, http.StatusNotFound, http.MethodGet, "/api/rooms/"+rid, nil)
	want(t, srv, http.StatusNotFound, http.MethodGet, "/api/groups/"+gid, nil)
	want(t, srv, http.StatusNotFound, http.MethodGet, list+"/"+pres, nil)
}

func TestGroupMemberEndpoints(t *testing.T) {
	srv := newServer(t)
	newUser := func(email string) any {
		return want(t, srv, http.StatusCreated, http.MethodPost, "/api/users", map[string]any{
			"full_name": email, "email": email, "password": "secreta123"})["id"]
	}
	ana, beto, caro := newUser("ana@example.com"), newUser("beto@example.com"), newUser("caro@example.com")
	rid := fmt.Sprint(want(t, srv, http.StatusCreated, http.MethodPost, "/api/rooms", map[string]any{"name": "Clase"}, session(t, ana))["id"])
	gid := fmt.Sprint(want(t, srv, http.StatusCreated, http.MethodPost, "/api/rooms/"+rid+"/groups",
		map[string]any{"limit": 2, "priority": 1}, session(t, ana))["id"])
	members := "/api/groups/" + gid + "/members"

	notInRoom := want(t, srv, http.StatusConflict, http.MethodPost, members, map[string]any{"user_id": ana})
	if notInRoom["error"] != domain.ErrRoomMembershipRequired.Error() {
		t.Fatalf("409 sin ser miembro de la sala = %v", notInRoom)
	}
	for _, u := range []any{ana, beto, caro} {
		want(t, srv, http.StatusCreated, http.MethodPost, "/api/rooms/"+rid+"/members", map[string]any{"user_id": u})
	}

	m := want(t, srv, http.StatusCreated, http.MethodPost, members, map[string]any{"user_id": ana})
	if fmt.Sprint(m["group_id"]) != gid || m["user_id"] != ana || m["joined_at"] == nil {
		t.Fatalf("integrante = %v", m)
	}
	want(t, srv, http.StatusOK, http.MethodPost, members, map[string]any{"user_id": ana})
	want(t, srv, http.StatusCreated, http.MethodPost, members, map[string]any{"user_id": beto})
	full := want(t, srv, http.StatusConflict, http.MethodPost, members, map[string]any{"user_id": caro})
	if full["error"] != domain.ErrGroupFull.Error()+" (cupo 2)" {
		t.Fatalf("409 grupo completo = %v", full)
	}
	want(t, srv, http.StatusConflict, http.MethodPatch, "/api/groups/"+gid, map[string]any{"limit": 1}, session(t, ana))
	want(t, srv, http.StatusForbidden, http.MethodPatch, "/api/groups/"+gid, map[string]any{"limit": 2}, session(t, beto))
	want(t, srv, http.StatusNotFound, http.MethodPost, "/api/groups/9999/members", map[string]any{"user_id": ana})

	if _, data := call(t, srv, http.MethodGet, members, nil); !bytes.Contains(data, []byte(`"full_name":"beto@example.com"`)) ||
		bytes.Contains(data, []byte(`"email"`)) {
		t.Fatalf("integrantes = %s", data)
	}
	if _, data := call(t, srv, http.MethodGet, fmt.Sprintf("/api/users/%v/groups", ana), nil); !bytes.Contains(data, []byte(`"id":`+gid)) {
		t.Fatalf("grupos de ana = %s", data)
	}
	want(t, srv, http.StatusNoContent, http.MethodDelete, fmt.Sprintf("%s/%v", members, beto), nil)
	want(t, srv, http.StatusNotFound, http.MethodDelete, fmt.Sprintf("%s/%v", members, beto), nil)
	want(t, srv, http.StatusCreated, http.MethodPost, members, map[string]any{"user_id": caro}) // quedó una plaza libre
}

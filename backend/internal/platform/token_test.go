package platform_test

import (
	"testing"
	"time"

	"spd.web/internal/platform"
)

// Tests del token de sesión: ida y vuelta, y los rechazos (firma, vencimiento, formato).

func TestTokenRoundTrip(t *testing.T) {
	id, err := platform.TokenUser("secreto", mustToken(t, "secreto", 7, time.Hour))
	if err != nil || id != 7 {
		t.Fatalf("TokenUser = %d, %v; se esperaba 7, nil", id, err)
	}
}

func TestTokenRejects(t *testing.T) {
	cases := []struct {
		name   string
		secret string
		raw    string
	}{
		{"firma equivocada", "otro-secreto", mustToken(t, "secreto", 7, time.Hour)},
		{"vencido", "secreto", mustToken(t, "secreto", 7, -time.Minute)},
		{"basura", "secreto", "no-es-un-jwt"},
		{"vacío", "secreto", ""},
	}
	for _, tc := range cases {
		if id, err := platform.TokenUser(tc.secret, tc.raw); err == nil {
			t.Fatalf("%s: aceptó el token (id %d)", tc.name, id)
		}
	}
}

// mustToken emite un JWT (con error fatal si no puede: el test se cae igual).
func mustToken(t *testing.T, secret string, userID uint, ttl time.Duration) string {
	t.Helper()
	token, err := platform.IssueToken(secret, userID, ttl)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

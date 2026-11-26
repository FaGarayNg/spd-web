package platform

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Tokens de sesión (JWT HS256). Los emite el servicio que autentica (rooms, en /api/auth/login)
// y los verifica cada servicio que necesite identidad: el gateway solo reenvía la cabecera
// Authorization, de modo que los servicios internos no confían en cabeceras que el cliente
// pudiera forjar.
//
// El secreto viene de JWT_SECRET: todos los servicios que firman o verifican tienen que
// compartirlo. El valor por defecto es solo para desarrollo.

// ErrTokenInvalid indica una sesión que no se puede aceptar: mal formada, con firma equivocada
// o vencida. El handler la traduce a 401.
var ErrTokenInvalid = errors.New("sesión inválida o vencida")

// TokenTTL es cuánto vale una sesión. Un día de clase entera, con margen.
const TokenTTL = 24 * time.Hour

// IssueToken firma un JWT con el id del usuario dentro (claim sub).
func IssueToken(secret string, userID uint, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub": fmt.Sprint(userID), // GetSubject: el id como string
		"iat": now.Unix(),
		"exp": now.Add(ttl).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

// TokenUser verifica un JWT y devuelve el id del usuario que representa: ErrTokenInvalid si el
// token no es aceptable (firma, formato o vencimiento).
func TokenUser(secret, raw string) (uint, error) {
	parsed, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) {
		return []byte(secret), nil // la clave de verificación; el método se exige aparte
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !parsed.Valid {
		return 0, ErrTokenInvalid
	}
	sub, err := parsed.Claims.GetSubject()
	if err != nil {
		return 0, ErrTokenInvalid
	}
	var id uint
	if _, err := fmt.Sscanf(sub, "%d", &id); err != nil || id == 0 {
		return 0, ErrTokenInvalid
	}
	return id, nil
}

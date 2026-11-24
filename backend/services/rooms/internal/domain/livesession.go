package domain

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// LiveSession es la sesión en vivo de una sala: qué presentación del servicio presentations se
// está proyectando en este momento. Una sala tiene a lo sumo una: lanzar otra reemplaza a la
// anterior. StartedAt es cuándo arrancó: cada lanzamiento lo reinicia. No es la sesión del
// servicio realtime (esa vive en su memoria): es el puntero que publican los anfitriones para
// que los espectadores sepan a qué presentación entrar.
type LiveSession struct {
	RoomID         uint      `json:"room_id"`
	PresentationID string    `json:"presentation_id"`
	StartedAt      time.Time `json:"started_at"`
}

// SetLiveSession publica la sesión en vivo de la sala: la presentación se proyecta desde ahora.
// La lanza el anfitrión o, en formato individual, el participante dueño de esa presentación propia.
// La presentación tiene que conocerla el servicio presentations
// (si no, no hay nada que proyectar). Lanzar otra presentación reemplaza a la anterior.
func (s *Service) SetLiveSession(ctx context.Context, callerID, roomID uint, presentationID string) (LiveSession, error) {
	r, err := s.store.GetRoom(ctx, roomID)
	if err != nil {
		return LiveSession{}, err
	}
	if err := checkOwner(r, callerID); err != nil {
		// En formato individual el participante también puede lanzar LA SUYA: basta que tenga
		// una presentación propia activa en esta sala. Seguir sin sesión sigue siendo 401.
		if !errors.Is(err, ErrForbidden) {
			return LiveSession{}, err
		}
		if _, ownErr := s.store.UserPresentation(ctx, roomID, callerID); ownErr != nil {
			return LiveSession{}, err
		}
	}
	if _, err := s.catalog.SlideCount(ctx, presentationID); err != nil {
		if errors.Is(err, ErrPresentationUnknown) {
			return LiveSession{}, err
		}
		return LiveSession{}, fmt.Errorf("%w: %v", ErrCatalogUnavailable, err)
	}
	return s.store.SetLiveSession(ctx, LiveSession{RoomID: roomID, PresentationID: presentationID})
}

// LiveSession devuelve la sesión en vivo de la sala; ErrLiveSessionNotFound si no hay ninguna.
// La consulta es pública: es lo que usan los espectadores para saber a qué entrar. La sala
// tiene que existir (aunque la sesión quede en la base, la de una sala borrada no se devuelve).
func (s *Service) LiveSession(ctx context.Context, roomID uint) (LiveSession, error) {
	if _, err := s.store.GetRoom(ctx, roomID); err != nil {
		return LiveSession{}, err
	}
	return s.store.LiveSession(ctx, roomID)
}

// ClearLiveSession da por terminada la sesión en vivo de la sala. Solo el anfitrión puede.
// Finalizar una sala sin sesión también es éxito (idempotente: finalizar dos veces no es un
// error); sobre una sala inexistente es ErrRoomNotFound.
func (s *Service) ClearLiveSession(ctx context.Context, callerID, roomID uint) error {
	r, err := s.store.GetRoom(ctx, roomID)
	if err != nil {
		return err
	}
	if err := checkOwner(r, callerID); err != nil {
		return err
	}
	return s.store.ClearLiveSession(ctx, roomID)
}

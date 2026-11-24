package domain

import (
	"context"

	"spd.web/internal/platform"
)

// Presentaciones propias (formato individual). A diferencia de las de grupo, la identidad del
// presentador sale del JWT: el cuerpo del POST solo trae el UUID y, opcionalmente, las diapositivas.

// SetUserPresentation asigna (o reemplaza) la presentación propia de caller en la sala. Tiene que
// ser miembro (o el anfitrión) y el UUID debe existir en el servicio presentations.
func (s *Service) SetUserPresentation(ctx context.Context, callerID, roomID uint, in NewPresentation) (UserPresentation, error) {
	r, err := s.store.GetRoom(ctx, roomID)
	if err != nil {
		return UserPresentation{}, err
	}
	member, err := s.store.IsRoomMember(ctx, roomID, callerID)
	if err != nil {
		return UserPresentation{}, err
	}
	if err := checkMember(r, callerID, member); err != nil {
		return UserPresentation{}, err
	}
	// El dueño arma la sala y decide el orden, pero no carga su propia presentación acá: para
	// exponer la suya usa el modo "Presentación propia" (upload directo + PUT /live-session).
	if callerID == r.OwnerID {
		return UserPresentation{}, ErrHostCannotPresent
	}
	id, ok := platform.CanonicalUUID(in.PresentationID)
	if !ok {
		return UserPresentation{}, invalid("presentation_id debe ser un UUID")
	}
	slides, err := s.checkSlides(ctx, id, in.Slides)
	if err != nil {
		return UserPresentation{}, err
	}
	return s.store.SetUserPresentation(ctx, UserPresentation{
		ID: id, RoomID: roomID, UserID: callerID, Slides: slides,
	})
}

// UserPresentation devuelve la presentación propia de caller en la sala (404 si no tiene).
func (s *Service) UserPresentation(ctx context.Context, callerID, roomID uint) (UserPresentation, error) {
	if callerID == 0 {
		return UserPresentation{}, ErrUnauthenticated
	}
	r, err := s.store.GetRoom(ctx, roomID)
	if err != nil {
		return UserPresentation{}, err
	}
	member, err := s.store.IsRoomMember(ctx, roomID, callerID)
	if err != nil {
		return UserPresentation{}, err
	}
	if err := checkMember(r, callerID, member); err != nil {
		return UserPresentation{}, err
	}
	return s.store.UserPresentation(ctx, roomID, callerID)
}

// RoomUserPresentations lista las presentaciones propias de una sala. Es pública, como el listado
// de integrantes: así los participantes ven quién ya está listo para presentar.
func (s *Service) RoomUserPresentations(ctx context.Context, roomID uint) ([]UserPresentation, error) {
	r, err := s.store.GetRoom(ctx, roomID)
	if err != nil {
		return nil, err
	}
	all, err := s.store.RoomUserPresentations(ctx, roomID)
	if err != nil {
		return nil, err
	}
	// El anfitrión no figura entre quienes presentan, aunque quede alguna fila vieja.
	out := make([]UserPresentation, 0, len(all))
	for _, p := range all {
		if p.UserID != r.OwnerID {
			out = append(out, p)
		}
	}
	return out, nil
}

// RemoveUserPresentation quita la presentación propia de caller en la sala (idempotente).
func (s *Service) RemoveUserPresentation(ctx context.Context, callerID, roomID uint) error {
	if callerID == 0 {
		return ErrUnauthenticated
	}
	return s.store.RemoveUserPresentation(ctx, roomID, callerID)
}

// PublishMyPresentation pone en vivo la presentación propia de caller. Puede hacerlo el
// participante dueño de ella o el anfitrión de la sala (SetLiveSession ya valida eso).
func (s *Service) PublishMyPresentation(ctx context.Context, callerID, roomID uint) (LiveSession, error) {
	r, err := s.store.GetRoom(ctx, roomID)
	if err != nil {
		return LiveSession{}, err
	}
	if callerID == r.OwnerID {
		return LiveSession{}, ErrHostCannotPresent
	}
	p, err := s.store.UserPresentation(ctx, roomID, callerID)
	if err != nil {
		return LiveSession{}, err
	}
	return s.SetLiveSession(ctx, callerID, roomID, p.ID)
}

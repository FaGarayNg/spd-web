package store

import (
	"context"

	"gorm.io/gorm"

	"spd.web/services/rooms/internal/domain"
)

// Sesiones en vivo: el puntero que publican los anfitriones para que los espectadores sepan a
// qué presentación entrar. Una sala tiene a lo sumo una: el alta reemplaza a la anterior.

// SetLiveSession publica la sesión en vivo de la sala. El alta es una transacción que borra la
// fila anterior y crea la nueva: así CreatedAt (StartedAt del dominio) siempre queda en el
// momento de este lanzamiento, aunque la presentación sea la misma.
func (s *Store) SetLiveSession(ctx context.Context, ls domain.LiveSession) (domain.LiveSession, error) {
	row := liveSession{RoomID: ls.RoomID, PresentationID: ls.PresentationID}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("room_id = ?", ls.RoomID).Delete(&liveSession{}).Error; err != nil {
			return err
		}
		return tx.Create(&row).Error
	})
	if err != nil {
		return domain.LiveSession{}, err
	}
	return row.toDomain(), nil
}

// LiveSession devuelve la sesión en vivo de la sala; ErrLiveSessionNotFound si no hay ninguna.
func (s *Store) LiveSession(ctx context.Context, roomID uint) (domain.LiveSession, error) {
	var row liveSession
	err := take(s.db.WithContext(ctx), &row, domain.ErrLiveSessionNotFound, "room_id = ?", roomID)
	return row.toDomain(), err
}

// ClearLiveSession borra la sesión en vivo que tenga la sala. Idempotente: no tener sesión
// también es éxito (finalizar dos veces no es un error).
func (s *Store) ClearLiveSession(ctx context.Context, roomID uint) error {
	s.db.WithContext(ctx).Where("room_id = ?", roomID).Delete(&liveSession{})
	return nil
}

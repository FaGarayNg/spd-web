package store

import (
	"context"

	"gorm.io/gorm"

	"spd.web/services/rooms/internal/domain"
)

// SetUserPresentation guarda la presentación propia de un usuario en una sala. Si ya existía una
// (aunque estuviera borrada), la clave natural (room_id, user_id) la reactiva con los datos nuevos.
func (s *Store) SetUserPresentation(ctx context.Context, p domain.UserPresentation) (domain.UserPresentation, error) {
	row := userPresentation{
		RoomID: p.RoomID, UserID: p.UserID, PresentationID: p.ID, Slides: p.Slides,
	}
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := take(tx.Clauses(lockShare), &room{}, domain.ErrRoomNotFound, "id = ?", p.RoomID); err != nil {
			return err
		}
		res := tx.Clauses(reactivate("user_presentations",
			[]string{"room_id", "user_id"},
			"presentation_id", "slides", "created_at", "updated_at")).Create(&row)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			// Ya hay una fila ACTIVA para este usuario en la sala: el ON CONFLICT solo reactiva
			// borradas, así que acá tenemos que reemplazarla de verdad. Si no, la API responde
			// el UUID nuevo pero la base (y el preview) siguen con el anterior.
			return tx.Model(&userPresentation{}).
				Where("room_id = ? AND user_id = ?", p.RoomID, p.UserID).
				Updates(map[string]any{
					"presentation_id": p.ID,
					"slides":          Array[int32](p.Slides),
				}).Error
		}
		return nil
	})
	if err != nil {
		return domain.UserPresentation{}, err
	}
	return row.toDomain(), nil
}

func (s *Store) UserPresentation(ctx context.Context, roomID, userID uint) (domain.UserPresentation, error) {
	var row userPresentation
	err := take(s.db.WithContext(ctx), &row, domain.ErrUserPresentationNotFound,
		"room_id = ? AND user_id = ?", roomID, userID)
	return row.toDomain(), err
}

func (s *Store) RoomUserPresentations(ctx context.Context, roomID uint) ([]domain.UserPresentation, error) {
	db := s.db.WithContext(ctx)
	if err := take(db, &room{}, domain.ErrRoomNotFound, "id = ?", roomID); err != nil {
		return nil, err
	}
	var rows []userPresentation
	err := db.Where("room_id = ?", roomID).Order("created_at, user_id").Find(&rows).Error
	return mapList(rows, userPresentation.toDomain), err
}

// RemoveUserPresentation quita la presentación propia. No encontrar nada no es error.
func (s *Store) RemoveUserPresentation(ctx context.Context, roomID, userID uint) error {
	return s.db.WithContext(ctx).
		Where("room_id = ? AND user_id = ?", roomID, userID).
		Delete(&userPresentation{}).Error
}

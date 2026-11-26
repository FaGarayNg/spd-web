package store

import (
	"context"

	"gorm.io/gorm"

	"spd.web/services/rooms/internal/domain"
)

func (s *Store) CreateRoom(ctx context.Context, r domain.Room) (domain.Room, error) {
	row := room{Name: r.Name, URL: r.URL, AccessKey: r.AccessKey, AccessKeyHash: r.AccessKeyHash}
	if r.OwnerID != 0 {
		row.OwnerID = &r.OwnerID
	}
	if err := s.db.WithContext(ctx).Create(&row).Error; err != nil {
		return domain.Room{}, err
	}
	return row.toDomain(), nil
}

func (s *Store) ListRooms(ctx context.Context) ([]domain.Room, error) {
	var rows []room
	err := s.db.WithContext(ctx).Order("id").Find(&rows).Error
	return mapList(rows, room.toDomain), err
}

func (s *Store) GetRoom(ctx context.Context, id uint) (domain.Room, error) {
	var row room
	err := take(s.db.WithContext(ctx), &row, domain.ErrRoomNotFound, "id = ?", id)
	return row.toDomain(), err
}

func (s *Store) UpdateRoom(ctx context.Context, id uint, ch domain.RoomUpdate) (domain.Room, error) {
	changes := map[string]any{}
	if ch.Name != nil {
		changes["name"] = *ch.Name
	}
	if ch.URL != nil {
		changes["url"] = *ch.URL
	}
	if ch.AccessKeyHash != nil {
		changes["access_key_hash"] = *ch.AccessKeyHash
	}
	if ch.AccessKey != nil {
		changes["access_key"] = *ch.AccessKey
	}
	if ch.Format != nil {
		changes["format"] = *ch.Format
	}
	if ch.IndividualOrder != nil {
		changes["individual_order"] = Array[int32](*ch.IndividualOrder)
	}
	if ch.GroupOrder != nil {
		changes["group_order"] = Array[int32](*ch.GroupOrder)
	}
	var row room
	if err := s.update(ctx, &row, id, domain.ErrRoomNotFound, changes); err != nil {
		return domain.Room{}, err
	}
	return row.toDomain(), nil
}

// DeleteRoom borra la sala con sus grupos (y las presentaciones e integrantes de esos grupos) y
// sus miembros. Borra del padre a los hijos: es el orden en que las altas bloquean las filas.
func (s *Store) DeleteRoom(ctx context.Context, id uint) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := deleted(tx.Delete(&room{}, id), domain.ErrRoomNotFound); err != nil {
			return err
		}
		if err := tx.Where("room_id = ?", id).Delete(&group{}).Error; err != nil {
			return err
		}
		// Unscoped: los grupos ya están marcados como borrados.
		groups := tx.Unscoped().Model(&group{}).Select("id").Where("room_id = ?", id)
		if err := tx.Where("group_id IN (?)", groups).Delete(&presentation{}).Error; err != nil {
			return err
		}
		if err := tx.Where("group_id IN (?)", groups).Delete(&groupMember{}).Error; err != nil {
			return err
		}
		if err := tx.Where("room_id = ?", id).Delete(&userPresentation{}).Error; err != nil {
			return err
		}
		// live_sessions no tiene borrado lógico: su fila se borra de verdad con la sala.
		if err := tx.Where("room_id = ?", id).Delete(&liveSession{}).Error; err != nil {
			return err
		}
		return tx.Where("room_id = ?", id).Delete(&roomMember{}).Error
	})
}

func (s *Store) AddRoomMember(ctx context.Context, roomID, userID uint, admit func(domain.Room) error) (domain.RoomMember, bool, error) {
	var m roomMember
	var created bool
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var r room
		if err := take(tx.Clauses(lockShare), &r, domain.ErrRoomNotFound, "id = ?", roomID); err != nil {
			return err
		}
		if err := admit(r.toDomain()); err != nil {
			return err
		}
		if err := take(tx.Clauses(lockShare), &user{}, domain.ErrUserNotFound, "id = ?", userID); err != nil {
			return err
		}
		m = roomMember{UserID: userID, RoomID: roomID}
		res := tx.Clauses(reactivate("room_members", []string{"user_id", "room_id"}, "created_at")).Create(&m)
		if res.Error != nil {
			return res.Error
		}
		created = res.RowsAffected == 1
		return take(tx, &m, domain.ErrNotRoomMember, "user_id = ? AND room_id = ?", userID, roomID)
	})
	if err != nil {
		return domain.RoomMember{}, false, err
	}
	return m.toDomain(), created, nil
}

func (s *Store) RoomMembers(ctx context.Context, roomID uint) ([]domain.Member, error) {
	db := s.db.WithContext(ctx)
	if err := take(db, &room{}, domain.ErrRoomNotFound, "id = ?", roomID); err != nil {
		return nil, err
	}
	return members(db, "room_members", "room_id", roomID, "users.id")
}

// RemoveRoomMember saca al usuario de la sala y de los grupos de esa sala.
func (s *Store) RemoveRoomMember(ctx context.Context, roomID, userID uint) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Where("room_id = ? AND user_id = ?", roomID, userID).Delete(&roomMember{})
		if err := deleted(res, domain.ErrNotRoomMember); err != nil {
			return err
		}
		if err := tx.Where("room_id = ? AND user_id = ?", roomID, userID).Delete(&userPresentation{}).Error; err != nil {
			return err
		}
		groupIds, err := affectedGroupIds(tx, roomID, userID)
		if err != nil {
			return err
		}
		for _, groupID := range groupIds {
			if err := reassignEncargadoIfNeeded(tx, groupID, userID); err != nil {
				return err
			}
		}
		if err := tx.Where("user_id = ? AND group_id IN (?)", userID,
			tx.Unscoped().Model(&group{}).Select("id").Where("room_id = ?", roomID)).Delete(&groupMember{}).Error; err != nil {
			return err
		}
		for _, groupID := range groupIds {
			if err := clearPresentationIfEmpty(tx, groupID); err != nil {
				return err
			}
		}
		return nil
	})
}

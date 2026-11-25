package store

import (
	"time"

	"gorm.io/gorm"

	"spd.web/services/rooms/internal/domain"
)

// Filas de las tablas, con el esquema que crea AutoMigrate. Son la representación persistente
// de las entidades del dominio y se convierten con toDomain.
//
// gorm.Model aporta id, created_at, updated_at y deleted_at. DeletedAt activa el borrado lógico:
// Delete marca la fila con la fecha en lugar de borrarla y todas las consultas excluyen las filas
// marcadas.

// user es un Usuario. El correo es único solo entre los usuarios no borrados: uno borrado no lo
// bloquea.
type user struct {
	gorm.Model
	FullName     string        `gorm:"size:200;not null"`
	Email        string        `gorm:"size:254;not null;uniqueIndex:idx_users_email,where:deleted_at IS NULL"`
	PasswordHash string        `gorm:"not null"`
	Roles        Array[string] `gorm:"type:text[];not null;default:'{}'"`
}

func (user) TableName() string { return "users" }

func (u user) toDomain() domain.User {
	return domain.User{ID: u.ID, FullName: u.FullName, Email: u.Email, PasswordHash: u.PasswordHash,
		Roles: nonNil(u.Roles), CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt}
}

// room es una Sala; AccessKeyHash vacío: sala sin clave.
type room struct {
	gorm.Model
	Name          string `gorm:"size:200;not null"`
	URL           string `gorm:"size:2048;not null;default:''"`
	AccessKeyHash string `gorm:"not null;default:''"`
	// Dueño y anfitrión de la sala; nil en las salas de antes del login.
	OwnerID *uint `gorm:"index"`
	// Modo de presentación confirmado: "" sin confirmar, "groups" o "individual".
	Format string `gorm:"size:20;not null;default:''"`
	// Orden elegido por el anfitrión; se comparte con todos los integrantes de la sala.
	IndividualOrder Array[int32] `gorm:"type:integer[];not null;default:'{}'"`
	GroupOrder      Array[int32] `gorm:"type:integer[];not null;default:'{}'"`
}

func (room) TableName() string { return "rooms" }

func (r room) toDomain() domain.Room {
	var ownerID uint
	if r.OwnerID != nil {
		ownerID = *r.OwnerID
	}
	return domain.Room{ID: r.ID, Name: r.Name, URL: r.URL, OwnerID: ownerID, Format: r.Format,
		IndividualOrder: nonNil(r.IndividualOrder), GroupOrder: nonNil(r.GroupOrder),
		AccessKeyHash: r.AccessKeyHash, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
}

// roomMember es un DetalleSala. La clave primaria es el par (user_id, room_id): quien vuelve a
// una sala tras salir reactiva la misma fila.
type roomMember struct {
	UserID    uint `gorm:"primaryKey"`
	RoomID    uint `gorm:"primaryKey;index"`
	CreatedAt time.Time
	DeletedAt gorm.DeletedAt `gorm:"index"`

	// Solo declaran las claves foráneas para AutoMigrate: nunca se cargan.
	User *user `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Room *room `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
}

func (roomMember) TableName() string { return "room_members" }

func (m roomMember) toDomain() domain.RoomMember {
	return domain.RoomMember{UserID: m.UserID, RoomID: m.RoomID, JoinedAt: m.CreatedAt}
}

// group es un Grupo: Limit es su cupo (máximo de integrantes) y Priority, su prioridad de paso al
// presentar.
type group struct {
	gorm.Model
	RoomID   uint  `gorm:"not null;index"`
	Limit    int   `gorm:"not null"`
	Priority int   `gorm:"not null"`
	Room     *room `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
}

func (group) TableName() string { return "groups" }

func (g group) toDomain() domain.Group {
	return domain.Group{ID: g.ID, RoomID: g.RoomID, Limit: g.Limit, Priority: g.Priority,
		CreatedAt: g.CreatedAt, UpdatedAt: g.UpdatedAt}
}

// groupMember es un DetalleGrupo: la relación n:m entre usuarios y grupos. La clave primaria es
// el par (user_id, group_id): quien vuelve a un grupo tras salir reactiva la misma fila.
type groupMember struct {
	UserID    uint `gorm:"primaryKey"`
	GroupID   uint `gorm:"primaryKey;index"`
	CreatedAt time.Time
	DeletedAt gorm.DeletedAt `gorm:"index"`

	// Solo declaran las claves foráneas para AutoMigrate: nunca se cargan.
	User  *user  `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Group *group `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
}

func (groupMember) TableName() string { return "group_members" }

func (m groupMember) toDomain() domain.GroupMember {
	return domain.GroupMember{UserID: m.UserID, GroupID: m.GroupID, JoinedAt: m.CreatedAt}
}

// presentation es una Presentacion: su clave es el UUID del servicio presentations, y Slides,
// las diapositivas que ve el grupo.
type presentation struct {
	ID        string       `gorm:"type:uuid;primaryKey"`
	GroupID   uint         `gorm:"not null;index"`
	Slides    Array[int32] `gorm:"type:integer[];not null;default:'{}'"`
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt gorm.DeletedAt `gorm:"index"`
	Group     *group         `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
}

func (presentation) TableName() string { return "presentations" }

// userPresentation es la presentación propia de un participante (formato individual). Un usuario
// tiene a lo sumo una activa por sala: la clave natural (room_id, user_id) se reactiva al volver a
// asignar, igual que las pertenencias y las presentaciones de grupo.
type userPresentation struct {
	gorm.Model
	RoomID         uint         `gorm:"not null;index;uniqueIndex:idx_up_room_user"`
	UserID         uint         `gorm:"not null;index;uniqueIndex:idx_up_room_user"`
	PresentationID string       `gorm:"type:uuid;not null;index"`
	Slides         Array[int32] `gorm:"type:integer[];not null;default:'{}'"`
}

func (userPresentation) TableName() string { return "user_presentations" }

func (p userPresentation) toDomain() domain.UserPresentation {
	return domain.UserPresentation{
		ID: p.PresentationID, RoomID: p.RoomID, UserID: p.UserID, Slides: nonNil(p.Slides),
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
}

// liveSession es la sesión en vivo de una sala: qué presentación se está proyectando. Una sala
// tiene a lo sumo una (RoomID es la clave primaria): lanzar otra reemplaza a la anterior. Son
// filas físicas, sin DeletedAt: terminar la sesión la borra de verdad, y CreatedAt es el momento
// en que arrancó (domain.LiveSession.StartedAt).
type liveSession struct {
	RoomID         uint   `gorm:"primaryKey"`
	PresentationID string `gorm:"type:uuid;not null"`
	CreatedAt      time.Time
	Room           *room `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
}

func (liveSession) TableName() string { return "live_sessions" }

func (l liveSession) toDomain() domain.LiveSession {
	return domain.LiveSession{RoomID: l.RoomID, PresentationID: l.PresentationID, StartedAt: l.CreatedAt}
}

func (p presentation) toDomain() domain.Presentation {
	return domain.Presentation{ID: p.ID, GroupID: p.GroupID, Slides: nonNil(p.Slides),
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt}
}

// memberRow es un usuario unido a su pertenencia (room_members o group_members): las columnas de
// domain.Member, sin leer el correo ni el hash de la contraseña.
type memberRow struct {
	ID       uint
	FullName string
	Roles    Array[string]
	JoinedAt time.Time
}

func (m memberRow) toDomain() domain.Member {
	return domain.Member{ID: m.ID, FullName: m.FullName, Roles: nonNil(m.Roles), JoinedAt: m.JoinedAt}
}

// members lista los usuarios (no borrados) con pertenencia activa en table (room_members o
// group_members) para parentID, ordenados por id.
func members(db *gorm.DB, table, parentColumn string, parentID uint, orderBy string) ([]domain.Member, error) {
	var rows []memberRow
	err := db.Model(&user{}).
		Select("users.id, users.full_name, users.roles, "+table+".created_at AS joined_at").
		Joins("JOIN "+table+" ON "+table+".user_id = users.id AND "+table+".deleted_at IS NULL").
		Where(table+"."+parentColumn+" = ?", parentID).
		Order(orderBy).Scan(&rows).Error
	return mapList(rows, memberRow.toDomain), err
}

// mapList convierte una lista de filas con f, p. ej. mapList(rows, user.toDomain). Nunca
// devuelve nil: en JSON, una lista vacía es [].
func mapList[R, D any](rows []R, f func(R) D) []D {
	out := make([]D, len(rows))
	for i, r := range rows {
		out[i] = f(r)
	}
	return out
}

func nonNil[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}

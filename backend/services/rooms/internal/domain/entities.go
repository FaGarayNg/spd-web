// Package domain contiene el dominio "salas": las entidades (usuarios, salas y sus miembros,
// grupos y sus integrantes, presentaciones asignadas), sus reglas y los casos de uso. No sabe
// cómo se guardan: la persistencia la pone una implementación de Store (paquete store,
// PostgreSQL con GORM).
package domain

import (
	"encoding/json"
	"time"
)

// User es un usuario (Usuario). PasswordHash es el hash bcrypt de la contraseña y nunca se
// serializa.
type User struct {
	ID           uint      `json:"id"`
	FullName     string    `json:"full_name"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Roles        []string  `json:"roles"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Room es una sala (Sala). AccessKeyHash es el hash bcrypt de la clave de ingreso, vacío si la
// sala no tiene clave. Nunca se serializa: la API solo dice si existe (has_access_key).
// OwnerID es quién la creó y hace de anfitrión: 0 en salas sin dueño (nadie puede
// administrarlas por la API). Format es el modo de presentación confirmado ("" mientras el
// anfitrión no lo eligió): es público porque los invitados tienen que ver la sala armarse.
type Room struct {
	ID            uint      `json:"id"`
	Name          string    `json:"name"`
	URL           string    `json:"url"`
	OwnerID       uint      `json:"owner_id"`
	Format        string    `json:"format"`
	// Orden de presentación elegido por el anfitrión. Se guarda en la sala para que todos los
	// integrantes vean el mismo orden, tanto en formato individual como en grupos.
	IndividualOrder []int32   `json:"individual_order"`
	GroupOrder      []int32   `json:"group_order"`
	// AccessKey se guarda en el servidor para que el anfitrión pueda verla desde cualquier
	// dispositivo. Nunca se serializa: la API decide si la devuelve (solo al dueño).
	AccessKey     string    `json:"-"`
	AccessKeyHash string    `json:"-"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// Formatos de presentación confirmables en una sala.
const (
	FormatGroups     = "groups"     // la clase se organiza en grupos (tarjetas por grupo)
	FormatIndividual = "individual" // cada participante carga y presenta lo suyo
)

// HasAccessKey indica si la sala pide clave de ingreso.
func (r Room) HasAccessKey() bool { return r.AccessKeyHash != "" }

// MarshalJSON añade has_access_key.
func (r Room) MarshalJSON() ([]byte, error) {
	type plain Room // sin métodos: evita que MarshalJSON se llame a sí mismo
	return json.Marshal(struct {
		plain
		HasAccessKey bool `json:"has_access_key"`
	}{plain(r), r.HasAccessKey()})
}

// Member es un miembro de una sala o un integrante de un grupo, visto desde ella: solo lo que
// necesitan ver los demás. El correo y las fechas de la cuenta quedan fuera, son del propio
// usuario (GET /api/users/:id). JoinedAt es cuándo entró.
type Member struct {
	ID       uint      `json:"id"`
	FullName string    `json:"full_name"`
	Roles    []string  `json:"roles"`
	JoinedAt time.Time `json:"joined_at"`
}

// RoomMember es la pertenencia de un usuario a una sala (DetalleSala).
type RoomMember struct {
	UserID   uint      `json:"user_id"`
	RoomID   uint      `json:"room_id"`
	JoinedAt time.Time `json:"joined_at"`
}

// GroupMember es la pertenencia de un usuario a un grupo (DetalleGrupo). Usuarios y grupos se
// relacionan n:m: un usuario puede estar en varios grupos y un grupo tiene varios integrantes.
type GroupMember struct {
	UserID   uint      `json:"user_id"`
	GroupID  uint      `json:"group_id"`
	JoinedAt time.Time `json:"joined_at"`
}

// Group es un grupo de una sala (Grupo). Limit es su cupo, el máximo de integrantes, y Priority,
// su prioridad de paso a la hora de presentar: los grupos de una sala presentan por prioridad
// ascendente (1 primero) y, a igual prioridad, en el orden en que se crearon.
type Group struct {
	ID        uint      `json:"id"`
	RoomID    uint      `json:"room_id"`
	Limit     int       `json:"limit"`
	Priority  int       `json:"priority"`
	// EncargadoID es el integrante que carga/quita la presentación del grupo. 0 si el grupo
	// quedó sin encargado. Se puede transferir a otro integrante.
	EncargadoID uint      `json:"encargado_id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Presentation asigna a un grupo una presentación del servicio presentations (Presentacion): su
// ID es el mismo UUID y Slides, los números de las diapositivas que ve el grupo.
type Presentation struct {
	ID        string    `json:"presentation_id"`
	GroupID   uint      `json:"group_id"`
	Slides    []int32   `json:"slides"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// UserPresentation es la presentación propia de un participante en una sala con formato
// individual. ID es el UUID del servicio presentations y Slides, el subconjunto que presentará.
// Un usuario tiene a lo sumo una presentación activa por sala.
type UserPresentation struct {
	ID             string    `json:"presentation_id"`
	RoomID         uint      `json:"room_id"`
	UserID         uint      `json:"user_id"`
	Slides         []int32   `json:"slides"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

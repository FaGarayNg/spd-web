import type {
  ApiGroup,
  ApiGroupFields,
  ApiGroupMember,
  ApiLiveSession,
  ApiLoginResponse,
  ApiMember,
  ApiNewRoom,
  ApiRoom,
  ApiRoomJoin,
  ApiRoomMember,
  ApiPresentation,
  ApiPresentationDetail,
  ApiUser,
  ApiUserPresentation,
  Group,
  LiveSession,
  Member,
  Room,
  UserPresentation,
} from "../types"
import { apiGet, apiSend, apiSendWithStatus, ApiError } from "./http"
import { resetPresentation } from "./live"

// Dominio "salas" del gateway: usuarios, salas y sus miembros, grupos y sus integrantes, y las
// presentaciones asignadas a cada grupo. Los errores llegan como ApiError (ver http.ts), con el
// mensaje del backend y el código HTTP: 409 conflicto (sala con clave equivocada, grupo lleno...),
// 404 no existe, 422 presentación desconocida, etc.

// ─── Salas ──────────────────────────────────────────────────────────────────────────────────

const toRoom = (api: ApiRoom): Room => ({
  id: api.id,
  name: api.name,
  url: api.url,
  ownerId: api.owner_id,
  format: api.format,
  individualOrder: api.individual_order,
  groupOrder: api.group_order,
  hasAccessKey: api.has_access_key,
  createdAt: api.created_at,
  updatedAt: api.updated_at,
})

const toMember = (api: ApiMember): Member => ({ id: api.id, fullName: api.full_name, roles: api.roles })

/** Todas las salas, ordenadas por id. GET /api/rooms */
export async function getRooms(): Promise<Room[]> {
  const rooms = await apiGet<ApiRoom[]>("/rooms")
  return rooms.map(toRoom)
}

/** Salas en las que es miembro un usuario. GET /api/users/:id/rooms */
export async function getUserRooms(userId: number): Promise<Room[]> {
  const rooms = await apiGet<ApiRoom[]>(`/users/${userId}/rooms`)
  return rooms.map(toRoom)
}

/** Una sala. GET /api/rooms/:id. Rechaza con ApiError si no existe. */
export function getRoom(id: number | string): Promise<Room> {
  return apiGet<ApiRoom>(`/rooms/${id}`).then(toRoom)
}

/** Modifica los campos indicados de una sala (los ausentes no cambian). PATCH /api/rooms/:id.
 * Owner-only en el back: 401 sin sesión, 403 si no sos el anfitrión. */
export function updateRoom(
  roomId: number,
  changes: { name?: string; url?: string; accessKey?: string; format?: string },
): Promise<Room> {
  const body: Record<string, unknown> = {}
  if (changes.name !== undefined) body.name = changes.name
  if (changes.url !== undefined) body.url = changes.url
  if (changes.accessKey !== undefined) body.access_key = changes.accessKey
  if (changes.format !== undefined) body.format = changes.format
  return apiSend<ApiRoom>(`/rooms/${roomId}`, "PATCH", body).then(toRoom)
}

/** Guarda el orden de presentación elegido. Solo el anfitrión. `kind` es "individual" o "groups";
 * una lista vacía vuelve al orden natural. PATCH /api/rooms/:id/order */
export function updateRoomOrder(
  roomId: number,
  kind: "individual" | "groups",
  ids: number[],
): Promise<Room> {
  return apiSend<ApiRoom>(`/rooms/${roomId}/order`, "PATCH", { kind, ids }).then(toRoom)
}

/** Clave de ingreso en claro, solo para el anfitrión de la sala. GET /api/rooms/:id/access-key */
export function getRoomAccessKey(roomId: number | string): Promise<string> {
  return apiGet<{ access_key: string }>(`/rooms/${roomId}/access-key`).then((data) => data.access_key)
}

/** Cierra (borra) una sala. Solo el anfitrión: el back devuelve 401 sin sesión o 403 si no es
 * el dueño. En cascada se borran grupos, presentaciones asignadas, integrantes y miembros.
 * DELETE /api/rooms/:id */
export function deleteRoom(roomId: number | string): Promise<void> {
  return apiSend<void>(`/rooms/${roomId}`, "DELETE")
}

/** Crea una sala: sin clave de ingreso si accessKey queda vacía. POST /api/rooms */
export function createRoom(input: { name: string; url?: string; accessKey?: string }): Promise<Room> {
  const body: ApiNewRoom = {
    name: input.name,
    ...(input.url ? { url: input.url } : {}),
    ...(input.accessKey ? { access_key: input.accessKey } : {}),
  }
  return apiSend<ApiRoom>("/rooms", "POST", body).then(toRoom)
}

/** Saca a un integrante de la sala (solo el anfitrión puede sacar a otros). */
export function removeRoomMember(roomId: number | string, userId: number): Promise<void> {
  return apiSend<void>(`/rooms/${roomId}/members/${userId}`, "DELETE")
}

/** Integrantes de una sala. GET /api/rooms/:id/members */
export async function getRoomMembers(roomId: number): Promise<Member[]> {
  const members = await apiGet<ApiMember[]>(`/rooms/${roomId}/members`)
  return members.map(toMember)
}

/** Entra a una sala. Devuelve true si es nuevo miembro (201), false si ya estaba (200).
 * POST /api/rooms/:id/members */
export async function joinRoom(roomId: number, input: { userId: number; accessKey?: string }): Promise<boolean> {
  const body: ApiRoomJoin = { user_id: input.userId, ...(input.accessKey ? { access_key: input.accessKey } : {}) }
  const { status } = await apiSendWithStatus<ApiRoomMember>(`/rooms/${roomId}/members`, "POST", body)
  return status === 201
}

// ─── Grupos ─────────────────────────────────────────────────────────────────────────────────

/** Grupos de una sala con sus integrantes (una llamada por grupo). GET /api/rooms/:id/groups */
export async function getRoomGroups(roomId: number, sessionUserId: number | null): Promise<Group[]> {
  const groups = await apiGet<ApiGroup[]>(`/rooms/${roomId}/groups`)
  return Promise.all(
    groups.map(async (group) => {
      const groupMembers = await getGroupMembers(group.id)
      return {
        id: group.id,
        limit: group.limit,
        priority: group.priority,
        encargadoId: group.encargado_id,
        // El listado de integrantes ya trae nombre: { id, full_name, roles, joined_at }.
        members: groupMembers.map((m) => ({
          id: m.id,
          fullName: m.full_name,
          joined: sessionUserId !== null && m.id === sessionUserId,
        })),
      }
    }),
  )
}

/** Borra un grupo (y sus presentaciones e integrantes). DELETE /api/groups/:id */
export function deleteGroup(groupId: number): Promise<void> {
  return apiSend<void>(`/groups/${groupId}`, "DELETE")
}

/** Transfiere el rol de encargado a otro integrante del grupo. */
export function transferEncargado(groupId: number, userId: number): Promise<void> {
  return apiSend<void>(`/groups/${groupId}/encargado`, "PATCH", { user_id: userId })
}

/** Crea un grupo en la sala. POST /api/rooms/:id/groups */
export function createGroup(roomId: number, fields: { limit?: number; priority?: number }): Promise<ApiGroup> {
  const body: ApiGroupFields = {
    ...(fields.limit !== undefined ? { limit: fields.limit } : {}),
    ...(fields.priority !== undefined ? { priority: fields.priority } : {}),
  }
  return apiSend<ApiGroup>(`/rooms/${roomId}/groups`, "POST", body)
}

/** Integrantes de un grupo. GET /api/groups/:id/members */
export function getGroupMembers(groupId: number): Promise<ApiMember[]> {
  return apiGet<ApiMember[]>(`/groups/${groupId}/members`)
}

/** Entra a un grupo. Devuelve true si se sumó ahora (201), false si ya estaba (200).
 * POST /api/groups/:id/members */
export async function joinGroup(groupId: number, userId: number): Promise<boolean> {
  const { status } = await apiSendWithStatus<ApiGroupMember>(`/groups/${groupId}/members`, "POST", { user_id: userId })
  return status === 201
}

/** Sale de un grupo. DELETE /api/groups/:id/members/:user_id */
export function leaveGroup(groupId: number, userId: number): Promise<void> {
  return apiSend<void>(`/groups/${groupId}/members/${userId}`, "DELETE")
}

/** Presentaciones asignadas a un grupo. GET /api/groups/:id/presentations */
export function getGroupPresentations(groupId: number): Promise<ApiPresentation[]> {
  return apiGet<ApiPresentation[]>(`/groups/${groupId}/presentations`)
}

/** Preview privado: el back verifica que el usuario sea integrante del grupo. Las imágenes
 * vienen por rutas protegidas por rooms (ver apiImage). */
export function getGroupPreview(groupId: number, presentationId: string): Promise<ApiPresentationDetail> {
  return apiGet<ApiPresentationDetail>(`/groups/${groupId}/presentations/${presentationId}/preview`)
}

/** Preview de la presentación individual del usuario de la sesión: solo la suya. */
export function getMyPreview(roomId: number | string): Promise<ApiPresentationDetail> {
  return apiGet<ApiPresentationDetail>(`/rooms/${roomId}/my-presentation/preview`)
}

/** Asigna una presentación (subida a /api/presentations/upload) al grupo: la ve entera.
 * POST /api/groups/:id/presentations. 409 si ya está asignada a otro grupo, 422 si el back
 * no conoce ese id, 503 si no puede verificarlo con el servicio presentations. */
export function assignGroupPresentation(groupId: number, presentationId: string): Promise<ApiPresentation> {
  return apiSend<ApiPresentation>(`/groups/${groupId}/presentations`, "POST", {
    presentation_id: presentationId,
  })
}

/** Quita una presentación asignada. DELETE /api/groups/:id/presentations/:presentation_id */
export function unassignGroupPresentation(groupId: number, presentationId: string): Promise<void> {
  return apiSend<void>(`/groups/${groupId}/presentations/${presentationId}`, "DELETE")
}

// ─── Presentaciones individuales ──────────────────────────────────────────────────────────────

const toUserPresentation = (api: ApiUserPresentation): UserPresentation => ({
  presentationId: api.presentation_id,
  roomId: api.room_id,
  userId: api.user_id,
  slides: api.slides,
  createdAt: api.created_at,
  updatedAt: api.updated_at,
})

/** Todas las presentaciones propias de la sala. GET /api/rooms/:id/user-presentations */
export async function getUserPresentations(roomId: number | string): Promise<UserPresentation[]> {
  const list = await apiGet<ApiUserPresentation[]>(`/rooms/${roomId}/user-presentations`)
  return list.map(toUserPresentation)
}

/** La presentación propia del usuario de la sesión, o null si no tiene. */
export async function getMyPresentation(roomId: number | string): Promise<UserPresentation | null> {
  try {
    return toUserPresentation(await apiGet<ApiUserPresentation>(`/rooms/${roomId}/my-presentation`))
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/** Asigna (o reemplaza) la presentación propia. POST /api/rooms/:id/my-presentation */
export function setMyPresentation(roomId: number | string, presentationId: string): Promise<UserPresentation> {
  return apiSend<ApiUserPresentation>(`/rooms/${roomId}/my-presentation`, "POST", {
    presentation_id: presentationId,
  }).then(toUserPresentation)
}

/** Quita la presentación propia. DELETE /api/rooms/:id/my-presentation */
export function clearMyPresentation(roomId: number | string): Promise<void> {
  return apiSend<void>(`/rooms/${roomId}/my-presentation`, "DELETE")
}

/** Publica la presentación propia del usuario en la sesión en vivo de la sala. */
export function publishMyPresentation(roomId: number | string): Promise<LiveSession> {
  return apiSend<ApiLiveSession>(`/rooms/${roomId}/my-presentation/live`, "PUT")
    .then(async (api) => {
      await resetPresentation(api.presentation_id).catch(() => undefined)
      return { presentationId: api.presentation_id, startedAt: api.started_at }
    })
}

// ─── Sesión en vivo ──────────────────────────────────────────────────────────────────────────

// La sesión en vivo es el puntero que publica el anfitrión: qué presentación se proyecta ahora.
// GET es público (404 si no hay sesión); PUT y DELETE exigen ser el dueño de la sala: el backend
// verifica el JWT y responde 401 sin sesión o 403 si no sos el anfitrión.

/** La sesión en vivo de la sala, o null si no hay ninguna (404 del back).
 * GET /api/rooms/:id/live-session */
export async function getLiveSession(roomId: number | string): Promise<LiveSession | null> {
  try {
    const api = await apiGet<ApiLiveSession>(`/rooms/${roomId}/live-session`)
    return { presentationId: api.presentation_id, startedAt: api.started_at }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/** Lanza (o reemplaza) la sesión en vivo con una presentación: se proyecta desde ahora.
 * PUT /api/rooms/:id/live-session. Rechaza con ApiError: 404 sala inexistente, 422 presentación
 * desconocida, 503 servicio presentations caído. */
export function setLiveSession(roomId: number | string, presentationId: string): Promise<LiveSession> {
  return apiSend<ApiLiveSession>(`/rooms/${roomId}/live-session`, "PUT", { presentation_id: presentationId })
    .then(async (api) => {
      // Cada emisión arranca limpia, incluso si se repite la misma presentación.
      await resetPresentation(api.presentation_id).catch(() => undefined)
      return { presentationId: api.presentation_id, startedAt: api.started_at }
    })
}

/** Da por terminada la sesión en vivo (idempotente: sin sesión también es éxito).
 * DELETE /api/rooms/:id/live-session */
export function clearLiveSession(roomId: number | string): Promise<void> {
  return apiSend<void>(`/rooms/${roomId}/live-session`, "DELETE")
}

// ─── Usuarios ───────────────────────────────────────────────────────────────────────────────

/** Inicia sesión: POST /api/auth/login. Devuelve el token de la sesión y el usuario; rechaza
 * con el mensaje del back (el mismo 401 para correo inexistente y contraseña incorrecta). */
export function login(email: string, password: string): Promise<ApiLoginResponse> {
  return apiSend<ApiLoginResponse>("/auth/login", "POST", { email, password })
}

/** Crea un usuario. POST /api/users. 409 si el email ya está registrado. */
export function createUser(input: {
  fullName: string
  email: string
  password: string
  roles?: string[]
}): Promise<ApiUser> {
  return apiSend<ApiUser>("/users", "POST", {
    full_name: input.fullName,
    email: input.email,
    password: input.password,
    ...(input.roles ? { roles: input.roles } : {}),
  })
}

/** Un usuario. GET /api/users/:id */
export function getUser(id: number): Promise<ApiUser> {
  return apiGet<ApiUser>(`/users/${id}`)
}

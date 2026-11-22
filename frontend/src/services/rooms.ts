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
  ApiUser,
  Group,
  LiveSession,
  Member,
  Room,
} from "../types"
import { apiGet, apiSend, apiSendWithStatus, ApiError } from "./http"

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

/** Crea una sala: sin clave de ingreso si accessKey queda vacía. POST /api/rooms */
export function createRoom(input: { name: string; url?: string; accessKey?: string }): Promise<Room> {
  const body: ApiNewRoom = {
    name: input.name,
    ...(input.url ? { url: input.url } : {}),
    ...(input.accessKey ? { access_key: input.accessKey } : {}),
  }
  return apiSend<ApiRoom>("/rooms", "POST", body).then(toRoom)
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

// ─── Sesión en vivo ──────────────────────────────────────────────────────────────────────────

// La sesión en vivo es el puntero que publica el anfitrión: qué presentación se proyecta ahora.
// El backend solo guarda hashes de la clave, así que estos endpoints no exigen rol: el rol lo
// maneja la interfaz (igual que en el resto de la sala).

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
    .then((api) => ({ presentationId: api.presentation_id, startedAt: api.started_at }))
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

/** Crea una cuenta real para un invitado: el backend no tiene login ni "invitados", así que la
 * identidad es un usuario común con email y contraseña autogenerados (nunca salen del
 * navegador). Devuelve el usuario para obtener su id y unirse a la sala/grupo. */
export function createGuestUser(fullName: string): Promise<ApiUser> {
  // UUID: sin colisiones ni datos personales en el email. Dominio reservado, no existe.
  const email = `guest-${crypto.randomUUID()}@invitados.spd.local`
  const password = randomSecret()
  return createUser({ fullName, email, password })
}

// Secreto de 16+ caracteres: suficiente para la validación del back (mínimo 8) y desechable.
function randomSecret(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)) // base64: ~22 chars imprimibles
}

/** Un usuario. GET /api/users/:id */
export function getUser(id: number): Promise<ApiUser> {
  return apiGet<ApiUser>(`/users/${id}`)
}

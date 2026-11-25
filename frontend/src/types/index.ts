
// API: servicio de piezas

export type ApiUser = {
  id: number
  full_name: string
  email: string
  roles: string[]
  created_at: string
  updated_at: string
}

export type ApiRoom = {
  id: number
  name: string
  url: string
  owner_id: number
  /** Modo de presentación confirmado: "groups", "individual" o "" sin confirmar. */
  format: string
  /** Orden elegido por el anfitrión; se comparte con todos los integrantes. */
  individual_order: number[]
  group_order: number[]
  has_access_key: boolean
  created_at: string
  updated_at: string
}

/** Respuesta del login: el JWT de la sesión y el usuario autenticado. */
export type ApiLoginResponse = { token: string; user: ApiUser }

export type ApiNewRoom = { name: string; url?: string; access_key?: string }


export type ApiMember = {
  id: number
  full_name: string
  roles: string[]
  joined_at: string
}

export type ApiRoomMember = { user_id: number; room_id: number; joined_at: string }
export type ApiRoomJoin = { user_id: number; access_key?: string }

export type ApiGroup = {
  id: number
  room_id: number
  limit: number
  priority: number
  created_at: string
  updated_at: string
}

export type ApiGroupFields = { limit?: number; priority?: number }
export type ApiGroupMember = { user_id: number; group_id: number; joined_at: string }

export type ApiPresentation = { presentation_id: string; group_id: number; slides: number[] }

// Presentación propia de un participante (formato individual).
export type ApiUserPresentation = {
  presentation_id: string
  room_id: number
  user_id: number
  slides: number[]
  created_at: string
  updated_at: string
}

export type UserPresentation = {
  presentationId: string
  roomId: number
  userId: number
  slides: number[]
  createdAt: string
  updatedAt: string
}

// Sesión en vivo de una sala (servicio rooms): qué presentación se está proyectando.
export type ApiLiveSession = { room_id: number; presentation_id: string; started_at: string }

export type LiveSession = { presentationId: string; startedAt: string }

//  API mistica de servicio de presentaciones 

export type ApiSlide = { 
  slide: number
  file: string
  url: string
}

export type ApiPresentationDetail = {
  presentation_id: string
  slide_count: number
  slides: ApiSlide[]
}

// API: servicio realtime 

// Anotaciones compartidas: coordenadas en el canvas fijo de 1280x720.
export type CanvasPoint = { x: number; y: number }

export type CanvasStroke = {
  id: string
  color: string
  width: number
  eraser: boolean
  points: CanvasPoint[]
}

export type AnnotationMessage =
  | { type: "annotation"; annotation: CanvasStroke }
  | { type: "clear" }

export type ApiSlideState = {
  type: "slide"
  presentation_id: string
  slide: number
  slide_count: number
  url: string
  annotations: CanvasStroke[]
}

export type Role = "host" | "guest"

export type Room = {
  id: number
  name: string
  url: string
  /** Dueño y anfitrión de la sala; 0 en las salas de antes del login. */
  ownerId: number
  /** Modo de presentación confirmado ("groups" | "individual" | ""): la ven todos. */
  format: string
  individualOrder: number[]
  groupOrder: number[]
  hasAccessKey: boolean
  createdAt: string
  updatedAt: string
}

export type Member = {
  id: number
  fullName: string
  roles: string[]
}

export type GroupMember = {
  id: number
  fullName: string
  joined: boolean
}

export type Group = {
  id: number
  limit: number
  priority: number
  members: GroupMember[]
}

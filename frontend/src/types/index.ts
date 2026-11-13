
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
  has_access_key: boolean
  created_at: string
  updated_at: string
}

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

export type ApiSlideState = {
  type: "slide"
  presentation_id: string
  slide: number
  slide_count: number
  url: string
}

export type Role = "host" | "guest"

export type Room = {
  id: number
  name: string
  url: string
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

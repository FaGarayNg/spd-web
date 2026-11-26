// Cliente HTTP base: todos los servicios pasan por acá. En desarrollo Vite hace de proxy hacia
// el gateway (ver vite.config.ts); en producción, el reverse-proxy debe publicar /api y /ws.
//
// El backend responde los errores siempre {"error": "<mensaje>"} con el código HTTP correcto,
// o el cuerpo correspondiente (201 crea, 200/204 leen, 409 conflicto, 422 desconocido...).

const API_BASE = "/api"

const UNREACHABLE = "No pudimos conectar con el servidor. Probá de nuevo en unos minutos."
const SERVER_FAILED = "El servidor tuvo un problema. Probá de nuevo en unos minutos."

// Mensaje para el usuario cuando el back no trae uno propio (o es un error del servidor).
function fallbackMessage(status: number) {
  if (status === 502 || status === 503 || status === 504) return UNREACHABLE
  if (status >= 500) return SERVER_FAILED
  if (status === 404) return "No encontramos lo que buscabas."
  if (status === 401 || status === 403) return "No tenés permiso para hacer eso."
  return `No se pudo completar la operación (error ${status}).`
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

import { getToken } from "../utils/token"

type Options = {
  /** Método HTTP. Por defecto GET. */
  method?: string
  /** Cuerpo JSON (se serializa). No usar junto a bodyRaw. */
  body?: unknown
  /** Cuerpo crudo (p. ej. un Blob o FormData). No usar junto a body. */
  bodyRaw?: BodyInit
  /** Cabeceras extra (p. ej. Content-Type para bodyRaw). */
  headers?: Record<string, string>
}

function isNotOk(response: Response) {
  return !response.ok;
}

type Result<T> = { data: T; status: number };

async function requestRaw<T>(path: string, options: Options = {}): Promise<Result<T>> {
  const { method = "GET", body, bodyRaw, headers } = options

  // Si hay sesión iniciada, el token viaja en cada petición: es lo único que el backend mira
  // para saber quién pide. Sin token la petición es anónima (solo consultas públicas).
  const token = getToken()
  const withAuth = token !== null ? { Authorization: `Bearer ${token}`, ...headers } : headers

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json", ...withAuth } : withAuth,
      body: body !== undefined ? JSON.stringify(body) : bodyRaw,
    })
  } catch {
    // Sin conexión o servidor apagado: el navegador ni llega a recibir respuesta.
    throw new ApiError(0, UNREACHABLE)
  }

  if (isNotOk(response)) {
    let message = fallbackMessage(response.status)
    // Los 5xx nunca se muestran crudos; el resto trae el mensaje del back ({"error": "..."}).
    if (response.status < 500) {
      try {
        const parsed: unknown = await response.json()
        if (isErrorBody(parsed) && parsed.error) message = parsed.error
      } catch {
        // Respuesta sin cuerpo JSON: nos quedamos con el mensaje genérico.
      }
    }
    throw new ApiError(response.status, message)
  }

  // 204 sin contenido: nada que decodificar.
  if (response.status === 204) return { data: undefined as T, status: response.status }
  return { data: (await response.json()) as T, status: response.status }
}

async function request<T>(path: string, options: Options = {}): Promise<T> {
  const { data } = await requestRaw<T>(path, options)
  return data
}

function isErrorBody(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function apiSend<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  return request<T>(path, { method, body })
}

/** Como apiSend, pero además del cuerpo devuelve el código HTTP: los endpoints que crean (o
 * re-usan) pertenencias como POST /api/rooms/:id/members distinguen el 201 del 200. */
export function apiSendWithStatus<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<Result<T>> {
  return requestRaw<T>(path, { method, body })
}

/** Envío multipart (p. ej. la subida de presentaciones). El Content-Type lo pone el navegador. */
export function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return request<T>(path, { method: "POST", bodyRaw: form })
}

/** Imagen protegida: se baja con la cabecera de sesión y se devuelve como URL local. Un <img>
 * normal no podría mandar el Bearer, por eso el preview privado usa este helper. */
export async function apiImage(path: string): Promise<string> {
  const token = getToken()
  // Las URLs del preview ya vienen con /api (como las del servicio presentations): no lo
  // agregamos dos veces, si no el gateway no encuentra la ruta.
  const fullPath = path.startsWith(`${API_BASE}/`) ? path : `${API_BASE}${path}`
  let response: Response
  try {
    response = await fetch(fullPath, {
      headers: token !== null ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch {
    throw new ApiError(0, UNREACHABLE)
  }
  if (!response.ok) {
    let message = fallbackMessage(response.status)
    if (response.status < 500) {
      try {
        const parsed: unknown = await response.json()
        if (isErrorBody(parsed) && parsed.error) message = parsed.error
      } catch {
        // sin cuerpo JSON: se conserva el mensaje genérico
      }
    }
    throw new ApiError(response.status, message)
  }
  return URL.createObjectURL(await response.blob())
}


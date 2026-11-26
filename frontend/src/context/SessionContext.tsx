import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { setToken } from "../utils/token"

// Sesión del navegador. El backend emite un JWT en el login (POST /api/auth/login) y http.ts lo
// manda en cada petición: eso identifica al usuario del otro lado. El userId sirve para las
// llamadas que necesitan el id en el cuerpo (unirse a sala/grupo). Se persiste en localStorage
// para que la sesión sobreviva recargas y pestañas nuevas.

export type Session = {
  name: string
  /** Id del usuario en el backend. */
  userId?: number
  /** JWT de la sesión. Sin él no hay sesión válida (el login siempre lo entrega). */
  token?: string
}

const STORAGE_KEY = "spd.session"

function load(): Session | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    if (typeof parsed !== "object" || parsed === null || typeof parsed.name !== "string") return null
    // Sesiones viejas sin token (identidades efímeras) ya no son válidas.
    if (typeof parsed.token !== "string" || parsed.token === "") return null
    return parsed
  } catch {
    return null // localStorage bloqueado (p. ej. cookies off): sesión volátil
  }
}

function save(session: Session | null) {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Sin almacenamiento: la sesión vive solo en memoria.
  }
}

type SessionValue = {
  session: Session | null
  signIn: (session: Session) => void
  signOut: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(load)
  // El token viaja con la sesión y alimenta a http.ts (fuera de React). Al cerrar sesión
  // también se limpia.
  useEffect(() => {
    save(session)
    setToken(session?.token ?? null)
  }, [session])
  const value: SessionValue = {
    session,
    signIn: (next) => setSession(next),
    signOut: () => setSession(null),
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = useContext(SessionContext)
  if (!context) throw new Error("useSession debe usarse dentro de SessionProvider")
  return context
}

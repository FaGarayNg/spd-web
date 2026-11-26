// Token de sesión del navegador. Lo emite el backend en el login (POST /api/auth/login) y lo
// manda http.ts en cada petición (cabecera Authorization). Vive aparte de la sesión (clave:
// spd.session) porque http.ts lo necesita sin pasar por React.
const TOKEN_KEY = "spd.token"

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null // almacenamiento bloqueado: la sesión queda anónima
  }
}

export function setToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Sin almacenamiento: la sesión vive solo en memoria.
  }
}

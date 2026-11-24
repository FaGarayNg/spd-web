// El back guarda la clave hasheada y nunca la devuelve. Para poder mostrarla después, este
// dispositivo recuerda la que se creó o con la que se entró. Si se pierde (otro dispositivo, datos
// del navegador borrados), el front no puede recuperarla: haría falta que el back la guarde de forma
// recuperable.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // sin 0, O, 1, I para no confundir
const STORAGE_KEY = "spd.roomKeys"

/** Clave legible del estilo ABC-DEF. */
export function generateAccessKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length])
  return `${chars.slice(0, 3).join("")}-${chars.slice(3).join("")}`
}

function readAll(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>
  } catch {
    return {}
  }
}

export function saveRoomKey(roomId: number | string, key: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [roomId]: key }))
  } catch {
    // sin acceso al almacenamiento: la clave simplemente no se recuerda
  }
}

export function getRoomKey(roomId: number | string): string | undefined {
  return readAll()[String(roomId)]
}

/** Olvida la clave de una sala cerrada: no sirve guardarla para siempre en este dispositivo. */
export function removeRoomKey(roomId: number | string) {
  try {
    const keys = readAll()
    delete keys[String(roomId)]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // sin acceso al almacenamiento: no hay nada que limpiar
  }
}

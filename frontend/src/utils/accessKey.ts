// La clave ya no se guarda en el navegador: vive en el servidor y el anfitrión la pide con
// GET /rooms/:id/access-key desde cualquier dispositivo. Acá solo la generamos al crear/rotar.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // sin 0, O, 1, I para no confundir

/** Clave legible del estilo ABC-DEF. */
export function generateAccessKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length])
  return `${chars.slice(0, 3).join("")}-${chars.slice(3).join("")}`
}

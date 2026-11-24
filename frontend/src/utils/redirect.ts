// Después del login se vuelve a la ruta que inició el flujo (por ejemplo, el enlace de
// invitación a una sala). Solo se aceptan rutas internas: un state manipulado no debe
// convertir esto en un open redirect.
export function safeReturnPath(from: unknown, fallback = "/salas"): string {
  return typeof from === "string" &&
    from.startsWith("/") &&
    !from.startsWith("//") &&
    !from.startsWith("/\\")
    ? from
    : fallback
}

// El destino también viaja en ?next=: así sobrevive a una recarga del login o a abrir el
// registro en otra pestaña. safeReturnPath sigue siendo el único que decide si es válido.
export function loginPath(from: string): string {
  return `/login?next=${encodeURIComponent(from)}`
}

export function registerPath(from: string): string {
  return `/registro?next=${encodeURIComponent(from)}`
}

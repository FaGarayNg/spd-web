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

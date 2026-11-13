
export function formatDate(iso: string) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date)
}

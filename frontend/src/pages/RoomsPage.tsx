import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { RoomCard } from "../components/rooms/RoomCard"
import { Button } from "../components/ui/Button"
import { useSession } from "../context/SessionContext"
import { getRoomMembers, getUserRooms } from "../services/rooms"
import type { Role, Room } from "../types"

const TABS: { role: Role; label: string; empty: string }[] = [
  // El backend ya sabe quién es dueño de cada sala: la pestaña de anfitrión filtra las salas
  // propias y la de invitado las que integra sin ser su dueño.
  { role: "host", label: "Anfitrión", empty: "Todavía no creaste ninguna sala." },
  {
    role: "guest",
    label: "Invitado",
    empty: "El anfitrión te va a invitar con el enlace de la sala: uniéndote te la traemos acá.",
  },
]

export default function RoomsPage() {
  const navigate = useNavigate()
  const { session } = useSession()
  const [role, setRole] = useState<Role>("host")
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [counts, setCounts] = useState<Record<number, number>>({})

  useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    // Con sesión real o de invitado: las salas del usuario, filtradas por el rol de la pestaña.
    // Sin usuario (ni cuenta ni invitado): nada que mostrar todavía.
    const userId = session?.userId
    const request =
      userId === undefined
        ? Promise.resolve([] as Room[])
        : getUserRooms(userId).then((list) =>
            list.filter((room) => (role === "host" ? room.ownerId === userId : room.ownerId !== userId)),
          )
    request
      .then((result) => {
        if (!active) return
        setRooms(result)
        setLoading(false)
        // El listado no trae los integrantes: se piden por sala (si alguno falla, no se muestra).
        Promise.all(
          result.map((room) =>
            getRoomMembers(room.id).then((list) => [room.id, list.length] as const).catch(() => null),
          ),
        ).then((pairs) => {
          if (active) setCounts(Object.fromEntries(pairs.filter((pair) => pair !== null)))
        })
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(err instanceof Error ? err.message : "No se pudieron cargar las salas.")
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [role, session?.userId])

  const tab = TABS.find((item) => item.role === role)!

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-brand-700">Mis salas</h1>
        {role === "host" ? (
          <Button variant="accent" onClick={() => navigate("/salas/nueva")}>
            Crear sala
          </Button>
        ) : (
          <Button variant="accent" onClick={() => navigate("/unirse")}>
            Unirme a una sala
          </Button>
        )}
      </div>

      <div className="flex gap-6 border-b border-border" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.role}
            role="tab"
            aria-selected={role === item.role}
            onClick={() => setRole(item.role)}
            className={`-mb-px border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
              role === item.role
                ? "border-accent text-brand-700"
                : "border-transparent text-ink/60 hover:text-brand-700"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-ink/60">Cargando salas…</p>
      ) : error ? (
        <p role="alert" className="rounded-lg border border-dashed border-red-300 bg-surface p-8 text-center text-red-700">
          {error}
        </p>
      ) : rooms.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-ink/70">
          {role === "guest" && session?.userId === undefined
            ? "Todavía no te uniste a ninguna sala. Registrate o entrá como invitado para sumarte."
            : tab.empty}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} role={role} members={counts[room.id]} />
          ))}
        </div>
      )}
    </div>
  )
}

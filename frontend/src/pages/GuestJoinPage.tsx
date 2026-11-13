import { useEffect, useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { SplitCard } from "../components/layout/SplitCard"
import { Button } from "../components/ui/Button"
import { Field } from "../components/ui/Field"
import { useSession } from "../context/SessionContext"
import { createUser, getRoom, joinRoom } from "../services/rooms"
import type { Room } from "../types"
import { saveRoomKey } from "../utils/accessKey"

// El back no tiene "invitado": se crea un usuario descartable con rol "guest" para poder usar
// POST /api/rooms/:id/members y los grupos. Pendiente de definir con el back (deja usuarios sueltos).
const guestEmail = () => `invitado-${crypto.randomUUID()}@invitados.spd.app`

export default function GuestJoinPage() {
  const navigate = useNavigate()
  const { session, signIn } = useSession()
  const roomParam = useSearchParams()[0].get("sala") ?? ""
  const [roomId, setRoomId] = useState(roomParam)
  const [room, setRoom] = useState<Room | null>(null)
  const [name, setName] = useState(session?.name ?? "")
  const [key, setKey] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Si el enlace trae la sala, la consultamos para mostrar su nombre y saber si pide clave.
  useEffect(() => {
    if (!roomParam) return
    let active = true
    getRoom(roomParam)
      .then((result) => {
        if (active) setRoom(result)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "No se pudo cargar la sala.")
      })
    return () => {
      active = false
    }
  }, [roomParam])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const id = Number(roomId)
    if (!Number.isInteger(id) || id < 1) return setError("Ingresá un número de sala válido.")
    setSubmitting(true)
    setError("")
    const accessKey = key.trim()
    try {
      // Con cuenta o invitado previo se reutiliza el usuario; si no, se crea uno.
      let user: { name: string; userId: number }
      if (session?.userId !== undefined) {
        user = { name: session.name, userId: session.userId }
      } else {
        const created = await createUser({
          fullName: name.trim(),
          email: guestEmail(),
          password: crypto.randomUUID(),
          roles: ["guest"],
        })
        user = { name: created.full_name, userId: created.id }
      }
      await joinRoom(id, { userId: user.userId, accessKey: accessKey || undefined })
      if (accessKey) saveRoomKey(id, accessKey)
      signIn(user)
      navigate(`/salas/${id}`, { state: { role: "guest" } })
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo entrar a la sala.")
      setSubmitting(false)
    }
  }

  const needsKey = room ? room.hasAccessKey : true

  return (
    <SplitCard title="Todo listo para entrar en sala" text="Ingresá tus datos y unite a la presentación en vivo.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold text-brand-700">
          {room ? `Unite a «${room.name}»` : "Unite a la sala"}
        </h2>
        {!roomParam && (
          <Field label="Número de sala" inputMode="numeric" placeholder="Ej. 4" value={roomId}
            onChange={(event) => setRoomId(event.target.value)} required />
        )}
        {session?.userId === undefined && (
          <Field label="Nombre de usuario" placeholder="¿Cómo te llamás?" value={name}
            onChange={(event) => setName(event.target.value)} required />
        )}
        {needsKey && (
          <Field label="Clave de la sala" placeholder="Ej. A7K-29P" value={key}
            onChange={(event) => setKey(event.target.value.toUpperCase())} required />
        )}
        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        <Button type="submit" disabled={submitting}>{submitting ? "Entrando…" : "Ingresar"}</Button>
      </form>
    </SplitCard>
  )
}

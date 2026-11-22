import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { SplitCard } from "../components/layout/SplitCard"
import { Button } from "../components/ui/Button"
import { Field } from "../components/ui/Field"
import { useSession } from "../context/SessionContext"
import { ApiError } from "../services/http"
import { createGuestUser, getRoom, joinRoom } from "../services/rooms"
import { saveRoomKey } from "../utils/accessKey"
import type { Room } from "../types"

// Nombre autogenerado para la identidad efímera: el vínculo con la sala es la clave, no el
// nombre. Cuando exista inicio de sesión, el usuario va a llegar acá con su cuenta real (o se
// le va a pedir iniciar sesión o registrarse antes de este formulario) y el nombre va a salir
// de la cuenta: "Invitado XXXX" queda solo como rótulo temporal en el header.
function guestName(): string {
  return `Invitado ${crypto.randomUUID().slice(0, 4).toUpperCase()}`
}

export default function GuestJoinPage() {
  const navigate = useNavigate()
  const { signIn, session } = useSession()
  const [params] = useSearchParams()
  // El enlace de invitación (RoomHeader) usa ?sala=; se tolera ?room= por enlaces viejos.
  const roomId = params.get("sala") ?? params.get("room") ?? ""

  const [room, setRoom] = useState<Room | null | undefined>(undefined)
  const [key, setKey] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // La sala se conoce por el enlace: nombre y si pide clave. Sin ?sala= no hay a qué unirse:
  // el backend no tiene búsqueda por clave (POST /rooms/:id/members necesita el id).
  useEffect(() => {
    if (!roomId) return setRoom(null)
    let active = true
    setRoom(undefined)
    getRoom(roomId)
      .then((result) => active && setRoom(result))
      .catch(() => active && setRoom(null))
    return () => {
      active = false
    }
  }, [roomId])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!room) return
    setSubmitting(true)
    setError("")
    try {
      // 1. Identidad real: si la sesión ya tiene userId (registro o invitación previa) se
      //    reusa; si no, se crea una cuenta efímera con datos autogenerados.
      let userId = session?.userId
      if (userId === undefined) {
        const user = await createGuestUser(guestName())
        userId = user.id
        signIn({ name: user.full_name, userId, guest: true })
      }
      // 2. POST /api/rooms/:id/members: valida la clave con bcrypt y queda como miembro real
      //    (200 si ya era miembro, 201 si entra ahora). 403 = clave equivocada.
      await joinRoom(room.id, { userId, accessKey: key || undefined })
      // El dispositivo recuerda la clave con la que entró: el header de la sala la va a poder
      // mostrar y copiar (ver utils/accessKey.ts).
      if (key) saveRoomKey(room.id, key)
      navigate(`/salas/${room.id}`, { state: { role: "guest" } })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) setError("La clave no es correcta. Pedile la del anfitrión.")
        else if (err.status === 404) setError("La sala ya no existe.")
        else setError(err.message)
      } else {
        setError("No se pudo entrar a la sala. Volvé a intentar.")
      }
      setSubmitting(false)
    }
  }

  if (room === undefined) return <p className="text-ink/60">Buscando la sala…</p>

  if (room === null) {
    return (
      <SplitCard
        title="Enlace de invitación inválido"
        text="El enlace no tiene el id de la sala (o la sala ya no existe). Pedile al anfitrión que te reenvíe el enlace completo."
      >
        <Link to="/salas" className="font-semibold text-brand-500 hover:underline">Ir a mis salas</Link>
      </SplitCard>
    )
  }

  return (
    <SplitCard
      title="Todo listo para entrar en sala"
      text={<>Vas a entrar como invitado a <strong className="text-brand-700">{room.name}</strong>.</>}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold text-brand-700">Unite a la sala</h2>
        {room.hasAccessKey ? (
          <Field label="Clave de la sala" placeholder="Ej. A7K-29P" value={key}
            onChange={(event) => setKey(event.target.value)} required autoFocus />
        ) : (
          <p className="rounded-lg bg-brand-50 p-4 text-sm text-brand-700">
            Esta sala no pide clave: podés entrar directo.
          </p>
        )}
        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Entrando…" : "Ingresar"}
        </Button>
        <p className="text-sm text-ink/70">
          ¿Sos el anfitrión? <Link to="/login" className="font-semibold text-brand-500 hover:underline">Iniciá sesión</Link>
        </p>
      </form>
    </SplitCard>
  )
}

import { useEffect, useState, type FormEvent } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { SplitCard } from "../components/layout/SplitCard"
import { Button } from "../components/ui/Button"
import { Field } from "../components/ui/Field"
import { useSession } from "../context/SessionContext"
import { ApiError } from "../services/http"
import { getRoom, joinRoom } from "../services/rooms"
import { saveRoomKey } from "../utils/accessKey"
import { loginPath } from "../utils/redirect"
import type { Room } from "../types"

// Ingreso a una sala ajena por enlace + clave. A diferencia de antes, no se crea una identidad
// efímera: hace falta una cuenta con sesión iniciada para que el backend sepa quién entra.
export default function JoinRoomPage() {
  const navigate = useNavigate()
  const { session, signOut } = useSession()
  const [params] = useSearchParams()
  // El enlace de invitación usa ?sala=; se tolera ?room= por enlaces viejos.
  const roomId = params.get("sala") ?? params.get("room") ?? ""

  const [room, setRoom] = useState<Room | null | undefined>(undefined)
  const [key, setKey] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

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

  // Sin token no hay userId real que mandar al backend: volver al login y regresar acá después.
  // El destino viaja en ?next= además del state para que no se pierda si el login se recarga.
  const returnTo = `/unirse?sala=${encodeURIComponent(roomId)}`
  if (session?.token === undefined) {
    return <Navigate to={loginPath(returnTo)} state={{ from: returnTo }} replace />
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!room || session.userId === undefined) return
    setSubmitting(true)
    setError("")
    try {
      // POST /api/rooms/:id/members valida la clave (403 = incorrecta) y deja al usuario como
      // miembro real: 201 si entra ahora, 200 si ya pertenecía.
      await joinRoom(room.id, { userId: session.userId, accessKey: key || undefined })
      // El dispositivo recuerda la clave para poder mostrarla y copiarla en la sala.
      if (key) saveRoomKey(room.id, key)
      navigate(`/salas/${room.id}`)
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
      <section className="mx-auto max-w-md rounded-lg border border-border bg-surface p-6 text-center">
        <h1 className="text-lg font-semibold text-brand-700">Enlace de invitación inválido</h1>
        <p className="mt-2 text-sm text-ink/60">La sala no existe o el enlace está incompleto.</p>
        <Link to="/salas" className="mt-4 inline-block font-semibold text-brand-500 hover:underline">
          Volver a mis salas
        </Link>
      </section>
    )
  }

  return (
    <SplitCard
      title="Entrá a la sala"
      text={<>Te invitaron a <strong className="text-brand-700">{room.name}</strong>. Ingresá con tu cuenta y la clave de la sala.</>}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold text-brand-700">Unite a la sala</h2>
        <p className="text-sm text-ink/70">Entrás como <strong>{session.name}</strong>.</p>
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
          ¿Querés entrar con otra cuenta?{" "}
          <button type="button" onClick={() => {
            const backTo = `/unirse?sala=${room.id}`
            signOut()
            navigate(loginPath(backTo), { state: { from: backTo } })
          }} className="font-semibold text-brand-500 hover:underline">
            Cambiar de cuenta
          </button>
        </p>
      </form>
    </SplitCard>
  )
}

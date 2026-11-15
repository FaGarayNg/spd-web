import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { SplitCard } from "../components/layout/SplitCard"
import { Button } from "../components/ui/Button"
import { Field } from "../components/ui/Field"
import { useSession } from "../context/SessionContext"
import { createRoom, joinRoom } from "../services/rooms"
import { generateAccessKey, saveRoomKey } from "../utils/accessKey"

// POST /api/rooms. Reglas del backend: nombre obligatorio (hasta 200 caracteres),
// clave de 4+ caracteres (se guarda hasheada; después ya no se puede leer).
// Toda sala se crea con clave: si no se escribe una, se genera.
export default function CreateRoomPage() {
  const navigate = useNavigate()
  const { session } = useSession()
  const [name, setName] = useState("")
  const [accessKey, setAccessKey] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreating(true)
    setError("")
    const key = accessKey.trim() || generateAccessKey()
    try {
      const room = await createRoom({ name: name.trim(), accessKey: key })
      saveRoomKey(room.id, key)
      // Quien crea la sala cuenta como integrante (si tiene usuario real en el back).
      if (session?.userId !== undefined) {
        await joinRoom(room.id, { userId: session.userId, accessKey: key }).catch(() => false)
      }
      // El anfitrión de la sala es quien la acaba de crear: se lleva ese rol a la página de sala.
      navigate(`/salas/${room.id}`, { state: { role: "host" } })
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la sala.")
      setCreating(false)
    }
  }

  return (
    <SplitCard
      title="Creá una sala para presentar"
      text="Con el enlace de la sala y la clave, tus invitados entran a ver la presentación en vivo."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold text-brand-700">Nueva sala</h2>
        <Field label="Nombre de la sala" placeholder="Ej. Desarrollo Web" value={name}
          onChange={(event) => setName(event.target.value)} required maxLength={200} />
        <Field label="Clave de ingreso" placeholder="Si la dejás vacía, generamos una" value={accessKey}
          onChange={(event) => setAccessKey(event.target.value)} minLength={4} maxLength={72} />
        <small className="-mt-3 text-ink/60">
          Cada persona que entre va a necesitar esta clave. Vas a poder verla y copiarla desde la sala.
        </small>
        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        <Button type="submit" disabled={creating}>{creating ? "Creando sala…" : "Crear sala"}</Button>
        <p className="text-sm text-ink/70">
          <Link to="/salas" className="font-semibold text-brand-500 hover:underline">Volver a mis salas</Link>
        </p>
      </form>
    </SplitCard>
  )
}

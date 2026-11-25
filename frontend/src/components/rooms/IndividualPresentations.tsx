import { useRef, useState, type ChangeEvent } from "react"
import { uploadPresentation, MAX_UPLOAD_MB } from "../../services/live"
import { clearMyPresentation, setMyPresentation } from "../../services/rooms"
import type { Member, UserPresentation } from "../../types"
import { initials } from "../../utils/initials"
import { Button } from "../ui/Button"

type Props = {
  roomId: number
  members: Member[]
  currentUserId?: number
  presentations: UserPresentation[]
  /** Vuelve a consultar el listado después de subir o quitar. */
  onChanged: () => void
  registerItem?: (key: string) => (element: HTMLElement | null) => void
}

// Cada participante sube su propio PDF/PPTX. El anfitrión arma la sala, define el orden y da el
// inicio desde "Preparar sala": los participantes no lanzan su presentación desde acá.
export function IndividualPresentations({
  roomId, members, currentUserId, presentations, onChanged, registerItem,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState("")

  const byUser = new Map(presentations.map((p) => [p.userId, p]))
  const mine = currentUserId === undefined ? undefined : byUser.get(currentUserId)

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = "" // permite volver a elegir el mismo archivo
    if (!file) return
    if (!/\.(pdf|pptx)$/i.test(file.name)) return setError("El archivo tiene que ser PDF o PPTX.")
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return setError(`El archivo supera los ${MAX_UPLOAD_MB} MB.`)
    setError("")
    setUploading(true)
    try {
      const detail = await uploadPresentation(file)
      await setMyPresentation(roomId, detail.presentation_id)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la presentación.")
    } finally {
      setUploading(false)
    }
  }

  const remove = async () => {
    setRemoving(true)
    setError("")
    try {
      await clearMyPresentation(roomId)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar la presentación.")
    } finally {
      setRemoving(false)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-brand-700">Presentaciones individuales</h2>
        <p className="text-sm text-ink/60">
          Cada persona sube su archivo; el anfitrión define el orden y da el inicio desde "Preparar sala".
        </p>
      </div>

      {currentUserId !== undefined && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4">
          <input ref={inputRef} type="file" accept=".pdf,.pptx" className="hidden" onChange={upload} />
          <strong className="text-sm text-brand-700">Tu presentación</strong>
          {mine ? (
            <>
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                Lista · {mine.slides.length} diapositivas
              </span>
              <Button variant="ghost" icon="trash" onClick={remove} disabled={removing}>
                {removing ? "Quitando…" : "Quitar"}
              </Button>
            </>
          ) : (
            <Button icon="upload" onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? "Subiendo y convirtiendo…" : "Cargar mi presentación"}
            </Button>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}

      <ul className="flex flex-col gap-2">
        {members.map((person) => {
          const p = byUser.get(person.id)
          const isMine = person.id === currentUserId
          return (
            <li key={person.id} ref={registerItem?.(String(person.id))} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                {initials(person.fullName)}
              </span>
              <strong className="flex-1 text-sm">{person.fullName}{isMine ? " (vos)" : ""}</strong>
              {p ? (
                <small className="text-ink/60">Lista · {p.slides.length} diapositivas</small>
              ) : (
                <small className="text-ink/60">Esperando su presentación…</small>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

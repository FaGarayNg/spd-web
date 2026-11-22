import { useRef, useState, type ChangeEvent } from "react"
import type { ApiPresentation, Group } from "../../types"
import { initials } from "../../utils/initials"
import { Button } from "../ui/Button"

type Props = {
  group: Group
  blocked?: boolean
  /** Presentación asignada al grupo, si tiene (la carga el padre: es dato de la sala). */
  presentation?: ApiPresentation | null
  /** true mientras el padre sube y asigna el archivo de ESTE grupo. */
  uploading?: boolean
  /** El anfitrión puede desasignar (por ahora cualquiera podría vía API; en la UI solo él). */
  canManage?: boolean
  /** Solo el anfitrión lanza la presentación del grupo a la sesión en vivo. */
  canPresent?: boolean
  onToggle: () => void
  /** Sube el archivo y lo asigna al grupo; rechaza con el mensaje del back si falla. */
  onUpload: (file: File) => Promise<void>
  onUnassign: () => Promise<void>
  /** Abre la galería de diapositivas de la presentación asignada. */
  onView: () => void
  /** Lanza la presentación de este grupo en vivo (PUT live-session + navegar). */
  onPresent?: () => void
}

export function GroupCard({
  group,
  blocked = false,
  presentation,
  uploading = false,
  canManage = false,
  canPresent = false,
  onToggle,
  onUpload,
  onUnassign,
  onView,
  onPresent,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")
  // Integrante de la sesión: lo marca la carga de datos (user_id de la sesión dentro del grupo).
  const joined = group.members.some((member) => member.joined)
  const full = !joined && group.members.length >= group.limit
  const assigned = presentation != null

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = "" // permite volver a elegir el mismo archivo tras un error
    if (!file) return
    if (!/\.(pdf|pptx)$/i.test(file.name)) return setError("El archivo tiene que ser PDF o PPTX.")
    setError("")
    try {
      await onUpload(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la presentación.")
    }
  }

  const handleUnassign = async () => {
    setError("")
    try {
      await onUnassign()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar la presentación.")
    }
  }

  return (
    <article className={`flex flex-col gap-4 rounded-lg border bg-surface p-5 ${joined ? "border-brand-700" : "border-border"}`}>
      <div className="flex items-baseline justify-between">
        <strong className="text-brand-700">Grupo {String(group.priority).padStart(2, "0")}</strong>
        <small className="text-ink/60">{group.members.length}/{group.limit}</small>
      </div>
      <div className="flex min-h-16 flex-col gap-2">
        {group.members.length ? (
          group.members.map((member, index) => (
            <div key={member.id} className="flex items-center gap-2 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                {initials(member.fullName)}
              </span>
              <span>{member.fullName}</span>
              {index === 0 && <small className="text-ink/60">· Encargado</small>}
            </div>
          ))
        ) : (
          <p className="text-sm text-ink/60">Todavía no hay integrantes</p>
        )}
      </div>

      {assigned ? (
        <div className="flex flex-col gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
          <div className="flex items-center justify-between gap-2">
            <strong>Presentación asignada</strong>
            <small>{presentation.slides.length} diapositivas</small>
          </div>
          <div className="flex flex-wrap gap-2">
            {canPresent && onPresent && (
              <Button variant="ghost" icon="play" onClick={onPresent}>Presentar</Button>
            )}
            <Button variant="ghost" icon="eye" onClick={onView}>Ver diapositivas</Button>
            {canManage && (
              <Button variant="ghost" icon="trash" onClick={handleUnassign}>Quitar</Button>
            )}
          </div>
        </div>
      ) : (
        joined && (
          <>
            <input ref={inputRef} type="file" accept=".pdf,.pptx" className="hidden"
              onChange={handleFile} disabled={uploading} />
            <Button variant="ghost" icon="upload" className="self-start"
              onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? "Subiendo y convirtiendo…" : "Cargar presentación"}
            </Button>
          </>
        )
      )}
      {!assigned && uploading && (
        <p className="text-sm text-ink/60">Convirtiendo el archivo en diapositivas…</p>
      )}
      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant={joined ? "ghost" : "secondary"} onClick={onToggle} disabled={full || blocked}>
          {joined ? "Abandonar" : blocked ? "Ya estás en otro grupo" : full ? "Completo" : "Unirme"}
        </Button>
      </div>
    </article>
  )
}

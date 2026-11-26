import { useRef, useState, type ChangeEvent } from "react"
import { MAX_UPLOAD_MB } from "../../services/live"
import type { ApiPresentation, Group } from "../../types"
import { initials } from "../../utils/initials"
import { Button } from "../ui/Button"
import { Icon } from "../ui/Icon"

type Props = {
  group: Group
  /** Usuario de la sesión, para saber si es el encargado del grupo. */
  currentUserId?: number
  blocked?: boolean
  /** Presentación asignada al grupo, si tiene (la carga el padre: es dato de la sala). */
  presentation?: ApiPresentation | null
  /** true mientras el padre sube y asigna el archivo de ESTE grupo. */
  uploading?: boolean
  /** Desasignar: el anfitrión o el encargado del grupo (el back valida 401/403). */
  canManage?: boolean
  /** Solo el anfitrión lanza la presentación del grupo a la sesión en vivo. */
  canPresent?: boolean
  onToggle: () => void
  /** Pasa el rol de encargado a otro integrante (solo lo ve quien lo tiene). */
  onTransfer?: (userId: number) => void
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
  currentUserId,
  blocked = false,
  presentation,
  uploading = false,
  canManage = false,
  canPresent = false,
  onToggle,
  onTransfer,
  onUpload,
  onUnassign,
  onView,
  onPresent,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")
  const joined = group.members.some((member) => member.joined)
  const isEncargado = group.encargadoId === currentUserId
  const full = !joined && group.members.length >= group.limit
  const assigned = presentation != null
  const freeSlots = Math.max(0, group.limit - group.members.length)

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
    <article className={`flex h-full flex-col gap-4 rounded-xl border bg-surface p-5 ${
      joined ? "border-border bg-brand-50/40 ring-1 ring-brand-100" : "border-border"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <strong className="text-base font-semibold text-brand-700">
            Grupo {String(group.priority).padStart(2, "0")}
          </strong>
          {joined && (
            <span className="w-fit rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
              Tu equipo
            </span>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-ink/70">
          {group.members.length}/{group.limit} cupos
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {group.members.length > 0 ? (
          group.members.map((member) => (
            <div key={member.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                {initials(member.fullName)}
              </span>
              <span className="min-w-0 flex-1 truncate">{member.fullName}</span>
              {member.id === group.encargadoId ? (
                <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                  Encargado
                </span>
              ) : (
                isEncargado && onTransfer && (
                  <button type="button" onClick={() => onTransfer(member.id)}
                    title="Pasar rol de encargado" aria-label="Pasar rol de encargado"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink/50 transition-colors hover:bg-brand-50 hover:text-brand-700">
                    <Icon name="edit" size={14} />
                  </button>
                )
              )}
            </div>
          ))
        ) : (
          <p className="text-sm text-ink/60">Todavía no hay integrantes</p>
        )}
        {Array.from({ length: freeSlots }, (_, index) => (
          <div key={`cupo-${index}`}
            className="flex items-center gap-2 rounded-md border border-dashed border-border px-1 py-1 text-sm text-ink/40">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs">·</span>
            <span>Cupo disponible</span>
          </div>
        ))}
      </div>

      {assigned ? (
        <div className="flex flex-col gap-3 rounded-lg bg-brand-50/70 p-3 text-sm text-brand-700">
          <div className="flex items-center justify-between gap-2">
            <strong className="font-semibold">Presentación asignada</strong>
            <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold">
              {presentation.slides.length} diapositivas
            </span>
          </div>
          <div className="flex items-center gap-2">
            {joined && (
              <Button variant="secondary" icon="eye" onClick={onView} className="min-w-0 flex-1 justify-center">
                Ver diapositivas
              </Button>
            )}
            {canPresent && onPresent && (
              <Button variant="secondary" icon="play" onClick={onPresent} className="shrink-0">Presentar</Button>
            )}
            {(canManage || isEncargado) && (
              <button type="button" onClick={handleUnassign} title="Quitar" aria-label="Quitar"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink/60 transition-colors hover:bg-red-50 hover:text-red-700">
                <Icon name="trash" size={18} />
              </button>
            )}
          </div>
        </div>
      ) : (
        joined && isEncargado && (
          <>
            <input ref={inputRef} type="file" accept=".pdf,.pptx" className="hidden"
              onChange={handleFile} disabled={uploading} />
            <Button variant="secondary" icon="upload" className="w-full justify-center"
              onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? "Subiendo y convirtiendo…" : "Cargar presentación"}
            </Button>
            <small className="text-ink/60">PDF o PPTX · máximo {MAX_UPLOAD_MB} MB</small>
          </>
        )
      )}
      {!assigned && joined && !isEncargado && (
        <p className="text-sm text-ink/60">Solo el encargado del grupo carga la presentación.</p>
      )}
      {!assigned && uploading && (
        <p className="text-sm text-ink/60">Convirtiendo el archivo en diapositivas…</p>
      )}
      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}

      <div className="mt-auto flex border-t border-border pt-4">
        {joined ? (
          <Button variant="secondary" onClick={onToggle} className="w-full justify-center">Abandonar</Button>
        ) : blocked ? (
          <div className="w-full rounded-md bg-surface-muted px-3 py-2 text-center text-sm text-ink/60">
            Ya estás en otro grupo
          </div>
        ) : full ? (
          <div className="w-full rounded-md bg-surface-muted px-3 py-2 text-center text-sm text-ink/60">Completo</div>
        ) : (
          <Button variant="secondary" onClick={onToggle} className="w-full justify-center">Unirme</Button>
        )}
      </div>
    </article>
  )
}

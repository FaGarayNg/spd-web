import { useEffect, useState } from "react"
import { Button } from "../ui/Button"
import { Icon } from "../ui/Icon"

type Copied = "link" | "key" | null

type Props = {
  roomId: number
  title: string
  /** La clave en texto, solo si este dispositivo la conoce (la guardó al crear la sala o entrar). */
  accessKey?: string
  /** Cuántos integrantes tiene la sala, si ya se conocen. */
  members?: number
  /** El anfitrión ve la clave que viene del servidor; los demás solo saben si existe. */
  canSeeKey?: boolean
  /** Solo el anfitrión puede generar una clave nueva si la perdió. */
  canRotateKey?: boolean
  onRotateKey?: () => void
  rotatingKey?: boolean
}

const iconButton = "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-brand-700 hover:bg-brand-50"
const tile = "flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 sm:p-4"

export function RoomHeader({
  roomId, title, accessKey, members, canSeeKey, canRotateKey, onRotateKey, rotatingKey,
}: Props) {
  const [copied, setCopied] = useState<Copied>(null)
  const [revealed, setRevealed] = useState(false)

  // La clave recién generada debe verse de una vez, sin tener que tocar "mostrar".
  useEffect(() => {
    if (accessKey) setRevealed(true)
  }, [accessKey])
  // Enlace propio de esta sala: lleva el número, así quien entra inicia sesión y pone la clave.
  const invitationLink = `${window.location.origin}/unirse?sala=${roomId}`

  const copy = async (value: string, which: Exclude<Copied, null>) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // En la red local (http) el portapapeles moderno puede estar bloqueado: se usa el
      // método clásico con un campo temporal para que el enlace igual se pueda copiar.
      const area = document.createElement("textarea")
      area.value = value
      area.setAttribute("readonly", "")
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand("copy")
      } catch {
        // Sin portapapeles disponible: el usuario todavía puede copiar a mano.
      }
      document.body.removeChild(area)
    }
    setCopied(which)
    window.setTimeout(() => setCopied(null), 2000)
  }

  const keyText = !accessKey
    ? canSeeKey ? "Generá una clave para verla" : "Solo el anfitrión puede verla"
    : copied === "key"
      ? "¡Copiada!"
      : revealed
        ? accessKey
        : "••••••••"

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold text-brand-700 sm:text-2xl">{title}</h1>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">Activa</span>
            {members !== undefined && (
              <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700"
                title="El conteo incluye al anfitrión">
                {members} en sala
              </span>
            )}
          </div>
          {members !== undefined && (
            <small className="text-xs text-ink/60">El conteo incluye al anfitrión.</small>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => copy(invitationLink, "link")}
          aria-label="Copiar enlace de invitación"
          className={`${tile} text-left hover:border-brand-500`}
        >
          <span className="min-w-0 flex-1">
            <small className="block text-ink/60">Enlace de invitación</small>
            <strong className="mt-0.5 block break-all text-sm font-semibold text-brand-700 sm:text-base">
              {copied === "link" ? "¡Copiado!" : invitationLink}
            </strong>
            <small className="mt-1 block text-xs text-ink/50 sm:hidden">Tocá para copiar</small>
          </span>
          <span className="shrink-0 text-brand-700">
            <Icon name={copied === "link" ? "check" : "link"} />
          </span>
        </button>
        <div className={tile}>
          <span className="min-w-0 flex-1">
            <small className="block text-ink/60">Clave de sala</small>
            <strong className="mt-0.5 block break-all text-sm font-semibold text-brand-700 sm:text-base">{keyText}</strong>
          </span>
          {accessKey ? (
            <span className="flex shrink-0 gap-1">
              <button aria-label={revealed ? "Ocultar clave" : "Mostrar clave"} className={iconButton}
                onClick={() => setRevealed((value) => !value)}>
                <Icon name="eye" />
              </button>
              <button aria-label="Copiar clave" className={iconButton} onClick={() => copy(accessKey, "key")}>
                <Icon name={copied === "key" ? "check" : "copy"} />
              </button>
            </span>
          ) : (
            <span className="shrink-0 text-brand-700"><Icon name="lock" /></span>
          )}
        </div>
      </div>
      {canRotateKey && (
        <Button variant="ghost" icon="reset" className="self-start" onClick={onRotateKey} disabled={rotatingKey}>
          {rotatingKey ? "Generando…" : accessKey ? "Generar nueva clave" : "Crear clave de ingreso"}
        </Button>
      )}
    </div>
  )
}

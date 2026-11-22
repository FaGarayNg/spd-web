import { useState } from "react"
import { Icon } from "../ui/Icon"

type Copied = "link" | "key" | null

type Props = {
  roomId: number
  title: string
  /** La clave en texto, solo si este dispositivo la conoce (la guardó al crear la sala o entrar). */
  accessKey?: string
  /** Cuántos integrantes tiene la sala, si ya se conocen. */
  members?: number
}

const iconButton = "rounded-md p-2 text-brand-700 hover:bg-brand-50"
const tile = "flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"

export function RoomHeader({ roomId, title, accessKey, members }: Props) {
  const [copied, setCopied] = useState<Copied>(null)
  const [revealed, setRevealed] = useState(false)
  // Enlace propio de esta sala: lleva el número, así quien entra solo pone su nombre y la clave.
  const invitationLink = `${window.location.origin}/unirse?sala=${roomId}`

  const copy = async (value: string, which: Exclude<Copied, null>) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // sin permiso de portapapeles: igual mostramos el estado
    }
    setCopied(which)
    window.setTimeout(() => setCopied(null), 2000)
  }

  const keyText = !accessKey
    ? "Protegida: la clave no se puede ver desde este dispositivo"
    : copied === "key"
      ? "¡Copiada!"
      : revealed
        ? accessKey
        : "••••••••"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-700">{title}</h1>
          {members !== undefined && (
            <p className="text-sm text-ink/60">
              {members} {members === 1 ? "integrante" : "integrantes"}
            </p>
          )}
        </div>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">Activa</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button onClick={() => copy(invitationLink, "link")} className={`${tile} text-left hover:border-brand-500`}>
          <span className="min-w-0">
            <small className="block text-ink/60">Enlace de invitación</small>
            <strong className="block truncate text-brand-700">
              {copied === "link" ? "¡Copiado!" : invitationLink}
            </strong>
          </span>
          <Icon name={copied === "link" ? "check" : "link"} />
        </button>
        <div className={tile}>
          <span className="min-w-0">
            <small className="block text-ink/60">Clave de sala</small>
            <strong className="block truncate text-brand-700">{keyText}</strong>
          </span>
          {accessKey ? (
            <span className="flex gap-1">
              <button aria-label={revealed ? "Ocultar clave" : "Mostrar clave"} className={iconButton}
                onClick={() => setRevealed((value) => !value)}>
                <Icon name="eye" />
              </button>
              <button aria-label="Copiar clave" className={iconButton} onClick={() => copy(accessKey, "key")}>
                <Icon name={copied === "key" ? "check" : "copy"} />
              </button>
            </span>
          ) : (
            <Icon name="lock" />
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from "react"
import { getPresentation } from "../../services/live"
import type { ApiPresentationDetail } from "../../types"
import { Button } from "../ui/Button"
import { Icon } from "../ui/Icon"

type Props = {
  presentationId: string
  /** Rótulo (p. ej. "Grupo 03") para saber de quién es la presentación. */
  label: string
  onClose: () => void
}

/** Galería de las diapositivas de una presentación (metadatos + imágenes del servicio
 * presentations, a través del gateway). Son cacheables (immutable): abrir la galería antes
 * de una sesión en vivo precarga lo que se va a mostrar. */
export function SlideGallery({ presentationId, label, onClose }: Props) {
  const [detail, setDetail] = useState<ApiPresentationDetail | undefined>(undefined)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    setError("")
    getPresentation(presentationId)
      .then((result) => active && setDetail(result))
      .catch((err: unknown) => active && setError(err instanceof Error ? err.message : "No se pudieron cargar las diapositivas."))
    return () => {
      active = false
    }
  }, [presentationId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Diapositivas de ${label}`}
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-surface p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-brand-700">Diapositivas · {label}</h2>
          <Button variant="ghost" icon="logout" onClick={onClose}>Cerrar</Button>
        </div>
        {detail === undefined && !error && <p className="text-ink/60">Cargando diapositivas…</p>}
        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        {detail && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {detail.slides.map((slide) => (
              <figure key={slide.slide} className="flex flex-col gap-1.5">
                <img
                  src={slide.url}
                  alt={`Diapositiva ${slide.slide}`}
                  loading="lazy"
                  className="aspect-video w-full rounded-md border border-border object-contain bg-surface-muted"
                />
                <figcaption className="text-xs text-ink/60">Diapositiva {slide.slide}</figcaption>
              </figure>
            ))}
          </div>
        )}
        {detail && (
          <p className="mt-4 flex items-center gap-2 text-sm text-ink/70">
            <Icon name="eye" size={16} /> {detail.slide_count} diapositivas en total
          </p>
        )}
      </div>
    </div>
  )
}

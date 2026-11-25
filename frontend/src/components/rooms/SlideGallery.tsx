import { useEffect, useRef, useState } from "react"
import { apiImage } from "../../services/http"
import { getGroupPreview } from "../../services/rooms"
import type { ApiPresentationDetail } from "../../types"
import { Button } from "../ui/Button"
import { Icon } from "../ui/Icon"

type Props = {
  groupId: number
  presentationId: string
  /** Rótulo (p. ej. "Grupo 03") para saber de quién es la presentación. */
  label: string
  onClose: () => void
}

/** Galería privada: solo integrantes del grupo pueden abrirla. Metadatos e imágenes pasan por
 * rooms, que verifica la pertenencia; las imágenes se bajan con la sesión y se muestran como URLs
 * locales porque un <img> común no puede enviar la cabecera de autorización. */
export function SlideGallery({ groupId, presentationId, label, onClose }: Props) {
  const [detail, setDetail] = useState<ApiPresentationDetail | undefined>(undefined)
  const [images, setImages] = useState<Record<number, string>>({})
  const [error, setError] = useState("")
  const created = useRef<string[]>([])

  useEffect(() => {
    let active = true
    setDetail(undefined)
    setImages({})
    setError("")
    getGroupPreview(groupId, presentationId)
      .then(async (result) => {
        if (!active) return
        setDetail(result)
        const pairs = await Promise.all(result.slides.map(async (slide) => {
          const url = await apiImage(slide.url)
          created.current.push(url)
          return [slide.slide, url] as const
        }))
        if (active) setImages(Object.fromEntries(pairs))
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "No se pudieron cargar las diapositivas.")
      })
    return () => {
      active = false
      created.current.forEach((url) => URL.revokeObjectURL(url))
      created.current = []
    }
  }, [groupId, presentationId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Diapositivas de ${label}`}
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full max-w-4xl overflow-auto rounded-lg bg-surface p-4 sm:p-6"
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
                {images[slide.slide] ? (
                  <img
                    src={images[slide.slide]}
                    alt={`Diapositiva ${slide.slide}`}
                    className="aspect-video w-full rounded-md border border-border object-contain bg-surface-muted"
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-md border border-border bg-surface-muted text-xs text-ink/60">
                    Cargando…
                  </div>
                )}
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

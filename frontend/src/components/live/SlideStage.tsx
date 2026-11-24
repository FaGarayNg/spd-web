import { useEffect, useRef, useState, type PointerEvent } from "react"
import type { CanvasPoint, CanvasStroke } from "../../types"
import { Icon } from "../ui/Icon"

type Props = {
  slide: number
  total: number
  /** Imagen de la diapositiva actual (ruta del servicio presentations vía gateway). */
  url: string
  canControl: boolean
  /** Trazos ya dibujados, compartidos por el servidor. */
  annotations: CanvasStroke[]
  onAnnotation: (stroke: CanvasStroke) => void
  onClear: () => void
  onPrev: () => void
  onNext: () => void
  /** Ocupa todo el alto disponible: visor móvil y pantalla completa. */
  fill?: boolean
}

const COLORS = [
  { name: "Azul", value: "#1B3A6B" },
  { name: "Dorado", value: "#C9A227" },
  { name: "Rojo", value: "#C62828" },
  { name: "Negro", value: "#1A2233" },
]
const W = 1280
const H = 720
const tool = "flex h-10 w-10 items-center justify-center rounded-md text-brand-700 hover:bg-brand-50 sm:h-9 sm:w-9"

type CanvasBox = { left: number; top: number; width: number; height: number }

function drawStroke(c: CanvasRenderingContext2D, stroke: CanvasStroke) {
  if (stroke.points.length === 0) return
  c.save()
  c.globalCompositeOperation = stroke.eraser ? "destination-out" : "source-over"
  c.strokeStyle = stroke.color
  c.lineWidth = stroke.width
  c.lineCap = "round"
  c.lineJoin = "round"
  c.beginPath()
  c.moveTo(stroke.points[0].x, stroke.points[0].y)
  if (stroke.points.length === 1) c.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y)
  else for (const p of stroke.points.slice(1)) c.lineTo(p.x, p.y)
  c.stroke()
  c.restore()
}

export function SlideStage({
  slide, total, url, canControl, annotations, onAnnotation, onClear, onPrev, onNext, fill = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const drawing = useRef(false)
  const current = useRef<CanvasStroke | null>(null)
  const lastSent = useRef(0)
  const [eraser, setEraser] = useState(false)
  const [color, setColor] = useState(COLORS[0].value)
  const [broken, setBroken] = useState(false)
  // Tamaño natural de la imagen y rectángulo donde se está mostrando (object-contain).
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [canvasBox, setCanvasBox] = useState<CanvasBox | null>(null)

  const ctx = () => canvasRef.current?.getContext("2d") ?? null
  const clearCanvas = () => ctx()?.clearRect(0, 0, W, H)

  // Cambio de diapositiva: el servidor limpia los trazos y acá reiniciamos el dibujo local.
  // Va antes del efecto que pinta para que, cuando llegue el primer estado (url + trazos
  // juntos), el repintado gane y los trazos iniciales no se borren.
  useEffect(() => {
    drawing.current = false
    current.current = null
    setBroken(false)
    setImageSize({ width: 0, height: 0 })
    setCanvasBox(null)
  }, [url])

  // Todos pintan los trazos que llegan del Hub, también quien tiene controles: el anfitrión y
  // el presentador de turno deben verse entre sí. Si hay un trazo local en curso se dibuja
  // encima después del repintado para que no se pierda mientras se está dibujando.
  useEffect(() => {
    const c = ctx()
    if (!c) return
    clearCanvas()
    annotations.forEach((stroke) => drawStroke(c, stroke))
    if (current.current) drawStroke(c, current.current)
  }, [annotations, url])

  // El canvas tiene que cubrir exactamente la imagen (object-contain), no todo el stage:
  // en vertical el contenedor es más alto que la diapositiva y los trazos quedarían
  // desfasados. El tamaño interno sigue siendo 1280x720; solo cambia el tamaño en pantalla.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const naturalWidth = imageSize.width || W
    const naturalHeight = imageSize.height || H
    const fit = () => {
      const width = stage.clientWidth
      const height = stage.clientHeight
      if (!width || !height) return
      const scale = Math.min(width / naturalWidth, height / naturalHeight)
      const boxWidth = naturalWidth * scale
      const boxHeight = naturalHeight * scale
      setCanvasBox({
        left: (width - boxWidth) / 2,
        top: (height - boxHeight) / 2,
        width: boxWidth,
        height: boxHeight,
      })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [url, imageSize.width, imageSize.height])

  // Pre-carga de la siguiente diapositiva: las imágenes son cacheables (immutable), así que el
  // fetch posterior sale del caché y el cambio es instantáneo.
  useEffect(() => {
    if (slide < total) {
      const next = new Image()
      next.src = url.replace(/(\/slides\/)\d+$/, `$1${slide + 1}`)
    }
  }, [url, slide, total])

  const point = (e: PointerEvent<HTMLCanvasElement>): CanvasPoint => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }
  }

  const start = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = ctx()
    if (!canControl || !c) return
    drawing.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    const stroke: CanvasStroke = {
      id: crypto.randomUUID(), color, width: eraser ? 28 : 5, eraser, points: [point(e)],
    }
    current.current = stroke
    drawStroke(c, stroke)
    onAnnotation(stroke)
  }

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !current.current) return
    const c = ctx()
    if (!c) return
    const stroke = current.current
    stroke.points.push(point(e))
    // Se repinta el trazo completo para que el local coincida con el estado compartido.
    drawStroke(c, stroke)
    const now = Date.now()
    if (now - lastSent.current >= 50) {
      onAnnotation({ ...stroke, points: [...stroke.points] })
      lastSent.current = now
    }
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    const stroke = current.current
    current.current = null
    if (stroke) onAnnotation({ ...stroke, points: [...stroke.points] })
  }

  const clear = () => {
    clearCanvas()
    onClear()
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 sm:gap-4">
      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden rounded-lg border border-border bg-surface ${
          fill
            ? "min-h-0 flex-1"
            : "aspect-video max-sm:aspect-auto max-sm:min-h-0 max-sm:flex-1"
        }`}
      >
        {url ? (
          broken ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <Icon name="file" size={32} />
              <strong className="text-brand-700">No se pudo cargar esta diapositiva</strong>
              <small className="text-ink/60">El archivo quizás no está más disponible; verificá que la sesión siga activa.</small>
            </div>
          ) : (
            <img
              src={url}
              alt={`Diapositiva ${slide} de ${total}`}
              className="h-full w-full object-contain"
              onLoad={(event) => {
                const image = event.currentTarget
                setImageSize({ width: image.naturalWidth, height: image.naturalHeight })
              }}
              onError={() => setBroken(true)}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-ink/60">Cargando diapositiva…</div>
        )}
        <canvas ref={canvasRef} width={W} height={H}
          style={canvasBox ?? { visibility: "hidden" }}
          className={`absolute touch-none ${canControl ? "cursor-crosshair" : "pointer-events-none"}`}
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
      </div>
      {canControl && (
        <div className="flex shrink-0 items-center justify-center gap-4">
          <button aria-label="Diapositiva anterior" disabled={slide <= 1} onClick={() => { clear(); onPrev() }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-700 text-white hover:bg-brand-900 disabled:opacity-40 sm:h-10 sm:w-10">
            <Icon name="arrowLeft" />
          </button>
          <span className={`min-w-16 text-center text-sm font-semibold ${fill ? "text-white/70" : "text-ink/60 sm:hidden"}`}>
            {slide} / {total}
          </span>
          <button aria-label="Diapositiva siguiente" disabled={slide >= total} onClick={() => { clear(); onNext() }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-700 text-white hover:bg-brand-900 disabled:opacity-40 sm:h-10 sm:w-10">
            <Icon name="arrowRight" />
          </button>
        </div>
      )}
      {canControl && (
        <div className="flex w-full shrink-0 flex-wrap items-center justify-center gap-1 rounded-lg border border-border bg-surface p-2 sm:mx-auto sm:w-auto">
          <button aria-label="Pincel" aria-pressed={!eraser} className={`${tool} ${!eraser ? "bg-brand-50" : ""}`} onClick={() => setEraser(false)}><Icon name="brush" /></button>
          <button aria-label="Borrador" aria-pressed={eraser} className={`${tool} ${eraser ? "bg-brand-50" : ""}`} onClick={() => setEraser(true)}><Icon name="eraser" /></button>
          <span className="mx-1 h-6 w-px bg-border" />
          {COLORS.map((item) => (
            <button key={item.value} aria-label={`Color ${item.name}`} aria-pressed={color === item.value}
              onClick={() => { setColor(item.value); setEraser(false) }}
              className={`flex h-10 w-10 items-center justify-center rounded-md hover:bg-brand-50 sm:h-9 sm:w-9 ${color === item.value && !eraser ? "bg-brand-50" : ""}`}>
              <span className="h-5 w-5 rounded-full border border-border" style={{ background: item.value }} />
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-border" />
          <button aria-label="Borrar todo" className={tool} onClick={clear}><Icon name="reset" /></button>
        </div>
      )}
    </div>
  )
}

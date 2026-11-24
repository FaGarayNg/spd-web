import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Button } from "../ui/Button"
import { Icon, type IconName } from "../ui/Icon"

type Item = { key: string; label: string; badge: string }
type Props = { items: Item[]; onStart: (orderedKeys: string[]) => void }
type OrderMode = "ordered" | "random"

const ROUNDS = 6 // vueltas del sorteo
const ROUND_MS = 380

function shuffle<T>(values: T[]) {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// TODO: el resultado del sorteo todavía no se guarda en el back (haría falta actualizar la
// prioridad de cada grupo); hoy vale para la pantalla de esta sesión.
export function PrepareRoom({ items, onStart }: Props) {
  const [orderMode, setOrderMode] = useState<OrderMode>("ordered")
  const [order, setOrder] = useState<Item[]>(items)
  const [drawing, setDrawing] = useState(false)
  const rows = useRef(new Map<string, HTMLLIElement>())
  const tops = useRef(new Map<string, number>())
  const timers = useRef<number[]>([])

  // Si la lista de afuera cambia (alguien se suma), se conserva el orden actual y se agregan los nuevos.
  const itemKeys = items.map((item) => item.key).join(",")
  useEffect(() => {
    setOrder((previous) => {
      const byKey = new Map(items.map((item) => [item.key, item]))
      const kept = previous.filter((item) => byKey.has(item.key)).map((item) => byKey.get(item.key)!)
      const added = items.filter((item) => !previous.some((other) => other.key === item.key))
      return [...kept, ...added]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKeys])

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), [])

  // Cada vez que cambia el orden, las filas se deslizan desde donde estaban hasta su lugar nuevo.
  useLayoutEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    rows.current.forEach((row) => row.getAnimations().forEach((animation) => animation.cancel()))
    rows.current.forEach((row, key) => {
      const top = row.getBoundingClientRect().top
      const before = tops.current.get(key)
      if (!reduceMotion && before !== undefined && before !== top) {
        row.animate(
          [{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }],
          { duration: ROUND_MS - 40, easing: "ease-in-out" },
        )
      }
      tops.current.set(key, top)
    })
  }, [order])

  const draw = () => {
    if (drawing) return
    setDrawing(true)
    for (let step = 1; step <= ROUNDS; step++) {
      timers.current.push(
        window.setTimeout(() => {
          setOrder((current) => shuffle(current))
          if (step === ROUNDS) setDrawing(false)
        }, step * ROUND_MS),
      )
    }
  }

  const options: { mode: OrderMode; icon: IconName; title: string; text: string }[] = [
    { mode: "ordered", icon: "list", title: "En orden", text: "Como figuran en la lista" },
    { mode: "random", icon: "dice", title: "Al azar", text: "Que decida la suerte" },
  ]

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-brand-700">Orden de presentación</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <button key={option.mode} aria-pressed={orderMode === option.mode} disabled={drawing}
            onClick={() => {
              setOrderMode(option.mode)
              if (option.mode === "ordered") setOrder(items)
            }}
            className={`flex items-center gap-3 rounded-lg border p-4 text-left disabled:opacity-60 ${
              orderMode === option.mode ? "border-brand-700 bg-brand-50" : "border-border hover:border-brand-500"
            }`}>
            <Icon name={option.icon} />
            <span>
              <strong className="block text-brand-700">{option.title}</strong>
              <small className="text-ink/60">{option.text}</small>
            </span>
          </button>
        ))}
      </div>
      <ol className="flex flex-col gap-2" aria-label="Orden de presentación">
        {order.map((item, index) => (
          <li key={item.key} className="flex items-center gap-3 rounded-md bg-surface-muted p-3 text-sm"
            ref={(element) => {
              if (element) rows.current.set(item.key, element)
              else rows.current.delete(item.key)
            }}>
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-700 text-xs font-semibold text-white">
              {item.badge}
            </span>
            <strong className="flex-1">{item.label}</strong>
            {index === 0 && <small className="font-semibold text-brand-700">Empieza</small>}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        {orderMode === "random" && (
          <Button variant="secondary" icon="dice" onClick={draw} disabled={drawing}>
            {drawing ? "Sorteando…" : "Sortear"}
          </Button>
        )}
        <Button variant="accent" icon="play" onClick={() => onStart(order.map((item) => item.key))} disabled={drawing}>Iniciar presentaciones</Button>
      </div>
    </div>
  )
}

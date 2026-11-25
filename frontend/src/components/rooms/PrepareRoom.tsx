import { useState } from "react"
import { Button } from "../ui/Button"
import { Icon, type IconName } from "../ui/Icon"

type Item = { key: string; label: string; badge: string }
type OrderMode = "ordered" | "random"

type Props = {
  /** Ya vienen en el orden que debe ver la sala. */
  items: Item[]
  onOrderChange: (orderedKeys: string[], mode: OrderMode) => void
  onStart: (orderedKeys: string[]) => void
}

function shuffle<T>(values: T[]) {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// El orden ya no se muestra acá: se aplica directamente a la lista de integrantes/grupos de la
// sala, que es la que todos ven. Este panel solo elige "En orden" o "Al azar" y da el inicio.
export function PrepareRoom({ items, onOrderChange, onStart }: Props) {
  const [orderMode, setOrderMode] = useState<OrderMode>("ordered")
  const keys = items.map((item) => item.key)

  const draw = () => onOrderChange(shuffle(keys), "random")

  const options: { mode: OrderMode; icon: IconName; title: string; text: string }[] = [
    { mode: "ordered", icon: "list", title: "En orden", text: "Como figuran en la lista" },
    { mode: "random", icon: "dice", title: "Al azar", text: "Que decida la suerte" },
  ]

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-brand-700">Orden de presentación</h2>
      <p className="text-sm text-ink/60">
        Elegí cómo se ordenan los {items.length} {items.length === 1 ? "turnos" : "turnos"} en la sala.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <button key={option.mode} aria-pressed={orderMode === option.mode}
            onClick={() => {
              setOrderMode(option.mode)
              // Elegir el modo no sortea: "Al azar" solo habilita el botón Sortear.
              // "En orden" vuelve al orden natural de la sala.
              onOrderChange(keys, option.mode)
            }}
            className={`flex items-center gap-3 rounded-lg border p-4 text-left ${
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
      <div className="flex flex-wrap gap-3">
        {orderMode === "random" && (
          <Button variant="secondary" icon="dice" onClick={draw}>Sortear</Button>
        )}
        <Button variant="accent" icon="play" onClick={() => onStart(keys)}>Iniciar presentaciones</Button>
      </div>
    </div>
  )
}

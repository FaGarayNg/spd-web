import { useLayoutEffect, useRef } from "react"

// Animación FLIP: al cambiar el orden, cada fila se desliza desde donde estaba hasta su lugar
// nuevo. Se usa sobre la lista real de la sala, no sobre una lista interna del sorteo.
export function useFlip(orderKey: string) {
  const nodes = useRef(new Map<string, HTMLElement>())
  const previous = useRef(new Map<string, DOMRect>())

  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>()
    nodes.current.forEach((element, key) => {
      const rect = element.getBoundingClientRect()
      const before = previous.current.get(key)
      if (before && (Math.abs(before.top - rect.top) > 1 || Math.abs(before.left - rect.left) > 1)) {
        element.animate(
          [
            { transform: `translate(${before.left - rect.left}px, ${before.top - rect.top}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 400, easing: "ease-in-out" },
        )
      }
      next.set(key, rect)
    })
    previous.current = next
  }, [orderKey])

  return (key: string) => (element: HTMLElement | null) => {
    if (element) nodes.current.set(key, element)
    else nodes.current.delete(key)
  }
}

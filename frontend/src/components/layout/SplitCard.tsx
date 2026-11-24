import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { Icon } from "../ui/Icon"

type Props = {
  title: string
  /** Texto del panel izquierdo; admite contenido enriquecido (negritas, enlaces). */
  text: ReactNode
  /** Enlace de "volver" que se muestra arriba del formulario. */
  back?: { to: string; label: string }
  children: ReactNode
}

export function SplitCard({ title, text, back, children }: Props) {
  return (
    <section className="grid overflow-hidden rounded-lg border border-border bg-surface md:grid-cols-2">
      <div className="bg-brand-900 p-6 text-white sm:p-10">
        <div className="h-1 w-12 bg-accent" />
        <h1 className="mt-5 text-2xl font-semibold leading-tight sm:mt-6 sm:text-3xl">{title}</h1>
        <p className="mt-3 max-w-sm text-brand-50/80 sm:mt-4">{text}</p>
      </div>
      <div className="p-6 sm:p-10">
        {back && (
          <Link to={back.to} className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-500 hover:underline">
            <Icon name="arrowLeft" size={16} />
            {back.label}
          </Link>
        )}
        {children}
      </div>
    </section>
  )
}

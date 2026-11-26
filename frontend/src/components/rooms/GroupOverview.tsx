import type { ApiPresentation, Group } from "../../types"
import { initials } from "../../utils/initials"

type Props = {
  groups: Group[]
  /** Presentación asignada a cada grupo, para ver quién ya está listo para exponer. */
  assignments: Record<number, ApiPresentation | null>
  registerItem?: (key: string) => (element: HTMLElement | null) => void
}

// Vista del anfitrión: ve la grilla armada y quién está en cada grupo. No puede unirse ni cargar.
// Si un grupo se queda sin integrantes, el backend quita su presentación automáticamente.
export function GroupOverview({ groups, assignments, registerItem }: Props) {
  if (groups.length === 0) {
    return <p className="text-sm text-ink/60">Todavía no armaste ningún grupo.</p>
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {groups.map((group) => {
        const assigned = assignments[group.id]
        return (
        <article key={group.id} ref={registerItem?.(String(group.id))} className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-sm text-brand-700">Grupo {String(group.priority).padStart(2, "0")}</strong>
            <small className="text-ink/60">{group.members.length}/{group.limit}</small>
          </div>
          {assigned ? (
            <span className="self-start rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
              Listo · {assigned.slides.length} diapositivas
            </span>
          ) : (
            <span className="text-xs text-ink/60">Sin presentación cargada</span>
          )}
          {group.members.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {group.members.map((member) => (
                <li key={member.id} className="flex items-center gap-2 text-sm text-ink/70">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700">
                    {initials(member.fullName)}
                  </span>
                  <span className="truncate">{member.fullName}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink/60">Sin integrantes todavía.</p>
          )}
        </article>
        )
      })}
    </div>
  )
}

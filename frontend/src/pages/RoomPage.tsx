import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { GroupCard } from "../components/rooms/GroupCard"
import { ModeCard } from "../components/rooms/ModeCard"
import { OwnPresentation } from "../components/rooms/OwnPresentation"
import { PrepareRoom } from "../components/rooms/PrepareRoom"
import { RoomHeader } from "../components/rooms/RoomHeader"
import { SetupGroups } from "../components/rooms/SetupGroups"
import { Button } from "../components/ui/Button"
import { SlideGallery } from "../components/rooms/SlideGallery"
import { useSession } from "../context/SessionContext"
import {
  assignGroupPresentation,
  createGroup,
  getGroupPresentations,
  getLiveSession,
  getRoom,
  getRoomGroups,
  getRoomMembers,
  joinGroup,
  leaveGroup,
  setLiveSession,
  unassignGroupPresentation,
  updateRoom,
} from "../services/rooms"
import { uploadPresentation } from "../services/live"
import { ApiError } from "../services/http"
import type { ApiPresentation, Group, LiveSession, Member, Role, Room } from "../types"
import { getRoomKey } from "../utils/accessKey"
import { initials } from "../utils/initials"

type Format = "group" | "individual"

export default function RoomPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const { session } = useSession()

  const [room, setRoom] = useState<Room | null | undefined>(undefined)
  const [members, setMembers] = useState<Member[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [mode, setMode] = useState<"own" | "watch">("watch")
  const [format, setFormat] = useState<Format>("group")
  const [settingUp, setSettingUp] = useState(false)
  const [notice, setNotice] = useState("")
  const [presentationId, setPresentationId] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [attempt, setAttempt] = useState(0)
  // Presentaciones asignadas: groupId → asignación (o null si no tiene).
  const [assignments, setAssignments] = useState<Record<number, ApiPresentation | null>>({})
  const [uploadingGroupId, setUploadingGroupId] = useState<number | null>(null)
  const [viewing, setViewing] = useState<{ presentationId: string; label: string } | null>(null)
  // Sesión en vivo de la sala (la publica el anfitrión): null mientras no haya ninguna.
  const [live, setLive] = useState<LiveSession | null>(null)

  // La sala existe y sus integrantes son de solo lectura: se cargan al entrar.
  useEffect(() => {
    let active = true
    setRoom(undefined)
    setGroups([])
    setNotice("")
    setLoadError("")
    getRoom(id)
      .then((result) => {
        if (!active) return
        setRoom(result)
        return getRoomMembers(result.id)
      })
      .then((roomMembers) => {
        if (active && roomMembers) setMembers(roomMembers)
      })
      .catch((err: unknown) => {
        if (!active) return
        // 404: la sala no existe. Cualquier otro error (servidor caído, red) se puede reintentar.
        if (err instanceof ApiError && err.status === 404) setRoom(null)
        else setLoadError(err instanceof Error ? err.message : "No se pudo cargar la sala.")
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt])

  // El estado de la sala se refresca solo cada tanto: así los cambios del anfitrión (formato
  // confirmado, grupos creados, presentaciones asignadas) y de los demás (miembros nuevos)
  // aparecen en vivo, sin recargar la página. Un fallo puntual se corrige con el siguiente
  // intento; la sala borrada en el medio avisa y saca al visitante.
  useEffect(() => {
    if (room == null) return
    let active = true
    const refresh = () => {
      getRoom(room.id)
        .then((updated) => {
          if (active) setRoom(updated)
        })
        .catch((err: unknown) => {
          if (active && err instanceof ApiError && err.status === 404) setRoom(null)
        })
      getRoomMembers(room.id)
        .then((roomMembers) => {
          if (active) setMembers(roomMembers)
        })
        .catch(() => undefined)
      getRoomGroups(room.id, session?.userId ?? null)
        .then((result) => {
          if (!active) return
          setGroups(result)
          return loadAssignments(result)
        })
        .catch(() => undefined)
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh()
    }, 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, session?.userId])

  // El formato confirmado en el back es la verdad compartida: si el anfitrión lo confirma (o
  // cambia), la vista de todos se alinea. El "group" local es el nombre del tab del setup.
  useEffect(() => {
    if (room?.format === "groups") setFormat("group")
    else if (room?.format === "individual") setFormat("individual")
  }, [room?.format])

  // La sesión en vivo se consulta cada tanto: así, cuando el anfitrión lanza una presentación,
  // los invitados la ven aparecer (y desaparecer si la finaliza) sin recargar la página.
  useEffect(() => {
    if (room == null) return
    let active = true
    const check = () => {
      getLiveSession(room.id)
        .then((result) => {
          if (active) setLive(result)
        })
        .catch(() => undefined) // un fallo puntual se corrige con el siguiente intento
    }
    check()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") check()
    }, 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [room])

  // Se cargan los grupos que ya existan: así, si el anfitrión vuelve a entrar, no se crean de nuevo.
  useEffect(() => {
    if (room == null) return
    let active = true
    getRoomGroups(room.id, session?.userId ?? null)
      .then((result) => {
        if (!active) return
        setGroups(result)
        return loadAssignments(result)
      })
      .catch(() => setNotice("No se pudieron cargar los grupos de la sala."))
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id])

  const reloadGroups = () => {
    if (!room) return
    getRoomGroups(room.id, session?.userId ?? null)
      .then((result) => {
        setGroups(result)
        return loadAssignments(result)
      })
      .catch(() => setNotice("No se pudieron recargar los grupos."))
  }

  // Qué presentación tiene cada grupo (una llamada por grupo; se muestra la primera asignada).
  const loadAssignments = (groupsList: Group[]) => {
    const requests = groupsList.map(async (group) => {
      const list = await getGroupPresentations(group.id).catch(() => [])
      return [group.id, list[0] ?? null] as const
    })
    return Promise.all(requests).then((entries) => {
      setAssignments(Object.fromEntries(entries) as Record<number, ApiPresentation | null>)
    })
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="rounded-lg bg-brand-50 p-4 text-sm font-medium text-brand-700">{loadError}</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Reintentar</Button>
      </div>
    )
  }
  if (room === undefined) return <p className="text-ink/60">Cargando sala…</p>
  if (room === null) {
    return (
      <p className="text-ink/70">
        No encontramos esa sala.{" "}
        <Link to="/salas" className="font-semibold text-brand-500 hover:underline">Volver a mis salas</Link>
      </p>
    )
  }

  // El anfitrión es el dueño de la sala (la crea con sesión iniciada y el back le guarda el
  // owner_id): ya no viaja el rol por la navegación, lo decide el backend. Salas sin dueño
  // (anteriores al login) o sesión de invitado: todos espectadores.
  const isHost = session?.userId !== undefined && room.ownerId === session.userId
  const role: Role = isHost ? "host" : "guest"
  // La sala está armada cuando el anfitrión confirmó un formato, o cuando ya tiene grupos (las
  // salas de antes del login no guardaban formato). Lo decide el backend, así lo ven todos igual.
  const configured = room.format !== "" || groups.length > 0
  const activeMode = isHost ? mode : "watch"
  const showList = !isHost || configured
  const startLive = (livePresentationId: string | null) =>
    navigate(`/salas/${room.id}/en-vivo`, { state: { role, presentationId: livePresentationId } })
  // "En sala" son las personas de la sala, no la suma de los grupos (así nadie se cuenta dos veces).
  const inRoom = members.length
  const inAnyGroup = groups.some((g) => g.members.some((m) => m.joined))

  // Lanzar en vivo es publicar la sesión (PUT live-session) y entrar a la pantalla de proyección.
  // Si el lanzamiento falla, avisamos y no navegamos: la sala quedaría sin sesión publicada.
  const launch = (livePresentationId: string) => {
    if (!room) return
    setLiveSession(room.id, livePresentationId)
      .then((session) => {
        setLive(session)
        startLive(livePresentationId)
      })
      .catch((err: unknown) =>
        setNotice(err instanceof Error ? err.message : "No se pudo lanzar la presentación en vivo."),
      )
  }

  // El anfitrión arma (n × POST /api/rooms/:id/groups) la grilla real de grupos de la sala y
  // confirma el formato: el PATCH deja el cambio en el back, y el polling lo refleja en la
  // pantalla de todos.
  const confirmGroups = (count: number, limit: number) => {
    setSettingUp(true)
    setNotice("")
    const creates = Array.from({ length: count }, (_, index) =>
      createGroup(room.id, { limit, priority: index + 1 }),
    )
    Promise.all(creates)
      .then(() => updateRoom(room.id, { format: "groups" }))
      .then((updated) => setRoom(updated))
      .then(() => reloadGroups())
      .catch((err: unknown) =>
        setNotice(err instanceof Error ? err.message : "No se pudieron crear los grupos."),
      )
      .finally(() => setSettingUp(false))
  }

  // Confirmar el formato individual también queda en el back: los invitados lo ven al momento.
  const confirmIndividual = () => {
    setNotice("")
    updateRoom(room.id, { format: "individual" })
      .then((updated) => setRoom(updated))
      .catch((err: unknown) =>
        setNotice(err instanceof Error ? err.message : "No se pudo confirmar el formato."),
      )
  }

  // Integrarse a un grupo hace POST /api/groups/:id/members con el userId de la sesión; si no
  // hay sesión con usuario real, no se puede (y así lo decimos).
  const toggleGroup = (group: Group) => {
    const userId = session?.userId
    if (userId === undefined || !room) {
      setNotice("Para unirte a un grupo registrate o entrá como invitado con la clave de la sala. Iniciar sesión todavía no está disponible en el servidor.")
      return
    }
    setNotice("")
    const isMember = group.members.some((m) => m.joined)
    // Una persona solo puede estar en un grupo a la vez.
    const current = groups.find((g) => g.members.some((m) => m.joined))
    if (!isMember && current) {
      setNotice(`Ya estás en el Grupo ${String(current.priority).padStart(2, "0")}. Abandonalo para unirte a otro.`)
      return
    }
    const change = isMember ? leaveGroup(group.id, userId) : joinGroup(group.id, userId)
    change
      .then(reloadGroups)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 409) setNotice(err.message)
        else setNotice("No se pudo cambiar de grupo. Volvé a intentar.")
      })
  }

  // Sube el archivo del grupo a presentations y lo asigna al grupo (asignación única: 409 si
  // el back ya la tiene en otro grupo). Los mensajes de error los muestra la propia tarjeta.
  const handleUpload = async (group: Group, file: File) => {
    setUploadingGroupId(group.id)
    try {
      const detail = await uploadPresentation(file)
      await assignGroupPresentation(group.id, detail.presentation_id)
      await loadAssignments(groups)
    } finally {
      setUploadingGroupId(null)
    }
  }

  // Desasignar no borra la presentación del servicio presentations: solo la desvincula del grupo.
  const handleUnassign = async (group: Group) => {
    const assigned = assignments[group.id]
    if (!assigned) return
    await unassignGroupPresentation(group.id, assigned.presentation_id)
    setAssignments((current) => ({ ...current, [group.id]: null }))
  }

  const handleView = (group: Group) => {
    const assigned = assignments[group.id]
    if (assigned) setViewing({ presentationId: assigned.presentation_id, label: `Grupo ${String(group.priority).padStart(2, "0")}` })
  }

  return (
    <div className="flex flex-col gap-8">
      <RoomHeader roomId={room.id} title={room.name} accessKey={getRoomKey(room.id)} members={members.length} />

      {notice && (
        <p role="alert" className="rounded-lg bg-brand-50 p-4 text-sm font-medium text-brand-700">
          {notice}
        </p>
      )}

      {isHost && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-brand-700">Modo de presentación</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <ModeCard active={mode === "own"} icon="file" title="Presentación propia" text="Exponé tu archivo" onClick={() => setMode("own")} />
            <ModeCard active={mode === "watch"} icon="people" title="Ver presentaciones" text="Organizá a tu clase" onClick={() => setMode("watch")} />
          </div>
        </section>
      )}

      {activeMode === "own" ? (
        <OwnPresentation
          onUploaded={setPresentationId}
          onStart={() => presentationId && launch(presentationId)}
        />
      ) : (
        <>
          {isHost && !configured && (
            <section className="flex flex-col gap-4">
              <div className="flex gap-6 border-b border-border" role="tablist">
                {(["individual", "group"] as const).map((item) => (
                  <button key={item} role="tab" aria-selected={format === item} onClick={() => setFormat(item)}
                    className={`-mb-px border-b-2 px-1 pb-3 text-sm font-semibold ${
                      format === item ? "border-accent text-brand-700" : "border-transparent text-ink/60 hover:text-brand-700"
                    }`}>
                    {item === "group" ? "En grupo" : "Individual"}
                  </button>
                ))}
              </div>
              {format === "group" ? (
                <SetupGroups onConfirm={confirmGroups} busy={settingUp} />
              ) : (
                <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
                  <h2 className="text-lg font-semibold text-brand-700">Formato individual</h2>
                  <p className="text-ink/70">
                    Cada participante carga su archivo y presenta. {members.length} {members.length === 1 ? "persona" : "personas"} en la sala.
                  </p>
                  <Button icon="check" className="self-start" onClick={confirmIndividual}>Activar formato individual</Button>
                </div>
              )}
            </section>
          )}

          {showList && (
            <section className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-brand-700">
                  {format === "group" ? `${groups.length} grupos: elegí tu equipo` : `Personas en la sala (${members.length})`}
                </h2>
                <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">{inRoom} en sala</span>
              </div>
              {format === "group" ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {groups.map((group) => (
                    <GroupCard
                      key={group.id}
                      group={group}
                      blocked={inAnyGroup && !group.members.some((m) => m.joined)}
                      presentation={assignments[group.id] ?? null}
                      uploading={uploadingGroupId === group.id}
                      canManage={isHost}
                      onToggle={() => toggleGroup(group)}
                      onUpload={(file) => handleUpload(group, file)}
                      onUnassign={() => handleUnassign(group)}
                      onView={() => handleView(group)}
                      canPresent={isHost}
                      onPresent={assignments[group.id] ? () => launch(assignments[group.id]!.presentation_id) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {members.map((person, index) => (
                    <li key={person.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{initials(person.fullName)}</span>
                      <strong className="flex-1 text-sm">{person.fullName}</strong>
                      <small className="text-ink/60">{index === 0 ? "Listo para presentar" : "En espera"}</small>
                    </li>
                  ))}
                </ul>
              )}
              {isHost && !preparing && <Button icon="sparkles" className="self-start" onClick={() => setPreparing(true)}>Preparar sala</Button>}
              {isHost && preparing && (
                <PrepareRoom
                  items={
                    format === "individual"
                      ? members.map((m) => ({ key: String(m.id), label: m.fullName, badge: initials(m.fullName) }))
                      : groups.map((g) => ({
                          key: String(g.id),
                          label: `Grupo ${String(g.priority).padStart(2, "0")}`,
                          badge: `G${g.priority}`,
                        }))
                  }
                  onStart={() => {
                    // El primer turno es el primer grupo con presentación asignada.
                    const first = groups.find((g) => assignments[g.id])
                    if (first) launch(assignments[first.id]!.presentation_id)
                    else setNotice("Todavía no hay presentaciones asignadas: cargá el archivo desde la tarjeta de un grupo.")
                  }}
                />
              )}
              {!isHost && (
                <div className="flex flex-col gap-3 rounded-lg bg-brand-50 p-4 text-sm text-brand-700">
                  {live ? (
                    <>
                      <p>
                        <strong>El anfitrión está presentando.</strong> Podés entrar a verlo en tiempo real.
                      </p>
                      <Button icon="play" className="self-start" onClick={() => startLive(live.presentationId)}>
                        Entrar a la presentación
                      </Button>
                    </>
                  ) : (
                    <>
                      <p><strong>Ya estás dentro.</strong> El anfitrión te va a avisar cuando sea momento de comenzar.</p>
                      <Button icon="play" className="self-start" disabled>Esperando al anfitrión…</Button>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {viewing && (
        <SlideGallery presentationId={viewing.presentationId} label={viewing.label} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}

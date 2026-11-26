import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { SlideStage } from "../components/live/SlideStage"
import { Button } from "../components/ui/Button"
import { Icon } from "../components/ui/Icon"
import { controlPresentation, connectPresentationSocket, type ControlCommand, type LiveSocket } from "../services/live"
import { clearLiveSession, getGroupPresentations, getLiveSession, getRoom, getRoomGroups, getRoomMembers, getUserPresentations, setLiveSession } from "../services/rooms"
import { useSession } from "../context/SessionContext"
import type { ApiError } from "../services/http"
import type { ApiPresentation, ApiSlideState, CanvasStroke, Role, UserPresentation } from "../types"

type LiveKind = "group" | "individual" | "own"

type LocationState = {
  role?: Role
  presentationId?: string
  order?: string[]
  kind?: LiveKind
  groupId?: number
}

type SavedLive = { ids: string[]; kind?: LiveKind; groupId?: number }

// La API de orientación no está en todos los navegadores (iOS Safari no la expone). Se usa
// con guardas y, si falla, la presentación sigue funcionando igual.
type LockableOrientation = {
  lock?: (orientation: "landscape" | "portrait" | "any") => Promise<void>
  unlock?: () => void
}

function orientationApi(): LockableOrientation | undefined {
  if (typeof screen === "undefined") return undefined
  return screen.orientation as unknown as LockableOrientation | undefined
}

async function lockLandscape() {
  const orientation = orientationApi()
  if (!orientation?.lock) return
  try {
    await orientation.lock("landscape")
  } catch {
    // Requiere pantalla completa o no está permitido: se ignora.
  }
}

function unlockOrientation() {
  try {
    orientationApi()?.unlock?.()
  } catch {
    // Sin soporte: no hay nada que liberar.
  }
}

export default function LivePage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const { session } = useSession()
  const state = (useLocation().state as LocationState | null) ?? {}

  // El vivo tampoco se puede ver sin sesión; al iniciar se vuelve a esta pantalla.
  useEffect(() => {
    if (session?.token === undefined) {
      navigate("/login", { state: { from: `/salas/${id}/en-vivo` }, replace: true })
    }
  }, [session?.token, id, navigate])

  // Si el anfitrión expulsa al usuario mientras está en el vivo, lo devolvemos al inicio.
  useEffect(() => {
    if (session?.userId === undefined) return
    let active = true
    const check = () => {
      getRoomMembers(Number(id))
        .then((list) => {
          if (!active || list.some((member) => member.id === session.userId)) return
          return getRoom(id).then((room) => {
            if (active && room.ownerId !== session.userId) {
              navigate("/salas", { state: { notice: "Fuiste quitado de la sala." }, replace: true })
            }
          })
        })
        .catch(() => undefined)
    }
    check()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") check()
    }, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [id, session?.userId, navigate])

  // Orden y grupo viajan en la navegación; se guardan para sobrevivir una recarga.
  const saved = (() => {
    try {
      const raw = sessionStorage.getItem(`spd.order.${id}`)
      if (!raw) return null
      const parsed = JSON.parse(raw) as SavedLive | string[]
      return Array.isArray(parsed) ? { ids: parsed } : parsed
    } catch {
      return null
    }
  })()
  const order = state.order ?? saved?.ids ?? []
  const kind = state.kind ?? saved?.kind ?? "individual"
  const [currentGroupId, setCurrentGroupId] = useState(state.groupId ?? saved?.groupId)
  const [currentGroupLabel, setCurrentGroupLabel] = useState<string>()
  const [currentGroupMembers, setCurrentGroupMembers] = useState<number[]>([])
  const [groupPresentations, setGroupPresentations] = useState<(ApiPresentation | null)[]>([])
  const isGroupMode = kind === "group" && currentGroupId !== undefined

  // El anfitrión es el dueño de la sala (owner_id en el back); el rol de la navegación solo
  // vale mientras llega la respuesta de la sala.
  const [isHost, setIsHost] = useState((state.role ?? "guest") === "host")
  useEffect(() => {
    let active = true
    getRoom(id)
      .then((room) => {
        if (active) setIsHost(session?.userId !== undefined && room.ownerId === session.userId)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [id, session?.userId])

  // La presentación que se proyecta es estado: el espectador la sigue consultando la sesión
  // publicada de la sala (si el anfitrión pasa al grupo siguiente, cambia sola).
  const [presentationId, setPresentationId] = useState<string | null>(state.presentationId ?? null)
  const [watching, setWatching] = useState(false) // alguna vez hubo imagen en pantalla
  // En formato individual, la presentación en vivo pertenece a un participante: es quien debe
  // poder avanzar diapositivas y dibujar, además del anfitrión.
  const [presenterId, setPresenterId] = useState<number | undefined>()
  const [roomPresentations, setRoomPresentations] = useState<UserPresentation[]>([])

  const [sessionState, setSessionState] = useState<ApiSlideState | null>(null)
  const [connection, setConnection] = useState<"connecting" | "live" | "ended" | "error">("connecting")
  const [error, setError] = useState("")
  const [isFullscreen, setIsFullscreen] = useState(false)
  // El contenedor que pasa a pantalla completa: incluye la diapositiva, las flechas y el
  // panel de dibujo, así los controles siguen disponibles.
  const presentationRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<LiveSocket | null>(null)
  // Detecta el final de la sesión para devolver a todos a la sala. La primera lectura solo
  // inicializa: alguien que entra cuando no hay presentación no debe ser redirigido.
  const hadLiveRef = useRef(false)
  const firstLiveCheckRef = useRef(true)

  // Si la sala cambia, se reinicia la detección de fin de sesión.
  useEffect(() => {
    hadLiveRef.current = false
    firstLiveCheckRef.current = true
  }, [id])

  // Pantalla completa: al salir (botón, Escape o gesto del sistema) se libera la orientación.
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === presentationRef.current
      setIsFullscreen(active)
      if (!active) unlockOrientation()
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => {
      document.removeEventListener("fullscreenchange", onChange)
      unlockOrientation()
    }
  }, [])

  // En el celular, entrar a pantalla completa gira la pantalla a horizontal de forma
  // automática. Si el navegador no permite la Fullscreen API (iOS), el contenedor igual
  // pasa a ocupar toda la pantalla con la clase fija de abajo.
  const toggleFullscreen = async () => {
    const element = presentationRef.current
    if (!element) return
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch {
        // El navegador ya salió: el evento fullscreenchange actualiza el estado.
      }
      setIsFullscreen(false)
      unlockOrientation()
      return
    }
    if (isFullscreen) {
      setIsFullscreen(false)
      unlockOrientation()
      return
    }
    setIsFullscreen(true)
    try {
      await element.requestFullscreen()
    } catch {
      // Sin Fullscreen API: se queda el modo expandido por CSS.
    }
    await lockLandscape()
  }

  // El espectador consulta la sesión en vivo: sigue la presentación actual y, cuando termina,
  // vuelve automáticamente al inicio de la sala (el anfitrión ya navega al finalizar).
  useEffect(() => {
    if (isHost) return
    let active = true
    const check = () => {
      getLiveSession(id)
        .then((session) => {
          if (!active) return
          const isLive = session !== null
          setPresentationId(session?.presentationId ?? null)
          if (firstLiveCheckRef.current) {
            firstLiveCheckRef.current = false
            hadLiveRef.current = isLive
            return
          }
          if (hadLiveRef.current && !isLive) {
            navigate(`/salas/${id}`, { state: { role: "guest" } })
            return
          }
          hadLiveRef.current = isLive
        })
        .catch(() => undefined) // un fallo puntual se corrige con el siguiente intento
    }
    check()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") check()
    }, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [id, isHost])

  // Resuelve quién es el dueño de la presentación que se está proyectando. Si cambia de
  // presentación, se vuelve a consultar: el control sigue al turno, no a la persona fija.
  useEffect(() => {
    if (!presentationId) {
      setPresenterId(undefined)
      return
    }
    let active = true
    getUserPresentations(id)
      .then((list) => {
        if (!active) return
        setRoomPresentations(list)
        setPresenterId(list.find((p) => p.presentationId === presentationId)?.userId)
      })
      .catch(() => {
        if (active) {
          setRoomPresentations([])
          setPresenterId(undefined)
        }
      })
    return () => {
      active = false
    }
  }, [id, presentationId])

  // En grupos, las presentaciones por turno viven en cada grupo, no en las presentaciones propias.
  useEffect(() => {
    if (!isGroupMode || order.length === 0) return
    let active = true
    Promise.all(order.map((key) =>
      getGroupPresentations(Number(key))
        .then((list) => list[0] ?? null)
        .catch(() => null),
    )).then((list) => {
      if (active) setGroupPresentations(list)
    })
    return () => {
      active = false
    }
  }, [isGroupMode, order.join(",")])

  useEffect(() => {
    if (!isGroupMode || currentGroupId === undefined) return
    let active = true
    getRoomGroups(Number(id), session?.userId ?? null)
      .then((groups) => {
        const group = groups.find((g) => g.id === currentGroupId)
        if (!active) return
        setCurrentGroupLabel(group ? `Grupo ${String(group.priority).padStart(2, "0")}` : undefined)
        setCurrentGroupMembers(group?.members.map((m) => m.id) ?? [])
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [isGroupMode, currentGroupId, id, session?.userId])

  // En grupos manda cualquiera de los integrantes del grupo en turno, no solo el encargado.
  const belongsToCurrentGroup = session?.userId !== undefined &&
    currentGroupMembers.includes(session.userId)
  const canControl = isHost || belongsToCurrentGroup ||
    (session?.userId !== undefined && presenterId === session.userId)

  // "Siguiente exposición" pasa al siguiente del orden: en individual por usuario, en grupos por
  // grupo. Si no hay siguiente, el botón termina la sesión completa.
  const currentTurn = isGroupMode
    ? order.findIndex((key) => Number(key) === currentGroupId)
    : order.findIndex((key) => Number(key) === presenterId)
  const nextGroupIndex = isGroupMode
    ? groupPresentations.findIndex((p, index) => index > currentTurn && p !== null)
    : -1
  const nextGroupId = nextGroupIndex >= 0 ? Number(order[nextGroupIndex]) : NaN
  const nextUserId = currentTurn >= 0 ? Number(order[currentTurn + 1]) : NaN
  const nextGroupPresentation = nextGroupIndex >= 0 ? groupPresentations[nextGroupIndex] : undefined
  const nextPresentation = Number.isNaN(nextUserId)
    ? undefined
    : roomPresentations.find((p) => p.userId === nextUserId)
  const nextPresentationId = isGroupMode
    ? nextGroupPresentation?.presentation_id
    : nextPresentation?.presentationId

  // La sesión en vivo es un WebSocket: el servidor manda el estado vigente apenas entra un
  // visor y re-manda en cada cambio del presentador.
  useEffect(() => {
    if (!presentationId) {
      setSessionState(null)
      setConnection("ended") // todavía no arrancó: la pantalla explica qué esperar
      return
    }
    const pid = presentationId // ya acotado a string para los reintentos
    setConnection("connecting")
    setError("")
    let attempts = 0
    socketRef.current = connectPresentationSocket(pid, handleState, handleError)

    function handleState(state: ApiSlideState) {
      if (state.type !== "slide") return
      setSessionState(state)
      setWatching(true)
      setConnection("live")
    }
    function handleError(event: Event | CloseEvent) {
      // Cierre normal nuestro (1000): no es error, se está saliendo a propósito.
      if ("code" in event && event.code === 1000) {
        setConnection("ended")
        return
      }
      // 4404: la presentación no está en vivo (el back la expulsa si ya no existe).
      if ("code" in event && event.code === 4404) {
        setConnection("error")
        setError("Esta presentación no está disponible en vivo.")
        return
      }
      // 1001: el servicio se está apagando. 1006: se cortó de golpe. Reintentar un par de veces.
      if (attempts < 3) {
        attempts += 1
        setConnection("connecting")
        window.setTimeout(() => {
          socketRef.current?.disconnect()
          socketRef.current = connectPresentationSocket(pid, handleState, handleError)
        }, 1500 * attempts)
        return
      }
      setConnection("error")
      setError("Se perdió la conexión con la presentación en vivo.")
    }

    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [presentationId])

  // Los trazos van por el mismo WebSocket: el Hub los difunde y el estado vuelve completo.
  const sendAnnotation = (annotation: CanvasStroke) =>
    socketRef.current?.send({ type: "annotation", annotation })
  const clearAnnotations = () => socketRef.current?.send({ type: "clear" })

  const send = (command: ControlCommand) => {
    if (!presentationId) return
    controlPresentation(presentationId, command).then(setSessionState).catch((err: unknown) => {
      const status = (err as ApiError).status
      if (status === 404) {
        setConnection("error")
        setError("El presentador ya no está transmitiendo esta presentación.")
      } else {
        setError(err instanceof Error ? err.message : "No se pudo cambiar de diapositiva.")
      }
    })
  }

  const leave = () => navigate(`/salas/${id}`, { state: { role: isHost ? "host" : "guest" } })

  // Finalizar: el anfitrión quita la sesión publicada de la sala (los espectadores se enteran en
  // su próxima consulta) y vuelve a la sala. Idempotente: finalizar dos veces no es un error.
  const finish = async () => {
    if (!isHost) return leave()
    setError("")
    try {
      if (nextPresentationId) {
        // Sigue la sesión, pero con la presentación del siguiente del orden.
        const next = await setLiveSession(id, nextPresentationId)
        if (isGroupMode && !Number.isNaN(nextGroupId)) setCurrentGroupId(nextGroupId)
        setPresentationId(next.presentationId)
        return
      }
      // No queda nadie más: se termina la sesión y todos vuelven a la sala.
      sessionStorage.removeItem(`spd.order.${id}`)
      await clearLiveSession(id)
      leave()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar de expositor.")
    }
  }

  if (sessionState === null) {
    return (
      <div className="flex flex-col gap-5 px-4 py-6 sm:p-0">
        <h1 className="text-xl font-semibold text-brand-700 sm:text-2xl">
          {connection === "connecting" ? "Conectando…" : "Todavía no hay presentación en vivo"}
        </h1>
        {connection === "error" && (
          <p role="alert" className="text-sm font-medium text-red-700">{error}</p>
        )}
        {connection === "ended" ? (
          watching ? (
            <p className="text-ink/70">El presentador finalizó la sesión.</p>
          ) : (
            <p className="text-ink/70">
              Cuando el presentador inicie la presentación, acá se ve en tiempo real.
            </p>
          )
        ) : (
          <p className="text-ink/60">Sincronizando el estado de la presentación…</p>
        )}
        <div className="flex gap-3">
          <Button variant="secondary" onClick={leave}>
            <span className="inline-flex items-center gap-2"><Icon name="arrowLeft" /> Volver a la sala</span>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] flex-col gap-3 overflow-hidden p-3 sm:gap-5 sm:p-0">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <h1 className="hidden truncate text-base font-semibold text-brand-700 sm:block sm:text-2xl">Sala {id}</h1>
          <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold text-brand-900 sm:px-3 sm:text-xs">
            {connection === "live" ? "EN VIVO" : connection === "connecting" ? "RECONECTANDO" : "DETENIDA"}
          </span>
          {isGroupMode && currentGroupLabel && (
            <span className="shrink-0 rounded-full bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-700 sm:text-xs">
              Exponiendo: {currentGroupLabel}
            </span>
          )}
          {!canControl ? (
            <span className="shrink-0 rounded-full bg-brand-50 px-2 py-1 text-[10px] font-semibold text-brand-700 sm:text-xs">
              Modo espectador
            </span>
          ) : (
            !isHost && (
              <span className="shrink-0 rounded-full bg-brand-50 px-2 py-1 text-[10px] font-semibold text-brand-700 sm:text-xs">
                {isGroupMode ? "Tu grupo está exponiendo" : "Es tu turno"}
              </span>
            )
          )}
          <span className="shrink-0 text-xs text-ink/70 sm:hidden">
            {sessionState.slide}/{sessionState.slide_count}
            {order.length > 0 && currentTurn >= 0 && (
              <span className="ml-1 text-ink/60">· T{currentTurn + 1}/{order.length}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 text-sm text-ink/70 lg:inline-flex">
            <Icon name="eye" size={16} /> Diapositiva {sessionState.slide} de {sessionState.slide_count}
            {order.length > 0 && currentTurn >= 0 && (
              <span className="ml-2 text-ink/60">· Turno {currentTurn + 1} de {order.length}</span>
            )}
          </span>
          <div className="hidden items-center gap-2 sm:flex">
            <Button variant="secondary" icon={isFullscreen ? "minimize" : "expand"} onClick={toggleFullscreen}>
              {isFullscreen ? "Salir" : "Pantalla completa"}
            </Button>
            <Button variant="secondary" icon="logout" onClick={leave}>Abandonar</Button>
            {isHost && (
              <Button icon="check" onClick={finish}>
                {nextPresentationId ? "Siguiente exposición" : "Finalizar presentación"}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1.5 sm:hidden">
            <button type="button" onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
              className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-brand-700">
              <Icon name={isFullscreen ? "minimize" : "expand"} />
            </button>
            <button type="button" onClick={leave} aria-label="Abandonar"
              className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface text-brand-700">
              <Icon name="logout" />
            </button>
            {isHost && (
              <button type="button" onClick={finish}
                aria-label={nextPresentationId ? "Siguiente exposición" : "Finalizar presentación"}
                className="flex h-10 w-10 items-center justify-center rounded-md bg-brand-700 text-white">
                <Icon name="check" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        ref={presentationRef}
        className={`flex min-h-0 flex-1 flex-col gap-3 ${
          isFullscreen ? "fixed inset-0 z-50 h-[100dvh] w-screen bg-brand-900 p-2 sm:p-3" : ""
        }`}
      >
        {isFullscreen && (
          <button type="button" onClick={toggleFullscreen} aria-label="Salir de pantalla completa"
            className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-brand-900/80 text-white">
            <Icon name="minimize" />
          </button>
        )}
        <SlideStage
          slide={sessionState.slide}
          total={sessionState.slide_count}
          url={sessionState.url}
          canControl={canControl}
          annotations={sessionState.annotations ?? []}
          onAnnotation={sendAnnotation}
          onClear={clearAnnotations}
          onPrev={() => send({ action: "prev" })}
          onNext={() => send({ action: "next" })}
          fill={isFullscreen}
        />
      </div>

      {error && connection !== "error" && (
        <p role="alert" className="shrink-0 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 sm:p-3 sm:text-sm">
          {error}
        </p>
      )}

    </div>
  )
}

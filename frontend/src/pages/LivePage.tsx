import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { SlideStage } from "../components/live/SlideStage"
import { Button } from "../components/ui/Button"
import { Icon } from "../components/ui/Icon"
import { controlPresentation, connectPresentationSocket, type ControlCommand } from "../services/live"
import { clearLiveSession, getLiveSession, getRoom } from "../services/rooms"
import { useSession } from "../context/SessionContext"
import type { ApiError } from "../services/http"
import type { ApiSlideState, Role } from "../types"

type LocationState = { role?: Role; presentationId?: string }

export default function LivePage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const { session } = useSession()
  const state = (useLocation().state as LocationState | null) ?? {}

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

  const [sessionState, setSessionState] = useState<ApiSlideState | null>(null)
  const [connection, setConnection] = useState<"connecting" | "live" | "ended" | "error">("connecting")
  const [error, setError] = useState("")
  const stageRef = useRef<HTMLDivElement>(null)

  // El espectador consulta la sesión en vivo de la sala: cambia de presentación cuando el
  // anfitrión lanza otra (siguiente grupo) y se entera cuando la finaliza.
  useEffect(() => {
    if (isHost) return
    let active = true
    const check = () => {
      getLiveSession(id)
        .then((session) => {
          if (active) setPresentationId(session?.presentationId ?? null)
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
  }, [id, isHost])

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
    let disconnect = connectPresentationSocket(pid, handleState, handleError)

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
          disconnect()
          disconnect = connectPresentationSocket(pid, handleState, handleError)
        }, 1500 * attempts)
        return
      }
      setConnection("error")
      setError("Se perdió la conexión con la presentación en vivo.")
    }

    return () => disconnect()
  }, [presentationId])

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
  const finish = () => {
    if (isHost) clearLiveSession(id).catch(() => undefined)
    leave()
  }

  if (sessionState === null) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold text-brand-700">
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-brand-700">Sala {id}</h1>
          <span className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-brand-900">
            {connection === "live" ? "EN VIVO" : connection === "connecting" ? "RECONECTANDO" : "DETENIDA"}
          </span>
        </div>
        <span className="inline-flex items-center gap-2 text-sm text-ink/70">
          <Icon name="eye" size={16} /> Diapositiva {sessionState.slide} de {sessionState.slide_count}
        </span>
      </div>

      <div ref={stageRef} className="bg-surface-muted">
        <SlideStage
          slide={sessionState.slide}
          total={sessionState.slide_count}
          url={sessionState.url}
          canControl={isHost}
          onPrev={() => send({ action: "prev" })}
          onNext={() => send({ action: "next" })}
        />
      </div>

      {error && connection !== "error" && (
        <p role="alert" className="rounded-lg bg-brand-50 p-3 text-sm text-brand-700">{error}</p>
      )}

      {!isHost && (
        <p className="flex items-center gap-2 rounded-lg bg-brand-50 p-4 text-sm text-brand-700">
          <Icon name="eye" />
          <span><strong>Modo espectador.</strong> Estás viendo la presentación en tiempo real.</span>
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" icon="expand" onClick={() => stageRef.current?.requestFullscreen?.()}>Pantalla completa</Button>
        <Button variant="secondary" icon="logout" onClick={leave}>Abandonar</Button>
        {isHost && (
          <Button icon="check" onClick={finish}>Finalizar presentación</Button>
        )}
      </div>
    </div>
  )
}

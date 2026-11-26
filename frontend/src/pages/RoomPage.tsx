import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { GroupCard } from "../components/rooms/GroupCard";
import { GroupOverview } from "../components/rooms/GroupOverview";
import { IndividualPresentations } from "../components/rooms/IndividualPresentations";
import { ModeCard } from "../components/rooms/ModeCard";
import { OwnPresentation } from "../components/rooms/OwnPresentation";
import { PrepareRoom } from "../components/rooms/PrepareRoom";
import { RoomHeader } from "../components/rooms/RoomHeader";
import { SetupGroups } from "../components/rooms/SetupGroups";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import {
  SlideGallery,
  type PreviewSource,
} from "../components/rooms/SlideGallery";
import { useSession } from "../context/SessionContext";
import {
  assignGroupPresentation,
  clearLiveSession,
  createGroup,
  deleteGroup,
  deleteRoom,
  getGroupPresentations,
  getLiveSession,
  getRoom,
  getRoomAccessKey,
  getRoomGroups,
  getRoomMembers,
  getUserPresentations,
  joinGroup,
  leaveGroup,
  setLiveSession,
  transferEncargado,
  unassignGroupPresentation,
  removeRoomMember,
  updateRoom,
  updateRoomOrder,
} from "../services/rooms";
import { uploadPresentation } from "../services/live";
import { ApiError } from "../services/http";
import type {
  ApiPresentation,
  Group,
  LiveSession,
  Member,
  Role,
  Room,
  UserPresentation,
} from "../types";
import { generateAccessKey } from "../utils/accessKey";
import { useFlip } from "../utils/flip";
import { initials } from "../utils/initials";

type Format = "group" | "individual";

// Ordena la lista real por las claves elegidas en el sorteo. Los que no estén en la lista
// (p. ej. alguien que se suma después) quedan al final en su orden original.
function applyOrder<T extends { id: number }>(items: T[], keys: string[]): T[] {
  if (keys.length === 0) return items;
  const position = new Map(keys.map((key, index) => [Number(key), index]));
  return [...items].sort(
    (a, b) =>
      (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity),
  );
}

export default function RoomPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();

  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [userPresentations, setUserPresentations] = useState<
    UserPresentation[]
  >([]);
  const [mode, setMode] = useState<"own" | "watch">("watch");
  const [format, setFormat] = useState<Format>("group");
  const [settingUp, setSettingUp] = useState(false);
  const [editingFormat, setEditingFormat] = useState(false);
  const [orderKeys, setOrderKeys] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  };
  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );
  const [presentationId, setPresentationId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [closing, setClosing] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [accessKey, setAccessKey] = useState<string>();
  const isHost =
    session?.userId !== undefined && room?.ownerId === session.userId;
  const [attempt, setAttempt] = useState(0);
  // Presentaciones asignadas: groupId → asignación (o null si no tiene).
  const [assignments, setAssignments] = useState<
    Record<number, ApiPresentation | null>
  >({});
  const [uploadingGroupId, setUploadingGroupId] = useState<number | null>(null);
  const [viewing, setViewing] = useState<{
    source: PreviewSource;
    label: string;
  } | null>(null);
  // Sesión en vivo de la sala (la publica el anfitrión): null mientras no haya ninguna.
  const [live, setLive] = useState<LiveSession | null>(null);
  // Para detectar el ARRANQUE (no una sesión que ya estaba al entrar) y redirigir una sola vez.
  const liveRef = useRef<LiveSession | null>(null);
  const firstLiveCheck = useRef(true);
  // Todos los hooks van antes de los returns anticipados de carga/error.
  const registerFlip = useFlip(orderKeys.join(","));

  // La sala existe y sus integrantes son de solo lectura: se cargan al entrar.
  // Ver una sala requiere sesión: si se entra por URL directa sin iniciar, al login y de vuelta.
  useEffect(() => {
    if (session?.token === undefined) {
      navigate("/login", { state: { from: `/salas/${id}` }, replace: true });
    }
  }, [session?.token, id, navigate]);

  useEffect(() => {
    let active = true;
    let loadedRoom: Room | null = null;
    setRoom(undefined);
    setGroups([]);
    setNotice("");
    setLoadError("");
    getRoom(id)
      .then((result) => {
        if (!active) return;
        loadedRoom = result;
        setRoom(result);
        return getRoomMembers(result.id);
      })
      .then((roomMembers) => {
        if (!active || !roomMembers) return;
        setMembers(roomMembers);
        const ownerIsMe =
          session?.userId !== undefined &&
          loadedRoom?.ownerId === session.userId;
        if (
          !ownerIsMe &&
          session?.userId !== undefined &&
          !roomMembers.some((member) => member.id === session.userId)
        ) {
          navigate("/salas", {
            state: { notice: "Fuiste quitado de la sala." },
            replace: true,
          });
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        // 404: la sala no existe. Cualquier otro error (servidor caído, red) se puede reintentar.
        if (err instanceof ApiError && err.status === 404) setRoom(null);
        else
          setLoadError(
            err instanceof Error ? err.message : "No se pudo cargar la sala.",
          );
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt]);

  // El estado de la sala se refresca solo cada tanto: así los cambios del anfitrión (formato
  // confirmado, grupos creados, presentaciones asignadas) y de los demás (miembros nuevos)
  // aparecen en vivo, sin recargar la página. Un fallo puntual se corrige con el siguiente
  // intento; la sala borrada en el medio avisa y saca al visitante.
  useEffect(() => {
    if (room == null) return;
    let active = true;
    const refresh = () => {
      getRoom(room.id)
        .then((updated) => {
          if (active) setRoom(updated);
        })
        .catch((err: unknown) => {
          if (active && err instanceof ApiError && err.status === 404)
            setRoom(null);
        });
      getRoomMembers(room.id)
        .then((roomMembers) => {
          if (!active) return;
          setMembers(roomMembers);
          const ownerIsMe =
            session?.userId !== undefined && room.ownerId === session.userId;
          if (
            !ownerIsMe &&
            session?.userId !== undefined &&
            !roomMembers.some((member) => member.id === session.userId)
          ) {
            navigate("/salas", {
              state: { notice: "Fuiste quitado de la sala." },
              replace: true,
            });
          }
        })
        .catch(() => undefined);
      getRoomGroups(room.id, session?.userId ?? null)
        .then((result) => {
          if (!active) return;
          setGroups(result);
          return loadAssignments(result);
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, session?.userId]);

  // El formato confirmado en el back es la verdad compartida: si el anfitrión lo confirma (o
  // cambia), la vista de todos se alinea. El "group" local es el nombre del tab del setup.
  useEffect(() => {
    if (room?.format === "groups") setFormat("group");
    else if (room?.format === "individual") setFormat("individual");
  }, [room?.format]);

  // El orden también vive en la sala: cualquiera que entre o actualice ve el mismo sorteo.
  useEffect(() => {
    if (room == null) return;
    const ids =
      format === "individual" ? room.individualOrder : room.groupOrder;
    setOrderKeys((ids ?? []).map(String));
  }, [room?.id, format, room?.individualOrder, room?.groupOrder]);

  // La clave está en el servidor: cualquiera que sea el dispositivo, el anfitrión la obtiene acá.
  useEffect(() => {
    setAccessKey(undefined);
    if (!isHost || !room?.hasAccessKey) return;
    let active = true;
    getRoomAccessKey(room.id)
      .then((key) => active && setAccessKey(key))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [room?.id, room?.hasAccessKey, isHost]);

  // Si se quita la presentación que estaba abierta, el preview no se queda mostrando la anterior.
  useEffect(() => {
    if (!viewing) return;
    if (viewing.source.kind === "group") {
      const assigned = assignments[viewing.source.groupId];
      if (
        !assigned ||
        assigned.presentation_id !== viewing.source.presentationId
      )
        setViewing(null);
    } else {
      const mine = userPresentations.find((p) => p.userId === session?.userId);
      if (!mine || mine.presentationId !== viewing.source.presentationId)
        setViewing(null);
    }
  }, [viewing, assignments, userPresentations, session?.userId]);

  function loadIndividualPresentations() {
    if (room == null) return;
    getUserPresentations(room.id)
      .then(setUserPresentations)
      .catch(() => undefined);
  }

  // Las presentaciones propias cambian cuando cualquier participante sube o quita la suya.
  useEffect(() => {
    if (room?.format !== "individual") return;
    loadIndividualPresentations();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadIndividualPresentations();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [room?.id, room?.format]);

  // Al cambiar de sala se reinicia la detección de arranque.
  useEffect(() => {
    liveRef.current = null;
    firstLiveCheck.current = true;
  }, [room?.id]);

  // La sesión en vivo se consulta cada tanto. Cuando cambia de "no hay" a "hay" (o se lanza
  // otra), todos los que están en la sala van a la presentación; la primera lectura solo
  // inicializa, para no sacar a alguien que llegó cuando ya estaba en curso.
  useEffect(() => {
    if (room == null) return;
    let active = true;
    const check = () => {
      getLiveSession(room.id)
        .then((result) => {
          if (!active) return;
          setLive(result);
          if (firstLiveCheck.current) {
            firstLiveCheck.current = false;
            liveRef.current = result;
            return;
          }
          const previous = liveRef.current;
          const started =
            result !== null &&
            (previous === null || result.startedAt !== previous.startedAt);
          liveRef.current = result;
          if (started) {
            const liveGroup = groups.find(
              (group) => assignments[group.id]?.presentation_id === result.presentationId,
            )
            const liveKind =
              room.format === "groups" ? "group" : room.format === "individual" ? "individual" : "own"
            navigate(`/salas/${room.id}/en-vivo`, {
              state: {
                role:
                  session?.userId !== undefined &&
                  room.ownerId === session.userId
                    ? "host"
                    : "guest",
                presentationId: result.presentationId,
                order: orderKeys,
                kind: liveKind,
                groupId: liveGroup?.id,
              },
            });
          }
        })
        .catch(() => undefined); // un fallo puntual se corrige con el siguiente intento
    };
    check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [room]);

  // Se cargan los grupos que ya existan: así, si el anfitrión vuelve a entrar, no se crean de nuevo.
  useEffect(() => {
    if (room == null) return;
    let active = true;
    getRoomGroups(room.id, session?.userId ?? null)
      .then((result) => {
        if (!active) return;
        setGroups(result);
        return loadAssignments(result);
      })
      .catch(() => setNotice("No se pudieron cargar los grupos de la sala."));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  const reloadGroups = () => {
    if (!room) return Promise.resolve();
    return getRoomGroups(room.id, session?.userId ?? null)
      .then((result) => {
        setGroups(result);
        return loadAssignments(result);
      })
      .catch(() => setNotice("No se pudieron recargar los grupos."));
  };

  // Qué presentación tiene cada grupo (una llamada por grupo; se muestra la primera asignada).
  const loadAssignments = (groupsList: Group[]) => {
    const requests = groupsList.map(async (group) => {
      const list = await getGroupPresentations(group.id).catch(() => []);
      return [group.id, list[0] ?? null] as const;
    });
    return Promise.all(requests).then((entries) => {
      setAssignments(
        Object.fromEntries(entries) as Record<number, ApiPresentation | null>,
      );
    });
  };

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p
          role="alert"
          className="rounded-lg bg-brand-50 p-4 text-sm font-medium text-brand-700"
        >
          {loadError}
        </p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (room === undefined) return <p className="text-ink/60">Cargando sala…</p>;
  if (room === null) {
    return (
      <p className="text-ink/70">
        No encontramos esa sala.{" "}
        <Link
          to="/salas"
          className="font-semibold text-brand-500 hover:underline"
        >
          Volver a mis salas
        </Link>
      </p>
    );
  }

  // El anfitrión es el dueño de la sala (la crea con sesión iniciada y el back le guarda el
  // owner_id): ya no viaja el rol por la navegación, lo decide el backend. Salas sin dueño
  // (anteriores al login) o quien no es el dueño: espectadores.
  // En formato individual el anfitrión arma la sala pero no participa ni figura en el orden.
  // El sorteo reordena estas listas, no una vista interna del panel de preparación.
  const participants = applyOrder(
    members.filter((member) => member.id !== room.ownerId),
    orderKeys,
  );
  const orderedGroups = applyOrder(groups, orderKeys);
  const role: Role = isHost ? "host" : "guest";
  // La sala está armada cuando el anfitrión confirmó un formato, o cuando ya tiene grupos (las
  // salas de antes del login no guardaban formato). Lo decide el backend, así lo ven todos igual.
  const configured = room.format !== "" || groups.length > 0;
  const activeMode = isHost ? mode : "watch";
  const startLive = (
    livePresentationId: string | null,
    order: string[] = [],
    kind: "group" | "individual" | "own" = room.format === "groups"
      ? "group"
      : "individual",
    groupId?: number,
  ) => {
    // El orden y el grupo viajan con la navegación y se guardan para sobrevivir una recarga.
    if (order.length)
      sessionStorage.setItem(`spd.order.${room.id}`, JSON.stringify({ ids: order, kind, groupId }));
    navigate(`/salas/${room.id}/en-vivo`, {
      state: { role, presentationId: livePresentationId, order, kind, groupId },
    });
  };
  const inAnyGroup = groups.some((g) => g.members.some((m) => m.joined));

  // Lanzar en vivo es publicar la sesión (PUT live-session) y entrar a la pantalla de proyección.
  // Si el lanzamiento falla, avisamos y no navegamos: la sala quedaría sin sesión publicada.
  const launch = (
    livePresentationId: string,
    groupId?: number,
    kind?: "group" | "individual" | "own",
  ) => {
    if (!room) return;
    const finalOrder = orderKeys.length
      ? orderKeys
      : orderedGroups.map((g) => String(g.id));
    const finalKind =
      kind ?? (room.format === "groups" ? "group" : "individual");
    setLiveSession(room.id, livePresentationId)
      .then((session) => {
        setLive(session);
        startLive(livePresentationId, finalOrder, finalKind, groupId);
      })
      .catch((err: unknown) =>
        setNotice(
          err instanceof Error
            ? err.message
            : "No se pudo lanzar la presentación en vivo.",
        ),
      );
  };

  // Cerrar la sala está disponible siempre (incluso antes de presentar). Se limpia primero la
  // sesión en vivo, aunque no haya empezado: DELETE es idempotente. Después el back borra en
  // cascada grupos, presentaciones y pertenencias; acá solo olvidamos la clave guardada en este
  // dispositivo, porque la sala ya no existe.
  const closeRoom = async () => {
    if (!room || closing) return;
    const confirmed = window.confirm(
      `¿Cerrar la sala "${room.name}"? Se borrarán sus grupos, presentaciones y miembros. Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;
    setClosing(true);
    setNotice("");
    try {
      await clearLiveSession(room.id).catch(() => undefined);
      await deleteRoom(room.id);
      setLive(null);
      navigate("/salas");
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : "No se pudo cerrar la sala.",
      );
      setClosing(false);
    }
  };

  // El anfitrión arma (n × POST /api/rooms/:id/groups) la grilla real de grupos de la sala y
  // confirma el formato: el PATCH deja el cambio en el back, y el polling lo refleja en la
  // pantalla de todos.
  // Cambiar de formato empieza de cero: se borran los grupos anteriores (con sus miembros y
  // presentaciones) para que la nueva cantidad y el nuevo límite se apliquen de verdad.
  const clearGroupsForFormatChange = async () => {
    if (groups.length === 0) return;
    await clearLiveSession(room.id).catch(() => undefined);
    await Promise.all(groups.map((group) => deleteGroup(group.id)));
    setGroups([]);
    setAssignments({});
    setLive(null);
    setOrderKeys([]);
    await updateRoomOrder(room.id, "individual", []).catch(() => undefined);
    await updateRoomOrder(room.id, "groups", []).catch(() => undefined);
  };

  const confirmGroups = async (count: number, limit: number) => {
    setNotice("");
    setSettingUp(true);
    try {
      await clearGroupsForFormatChange();
      await Promise.all(
        Array.from({ length: count }, (_, index) =>
          createGroup(room.id, { limit, priority: index + 1 }),
        ),
      );
      const updated = await updateRoom(room.id, { format: "groups" });
      setRoom(updated);
      await reloadGroups();
      setEditingFormat(false);
    } catch (err: unknown) {
      setNotice(
        err instanceof Error ? err.message : "No se pudieron crear los grupos.",
      );
    } finally {
      setSettingUp(false);
    }
  };

  // Al pasar a individual se limpian los grupos: así, volver a grupos es un inicio limpio.
  const confirmIndividual = async () => {
    setNotice("");
    try {
      await clearGroupsForFormatChange();
      const updated = await updateRoom(room.id, { format: "individual" });
      setRoom(updated);
      setEditingFormat(false);
    } catch (err: unknown) {
      setNotice(
        err instanceof Error ? err.message : "No se pudo confirmar el formato.",
      );
    }
  };

  // Integrarse a un grupo hace POST /api/groups/:id/members con el userId de la sesión; si no
  // hay sesión con usuario real, no se puede (y así lo decimos).
  const toggleGroup = (group: Group) => {
    const userId = session?.userId;
    if (userId === undefined || !room) {
      setNotice(
        "Para unirte a un grupo iniciá sesión (o registrate). Si te invitaron, usá el enlace y la clave de la sala.",
      );
      return;
    }
    setNotice("");
    const isMember = group.members.some((m) => m.joined);
    // Una persona solo puede estar en un grupo a la vez.
    const current = groups.find((g) => g.members.some((m) => m.joined));
    if (!isMember && current) {
      setNotice(
        `Ya estás en el Grupo ${String(current.priority).padStart(2, "0")}. Abandonalo para unirte a otro.`,
      );
      return;
    }
    const change = isMember
      ? leaveGroup(group.id, userId)
      : joinGroup(group.id, userId);
    change.then(reloadGroups).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 409) setNotice(err.message);
      else setNotice("No se pudo cambiar de grupo. Volvé a intentar.");
    });
  };

  // Sube el archivo del grupo a presentations y lo asigna al grupo (asignación única: 409 si
  // el back ya la tiene en otro grupo). Los mensajes de error los muestra la propia tarjeta.
  const handleUpload = async (group: Group, file: File) => {
    setUploadingGroupId(group.id);
    try {
      const detail = await uploadPresentation(file);
      await assignGroupPresentation(group.id, detail.presentation_id);
      await loadAssignments(groups);
    } finally {
      setUploadingGroupId(null);
    }
  };

  // Desasignar no borra la presentación del servicio presentations: solo la desvincula del grupo.
  const handleUnassign = async (groupId: number) => {
    const assigned = assignments[groupId];
    if (!assigned) return;
    await unassignGroupPresentation(groupId, assigned.presentation_id);
    setAssignments((current) => ({ ...current, [groupId]: null }));
  };

  // El backend solo guarda un hash de la clave: si se perdió en este dispositivo, no hay forma
  // de recuperarla. El anfitrión genera una nueva y se la guardamos acá para poder copiarla.
  const rotateKey = async () => {
    if (rotatingKey) return;
    setRotatingKey(true);
    setNotice("");
    const key = generateAccessKey();
    try {
      const updated = await updateRoom(room.id, { accessKey: key });
      setAccessKey(key);
      setRoom(updated);
      showToast(
        "Nueva clave generada. Ya podés verla, copiarla y compartir el enlace.",
      );
    } catch (err: unknown) {
      setNotice(
        err instanceof Error ? err.message : "No se pudo generar la clave.",
      );
    } finally {
      setRotatingKey(false);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    setNotice("");
    try {
      await removeRoomMember(room.id, userId);
      const [list, groupsNow] = await Promise.all([
        getRoomMembers(room.id),
        getRoomGroups(room.id, session?.userId ?? null),
      ]);
      setMembers(list);
      setGroups(groupsNow);
      await loadAssignments(groupsNow);
      showToast("Integrante expulsado correctamente.");
    } catch (err: unknown) {
      setNotice(
        err instanceof Error ? err.message : "No se pudo quitar a la persona.",
      );
    }
  };

  const handleTransfer = async (group: Group, userId: number) => {
    setNotice("");
    try {
      await transferEncargado(group.id, userId);
      await reloadGroups();
    } catch (err: unknown) {
      setNotice(
        err instanceof Error ? err.message : "No se pudo transferir el rol.",
      );
    }
  };

  const handleView = (group: Group) => {
    const assigned = assignments[group.id];
    if (assigned)
      setViewing({
        source: {
          kind: "group",
          groupId: group.id,
          presentationId: assigned.presentation_id,
          nonce: Date.now() + Math.random(),
        },
        label: `Grupo ${String(group.priority).padStart(2, "0")}`,
      });
  };

  // El backend busca la presentación por la sesión, pero el UUID va en la clave del preview:
  // así, al cargar otra, el gallery recarga en vez de conservar las imágenes anteriores.
  const handleViewOwn = (presentationId: string) =>
    setViewing({
      source: {
        kind: "individual",
        roomId: room.id,
        presentationId,
        nonce: Date.now() + Math.random(),
      },
      label: "Mi presentación",
    });

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <RoomHeader
        roomId={room.id}
        title={room.name}
        accessKey={accessKey}
        members={participants.length}
        canSeeKey={isHost}
        canRotateKey={isHost}
        onRotateKey={rotateKey}
        rotatingKey={rotatingKey}
      />

      {notice && (
        <p
          role="alert"
          className="rounded-lg bg-brand-50 p-4 text-sm font-medium text-brand-700"
        >
          {notice}
        </p>
      )}

      {isHost && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-brand-700">Modo de presentación</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <ModeCard
              active={mode === "own"}
              icon="file"
              title="Presentación propia"
              text="Exponé tu archivo"
              onClick={() => setMode("own")}
            />
            <ModeCard
              active={mode === "watch"}
              icon="people"
              title="Ver presentaciones"
              text="Organizá a tu clase"
              onClick={() => setMode("watch")}
            />
          </div>
          {configured && !editingFormat && mode !== "own" && (
            <Button
              variant="secondary"
              icon="edit"
              className="w-full sm:w-auto sm:self-start"
              onClick={() => setEditingFormat(true)}
            >
              Cambiar modo de presentación
            </Button>
          )}
        </section>
      )}

      {isHost && mode !== "own" && (!configured || editingFormat) && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-brand-700">
              {configured
                ? "Cambiar formato de la sala"
                : "Elegí el formato de la sala"}
            </h2>
            {configured && (
              <Button variant="ghost" onClick={() => setEditingFormat(false)}>
                Cancelar
              </Button>
            )}
          </div>
          <div
            className="flex gap-6 overflow-x-auto border-b border-border"
            role="tablist"
          >
            {(["individual", "group"] as const).map((item) => (
              <button
                key={item}
                role="tab"
                aria-selected={format === item}
                onClick={() => setFormat(item)}
                className={`-mb-px border-b-2 px-1 pb-3 text-sm font-semibold ${
                  format === item
                    ? "border-accent text-brand-700"
                    : "border-transparent text-ink/60 hover:text-brand-700"
                }`}
              >
                {item === "group" ? "En grupo" : "Individual"}
              </button>
            ))}
          </div>
          {format === "group" ? (
            <SetupGroups onConfirm={confirmGroups} busy={settingUp} />
          ) : (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
              <h2 className="text-base font-semibold text-brand-700 sm:text-lg">
                Formato individual
              </h2>
              <p className="text-ink/70">
                Cada participante carga su archivo y presenta.{" "}
                {participants.length}{" "}
                {participants.length === 1 ? "persona" : "personas"} en la sala.
              </p>
              <Button
                icon="check"
                className="w-full sm:w-auto sm:self-start"
                onClick={confirmIndividual}
              >
                {configured
                  ? "Cambiar a individual"
                  : "Activar formato individual"}
              </Button>
            </div>
          )}
        </section>
      )}

      {activeMode === "own" ? (
        <OwnPresentation
          onUploaded={setPresentationId}
          onStart={() => presentationId && launch(presentationId)}
        />
      ) : (
        <>
          {configured && (
            <section className="flex flex-col gap-5">
              {format === "group" && (
                <h2 className="text-base font-semibold text-brand-700 sm:text-lg">
                  {isHost
                    ? `${groups.length} grupos`
                    : `${groups.length} grupos: elegí tu equipo`}
                </h2>
              )}
              {format === "group" ? (
                isHost ? (
                  <>
                    <p className="text-sm text-ink/60">
                      Así quedó la grilla. Los participantes eligen su equipo y
                      cargan su archivo; vos definís el orden.
                    </p>
                    <GroupOverview
                      groups={orderedGroups}
                      assignments={assignments}
                      canRemove={isHost}
                      ownerId={room.ownerId}
                      onRemove={handleRemoveMember}
                      registerItem={registerFlip}
                    />
                  </>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {orderedGroups.map((group) => (
                      <div
                        key={group.id}
                        ref={registerFlip(String(group.id))}
                        className="h-full"
                      >
                        <GroupCard
                          group={group}
                          currentUserId={session?.userId}
                          blocked={
                            inAnyGroup && !group.members.some((m) => m.joined)
                          }
                          presentation={assignments[group.id] ?? null}
                          uploading={uploadingGroupId === group.id}
                          canManage={false}
                          onToggle={() => toggleGroup(group)}
                          onTransfer={(userId) => handleTransfer(group, userId)}
                          onUpload={(file) => handleUpload(group, file)}
                          onUnassign={() => handleUnassign(group.id)}
                          onView={() => handleView(group)}
                          canPresent={false}
                        />
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <IndividualPresentations
                  roomId={room.id}
                  members={participants}
                  currentUserId={isHost ? undefined : session?.userId}
                  presentations={userPresentations}
                  onChanged={loadIndividualPresentations}
                  onView={handleViewOwn}
                  canRemove={isHost}
                  onRemove={handleRemoveMember}
                  registerItem={registerFlip}
                />
              )}
              {isHost && !preparing && (
                <Button
                  icon="sparkles"
                  className="w-full sm:w-auto sm:self-start"
                  onClick={() => setPreparing(true)}
                >
                  Preparar sala
                </Button>
              )}
              {isHost && preparing && (
                <PrepareRoom
                  items={
                    format === "individual"
                      ? participants.map((m) => ({
                          key: String(m.id),
                          label: m.fullName,
                          badge: initials(m.fullName),
                        }))
                      : orderedGroups.map((g) => ({
                          key: String(g.id),
                          label: `Grupo ${String(g.priority).padStart(2, "0")}`,
                          badge: `G${g.priority}`,
                        }))
                  }
                  onOrderChange={(keys, sortMode) => {
                    const next = sortMode === "ordered" ? [] : keys;
                    setOrderKeys(next);
                    if (isHost && room) {
                      const kind = format === "group" ? "groups" : "individual";
                      updateRoomOrder(room.id, kind, next.map(Number))
                        .then(setRoom)
                        .catch((err: unknown) =>
                          setNotice(
                            err instanceof Error
                              ? err.message
                              : "No se pudo guardar el orden.",
                          ),
                        );
                    }
                  }}
                  onStart={(orderedKeys) => {
                    if (format === "individual") {
                      // El orden configurado decide quién empieza: se publica la presentación del
                      // primero de la lista y se entra a la pantalla en vivo con ella.
                      const first = userPresentations.find(
                        (p) => p.userId === Number(orderedKeys[0]),
                      );
                      if (!first) {
                        setNotice(
                          "Quien empieza según el orden todavía no cargó su presentación. Esperá a que lo haga.",
                        );
                        return;
                      }
                      setLiveSession(room.id, first.presentationId)
                        .then((session) => {
                          setLive(session);
                          setPreparing(false);
                          startLive(
                            first.presentationId,
                            orderedKeys,
                            "individual",
                          );
                        })
                        .catch((err: unknown) =>
                          setNotice(
                            err instanceof Error
                              ? err.message
                              : "No se pudo iniciar la presentación.",
                          ),
                        );
                      return;
                    }
                    // El primer turno es el primero del orden sorteado que tenga archivo, no el
                    // primero por id: si no, el vivo arranca en "turno 2" con el orden al revés.
                    const firstId = orderedKeys
                      .map(Number)
                      .find((gid) => assignments[gid]);
                    const first = orderedGroups.find((g) => g.id === firstId);
                    if (first)
                      launch(
                        assignments[first.id]!.presentation_id,
                        first.id,
                        "group",
                      );
                    else
                      setNotice(
                        "Todavía no hay presentaciones asignadas: cargá el archivo desde la tarjeta de un grupo.",
                      );
                  }}
                />
              )}
              {!isHost && (
                <div className="flex flex-col gap-3 rounded-lg bg-brand-50 p-4 text-sm text-brand-700">
                  {live ? (
                    <>
                      <p>
                        <strong>El anfitrión está presentando.</strong> Podés
                        entrar a verlo en tiempo real.
                      </p>
                      <Button
                        icon="play"
                        className="self-start"
                        onClick={() => startLive(live.presentationId)}
                      >
                        Entrar a la presentación
                      </Button>
                    </>
                  ) : (
                    <>
                      <p>
                        <strong>Ya estás dentro.</strong> El anfitrión te va a
                        avisar cuando sea momento de comenzar.
                      </p>
                      <Button icon="play" className="self-start" disabled>
                        Esperando al anfitrión…
                      </Button>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
          {!configured && !isHost && (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-surface p-6 text-center">
              <h2 className="text-lg font-semibold text-brand-700">
                El anfitrión todavía está configurando la sala
              </h2>
              <p className="text-sm text-ink/60">
                En cuanto elija el modo de presentación, vas a ver acá a los
                participantes y sus presentaciones. O bien, comenzará a
                transmitir su propia presentación.
              </p>
            </div>
          )}
        </>
      )}

      {isHost && (
        <section className="flex flex-col gap-2 rounded-lg border border-red-200 bg-surface p-4">
          <div>
            <h2 className="font-semibold text-brand-700">Cerrar sala</h2>
            <p className="text-sm text-ink/60">
              Disponible incluso antes de empezar. Borra los grupos, las
              presentaciones asignadas y los miembros; no se puede deshacer.
            </p>
          </div>
          <Button
            variant="danger"
            icon="trash"
            className="w-full sm:w-auto sm:self-start"
            onClick={closeRoom}
            disabled={closing}
          >
            {closing ? "Cerrando…" : "Cerrar sala"}
          </Button>
        </section>
      )}

      {viewing && (
        <SlideGallery
          source={viewing.source}
          label={viewing.label}
          onClose={() => setViewing(null)}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-4 top-4 z-[60] flex max-w-sm items-start gap-2 rounded-lg border border-brand-100 bg-surface px-4 py-3 text-sm text-brand-700 shadow-lg"
        >
          <Icon name="check" size={16} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

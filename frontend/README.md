# S.P.D. – Front

React + TypeScript + Vite + Tailwind v4.

    npm install
    npm run dev

## Integración con el backend

En desarrollo el front habla con el gateway (`backend/services/gateway`, :8080) por
proxys de Vite: `/api` (REST) y `/ws` (WebSocket con upgrade). El destino se cambia
con la variable `SPD_GATEWAY_URL` (por defecto `http://localhost:8080`); en
producción, un reverse-proxy debe publicar `/api` y `/ws` hacia el gateway.

- `services/http.ts`: cliente base; los errores llegan como `ApiError` con el
  código HTTP y el mensaje `{"error": ...}` que devuelve el backend. Si hay
  sesión, agrega `Authorization: Bearer <token>` a cada petición.
- `services/rooms.ts`: login, usuarios, salas, miembros, grupos, presentaciones
  asignadas y sesión en vivo (servicio `rooms`).
- `services/live.ts`: upload/metadata de presentaciones, WebSocket y control
  (servicios `presentations` y `realtime`).
- `types/index.ts`: tipos `Api*` que espejan el JSON de los servicios 1:1, y
  view models de la UI derivados de ellos.
- `pages/`: login, registro, invitado, salas, crear sala, sala y vista en vivo.

## Sesión y permisos

`POST /api/auth/login` devuelve un JWT de 24 h. `context/SessionContext.tsx`
guarda el nombre, el `userId` y el token en `localStorage` (claves `spd.session`
y `spd.token`), y `utils/token.ts` lo inyecta en las peticiones sin pasar por
React. `/registro` crea la cuenta (`POST /api/users`) y enseguida inicia sesión
para que la nueva sesión ya pueda crear salas. El backend expone además
`GET /api/users/me` para consultar el usuario de la sesión.

El back autoriza por sala: quien la crea queda como anfitrión (`owner_id`) y es
el único que puede modificarla o borrarla, armar grupos, lanzar o terminar la
sesión en vivo y desasignar presentaciones. El anfitrión o un miembro pueden
asignar la presentación de su grupo. Sin token la petición es anónima: solo
alcanza para consultar datos públicos.

## Unirse a una sala

`/unirse?sala=<id>` muestra la sala y pide la clave, pero **exige haber iniciado
sesión**: sin JWT redirige a `/login` con el destino en `state.from` y, después
del login (o el registro), vuelve al enlace. `POST /api/rooms/:id/members`
valida la clave (403 = incorrecta) y usa el `userId` de la sesión, así que la
pertenencia queda asociada a una cuenta real. La clave en claro **vive en el servidor**; el
anfitrión la obtiene con `GET /rooms/:id/access-key` desde cualquier dispositivo u origen, y
puede rotarla con **"Generar nueva clave"** en la cabecera de la sala. Los demás solo ven
`has_access_key`.

El anfitrión puede **cambiar el formato cuando quiera** desde "Cambiar modo de presentación".
Al pasar a individual se borran los grupos armados (con sus integrantes y presentaciones) y se
limpia la sesión en vivo; al volver a grupos se crean otros nuevos con la cantidad y el límite
elegidos. Los cambios se guardan en la sala y los demás los ven en su próxima actualización.

En **formato de grupos**, las tarjetas para elegir equipo y cargar archivo son solo para los
participantes. El anfitrión ve un listado de solo lectura con cada grupo y sus integrantes, no
puede unirse ni cargar, y define el orden desde "Preparar sala": el sorteo ("Al azar") reordena
directamente la lista de integrantes/grupos de la sala, sin una lista propia en el panel, y se
guarda en la sala (`PATCH /rooms/:id/order`) para que todos los integrantes vean el mismo orden
en su próxima actualización. El botón "Ver diapositivas"
aparece solo para quien integra ese grupo: el preview (metadatos e imágenes) se sirve desde
`rooms`, que valida la pertenencia; los demás reciben 403 aunque conozcan el UUID. Dentro de cada grupo, solo el
primer integrante (marcado como "Encargado") ve los botones para cargar y quitar la presentación;
los demás ven una aclaración. Cada uno puede abrir **"Ver diapositivas"** de su propia
presentación: el preview individual también es privado y solo lo responde el backend para quien
la subió. Si el último integrante sale, el backend quita la presentación del
grupo automáticamente: el anfitrión no tiene que hacer nada.

En **formato individual**, cada participante carga y publica su propio PDF/PPTX desde la
sala (`components/rooms/IndividualPresentations.tsx`): se sube a `presentations` y se
asigna con `POST /rooms/:id/my-presentation`. Los participantes **no tienen botón
"Presentar"**: solo cargan o quitan su archivo. El anfitrión arma la sala, define el
orden (`PrepareRoom`) y al iniciar se publica la presentación del primero de ese orden
y se entra al vivo. No figura en la lista. Si quiere exponer la suya, usa el modo
"Presentación propia", que sube el archivo y lo publica directamente. El listado se actualiza por polling y `LivePage` sigue mostrando
la sesión en vivo resultante. Cuando una sesión arranca, `RoomPage` detecta el cambio en su
polling de `live-session` y redirige a todos los presentes a la pantalla en vivo (si alguien
llega cuando ya estaba en curso, no se lo saca de la sala). Simétricamente, `LivePage` detecta
que la sesión pasó de activa a inexistente y devuelve a los espectadores al inicio de la sala;
el anfitrión navega al confirmar "Finalizar presentación". Antes de ese cierre, el botón dice
**"Siguiente exposición"**: publica la presentación del siguiente turno del orden (por usuario en
formato individual, por grupo en formato grupal, saltando grupos sin archivo) y mantiene a todos
en el vivo; cuando no queda nadie, sí termina la sesión y vuelven a la sala. En `LivePage`, el control de
diapositivas y del lienzo lo tiene el anfitrión **o** el dueño de la presentación individual
en vivo: se resuelve cruzando `presentation_id` con `/rooms/:id/user-presentations`, así que
el permiso sigue al turno. Los trazos del canvas se mandan por el WebSocket y vuelven en cada
`SlideState` (`annotations`), así que todos ven el dibujo en vivo; se limpian al pasar de
diapositiva o con "Borrar todo". Al publicar, `setLiveSession` y `publishMyPresentation`
llaman a `POST /presentations/:id/reset` para que cada emisión arranque en la diapositiva 1
y sin dibujos heredados.

Estructura: `pages/` (pantallas), `components/` (ui, layout, live, rooms),
`services/` (acceso al gateway), `types/`, `styles/`. Colores y tipografía:
tokens en `src/styles/index.css`.

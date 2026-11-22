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
  código HTTP y el mensaje `{"error": ...}` que devuelve el backend.
- `services/rooms.ts`: usuarios, salas, miembros, grupos (servicio `rooms`).
- `services/live.ts`: upload/metadata de presentaciones, WebSocket y control
  (servicios `presentations` y `realtime`).
- `types/index.ts`: tipos `Api*` que espejan el JSON de los servicios 1:1, y
  view models de la UI derivados de ellos.

Pendientes para cuando crezca el backend: endpoint de login (la sesión sigue
siendo local en `context/SessionContext.tsx`). El flujo de invitado ya es real:
`/unirse?sala=<id>` muestra la sala y solo pide la clave; crea una identidad
efímera (`POST /api/users` con nombre, email y contraseña autogenerados) y une
con `POST /api/rooms/:id/members` validando la clave (403 = clave incorrecta).
Las claves de sala se recuerdan por dispositivo (`utils/accessKey.ts`) porque el
backend solo guarda el hash.

Estructura: `pages/` (pantallas), `components/` (ui, layout, live, rooms),
`services/` (acceso al gateway), `types/`, `styles/`.
Colores y tipografía: tokens en `src/styles/index.css`.

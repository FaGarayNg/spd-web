# spd-web · backend

Sincronización de presentaciones en tiempo real. Un presentador sube un `.pptx` o un `.pdf`, que el servidor convierte en una imagen por diapositiva; después controla qué diapositiva se muestra y todos los visores conectados por WebSocket la ven cambiar al instante. Los usuarios, las salas, sus grupos (con sus integrantes) y las presentaciones asignadas a cada grupo se guardan en PostgreSQL. El anfitrión y quienes se unen a su sala entran con usuario y contraseña (JWT) y la clave de la sala.

## Arquitectura

Cuatro microservicios, cada uno dueño de un dominio y desplegable por separado:

```
 Frontend (React) ──►  gateway :8080      API pública única + CORS
                              │
        ┌─────────────────────┼───────────────────────┐
        ▼                     ▼                       ▼
  presentations :8081   realtime :8082          rooms :8083
  /api/presentations    /api/presentations/     /api/auth/login, /api/users
    /upload, /:id,        :id/control           /api/rooms, /api/groups
    /:id/slides/:n      /ws/presentation/:id    /api/rooms/:id/live-session

  subida y conversión   sesiones en memoria,    login (JWT), usuarios, salas,
  PPTX/PDF → PNG        WebSockets y control    grupos, presentaciones y sesión
                                                en vivo (PostgreSQL)
        │                                             │
        ▼                                             ▼
  UPLOAD_DIR/<uuid>/                            PostgreSQL (GORM)
  001.png, 002.png…

  realtime y rooms ──HTTP──► presentations: GET /api/presentations/:id (slide_count)
```

| Servicio        | Dominio                                                           | Puerto |
|-----------------|-------------------------------------------------------------------|--------|
| `gateway`       | Punto de entrada: enruta cada endpoint al servicio dueño          | 8080   |
| `presentations` | Archivos: subida, conversión de PPTX y PDF a PNG, imágenes        | 8081   |
| `realtime`      | Sesiones en vivo: diapositiva actual, visores WebSocket, control  | 8082   |
| `rooms`         | Login (JWT), usuarios, salas, miembros, grupos, presentaciones y sesión en vivo (PostgreSQL) | 8083 |

Los servicios no comparten disco, memoria ni base de datos: `realtime` y `rooms` solo conocen
las presentaciones consultando la API de `presentations`, y solo `rooms` usa PostgreSQL.

```
backend/
├── internal/platform/          infraestructura común: config (entorno y .env), logs, servidor  Gin, apagado
└── services/
    ├── gateway/                main.go + internal/gateway (proxy inverso, CORS)
    ├── presentations/          main.go + internal/
    │   ├── api/                handlers REST
    │   ├── presentation/       casos de uso (crear, consultar, resolver diapositiva)
    │   ├── storage/            servicio de archivos: guardado con límite, orden, publicación atómica
    │   └── convert/            PPTX → PDF (LibreOffice) → PNG (pdftoppm); un PDF va directo a pdftoppm
    ├── realtime/               main.go + internal/
    │   ├── hub/                patrón Hub: estado y difusión, sin locks
    │   ├── api/                endpoint de control + bucles de lectura/escritura del WebSocket
    │   └── catalog/            cliente HTTP del servicio presentations
    └── rooms/                  main.go + internal/
        ├── api/                handlers REST (incluye login y /api/users/me)
        ├── domain/             entidades, reglas (dueño/miembro) y casos de uso; no conoce GORM
        ├── store/              persistencia con GORM: modelos, migración, transacciones, borrado lógico
        ├── catalog/            cliente HTTP del servicio presentations
        └── dbtest/             esquema PostgreSQL aislado para los tests de integración
```

Cada servicio guarda su código en su propio `internal/`. El compilador de Go impide que un
servicio importe el código interno de otro, así que la frontera entre dominios no se puede
saltar por accidente.

## Puesta en marcha

Requisitos:

- Go 1.26 o superior.
- poppler (`pdftoppm`) para convertir cualquier subida y, además, LibreOffice (`soffice`) para
  los `.pptx`. Si falta alguno, las subidas que lo necesitan responden 503: sin LibreOffice,
  los `.pdf` funcionan igual.
- PostgreSQL para `rooms`. Basta un usuario y una base (p. ej. `createuser -P spd` y
  `createdb -O spd spd`) y apuntar `DATABASE_URL` a ella. Al arrancar, `rooms` crea o actualiza
  las tablas.

```sh
cp .env.example .env  # configuración local (ver Configuración)
make run              # los cuatro servicios en paralelo; Ctrl+C los detiene
make run-gateway      # o cada uno por separado: run-presentations, run-realtime, run-rooms
make build            # binarios en bin/
make test             # todos los tests (se omiten los que necesitan algo que no está disponible)
make test-race        # con el detector de carreras
```

Los tests de integración de `rooms` necesitan PostgreSQL y solo se ejecutan si se define
`TEST_DATABASE_URL`. Cada test crea su propio esquema y lo borra al terminar, así que puede
usarse la misma base de desarrollo:

```sh
TEST_DATABASE_URL='postgres://spd:spd@localhost:5432/spd?sslmode=disable' make test
```

El frontend solo habla con el gateway (`http://localhost:8080`). Por defecto se admite el
origen de Vite (`http://localhost:5173`) para CORS y WebSocket.

## API

Todas las rutas pasan por el gateway. Los errores siempre tienen la forma `{"error": "..."}`.
Las operaciones que requieren sesión esperan la cabecera `Authorization: Bearer <token>`; el
gateway la reenvía sin verificarla y el servicio `rooms` valida el JWT (ver Autenticación).

### `POST /api/presentations/upload`

Cuerpo `multipart/form-data` con el campo `file`: un `.pptx` o un `.pdf`. El formato se
deduce de la extensión, y el contenido tiene que corresponder a ella.

```sh
curl -F file=@presentacion.pptx http://localhost:8080/api/presentations/upload
curl -F file=@informe.pdf http://localhost:8080/api/presentations/upload
```

```json
{
  "presentation_id": "0b8e4c3e-7f4a-4f0e-8d55-2f8f0f6a9b22",
  "slide_count": 12,
  "slides": [
    {"slide": 1, "file": "001.png", "url": "/api/presentations/0b8e…/slides/1"}
  ]
}
```

| Estado | Motivo                                                                             |
|--------|------------------------------------------------------------------------------------|
| 201    | Creada (cabecera `Location`)                                                       |
| 400    | Contenido que no corresponde a la extensión (PPTX o PDF inválido), falta `file`    |
| 413    | Supera `MAX_UPLOAD_MB` u otro límite (diapositivas, tamaño descomprimido del PPTX) |
| 415    | Extensión distinta de `.pptx` o `.pdf` (los `.zip` de imágenes ya no se admiten)   |
| 422    | No se pudo convertir: documento dañado o cifrado, o se superó `CONVERT_TIMEOUT`    |
| 503    | El servidor no tiene pdftoppm o, para un `.pptx`, LibreOffice                      |

Cada diapositiva del PPTX, o cada página del PDF, se renderiza como PNG con el lado mayor de
`RENDER_MAX_PX` píxeles y se guarda como `001.png`, `002.png`… en el orden del documento. Un
PPTX pasa por LibreOffice (PPTX → PDF) y después por pdftoppm (PDF → PNG); un PDF va directo
a pdftoppm.

### `GET /api/presentations/:id`

Metadatos y lista de diapositivas de una presentación, con el mismo formato que la respuesta
de subida. Sirve para precargar todas las imágenes.

### `GET /api/presentations/:id/slides/:slide_id`

Devuelve la imagen. `slide_id` es el número de diapositiva, empezando en 1, o el nombre del
archivo (`003.png`). Las presentaciones son inmutables, así que la respuesta se puede cachear
indefinidamente (`Cache-Control: immutable`). Los endpoints **privados** de preview (`/preview` y
`/my-presentation/slides/:slide_id`, y los equivalentes de grupo) responden `no-store`: una
presentación puede reemplazarse y las URLs individuales no cambian, así que un caché del
navegador podría mostrar las imágenes anteriores.

### `POST /api/presentations/:id/control`

Cambia la diapositiva actual y la difunde a todos los visores de esa presentación.

```sh
curl -X POST -H 'Content-Type: application/json' -d '{"action":"next"}' \
  http://localhost:8080/api/presentations/<id>/control
```

| Cuerpo                                | Efecto                                    |
|---------------------------------------|-------------------------------------------|
| `{"action": "next"}`                  | Siguiente (se detiene en la última)       |
| `{"action": "prev"}`                  | Anterior (se detiene en la primera)       |
| `{"slide": 3}` o `{"slide_index": 3}` | Ir a la diapositiva 3 (empieza en 1)      |
| `{"action": "goto", "slide": 3}`      | Igual que la anterior                     |

Responde 200 con el estado resultante, con el mismo formato que el mensaje del WebSocket.
Responde 400 si el comando es inválido o la diapositiva está fuera de rango, 404 si la
presentación no existe y 413 si el cuerpo supera 1 KB.

### `POST /api/presentations/:id/reset`

Deja la sesión como nueva: diapositiva 1 y sin anotaciones, y lo difunde a los visores conectados.
El front lo llama justo después de publicar una presentación, porque `realtime` conserva la sesión
en memoria entre emisiones: sin este reset, volver a iniciar la misma presentación recuperaría el
dibujo anterior. Responde 200 con el mismo `SlideState` del WebSocket.

### `GET /ws/presentation/:id` (WebSocket)

Al conectarse, el visor recibe de inmediato la diapositiva actual. Después recibe un mensaje
por cada cambio:

```json
{"type": "slide", "presentation_id": "0b8e…", "slide": 3, "slide_count": 12,
 "url": "/api/presentations/0b8e…/slides/3", "annotations": [
   {"id": "trazo-1", "color": "#1B3A6B", "width": 5, "eraser": false,
    "points": [{"x": 10, "y": 20}, {"x": 30, "y": 40}]}
 ]}
```

Cada mensaje es el estado completo (diapositiva **y anotaciones**). Un visor lento puede saltarse
estados intermedios, pero siempre recibe el último y nunca los recibe desordenados.

Quien presenta puede mandar trazos por el mismo WebSocket (los visores solo leen):

```json
{"type": "annotation", "annotation": {"id": "trazo-1", "color": "#1B3A6B", "width": 5,
 "eraser": false, "points": [{"x": 10, "y": 20}, {"x": 30, "y": 40}]}}
```

Cada envío reemplaza el trazo con ese `id` (el frontend manda el trazo completo hasta ese punto).
`{"type": "clear"}` borra las anotaciones y cambiar de diapositiva también las limpia. Hay topes
(200 trazos, 2000 puntos por trazo, 16 KiB por mensaje) y los mensajes inválidos se ignoran sin
cortar la conexión.

Códigos de cierre que el frontend puede leer en `event.code`:

| Código | Significado                                   | ¿Reconectar?           |
|--------|-----------------------------------------------|------------------------|
| 4404   | La presentación no existe                     | No                     |
| 1001   | El servidor se está reiniciando               | Sí                     |
| 1013   | El servicio presentations no responde         | Sí, con espera         |
| 1006   | Corte de red                                  | Sí, con espera         |

### Autenticación y permisos (servicio `rooms`)

`POST /api/auth/login` intercambia correo y contraseña por un JWT HS256 con el id del usuario
(`sub`) y 24 h de validez (`platform.TokenTTL`). El cliente lo manda como
`Authorization: Bearer <token>`; el gateway solo reenvía la cabecera y quien la consume verifica
la firma con `JWT_SECRET` (secreto compartido por los servicios que firman o verifican sesiones).
Sin cabecera la petición es anónima: alcanza para consultar datos públicos y, a nivel de API, para
unirse con un `user_id` y la clave (el front no lo hace: exige sesión iniciada). Con un token
inválido o vencido responde 401.

```sh
curl -X POST -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","password":"secreta123"}' \
  http://localhost:8080/api/auth/login
```

```json
{"token": "<jwt>", "user": {"id": 1, "full_name": "Ana López", "email": "ana@example.com", "roles": [], "created_at": "2026-10-09T12:00:00Z", "updated_at": "2026-10-09T12:00:00Z"}}
```

`GET /api/users/me` devuelve el usuario de la sesión (401 si no hay una válida). El alta de
usuarios (`POST /api/users`) es pública: es el registro.

La autorización dentro de una sala es por dueño/miembro:

| Identidad | Permisos |
|-----------|----------|
| Anónima (sin token) | Consultar salas, grupos y usuarios; ver la sesión en vivo; unirse a una sala (con `user_id` y la clave, si la tiene) y a un grupo (si ese usuario es miembro de la sala). La UI exige login para unirse |
| Dueño de la sala (*anfitrión*, `owner_id`) | Crear la sala (el creador queda como dueño), modificarla o borrarla, armar/modificar/borrar grupos, lanzar o terminar la sesión en vivo y desasignar presentaciones |
| Miembro de la sala | Asignar la presentación del propio grupo y cambiar sus diapositivas; en formato individual, cargar la propia y publicarla en vivo. El anfitrión queda fuera de ese listado |

Una sala sin dueño (`owner_id: 0`, la creada antes de que existiera el login) no puede ser
administrada por la API. Donde se exige sesión, su ausencia responde 401 y la falta de permiso
403. El campo `roles` de los usuarios se guarda y se muestra, pero hoy no regula permisos.

### Usuarios, salas, grupos y presentaciones asignadas (servicio `rooms`)

CRUD en JSON sobre PostgreSQL. Los `DELETE` son borrados lógicos (ver Decisiones de diseño):
lo borrado deja de verse en la API, pero sigue en la base de datos.

| Ruta                                             | Métodos                  | Recurso                                                         |
|--------------------------------------------------|--------------------------|-----------------------------------------------------------------|
| `/api/users`                                     | `GET`, `POST`            | Usuarios                                                        |
| `/api/users/:id`                                 | `GET`, `PATCH`, `DELETE` | Un usuario (borrarlo lo saca de sus salas y grupos)             |
| `/api/users/:id/rooms`                           | `GET`                    | Salas de las que es miembro                                     |
| `/api/users/:id/groups`                          | `GET`                    | Grupos de los que es integrante                                 |
| `/api/rooms`                                     | `GET`, `POST`            | Salas                                                           |
| `/api/rooms/:id`                                 | `GET`, `PATCH`, `DELETE` | Una sala (borrarla borra sus grupos, presentaciones y miembros) |
| `/api/rooms/:id/order`                           | `PATCH`                  | Guarda el orden de presentación elegido (solo el anfitrión)      |
| `/api/rooms/:id/access-key`                      | `GET`                    | Clave de ingreso en claro (solo el anfitrión)                    |
| `/api/rooms/:id/members`                         | `GET`, `POST`            | Miembros (`GET` los lista, ver abajo; `POST` une a uno)         |
| `/api/rooms/:id/members/:user_id`                | `DELETE`                 | Saca a un usuario de la sala y de sus grupos (uno mismo puede irse; sacar a otro es solo del anfitrión) |
| `/api/rooms/:id/groups`                          | `GET`, `POST`            | Grupos de la sala, en orden de paso para presentar              |
| `/api/rooms/:id/live-session`                    | `GET`, `PUT`, `DELETE`   | Sesión en vivo: qué presentación se proyecta en la sala         |
| `/api/rooms/:id/user-presentations`              | `GET`                    | Presentaciones propias de los participantes (formato individual) |
| `/api/rooms/:id/my-presentation`                 | `GET`, `POST`, `DELETE`  | Presentación propia del usuario de la sesión                    |
| `/api/rooms/:id/my-presentation/live`            | `PUT`                    | Publicar la presentación propia en la sesión en vivo            |
| `/api/groups/:id`                                | `GET`, `PATCH`, `DELETE` | Un grupo (borrarlo borra sus presentaciones e integrantes)      |
| `/api/groups/:id/encargado`                      | `PATCH`                  | Transfiere el rol de encargado a otro integrante                |
| `/api/groups/:id/members`                        | `GET`, `POST`            | Integrantes (`GET` los lista, ver abajo; `POST` une a uno)      |
| `/api/groups/:id/members/:user_id`               | `DELETE`                 | Saca a un usuario del grupo                                     |
| `/api/groups/:id/presentations`                  | `GET`, `POST`            | Presentaciones asignadas al grupo                               |
| `/api/groups/:id/presentations/:presentation_id` | `GET`, `PATCH`, `DELETE` | Una presentación asignada                                       |
| `/api/groups/:id/presentations/:presentation_id/preview` | `GET`             | Metadatos del preview: solo integrantes del grupo                |
| `/api/groups/:id/presentations/:presentation_id/slides/:slide_id` | `GET` | Imagen del preview: solo integrantes del grupo                 |

`POST` responde 201 con el recurso y la cabecera `Location`; `GET`, `PATCH` y `PUT`, 200 con el
recurso; `DELETE`, 204 sin cuerpo. `PATCH` cambia solo los campos enviados.

`PATCH /api/rooms/:id/order` guarda el orden del sorteo en la sala (`{"kind":"groups"|"individual",
"ids":[...]}`; lista vacía = orden natural). Lo escribe solo el anfitrión y `GET /api/rooms/:id`
lo devuelve a todos, así los integrantes ven el mismo orden sin depender de lo que tenga cada
navegador en memoria.

Quitar una presentación asignada (`DELETE /api/groups/:id/presentations/:presentation_id`) puede
hacerlo el anfitrión o el **encargado** del grupo (su primer integrante), que es quien la cargó.
Los demás integrantes reciben 403. Cuando el último integrante sale del grupo (o sale de la sala
o se borra su usuario), `store` quita la presentación asignada **automáticamente** en la misma
transacción: un grupo vacío no necesita que nadie intervenga.

`GET /api/rooms/:id/my-presentation/preview` y `GET /api/rooms/:id/my-presentation/slides/:slide_id`
son el equivalente del formato individual y solo responden para el dueño de esa presentación;
cualquier otro integrante recibe 404.

El preview de las diapositivas de un grupo **no** usa el endpoint público de `presentations`:
`GET /preview` y `GET /slides/:slide_id` pasan por `rooms`, que exige sesión y comprueba que el
usuario integre ese grupo (401 sin sesión, 403 si no). El anfitrión no puede espiar un grupo del
que no forma parte. Las imágenes de la presentación en vivo siguen siendo públicas: son las que
ven todos los espectadores.

En formato individual, `POST /api/rooms/:id/my-presentation` asigna la propia con
`{"presentation_id": "<uuid>", "slides": [1, 2]}` (`slides` opcional; sin él, todas). El usuario
sale del JWT, no del cuerpo: nadie puede adjudicarse la de otro. Un usuario tiene a lo sumo una
presentación activa por sala; volver a asignar **reemplaza** el UUID y las diapositivas de esa
misma fila (estuviera activa o borrada), así que el preview no puede mostrar el archivo anterior.
`GET /user-presentations`
lista las de la sala (es público, como los integrantes) y `PUT /my-presentation/live` la publica
su dueño. El anfitrión no aparece en ese listado y no puede cargar ni publicar por estos
endpoints: arma la sala y define el orden; para exponer la suya usa "Presentación propia"
(upload directo + `PUT /live-session`). Borrar la sala, el usuario o la pertenencia también borra
estas presentaciones.

La sesión en vivo (`GET`/`PUT`/`DELETE /api/rooms/:id/live-session`) es el puntero que publica el
anfitrión para que los espectadores sepan qué presentación entrar: `GET` es público y responde 404
si no hay ninguna; `PUT` publica o reemplaza (`{"presentation_id": "<uuid>"}`) y `DELETE` la
termina (idempotente, 204 aunque no hubiera sesión). Publicar o terminar exige ser el dueño de la
sala, y la presentación debe existir en `presentations` (422 si no, 503 si no responde). No es la
sesión del servicio `realtime`: esa vive en su memoria.

```sh
curl -X POST -H 'Content-Type: application/json' \
  -d '{"full_name":"Ana López","email":"ana@example.com","password":"secreta123","roles":["presentador"]}' \
  http://localhost:8080/api/users
```

```json
{"id": 1, "full_name": "Ana López", "email": "ana@example.com", "roles": ["presentador"],
 "created_at": "2026-10-09T12:00:00Z", "updated_at": "2026-10-09T12:00:00Z"}
```

| Recurso                    | Campos que se envían                                          | Reglas                                                     |
|----------------------------|---------------------------------------------------------------|------------------------------------------------------------|
| Usuario                    | `full_name`, `email`, `password`, `roles` (opcional)          | Correo único sin distinguir mayúsculas; contraseña de al menos 8 caracteres (máximo 72 bytes), nunca se devuelve |
| Sala                       | `name`, `url` (opcional), `access_key` (opcional), `format` (opcional) | `url` absoluta http(s); la clave (al menos 4 caracteres, máximo 72 bytes) se guarda en el servidor junto a su hash. Los listados solo traen `has_access_key`; `GET /api/rooms/:id/access-key` la devuelve en claro **solo al anfitrión**. `PATCH` con `"access_key": ""` la quita. `format` es `groups` (por grupo) o `individual` (por participante). El alta requiere sesión y el creador queda como `owner_id` (anfitrión); las respuestas incluyen `owner_id` y `format` |
| Miembro (`POST …/members`) | `user_id`, `access_key` (si la sala tiene clave)              | 201 al entrar o volver; 200 si ya era miembro; 403 con la clave incorrecta. Responde `{"user_id", "room_id", "joined_at"}` |
| Grupo                      | `limit`, `priority`                                           | Ambos obligatorios en el alta, de 1 en adelante. `limit` es el cupo del grupo (máximo de integrantes): un `PATCH` no puede dejarlo por debajo de los integrantes actuales. `priority` es su prioridad de paso a la hora de presentar: los grupos de una sala se listan en ese orden (1 primero; a igual prioridad, el creado antes) |
| Integrante (`POST …/groups/:id/members`) | `user_id`                                       | Tiene que ser miembro de la sala del grupo (409 si no). 201 al entrar o volver; 200 si ya era integrante; 409 si el grupo está completo. Un usuario puede estar en varios grupos, también de la misma sala. Responde `{"user_id", "group_id", "joined_at"}` |
| Presentación               | `presentation_id`, `slides` (opcional)                        | `presentation_id` es el UUID del servicio presentations y debe existir allí. `slides` son números de diapositiva sin repetir, de 1 a `slide_count`; si falta, se asignan todas. Una presentación está en un solo grupo a la vez |
| Presentación propia        | `presentation_id`, `slides` (opcional) en `/my-presentation` | Igual regla de UUID/diapositivas, pero pertenece al usuario de la sesión y a la sala; una por usuario y sala. Solo miembros o el anfitrión pueden asignarla |

```json
{"presentation_id": "0b8e4c3e-7f4a-4f0e-8d55-2f8f0f6a9b22", "group_id": 3, "slides": [1, 2, 5],
 "created_at": "2026-10-09T12:00:00Z", "updated_at": "2026-10-09T12:00:00Z"}
```

Los listados de miembros de una sala y de integrantes de un grupo muestran a cada usuario
solo lo que necesitan ver los demás: sin su correo ni las fechas de su cuenta, que solo
devuelven `/api/users` y `/api/users/:id`. `joined_at` es cuándo entró. Los integrantes de un
grupo se listan por **fecha de ingreso** (no por id): el primero es el "Encargado", que conserva
el puesto aunque después se sume alguien con id menor.

```json
[{"id": 1, "full_name": "Ana López", "roles": ["presentador"], "joined_at": "2026-10-09T12:00:00Z"}]
```

| Estado | Motivo                                                                                                                                      |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------|
| 400    | id o JSON inválido, campo desconocido o dato que no cumple las reglas (el mensaje dice cuál)                                                |
| 401    | Falta la sesión donde se requiere, o el token es inválido o vencido (incluye correo/contraseña incorrectos en el login)                    |
| 403    | Clave de ingreso incorrecta, o la identidad autenticada no tiene permiso sobre la sala                                                    |
| 404    | El recurso no existe o está borrado                                                                                                         |
| 409    | Correo ya usado, presentación ya asignada, grupo completo, cupo menor que los integrantes, o usuario que no es miembro de la sala del grupo |
| 413    | Cuerpo de más de 1 MB                                                                                                                       |
| 422    | La presentación no existe en el servicio presentations                                                                                      |
| 503    | El servicio presentations no responde                                                                                                       |

## Configuración

Por variables de entorno o en un archivo `.env`. Todas tienen un valor por defecto pensado
para desarrollo local.

Al arrancar, cada servicio carga con [godotenv](https://github.com/joho/godotenv) el `.env`
de su directorio de trabajo (`backend/` si se lanza con `make`). `.env.example` es la
plantilla con lo que se suele ajustar: las URL de los servicios a los que enruta el gateway,
la carpeta de subidas (`UPLOAD_DIR`), el tamaño máximo de archivo en MB (`MAX_UPLOAD_MB`), la
base de datos de `rooms` (`DATABASE_URL`) y el secreto con el que se firman los JWT
(`JWT_SECRET`).

- Las variables definidas en el entorno tienen prioridad sobre el archivo: un despliegue
  puede cambiar cualquier valor sin tocarlo.
- Si no hay `.env`, se usan el entorno y los valores por defecto (en producción lo normal es
  no tenerlo). Si está mal formado, el servicio no arranca e indica el error.
- Cualquier variable de la tabla puede ir en el `.env`, incluida `GIN_MODE`.


| Variable                     | Servicio             | Defecto                  |
|------------------------------|----------------------|--------------------------|
| `HTTP_ADDR`                  | todos                | `:8080` / `:8081` / `:8082` / `:8083` |
| `LOG_LEVEL`, `LOG_FORMAT`    | todos                | `info`, `text` (o `json`) |
| `GIN_MODE`                   | todos                | `debug` (usar `release` en producción) |
| `ALLOWED_ORIGINS`            | gateway, realtime    | `http://localhost:5173`  |
| `PRESENTATIONS_URL`          | gateway, realtime, rooms | `http://localhost:8081` |
| `REALTIME_URL`               | gateway              | `http://localhost:8082`  |
| `ROOMS_URL`                  | gateway              | `http://localhost:8083`  |
| `UPLOAD_DIR`                 | presentations        | `./uploads`              |
| `MAX_UPLOAD_MB`              | presentations        | `10` (tamaño máximo del archivo subido) |
| `MAX_SLIDES`                 | presentations        | `500` (diapositivas o páginas por presentación) |
| `MAX_EXTRACTED_MB`           | presentations        | `1024` (tamaño descomprimido de un PPTX) |
| `SOFFICE_BIN`, `PDFTOPPM_BIN`| presentations        | `soffice`, `pdftoppm`    |
| `CONVERT_TIMEOUT`            | presentations        | `3m`                     |
| `MAX_CONCURRENT_CONVERSIONS` | presentations        | `2`                      |
| `RENDER_MAX_PX`              | presentations        | `1920` (lado mayor del PNG) |
| `SESSION_IDLE_TTL`           | realtime             | `24h` (`0` = nunca liberar) |
| `DATABASE_URL`               | rooms                | `postgres://spd:spd@localhost:5432/spd?sslmode=disable` |
| `DB_MAX_CONNS`               | rooms                | `10` (conexiones del pool) |
| `JWT_SECRET`                 | rooms                | `dev-secret-solo-para-desarrollo` (definir uno propio en producción) |
| `TEST_DATABASE_URL`          | tests de rooms       | sin definir: se omiten los tests de PostgreSQL |

`ALLOWED_ORIGINS` acepta una lista separada por comas. En producción debe contener solo el
dominio real del frontend; definida vacía, solo se admite el mismo origen.

`JWT_SECRET` firma y verifica los tokens de sesión. Hoy lo usa `rooms` (que emite los JWT en el
login); cualquier otro servicio que empiece a verificar sesiones debe compartir el mismo valor.
El defecto existe solo para desarrollo local: en producción hay que definir un secreto propio.

## Decisiones de diseño

**Concurrencia en `realtime` (patrón Hub).** Todo el estado lo posee una única goroutine
(`Hub.Run`). Los handlers le envían altas, bajas y comandos por canales, así que no hay
memoria compartida ni locks. Cada visor tiene un buzón de capacidad 1 donde el último estado
sustituye al anterior. El Hub deposita en él sin bloquearse nunca, de modo que un visor
lento no frena a nadie. Por conexión hay dos goroutines: una única escritora, con plazo por
mensaje y ping cada 30 s, y una lectora, que procesa los pong y el cierre. Las consultas de
red al catálogo se hacen fuera del bucle del Hub.

**Seguridad de las subidas.** Solo se aceptan `.pptx` y `.pdf`, y el contenido se comprueba
antes de llegar al conversor. Un PPTX debe ser un paquete OOXML real (con
`ppt/presentation.xml`), con un número de partes acotado y un tamaño descomprimido declarado
que no supere `MAX_EXTRACTED_MB`, lo que frena las zip bombs. Un PDF debe empezar por la firma
`%PDF-`. El archivo se copia a disco en streaming, sin cargarlo en memoria, y la copia se corta
al superar `MAX_UPLOAD_MB`. Las imágenes que genera el conversor se verifican por sus magic
bytes antes de publicarse. Cada subida trabaja en `UPLOAD_DIR/.staging/<uuid>` y se publica con
un `rename` atómico, así que nunca se ve una presentación a medias.

**Conversión.** Convertir un PPTX directamente a PNG con LibreOffice solo exporta la primera
diapositiva. Por eso se convierte a PDF y se rasteriza cada página con `pdftoppm`. Un PDF
subido se salta LibreOffice y va directo a `pdftoppm`: se convierte más rápido y no necesita
LibreOffice instalado. Las conversiones simultáneas de ambos formatos están limitadas
(`MAX_CONCURRENT_CONVERSIONS`), cada una usa un perfil de LibreOffice propio y se renderizan
como mucho `MAX_SLIDES` + 1 páginas. Si se agota el tiempo, se mata el grupo de procesos
completo, sin dejar `soffice.bin` huérfanos.

**Capas de `rooms`.** `domain` tiene las entidades, las reglas (validaciones, hash de secretos,
clave de ingreso, diapositivas válidas) y los casos de uso, y no conoce GORM: declara las
interfaces que necesita, `Store` y `Catalog`. `store` implementa `Store` con GORM y PostgreSQL,
`catalog` implementa `Catalog` con la API de `presentations` y `api` traduce HTTP a casos de
uso. `main.go` los conecta.

**Autenticación y autorización (`rooms`).** El login emite un JWT HS256 con el id del usuario y
24 h de validez; no hay sesiones en servidor. `currentUser` lee la cabecera `Bearer`: sin ella la
petición sigue anónima (consultas públicas), y con un token inválido responde 401. Las
reglas de la sala viven en `domain/authz.go`: ser dueño (`owner_id`) habilita administrar la sala,
sus grupos y la sesión en vivo; ser dueño o miembro habilita asignar la presentación del propio
grupo o la propia (formato individual) y publicarla. El gateway reenvía la cabecera sin
inspeccionarla, así que la confianza se decide en cada
servicio que la usa. Los roles del usuario se guardan y se exponen, pero aún no intervienen en la
autorización.

**Base de datos (`rooms`).** GORM sobre pgx, todo dentro de `store`. Al arrancar, `AutoMigrate`
crea o actualiza las tablas, los índices y las claves foráneas. Los nombres del modelo pasan a
inglés, como el resto del código:

| Modelo         | Tabla           | Columnas                                                              |
|----------------|-----------------|-----------------------------------------------------------------------|
| Usuario        | `users`         | `id`, `full_name`, `email`, `password_hash`, `roles text[]`           |
| DetalleSala    | `room_members`  | `user_id` y `room_id`: clave primaria compuesta y claves foráneas     |
| DetalleGrupo   | `group_members` | `user_id` y `group_id`: clave primaria compuesta y claves foráneas (n:m) |
| Sala           | `rooms`         | `id`, `name`, `url`, `access_key_hash`, `owner_id` (índice), `format`, `individual_order integer[]`, `group_order integer[]` |
| Grupo          | `groups`        | `id`, `room_id` (FK), `limit` (cupo), `priority` (prioridad de paso)  |
| Presentacion   | `presentations` | `id uuid` (el del servicio presentations), `group_id` (FK), `slides integer[]` |
| Presentación propia | `user_presentations` | `id`, `room_id` (FK), `user_id` (FK), `presentation_id uuid`, `slides integer[]`; única por `(room_id, user_id)` |
| Sesión en vivo | `live_sessions` | `room_id` (PK y FK), `presentation_id uuid`, `created_at` (= `started_at`) |

Todas las tablas tienen `created_at` y `deleted_at` (y, salvo `room_members` y `group_members`,
`updated_at`). `live_sessions` es la excepción: no tiene borrado lógico (terminar la sesión
borra la fila) ni `updated_at`.

**Borrado lógico.** `DELETE` marca la fila con `deleted_at` y todas las consultas excluyen las
filas marcadas. Como la fila sigue existiendo, las claves foráneas no propagan el borrado, así
que:

- El servicio borra en cascada él mismo, en una transacción: sala → grupos (con sus
  presentaciones e integrantes) y miembros; grupo → presentaciones e integrantes; usuario →
  pertenencias a salas y grupos. Quien sale de una sala sale también de sus grupos; si era encargado, el rol pasa automáticamente al
siguiente integrante de cada grupo (o queda vacío si no queda nadie).
- Cada alta bloquea a su padre con `SELECT … FOR SHARE` hasta terminar. Así, un alta concurrente
  no deja un hijo colgando de un padre recién borrado.
- El alta de un integrante bloquea el grupo con `FOR UPDATE`: las altas en un grupo pasan de a
  una, así dos no pueden ocupar a la vez la última plaza del cupo. También bloquea con
  `FOR SHARE` la pertenencia a la sala, así nadie queda en un grupo sin ser miembro de su sala.
- El correo es único solo entre los usuarios no borrados (índice único parcial
  `WHERE deleted_at IS NULL`; el servicio lo guarda en minúsculas): borrar un usuario libera su
  correo.
- `room_members`, `group_members` y `presentations` tienen clave natural, que no se puede
  repetir: volver a una sala o a un grupo, o reasignar una presentación quitada, reactiva la misma
  fila
  (`INSERT … ON CONFLICT … DO UPDATE … WHERE deleted_at IS NOT NULL`).

**Secretos.** Contraseñas y claves de ingreso se guardan como hash bcrypt y nunca salen en las
respuestas ni en los logs: GORM registra solo las consultas lentas o fallidas, y sin valores. Los
JWT no se guardan: se firman con `JWT_SECRET`, que en producción debe reemplazar al valor de
desarrollo.

**Presentaciones de `rooms`.** No hay clave foránea hacia `presentations`, porque está en otro
servicio. Al asignar una presentación o cambiar sus diapositivas, `rooms` consulta a
`presentations`: si no existe responde 422, y si las diapositivas no están en el rango
`1..slide_count`, 400.

**Apagado ordenado.** Ante SIGTERM, cada servicio deja de aceptar conexiones y espera a las
peticiones en curso. `realtime` además envía a cada visor un cierre 1001. Si un visor no lo
confirma en 3 s, cierra su conexión de forma forzada.

## Limitaciones conocidas

- **El endpoint de control no tiene autenticación.** Cualquiera que conozca el id de la
  presentación, que comparten todos los visores, puede cambiar la diapositiva. Antes de
  producción conviene emitir un token de presentador al subir y exigirlo en `/control`.
- **`realtime` guarda el estado en memoria.** Debe ejecutarse una sola instancia, o enrutar
  cada presentación siempre a la misma instancia. Para escalar en horizontal haría falta un
  bus compartido (Redis Pub/Sub, NATS).
- LibreOffice y pdftoppm procesan documentos no confiables. En producción conviene ejecutar
  `presentations` en un contenedor aislado y sin salida a internet.
- **No hay límite de intentos** de login ni de clave de ingreso (aunque las comparaciones con
  bcrypt encarecen cada intento). Conviene agregar rate limiting y bloqueo de cuentas.
- **La autorización es solo por dueño/miembro de la sala.** El campo `roles` de los usuarios se
  guarda y se muestra, pero todavía no regula permisos.
- **`JWT_SECRET` tiene un valor fijo para desarrollo.** Hay que definirlo en cada despliegue; si
  otro servicio pasa a verificar sesiones, debe compartir exactamente el mismo secreto.
- Los listados de `rooms` no están paginados.
- `AutoMigrate` solo añade tablas, columnas e índices. Para renombrar o borrar columnas hacen
  falta migraciones versionadas (p. ej. goose o golang-migrate).

# sync-app web

API de sincronización y (más adelante) panel de administración para la app Android offline-first [app](https://github.com/Mapachuelo/app).

La APK guarda los datos en SQLite local y los sincroniza por REST cuando recupera la red. Este repositorio implementa ese contrato sobre **Next.js + PostgreSQL**, empaquetado con **Podman**.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| F0 | Esqueleto Next.js + Prisma + Containerfile + `/api/health` | Hecha |
| F1 | API de sync (`POST/GET /api/users`) + tests de contrato | Hecha |
| F2 | API key + config runtime + logs en la APK (local) + `POST /api/client-logs`; login admin (web) pendiente | Parcial |
| F3 | Panel CRUD de usuarios | Pendiente |
| F4 | Import CSV/Excel + subida de archivos | Pendiente |
| F5 | Panel de sincronización + conflictos + auditoría | Pendiente |
| F6 | Backups, CI, docs de despliegue | Parcial (CI base) |

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node 22 |
| Framework | Next.js 16 (App Router, standalone) |
| Base de datos | PostgreSQL 17 |
| ORM | Prisma 7 + `@prisma/adapter-pg` |
| Validación | Zod 4 |
| IDs | UUID v7 (`uuidv7`) |
| Tests | Vitest 5 (unitarios + integración contra PostgreSQL) |
| Empaquetado | Podman (Containerfile multi-stage con pnpm) |

## Contrato API

| Endpoint | Auth | Respuesta |
|---|---|---|
| `POST /api/users` | `X-Api-Key` | `200 {server_time, users:[UserDto]}` / `409 {error:"documento_duplicado"}` |
| `GET /api/users?since=<ms>&limit=100` | `X-Api-Key` | `{server_time, users:[UserDto]}` con `updated_at > since` (incluye `deleted:true`) |
| `POST /api/client-logs` | `X-Api-Key` | `200 {received:n}`; lote de logs del dispositivo (≤200 entradas, ≤256 KB) |
| `GET /api/health` | — | `{status, db, server_time}` |

`UserDto`: `id`, `nombre`, `apellido`, `documento`, `phone`, `phone_previous`, `email`, `email_previous`, `address`, `address_previous`, `password`, `updated_at`, `deleted`.

Reglas garantizadas por la API:

- `POST /api/users` es **idempotente**: mismo `id` actualiza, nunca duplica.
- `updated_at` lo asigna el **servidor** con la secuencia `sync_seq` (monótona, base epoch ms). Los escritores toman un `pg_advisory_xact_lock`, de modo que el valor asignado y el orden de confirmación coinciden; el cursor `since` nunca pierde filas.
- `server_time` del pull es el `updated_at` del último registro devuelto: el cursor avanza solo por lo que la APK ya recibió y la página siguiente continúa donde quedó.
- `409` si el `documento` ya pertenece a otro usuario activo; se registra en `sync_conflicts` para revisión.
- El índice único de `documento` es parcial (`WHERE deleted = false`): el soft delete libera el documento.
- `password` (SHA-256 hex que envía la APK) se guarda en `password_hash` y **nunca se devuelve** en el pull.

## Logs de la app

La APK puede enviar lotes de logs a `POST /api/client-logs` (mismo `X-Api-Key`) desde la pantalla Diagnóstico. Cada lote queda en la tabla `client_logs` con `device_id`, `app_version`, `base_url`, las entradas (jsonb), su cantidad y `received_at`. El panel para verlos llegará en F5; mientras tanto se consultan por SQL:

```bash
podman exec sync-app-db psql -U syncapp -d syncapp \
  -c "SELECT received_at, device_id, entries_count FROM client_logs ORDER BY received_at DESC LIMIT 10"
```

## Puesta en marcha (desarrollo)

Requisitos: Node 22 + pnpm 10, Podman.

```bash
# 1) Base de datos de desarrollo
podman run -d --name syncapp-dev-db \
  -e POSTGRES_USER=syncapp -e POSTGRES_PASSWORD=syncapp -e POSTGRES_DB=syncapp \
  -p 127.0.0.1:5432:5432 docker.io/library/postgres:17-alpine

# 2) Dependencias y esquema
pnpm install
pnpm prisma:generate
pnpm prisma:migrate        # aplica prisma/migrations

# 3) Entorno (lo administra el despliegue; partir de .env.example)
cp .env.example .env       # y completar DATABASE_URL / API_KEY

# 4) Servidor
pnpm dev                   # http://localhost:3000
```

## Tests

```bash
pnpm test                  # unitarios; los de integración se saltan sin DATABASE_URL
pnpm lint
pnpm typecheck
```

Los tests de contrato (`tests/integration/sync-api.test.ts` y `tests/integration/client-logs.test.ts`) arrancan la API real contra PostgreSQL: idempotencia, 409 de documento duplicado, concurrencia, pull incremental, paginación, soft delete, cursor y recepción de logs.

```bash
DATABASE_URL="postgresql://syncapp:syncapp@127.0.0.1:5432/syncapp?schema=public" \
API_KEY="test_api_key" pnpm test
```

## Despliegue con Podman

Hay dos rutas de despliegue; ambas usan Podman y publican Next.js solo en loopback (nginx es la entrada HTTP del puerto aleatorio).

### Opción A: manifiesto Kubernetes (`podman kube play`)

Guía completa paso a paso en **[POD.md](POD.md)**.

```bash
# Construye la imagen, genera el secreto desde .env y aplica pod.yaml
bash deploy/kube.sh

# En un VPS detras de nginx (publica en todas las interfaces):
BIND_IP=0.0.0.0 bash deploy/kube.sh

# Bajar el despliegue (los volumenes PVC persisten)
podman kube down pod.yaml
```

- `pod.yaml`: un pod `sync-app` con PostgreSQL + web. La web espera a la base, aplica migraciones y recién arranca (`pnpm start`).
- Volúmenes persistentes: `syncapp-pgdata` y `syncapp-uploads` (PVC).
- Secreto `sync-app-env` (creado por el script a partir de `.env`, nunca versionado) con `DATABASE_URL`, `API_KEY`, credenciales de Postgres, etc.
- `BIND_IP` define dónde publica el pod (`127.0.0.1` por defecto para nginx local; `0.0.0.0` en VPS); `APP_PORT` es el puerto de ese binding.

### Opción B: contenedores sueltos

```bash
# Imágenes multi-stage (build de pnpm dentro del contenedor)
podman build --target migrator -t localhost/sync-app-migrate:local .
podman build --target runner   -t localhost/sync-app-web:local .

# Pod + PostgreSQL + migraciones + web (ver deploy/podman.sh)
bash deploy/podman.sh
```

El pod publica Next.js solo en loopback (`127.0.0.1:APP_PORT`); nginx (configurado aparte, ver `deploy/nginx.conf` de referencia) es la entrada HTTP en el puerto aleatorio.

## Variables de entorno

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión PostgreSQL (dentro del pod: `127.0.0.1:5432`) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Contenedor PostgreSQL |
| `API_KEY` | Clave que la APK envía en `X-Api-Key` |
| `APP_PORT` | Puerto loopback donde el pod publica Next.js |
| `WEB_PORT` | Puerto aleatorio del host donde nginx recibe HTTP |
| `SESSION_SECRET` | Reservada para el login del panel (F2) |
| `UPLOAD_DIR` | Reservada para archivos (F4) |

## Estructura

```
pod.yaml                 manifiesto para `podman kube play` (pod + PVCs)
POD.md                   guia de ejecucion del pod
src/
  app/api/users/route.ts        POST (upsert) + GET (pull incremental)
  app/api/client-logs/route.ts  POST lotes de logs de la APK
  app/api/health/route.ts       healthcheck publico
  lib/db.ts                PrismaClient + adapter pg
  lib/api-auth.ts          validacion X-Api-Key (timing-safe)
  lib/validation.ts        esquemas Zod (users + client-logs)
  lib/envelope.ts          UserDto / envelope del contrato
  lib/sync.ts              push/pull con advisory lock y sync_seq
prisma/
  schema.prisma            users, files, imports, sync_conflicts, sync_events, admin_users, client_logs
  migrations/              migracion inicial + client_logs
deploy/
  kube.sh                  build + secreto desde .env + kube play
  podman.sh                pod nativo + volumenes + migraciones + web
  nginx.conf               referencia de proxy HTTP
tests/                     unitarios + integracion de contrato
Containerfile              multi-stage: deps, build, migrator, kube, runner
```

## Documentación

- `plan.md` — planteamiento, fases y decisiones.
- `POD.md` — guía de ejecución del pod con `podman kube play`.

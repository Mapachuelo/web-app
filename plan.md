# Web-app: API + panel de sincronizacion

Documento de planteamiento del backend web para la app Android offline-first ([app](https://github.com/Mapachuelo/app)). La APK escribe en SQLite local y sincroniza por REST cuando recupera la red; este repositorio implementa ese contrato.

## Decisiones

- **Stack**: Next.js 16 (App Router, standalone) + PostgreSQL 17 + Prisma 7 (adapter pg) + Zod 4. Pnpm como gestor; build dentro del contenedor.
- **Despliegue**: Podman. Dos rutas: `podman kube play` con `pod.yaml` (pod + PVCs + secreto generado del `.env`; la web espera la base, migra y arranca; guia en `POD.md`) o contenedores sueltos con `deploy/podman.sh`. La web publica solo en loopback; nginx (configurado aparte) recibe HTTP en un puerto aleatorio fijo guardado en `.env`. El `.env` lo administra el despliegue, nunca se versiona.
- **Auth**: `X-Api-Key` para la API de la APK; login de administrador para el panel en F2.
- **IDs**: UUID v7. La APK los genera en offline; la web/import los generan al crear.

## Contrato (congelado)

- `POST /api/users` — upsert idempotente por `id`. `200 {server_time, users:[UserDto]}`; `409` si el documento existe con otro id.
- `GET /api/users?since=<ms>&limit=100` — `{server_time, users[]}` con `updated_at > since`, incluidos los `deleted:true`.
- `POST /api/client-logs` — lote de logs de la APK (≤200 entradas, ≤256 KB) con el mismo `X-Api-Key`; responde `{received:n}`.
- `GET /api/health` — publico.
- `UserDto`: `id`, `nombre`, `apellido`, `documento`, `phone`, `phone_previous`, `email`, `email_previous`, `address`, `address_previous`, `password` (opcional; null = no cambiar), `updated_at`, `deleted`.

## Sincronizacion y conflictos

- `updated_at` lo asigna el servidor con la secuencia `sync_seq` (base epoch ms, +1 por escritura) tomando `pg_advisory_xact_lock` en cada escritura: el orden de asignacion coincide con el de confirmacion, por lo que el cursor nunca pierde filas.
- `server_time` del pull = `updated_at` del ultimo registro devuelto. La APK debe paginar en bucle hasta pagina corta (pendiente en la app, F2).
- Documento unico activo: indice parcial `WHERE deleted = false`; la violacion responde `409` y queda en `sync_conflicts`.
- Soft delete: `deleted=true` viaja en el pull; el documento queda libre para reutilizarse.
- `password` se guarda tal cual (SHA-256 hex que envia la APK) y no se devuelve en el pull. La APK debe conservar su hash local cuando el DTO no trae `password` (parche pendiente, F2).

## Modelo de datos

- `users`: campos del contrato + `password_hash`, `created_at`, `source` (`app|web|import`).
- `files`: adjuntos por usuario (F4).
- `imports`: historial de cargas CSV/Excel (F4).
- `sync_conflicts`: conflictos 409 para revision manual (F5).
- `sync_events`: auditoria de cambios (F5).
- `client_logs`: lotes de logs enviados por la APK (device_id, app_version, base_url, entradas jsonb, received_at).
- `admin_users`: cuentas del panel (F2).

## Fases

- [x] **F0** Esqueleto Next.js + pnpm + Prisma + Containerfile multi-stage + `/api/health`. Aceptacion: imagen construida con Podman y health 200.
- [x] **F1** API de sync con tests de contrato (idempotencia, 409, concurrencia, pull, paginacion, soft delete). Aceptacion: APK debug completa offline->online.
- [ ] **F2** `X-Api-Key` en OkHttp (app), configuracion runtime de URL/key (app), pull paginado en bucle (app), conservar password local (app), logs (compartir y subida a `client-logs`); login admin (web, pendiente).
- [ ] **F3** Panel CRUD: lista, busqueda, detalle, edicion con reglas (nombre/apellido/documento inmutables; doble valor en celular/correo/direccion), soft delete/restaurar.
- [ ] **F4** Import CSV/Excel (preview, validacion, reporte por fila) y subida de archivos/fotos.
- [ ] **F5** Panel de sincronizacion: totales, `sync_seq`, ultimos cambios, conflictos pendientes de resolver.
- [ ] **F6** Backups (`pg_dump` programado), CI completo (lint + typecheck + tests con PostgreSQL + build de imagen), docs de despliegue (VPS con Podman: `deploy/kube.sh`, `BIND_IP=0.0.0.0` detras de nginx).

## Cambios pendientes en la app (cross-repo)

1. Interceptor OkHttp con `X-Api-Key` (`BuildConfig`).
2. Pull en bucle hasta pagina corta; hoy pide una sola pagina de 100 y saltaria registros en el siguiente ciclo.
3. `toEntity` debe conservar `passwordHash` local cuando `dto.password == null`.
4. `BASE_URL` release apuntando a `http://<host>:<puerto-nginx>`.

## Pruebas

- Unitarias: validacion Zod del payload Gson y serializacion del `UserDto`.
- Contrato (integracion): contra PostgreSQL real via handlers de ruta (sin red), mismos JSON que `MockApiServer` de la app.
- Pendiente F6: contract test cruzado (APK -> pod) y CI con imagen.

## Riesgos

- HTTP plano expone `X-Api-Key` y hashes en transito: aceptable en LAN/VPN; si se expone a internet, anadir TLS (nginx/Caddy) o tunel.
- La API key embebida en la APK es extraible: rotacion, rate limit (F2) y HTTPS en produccion.
- Los datos viven en el volumen `syncapp_pgdata`: backups programados en F6.

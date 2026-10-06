#!/usr/bin/env bash
# Referencia de despliegue con Podman: pod + volumenes + PostgreSQL + migraciones + web.
# El .env lo administra el despliegue (ver .env.example).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

POD="sync-app"
DB_CONTAINER="sync-app-db"
WEB_CONTAINER="sync-app-web"
WEB_IMAGE="localhost/sync-app-web:local"
MIGRATE_IMAGE="localhost/sync-app-migrate:local"
PGDATA_VOLUME="syncapp_pgdata"
UPLOADS_VOLUME="syncapp_uploads"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Falta $ENV_FILE (usa .env.example como base)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${APP_PORT:?APP_PORT no definido en .env}"
: "${DATABASE_URL:?DATABASE_URL no definido en .env}"

echo "==> Construyendo imagenes con Podman"
podman build --target migrator -t "$MIGRATE_IMAGE" "$ROOT_DIR"
podman build --target runner -t "$WEB_IMAGE" "$ROOT_DIR"

echo "==> Creando pod y volumenes"
podman pod exists "$POD" || podman pod create --name "$POD" -p "127.0.0.1:${APP_PORT}:3000"
podman volume exists "$PGDATA_VOLUME" || podman volume create "$PGDATA_VOLUME"
podman volume exists "$UPLOADS_VOLUME" || podman volume create "$UPLOADS_VOLUME"

echo "==> Arrancando PostgreSQL"
podman container exists "$DB_CONTAINER" && podman rm -f "$DB_CONTAINER" >/dev/null
podman run -d \
  --pod "$POD" \
  --name "$DB_CONTAINER" \
  --env-file "$ENV_FILE" \
  -v "${PGDATA_VOLUME}:/var/lib/postgresql/data" \
  docker.io/library/postgres:17-alpine

echo "==> Esperando PostgreSQL"
for _ in $(seq 1 60); do
  podman exec "$DB_CONTAINER" pg_isready -U "${POSTGRES_USER:-postgres}" >/dev/null 2>&1 && break
  sleep 1
done

echo "==> Aplicando migraciones"
podman run --rm --pod "$POD" --env-file "$ENV_FILE" "$MIGRATE_IMAGE"

echo "==> Arrancando web"
podman container exists "$WEB_CONTAINER" && podman rm -f "$WEB_CONTAINER" >/dev/null
podman run -d \
  --pod "$POD" \
  --name "$WEB_CONTAINER" \
  --env-file "$ENV_FILE" \
  -v "${UPLOADS_VOLUME}:/data/uploads" \
  "$WEB_IMAGE"

echo "==> Listo: nginx debe apuntar a http://127.0.0.1:${APP_PORT}"
echo "    Health: curl http://127.0.0.1:${APP_PORT}/api/health"

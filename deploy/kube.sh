#!/usr/bin/env bash
# Despliegue con `podman kube play`:
#   1) construye la imagen localhost/sync-app-kube:local (migraciones + Next.js)
#   2) genera el secreto de Kubernetes desde .env (el .env lo administra el despliegue)
#   3) crea/actualiza el secreto de Podman `sync-app-env`
#   4) aplica pod.yaml y publica Next.js en BIND_IP:APP_PORT
#      (BIND_IP default 127.0.0.1; en VPS usar BIND_IP=0.0.0.0 detras de nginx)
#
# La web (nginx u otro proxy) sigue siendo la unica entrada por el puerto aleatorio.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
POD_FILE="$ROOT_DIR/pod.yaml"
SECRET_NAME="sync-app-env"
SECRET_FILE="$ROOT_DIR/deploy/.sync-app-secret.yaml"
IMAGE="localhost/sync-app-kube:local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Falta $ENV_FILE (usa .env.example como base)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${DATABASE_URL:?DATABASE_URL no definido en .env}"
: "${API_KEY:?API_KEY no definido en .env}"

DB_URL="$DATABASE_URL"
if [[ "$DB_URL" == *"@sync-app-db:"* ]]; then
  DB_URL="$(sed -E 's/@sync-app-db:/@127.0.0.1:/' <<< "$DATABASE_URL")"
elif [[ "$DB_URL" != *"@127.0.0.1:"* && "$DB_URL" != *"@localhost:"* ]]; then
  echo "Aviso: DATABASE_URL debe apuntar a 127.0.0.1:5432 dentro del pod." >&2
fi

cat > "$SECRET_FILE" <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${SECRET_NAME}
type: Opaque
stringData:
  DATABASE_URL: "${DB_URL}"
  API_KEY: "${API_KEY}"
  POSTGRES_USER: "${POSTGRES_USER:-syncapp}"
  POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:-}"
  POSTGRES_DB: "${POSTGRES_DB:-syncapp}"
  SESSION_SECRET: "${SESSION_SECRET:-}"
  UPLOAD_DIR: "${UPLOAD_DIR:-/data/uploads}"
EOF
chmod 600 "$SECRET_FILE"

echo "==> Construyendo imagen con Podman (target kube)"
podman build --target kube -t "$IMAGE" "$ROOT_DIR"

echo "==> Creando secreto de Podman ${SECRET_NAME}"
podman secret exists "$SECRET_NAME" && podman secret rm "$SECRET_NAME" >/dev/null
podman secret create "$SECRET_NAME" "$SECRET_FILE" >/dev/null

APP_PORT="${APP_PORT:-3000}"
BIND_IP="${BIND_IP:-127.0.0.1}"
echo "==> Aplicando podman kube play (${BIND_IP}:${APP_PORT} -> web:3000)"
podman kube play --replace --publish "${BIND_IP}:${APP_PORT}:3000" "$POD_FILE"

echo "==> Listo: curl http://${BIND_IP}:${APP_PORT}/api/health"

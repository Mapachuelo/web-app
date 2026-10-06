# Ejecución del pod (`podman kube play`)

Guía para levantar la API + PostgreSQL en un solo pod usando `pod.yaml`.

## Requisitos

- Podman 5+ (`podman kube play` / `podman kube down`).
- Imagen `postgres:17-alpine` (se descarga sola si falta).
- Imagen propia `localhost/sync-app-kube:local` (la construye el script o el paso manual).
- Archivo `.env` en la raíz de `web-app` (partir de `.env.example`):

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Host `127.0.0.1` (dentro del pod la base es local) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Credenciales del contenedor PostgreSQL |
| `API_KEY` | Clave que envía la APK en `X-Api-Key` |
| `CORS_ORIGINS` | Orígenes permitidos para `/api/*` (`*` o lista separada por comas; la app Capacitor llama cross-origin) |
| `APP_PORT` | Puerto loopback donde el pod publica Next.js (default `3000`) |
| `BIND_IP` | IP de publicación (default `127.0.0.1`; en VPS usar `0.0.0.0`) |
| `WEB_PORT` | Puerto aleatorio del host donde nginx recibe HTTP (lo usa tu nginx) |
| `SESSION_SECRET` / `UPLOAD_DIR` | Reservadas para fases siguientes |

El `.env` lo administra el despliegue y no se versiona.

## Ejecución rápida

```bash
bash deploy/kube.sh
```

El script hace todo:

1. Construye `localhost/sync-app-kube:local` (target `kube` del `Containerfile`).
2. Genera `deploy/.sync-app-secret.yaml` a partir de `.env` (no versionado) y crea/actualiza el secreto de Podman `sync-app-env`.
3. Aplica `pod.yaml` con `podman kube play --replace --publish BIND_IP:APP_PORT:3000`.

Verificación:

```bash
curl http://127.0.0.1:3000/api/health
podman pod ps
podman logs -f sync-app-web
```

## Ejecución manual (sin script)

```bash
podman build --target kube -t localhost/sync-app-kube:local .

# Secreto con los valores del .env (ejemplo; usar los reales)
cat > deploy/.sync-app-secret.yaml <<'EOF'
apiVersion: v1
kind: Secret
metadata:
  name: sync-app-env
type: Opaque
stringData:
  DATABASE_URL: "postgresql://syncapp:PASSWORD@127.0.0.1:5432/syncapp?schema=public"
  API_KEY: "TU_API_KEY"
  POSTGRES_USER: "syncapp"
  POSTGRES_PASSWORD: "PASSWORD"
  POSTGRES_DB: "syncapp"
EOF

podman secret rm sync-app-env 2>/dev/null
podman secret create sync-app-env deploy/.sync-app-secret.yaml

podman kube play --replace --publish 127.0.0.1:3000:3000 pod.yaml
```

## Actualizar y detener

```bash
bash deploy/kube.sh              # reconstruye imagen y recrea el pod
podman kube down pod.yaml        # detiene el pod; los volumenes persisten
```

Los datos viven en los volúmenes `syncapp-pgdata` (PostgreSQL) y `syncapp-uploads` (archivos). Borrar todo, incluidos datos:

```bash
podman kube down pod.yaml
podman volume rm syncapp-pgdata syncapp-uploads
podman secret rm sync-app-env
rm -f deploy/.sync-app-secret.yaml
```

## VPS detrás de nginx

```bash
BIND_IP=0.0.0.0 APP_PORT=3000 bash deploy/kube.sh
```

nginx queda como única entrada HTTP en el puerto aleatorio (referencia: `deploy/nginx.conf`):

```nginx
server {
    listen 48123;
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

En la APK, la URL del servidor es `http://<host-o-ip>:48123` (o la IP Tailscale si se usa esa red).

## Contenido del pod

| Contenedor | Imagen | Función |
|---|---|---|
| `sync-app-db` | `postgres:17-alpine` | Base de datos; volumen `syncapp-pgdata` |
| `sync-app-web` | `localhost/sync-app-kube:local` | Espera la base, aplica `prisma migrate deploy` y arranca Next.js |

No se usan `initContainers` porque en un pod de Podman corren antes que la base: por eso el contenedor web reintenta las migraciones (hasta 60 intentos) y recién entonces arranca.

## Consultar logs de la APK

```bash
podman exec sync-app-db psql -U syncapp -d syncapp \
  -c "SELECT received_at, device_id, entries_count FROM client_logs ORDER BY received_at DESC LIMIT 10"
```

## Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| `bind: address already in use` | Otro proceso usa el puerto; cambiar `APP_PORT`. |
| `no se pudo aplicar migraciones tras 60 intentos` | `DATABASE_URL` con host distinto de `127.0.0.1` o credenciales que no coinciden con `POSTGRES_*`. |
| `401 no_autorizado` en la APK | `API_KEY` distinta entre `.env` y la pantalla Diagnóstico de la app. |
| El puerto no responde | Revisar `podman pod ps` y `podman logs sync-app-web`. |
| Se perdieron datos tras un cambio | Verificar que los volúmenes `syncapp-pgdata` sigan existiendo (`podman volume ls`). |

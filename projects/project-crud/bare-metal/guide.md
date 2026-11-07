# SEBI Bare-Metal Deployment Guide

End-to-end runbook for deploying both **frontend** (`project-fe`) and
**backend** (`project-crud`) as Docker containers on a single bare-metal
VM **with no internet access**.

---

## 1. Overview

| Component  | Image                  | Port | Lives on              |
|------------|------------------------|------|-----------------------|
| Frontend   | `sebi-fe:bare-metal`   | 3000 | SEBI app VM           |
| Backend    | `sebi-crud:bare-metal` | 8080 | SEBI app VM           |
| MongoDB    | (existing infra)       | 27017| separate infra VM     |

How they talk to each other:

- Browser → `http://<app-vm>:3000/` → frontend nginx.
- Frontend nginx → `http://backend:8080/v1/` (Docker DNS, bridge network).
- Backend → `mongodb://<user>:<pass>@<mongo-vm-ip>:27017/...` (direct IP over the docker bridge — no host-gateway needed since Mongo is on a different VM).

```
┌──────────── SEBI app VM ─────────────┐    ┌──── infra VM ────┐
│  ┌──────────────┐    ┌──────────────┐│    │                  │
│  │  frontend    │    │   backend    ││    │  mongod :27017   │
│  │  nginx :3000 ├───▶│ go server    ││───▶│                  │
│  │              │    │   :8080      ││    │                  │
│  └──────────────┘    └──────────────┘│    └──────────────────┘
│         (docker bridge: sebi-net)    │
└──────────────────────────────────────┘
```

---

## 2. Prerequisites on the VM

1. **Docker Engine + compose plugin** installed. Verify:
   ```bash
   docker version
   docker compose version
   ```
2. **Reachable MongoDB** with credentials. The SEBI backend uses the existing
   infra Mongo at `10.102.44.4:27017` (see `MONGO_URI` in `sebi.env`). Verify
   from the app VM before bringing the stack up:
   ```bash
   nc -zv 10.102.44.4 27017
   ```
3. **Ports 3000 and 8080 free** on the app VM. If your previous services
   bound 8080, stop them first (`docker compose down` in their stack).

---

## 3. Build the images (on a machine WITH internet)

Run from the parent directory that contains both repos.

```bash
# Frontend → sebi-fe:bare-metal
cd project-fe
docker build \
  --platform=linux/amd64 \
  -f bare-metal/Dockerfile \
  -t sebi-fe:bare-metal .

# Backend → sebi-crud:bare-metal
cd ../project-crud
docker build \
  --platform=linux/amd64 \
  -f bare-metal/Dockerfile \
  -t sebi-crud:bare-metal .
```

Confirm the architecture before shipping:
```bash
docker image inspect sebi-fe:bare-metal   | grep -i architecture
docker image inspect sebi-crud:bare-metal | grep -i architecture
# Both must report:  "Architecture": "amd64"
```

---

## 4. Export images to `.tar`

```bash
docker save sebi-fe:bare-metal   -o sebi-fe-bare-metal.tar
docker save sebi-crud:bare-metal -o sebi-crud-bare-metal.tar
```

---

## 5. Ship everything to the VM

```bash
# From the build machine:
scp sebi-fe-bare-metal.tar                              user@vm:/opt/sebi/
scp sebi-crud-bare-metal.tar                            user@vm:/opt/sebi/
scp project-crud/bare-metal/docker-compose.yml     user@vm:/opt/sebi/
scp project-crud/bare-metal/sebi.env.example       user@vm:/opt/sebi/sebi.env
```

> Note: this stack uses a dedicated `sebi.env` (NOT `.env`) so it doesn't
> interfere with any shared `/opt/.env` your other services on the VM read.
> `docker-compose.yml` references it explicitly via `env_file: - sebi.env`.

(Create `/opt/sebi/` on the VM first if it doesn't exist:
`ssh user@vm "sudo mkdir -p /opt/sebi && sudo chown $USER /opt/sebi"`.)

---

## 6. Load the images on the VM

```bash
ssh user@vm
cd /opt/sebi

docker load -i sebi-fe-bare-metal.tar
docker load -i sebi-crud-bare-metal.tar

docker images | grep sebi   # both should appear
```

---

## 7. Configure `sebi.env`

Edit `/opt/sebi/sebi.env` and fill in / verify:

- `FRONTEND_PORT` → host port the frontend listens on (default `3000`).
  Used by both nginx (`listen ${FRONTEND_PORT};` via envsubst) and the
  docker-compose host-side mapping.
- `HTTP_PORT` → backend listen port (default `8080`). Same value is reused
  by the frontend's nginx as the proxy target port — no drift possible.
- `BACKEND_HOST` → docker DNS name the frontend resolves for the backend
  (default `backend`). Same value also drives the backend's `container_name`.
- `MONGO_URI` → already set to your shared infra Mongo
  (`mongodb://admin:CHANGE_ME@10.102.44.4:27017/...`). Change creds/host
  if your setup differs.
- `MONGO_DB` → SEBI's own database name inside that Mongo cluster
  (default: `SEBI-project`). Keep it distinct from `MONGO_DB_NAME` used by
  other services.
- `JWT_SECRET` → keep the value or rotate with `openssl rand -base64 48`
  (must be >= 32 bytes). Intentionally separate from the shared `JWT_SECRET`
  in `/opt/.env` so SEBI's tokens are isolated.
- `CORS_ORIGINS` → must include the exact browser-facing origin, e.g.
  `http://10.102.44.3:3000`. No trailing slash, no `*` (ENV=prod rejects it).

---

## 8. Bring services up

```bash
cd /opt/sebi
docker compose --env-file sebi.env up -d
docker compose ps
```

Tail logs:
```bash
docker compose logs -f backend
docker compose logs -f frontend
```

> **Why `--env-file sebi.env`?** Docker Compose uses an env file for **two
> separate things**:
> 1. **Variable interpolation in `docker-compose.yml`** (the `${HTTP_PORT}`,
>    `${FRONTEND_PORT}`, `${BACKEND_HOST}` placeholders in this file's port
>    mappings and container_name). Compose only reads a file named `.env`
>    for this by default — to point it at `sebi.env`, pass `--env-file`.
> 2. **Injection into the container's environment** (the `env_file: -
>    sebi.env` directive inside each service block). This is what makes the
>    backend's Go config loader and the frontend nginx's `envsubst` see the
>    variables at runtime.
>
> Without `--env-file`, the `${...}` placeholders in compose.yml fall back
> to the defaults baked into the file (`:-3000`, `:-8080`, `:-backend`).
> Pass `--env-file sebi.env` whenever you customize those values.
>
> To use a completely different file (e.g. `sebi-staging.env`):
> ```bash
> docker compose --env-file sebi-staging.env up -d
> ```
> No edits to `docker-compose.yml` needed — the per-service `env_file:`
> directive can stay pointing at `sebi.env` and that copy can simply mirror
> the active file, OR you can edit `env_file:` to point at the alternate.

---

## 9. Bring services down / manage lifecycle

```bash
docker compose down              # stop + remove containers and network
docker compose stop              # stop without removing
docker compose start             # start previously-stopped containers
docker compose restart backend   # restart a single service
docker compose pull              # no-op here (no registry); ignore
docker compose --env-file sebi.env up -d --force-recreate backend   # recreate after image swap
```

To upgrade after rebuilding an image:
```bash
# On the build machine: rebuild + save + scp the new .tar.
# On the VM:
docker compose down
docker load -i sebi-crud-bare-metal.tar    # overwrites the tag
docker compose up -d
```

---

## 10. Verify end-to-end

From the VM:
```bash
curl -sf http://localhost:8080/health        # backend health
curl -sf http://localhost:3000/ | head -n 5  # frontend HTML
curl -sfi http://localhost:3000/v1/health    # nginx → backend proxy
```

From a workstation on the same network:
```
open http://<vm-host-or-ip>:3000
```

---

## 11. Common gotchas

| Symptom                                             | Likely cause / fix                                                                                              |
|-----------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| Backend logs: `server selection error` / connect refused on Mongo | Wrong `MONGO_URI` host/port/creds, or the app VM can't reach the infra VM. Test with `nc -zv 10.102.44.4 27017` from the app VM. |
| Browser console: CORS error                          | The origin in the URL bar isn't in `CORS_ORIGINS`. Add it (scheme + host + port), then `docker compose --env-file sebi.env up -d --force-recreate backend`. |
| Frontend returns `502 Bad Gateway` on `/v1/...`      | Backend container isn't running, or `container_name` was changed (must stay `backend` — nginx.conf hardcodes it).         |
| Backend exits at startup with config error           | A required env var (`MONGO_URI`, `MONGO_DB`, `JWT_SECRET`) is missing or `JWT_SECRET` is < 32 bytes.            |
| `exec format error` on container start               | Image was built for the wrong arch. Rebuild with `--platform=linux/amd64` and re-inspect.                       |
| Changes to `sebi.env` not taking effect              | `env_file` is read at container start. Run `docker compose --env-file sebi.env up -d --force-recreate backend` after editing.       |
| Port 8080 already in use                             | Another service on the VM is bound to 8080. Stop it, or change SEBI's `HTTP_PORT` in `sebi.env` AND the host-side mapping in `docker-compose.yml` (`"8081:8080"` etc.). |

# SEBI AI Bare-Metal Deployment Guide

End-to-end runbook for deploying the **AI service** (`project-ai`) as
a Docker container on a single bare-metal VM **with no direct internet
access** (LLM traffic egresses through an HTTP proxy).

---

## 1. Overview

| Component  | Image                | Port | Lives on              |
|------------|----------------------|------|-----------------------|
| AI service | `sebi-ai:bare-metal` | 9000 | SEBI app VM           |
| CRUD       | `sebi-crud:bare-metal` | 8080 | SEBI app VM (or separate) |
| MongoDB    | (existing infra)     | 27017| separate infra VM     |
| LLMs       | CDAC AIRawat APIs    | 443  | external (via proxy)  |

How they talk to each other:

- Frontend / external callers → `http://<app-vm>:9000/...` (or via the
  frontend nginx if you proxy `/ai/...` to it).
- AI service → `http://<crud-host>:8080/v1/...` (CRUD backend) using
  `CRUD_BASE_URL` and the shared `CRUD_SYSTEM_KEY`.
- AI service → `https://apis.airawat.cdac.in/...` (LLM endpoints) through
  `LLM_HTTP_PROXY` because the VM has no direct outbound internet.

```
┌──────────── SEBI app VM ────────────────┐    ┌──── infra VM ────┐
│  ┌──────────────┐    ┌────────────────┐ │    │                  │
│  │   crud       │    │   ai service   │ │    │  mongod :27017   │
│  │  go :8080    ├───▶│  fastapi :9000 │ │───▶│                  │
│  │              │    │                │ │    │                  │
│  └──────────────┘    └──────┬─────────┘ │    └──────────────────┘
│                             │           │
│        (docker bridge: sebi-net)        │
└─────────────────────────────┼───────────┘
                              ▼
                     ┌────────────────┐
                     │ LLM_HTTP_PROXY │──▶ CDAC AIRawat (Internet)
                     └────────────────┘
```

---

## 2. Prerequisites on the VM

1. **Docker Engine + compose plugin** installed. Verify:
   ```bash
   docker version
   docker compose version
   ```
2. **Reachable CRUD backend** — either the `sebi-crud` container on the
   same bridge (if you joined this stack to the same network) or the
   CRUD VM's IP:port. Verify before bringing the stack up:
   ```bash
   curl -sf http://<crud-host>:8080/health
   ```
3. **Reachable LLM proxy** with credentials/access. Verify:
   ```bash
   curl -sv -x http://10.201.6.100:1080 https://apis.airawat.cdac.in/ | head -n 5
   ```
4. **Port 9000 free** on the app VM. If something else uses it, change
   `APP_PORT` in `sebi-ai.env` AND the host-side mapping in
   `docker-compose.yml`.

---

## 3. Build the image (on a machine WITH internet)

Run from the repo root:

```bash
cd project-ai
./bare-metal/build-image.sh
```

Or manually:
```bash
docker build \
  --platform=linux/amd64 \
  -f bare-metal/Dockerfile \
  -t sebi-ai:bare-metal .
```

Confirm the architecture before shipping:
```bash
docker image inspect sebi-ai:bare-metal | grep -i architecture
# Must report:  "Architecture": "amd64"
```

---

## 4. Export the image to `.tar`

```bash
docker save sebi-ai:bare-metal -o sebi-ai-bare-metal.tar
```

(The `build-image.sh` script saves to `dist/sebi-ai.tar` with the
`sebi-ai:latest` tag; either form works as long as the tag on the VM
matches the `image:` line in `docker-compose.yml`.)

---

## 5. Ship everything to the VM

```bash
# From the build machine:
scp sebi-ai-bare-metal.tar                          user@vm:/opt/sebi/
scp project-ai/bare-metal/docker-compose.yml   user@vm:/opt/sebi/ai-compose.yml
scp project-ai/bare-metal/sebi-ai.env.example  user@vm:/opt/sebi/sebi-ai.env
```

> Note: the AI service uses a dedicated `sebi-ai.env` (NOT `.env`) so it
> doesn't interfere with the CRUD service's `sebi.env` already on the VM.
> The compose file is renamed to `ai-compose.yml` on the VM to avoid
> colliding with the CRUD `docker-compose.yml` in the same directory.

(Create `/opt/sebi/` on the VM first if it doesn't exist:
`ssh user@vm "sudo mkdir -p /opt/sebi && sudo chown $USER /opt/sebi"`.)

---

## 6. Load the image on the VM

```bash
ssh user@vm
cd /opt/sebi

docker load -i sebi-ai-bare-metal.tar
docker images | grep sebi-ai   # tag should appear
```

---

## 7. Configure `sebi-ai.env`

Edit `/opt/sebi/sebi-ai.env` and fill in / verify:

- `APP_PORT` → AI service listen port (default `9000`). Same value is
  reused as the host-side mapping in compose.
- `AI_HOST` → docker DNS name + `container_name` for the AI service
  (default `sebi-ai`). Keep this stable if anything proxies to it.
- `CRUD_BASE_URL` → URL of the CRUD backend reachable from this container.
  If CRUD runs in a separate compose stack on this same VM, use the
  CRUD VM IP (e.g. `http://10.102.44.3:8080`) — the AI compose file uses
  its own bridge network, so docker DNS won't resolve `sebi-crud` across
  stacks. To share a single network, see "Optional: shared network" below.
- `CRUD_SYSTEM_KEY` → must match `SYSTEM_API_KEY` set on the CRUD
  service. Otherwise CRUD will 401 every request.
- `MINIO_ENDPOINT` / `MINIO_BUCKET` / `MINIO_ACCESS_KEY` /
  `MINIO_SECRET_KEY` → fill in only if the AI service needs to pull
  attachments from MinIO. Leaving blank is fine if the relevant code
  paths aren't exercised.
- `LLM_BEARER_TOKEN` + `LLM_LLAMA_70B_BEARER_TOKEN` → CDAC AIRawat
  bearer tokens. Llama-3.3-70B uses a *separate* issuer/token.
- `LLM_HTTP_PROXY` → outbound proxy for all LLM calls. Must be set on
  the VM (default `http://10.201.6.100:1080`); leave empty only if the
  VM has direct internet.
- `LLM_VERIFY_SSL` → keep `false` if the CDAC certs aren't in the VM's
  trust store.

---

## 8. Bring the service up

```bash
cd /opt/sebi
docker compose -f ai-compose.yml --env-file sebi-ai.env up -d
docker compose -f ai-compose.yml ps
```

Tail logs:
```bash
docker compose -f ai-compose.yml logs -f ai
```

> **Why `--env-file sebi-ai.env`?** Docker Compose uses an env file for two
> separate things:
> 1. **Variable interpolation in `docker-compose.yml`** (the `${APP_PORT}`,
>    `${AI_HOST}` placeholders). Compose only reads a file literally named
>    `.env` for this by default — to point it at `sebi-ai.env`, pass
>    `--env-file`.
> 2. **Injection into the container's environment** (the
>    `env_file: - sebi-ai.env` directive inside the service block). This
>    is what makes pydantic-settings inside the FastAPI app see the
>    variables at runtime.
>
> Without `--env-file`, the `${...}` placeholders in compose.yml fall back
> to the defaults baked into the file (`:-9000`, `:-sebi-ai`).

---

## 9. Bring service down / manage lifecycle

```bash
docker compose -f ai-compose.yml down              # stop + remove container and network
docker compose -f ai-compose.yml stop              # stop without removing
docker compose -f ai-compose.yml restart ai        # restart
docker compose -f ai-compose.yml --env-file sebi-ai.env up -d --force-recreate ai   # recreate after env edit or image swap
```

To upgrade after rebuilding the image:
```bash
# On the build machine: rebuild + save + scp the new .tar.
# On the VM:
docker compose -f ai-compose.yml down
docker load -i sebi-ai-bare-metal.tar   # overwrites the tag
docker compose -f ai-compose.yml --env-file sebi-ai.env up -d
```

---

## 10. Verify end-to-end

From the VM:
```bash
curl -sf http://localhost:9000/health
# {"status":"ok"}
```

Test a CRUD round-trip (replace with a real endpoint exposed by your
API router):
```bash
curl -sf http://localhost:9000/docs   # FastAPI Swagger UI
```

Test LLM proxy egress:
```bash
docker exec -it sebi-ai sh -c 'curl -sv -x "$LLM_HTTP_PROXY" "$LLM_NEMOTRON_NANO_URL"' | head -n 20
```

---

## 11. Optional: share a network with the CRUD stack

If you want the AI container to resolve `sebi-crud` over docker DNS
(instead of using the CRUD VM's IP), join both stacks to the same
external network:

```bash
# One-time on the VM:
docker network create sebi-shared

# Then edit BOTH compose files to declare the network as external:
# networks:
#   sebi-shared:
#     external: true
# and point each service's networks: list at sebi-shared instead of sebi-net.
```

Once they share a network, set `CRUD_BASE_URL=http://sebi-crud:8080` in
`sebi-ai.env`.

---

## 12. Common gotchas

| Symptom                                                   | Likely cause / fix |
|-----------------------------------------------------------|--------------------|
| `httpx.ConnectError` on LLM calls                         | `LLM_HTTP_PROXY` wrong or proxy host unreachable. Test with `curl -x` from inside the container. |
| `401` from CRUD calls                                     | `CRUD_SYSTEM_KEY` doesn't match `SYSTEM_API_KEY` on the CRUD service. Re-sync the secret. |
| `httpx.ConnectError: All connection attempts failed` to CRUD | `CRUD_BASE_URL` points at a container name that doesn't exist on this network. Use the CRUD VM IP, or share a docker network (see §11). |
| `exec format error` on container start                    | Image was built for the wrong arch. Rebuild with `--platform=linux/amd64` and re-inspect. |
| Healthcheck flapping for the first ~30s                   | Cold start is slow with PyMuPDF/Pillow import. Bump `livenessProbe.initialDelaySeconds` if persistent. |
| `ssl.SSLCertVerificationError` against CDAC LLMs           | Keep `LLM_VERIFY_SSL=false` until CDAC certs are in the VM trust store. |
| `pydantic_settings.exceptions.SettingsError: extra fields not permitted` | The `.env` baked into the image is overriding values. The Dockerfile excludes `.env` via `Dockerfile.dockerignore`; rebuild if you see this. |
| Port 9000 already in use                                  | Another service on the VM is bound to 9000. Stop it, or change `APP_PORT` in `sebi-ai.env` AND the host-side mapping in `docker-compose.yml`. |

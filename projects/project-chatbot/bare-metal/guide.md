# SEBI Chatbot Bare-Metal Deployment Guide

End-to-end runbook for deploying the **chatbot service** (`project-chatbot`) as
a Docker container on a bare-metal VM **with no direct internet access**
(LLM traffic egresses through an HTTP proxy).

---

## 1. Overview

| Component    | Image                  | Port | Lives on          |
|--------------|------------------------|------|-------------------|
| Chatbot      | `sebi-chat:bare-metal` | 3001 | SEBI app VM       |
| MongoDB      | (existing infra)       | 27017| infra VM          |
| LLM (Llama)  | CDAC AIRawat API       | 443  | external (via proxy) |

How they talk to each other:

- Browser → Frontend nginx `/sebi-chat/` → chatbot `:3001`
- Chatbot → MongoDB `10.102.44.4:27017` directly (session storage + data queries)
- Chatbot → `https://apis.airawat.cdac.in/sebi/llama70b/v1/chat/completions` through `LLM_HTTP_PROXY`

```
┌──────────── SEBI app VM ───────────────────┐    ┌──── infra VM ────┐
│  ┌──────────┐    ┌────────────────────────┐ │    │                  │
│  │  nginx   │    │  chatbot               │ │    │  mongod :27017   │
│  │  :3000   ├───▶│  fastapi :3001         ├─┼───▶│  (SEBI-project)  │
│  │          │    │  LangGraph + Motor     │ │    │                  │
│  └──────────┘    └──────────┬─────────────┘ │    └──────────────────┘
│                             │               │
└─────────────────────────────┼───────────────┘
                              ▼ (via LLM_HTTP_PROXY)
                     ┌────────────────────┐
                     │  CDAC AIRawat      │
                     │  Llama-3.3-70B     │
                     └────────────────────┘
```

---

## 2. Prerequisites on the VM

1. **Docker Engine + compose plugin** installed:
   ```bash
   docker version
   docker compose version
   ```
2. **MongoDB reachable** from the container:
   ```bash
   curl -sf telnet://10.102.44.4:27017 || nc -zv 10.102.44.4 27017
   ```
3. **LLM proxy reachable**:
   ```bash
   curl -sv -x http://10.201.6.100:1080 https://apis.airawat.cdac.in/ | head -n 5
   ```
4. **Port 3001 free** on the VM. If not, change `APP_PORT` in `sebi-chat.env`.

---

## 3. Build the image (on a machine WITH internet)

Run from the `project-chatbot` repo root:

```bash
cd project-chatbot
./bare-metal/build-image.sh
```

Or manually:
```bash
docker build \
  --platform=linux/amd64 \
  -f bare-metal/Dockerfile \
  -t sebi-chat:bare-metal .
```

Confirm architecture before shipping:
```bash
docker image inspect sebi-chat:bare-metal | grep -i architecture
# Must report:  "Architecture": "amd64"
```

---

## 4. Export the image to `.tar`

The `build-image.sh` script saves to `dist/sebi-chat.tar` automatically. Or manually:

```bash
docker save sebi-chat:bare-metal -o dist/sebi-chat.tar
```

---

## 5. Ship the image to 0.6

```bash
# From the build machine:
scp dist/sebi-chat.tar root@10.102.44.6:~/
```

---

## 6. Load the image on 0.6

```bash
ssh root@10.102.44.6
docker load -i ~/sebi-chat.tar
docker images | grep sebi-chat   # tag should appear
```

---

## 7. Add chatbot vars to the existing `sebi.env` on 0.6

The chatbot reuses everything already in `sebi.env` (LLM_LLAMA_70B_*,
LLM_HTTP_PROXY, LLM_VERIFY_SSL). Append only what's missing:

```bash
cat >> ~/sebi.env <<'EOF'

# ── Chatbot ──────────────────────────────────────────────────────────────────
# Add MONGO_URI only if not already present in sebi.env:
MONGO_URI=mongodb://admin:CHANGE_ME@10.102.44.4:27017/?socketTimeoutMS=300000&connectTimeoutMS=30000&serverSelectionTimeoutMS=300000&maxPoolSize=20
MONGO_DB=SEBI-project
EOF
```

`CHAT_PORT=8002` is the host-side port exposed to 0.3 (already whitelisted,
firewall rule #56). The container listens on 3001 internally.

---

## 8. Add the chatbot to the existing `docker-compose.yml` on 0.6

Append the service block to `~/docker-compose.yml` (same file that runs
sebi-ai, bifrost, entity-agent, etc.):

```yaml
  sebi-chat:
    image: sebi-chat:bare-metal
    restart: unless-stopped
    env_file: [sebi.env]
    ports:
      - "8002:3001"
    networks: [agents]
```

---

## 9. Bring the chatbot up

```bash
docker compose --env-file ~/sebi.env up -d sebi-chat
docker compose ps sebi-chat
```

Tail logs:
```bash
docker compose logs -f sebi-chat
```

---

## 10. Verify

```bash
curl -sf http://localhost:8002/health
# {"status":"ok"}

curl -N -X POST http://localhost:8002/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"How many complaints does Angel One have?","session_id":null}'
```

You should see SSE chunks streaming then `data: [DONE]`.

---

## 11. Update `sebi.env` on 0.3 (app VM)

The frontend nginx needs to know where the chatbot is:

```bash
# Append to sebi.env on 0.3:
CHAT_HOST=10.102.44.6
CHAT_PORT=8002
```

Then restart the frontend container to reload nginx:
```bash
docker compose restart frontend
```

---

## 12. Upgrade after a rebuild

```bash
# On the build machine: rebuild + scp the new .tar
# On 0.6:
docker compose stop sebi-chat
docker load -i ~/sebi-chat.tar
docker compose --env-file ~/sebi.env up -d sebi-chat
```

---

## 13. Common gotchas

| Symptom | Likely cause / fix |
|---------|--------------------|
| `httpx.ConnectError` on LLM calls | `LLM_HTTP_PROXY` wrong or unreachable. Test: `docker exec -it sebi-chat sh -c 'curl -sv -x "$LLM_HTTP_PROXY" "$LLM_LLAMA_70B_URL"'` |
| `ServerSelectionTimeoutError` | MongoDB unreachable. Check `MONGO_URI` in `sebi.env` and network from container. |
| `ssl.SSLCertVerificationError` | Set `LLM_VERIFY_SSL=false` in `sebi.env`. |
| `exec format error` on start | Wrong image arch. Rebuild with `--platform=linux/amd64`. |
| nginx `502 Bad Gateway` on `/sebi-chat/` | `CHAT_HOST`/`CHAT_PORT` in 0.3's `sebi.env` wrong, or frontend not restarted. |
| SSE stream cuts off immediately | nginx `proxy_buffering` must be `off` for `/sebi-chat/`. Already set in `nginx.conf.template`. |

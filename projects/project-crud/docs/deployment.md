# Deployment Guide — project-crud

This guide covers everything needed to run the service in any environment:
local development, staging, and production.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Environment variables](#2-environment-variables)
3. [Local development](#3-local-development)
4. [Bootstrapping the first developer user](#4-bootstrapping-the-first-developer-user)
5. [Building the binary](#5-building-the-binary)
6. [Docker image](#6-docker-image)
7. [Production deployment checklist](#7-production-deployment-checklist)
8. [Health & readiness probes](#8-health--readiness-probes)
9. [Graceful shutdown](#9-graceful-shutdown)
10. [Observability](#10-observability)

---

## 1. Prerequisites

| Tool | Minimum version | Purpose |
|------|-----------------|---------|
| Go | 1.23 | Build the service and run tests |
| Docker | 24+ | Container builds and local dev compose |
| MongoDB | 6 or 7 | Primary database |
| `golangci-lint` | v1.59+ | Linting (`make lint`) |
| `govulncheck` | latest | Vulnerability scan (`make vuln`) |

---

## 2. Environment variables

Copy `.env.example` to `.env` and fill in every value before starting.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENV` | no | `dev` | `dev`, `staging`, or `prod`. Controls log format (text vs JSON) and enforces stricter CORS in prod. |
| `HTTP_PORT` | no | `8080` | Port the HTTP server listens on. |
| `MONGO_URI` | **yes** | — | Full MongoDB connection string. Examples below. |
| `MONGO_DB` | **yes** | — | Database name (e.g. `sebi_crud`). |
| `JWT_SECRET` | **yes** | — | HS256 signing secret. **Must be ≥ 32 bytes.** Never log or commit this. Generate with `openssl rand -base64 48`. |
| `JWT_ISSUER` | no | `sebi-crud` | Value of the `iss` claim. Tokens minted by one issuer are rejected by an instance with a different issuer. |
| `JWT_TTL` | no | `24h` | Token lifetime. Go duration format: `15m`, `1h`, `24h`. |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error`. `debug` is silenced unless `ENV=dev`. |
| `SHUTDOWN_TIMEOUT` | no | `15s` | Time allowed for in-flight requests to drain before a hard kill. |
| `CORS_ORIGINS` | no | _(empty)_ | Comma-separated list of allowed origins. Never `*` in prod — the config loader will reject it. |

### MongoDB URI examples

```bash
# Local (no auth)
MONGO_URI=mongodb://localhost:27017

# Replica set (recommended for production)
MONGO_URI=mongodb://user:password@host1:27017,host2:27017,host3:27017/?replicaSet=rs0&authSource=admin

# MongoDB Atlas
MONGO_URI=mongodb+srv://user:password@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority
```

> **Production note:** Use a Mongo user with the minimum required privileges
> (`readWrite` on the app database only). Never use the root user.

---

## 3. Local development

```bash
# 1. Copy and edit env
cp .env.example .env
# set MONGO_URI, MONGO_DB, JWT_SECRET (openssl rand -base64 48), CORS_ORIGINS

# 2. Start MongoDB
docker compose -f deploy/docker-compose.yml up -d mongo

# 3. Run the server (hot-reloads via `go run`)
make run
# → listening on :8080
```

Verify it started:

```bash
curl http://localhost:8080/health       # {"status":"ok"}
curl http://localhost:8080/readyz       # {"status":"ready"} once Mongo is up
curl http://localhost:8080/version      # {"version":"dev","commit":"unknown","build_time":"unknown"}
```

---

## 4. Bootstrapping the first developer user

`POST /v1/auth/signup` is admin-gated — there is no public registration.
The first `developer` user must be inserted directly into MongoDB.

### Step 1 — generate a bcrypt hash (cost 12)

**Option A — openssl + htpasswd (if you have Apache tools):**
```bash
htpasswd -bnBC 12 "" 'your-strong-password-here' | tr -d ':\n'
```

**Option B — using the Go standard library:**
```bash
go run -mod=mod - << 'EOF'
package main

import (
    "fmt"
    "golang.org/x/crypto/bcrypt"
)

func main() {
    h, err := bcrypt.GenerateFromPassword([]byte("your-strong-password-here"), 12)
    if err != nil { panic(err) }
    fmt.Println(string(h))
}
EOF
```

**Option C — Node.js (if Go is not available on the machine doing the insert):**
```bash
node -e "require('bcryptjs').hash('your-strong-password-here', 12).then(console.log)"
# npm install bcryptjs if needed
```

The output will look like: `$2a$12$eImiTXuWVxfM37uY4JANjQ...`

### Step 2 — insert the document

Connect to your Mongo instance (e.g. via `mongosh`) and run:

```js
use sebi_crud   // or whatever MONGO_DB is set to

db.users.insertOne({
    email:         "dev@onfinance.ai",          // your developer's email
    password_hash: "$2a$12$...",                 // the hash from Step 1
    role:          "developer",                  // cross-org; no org_id for developers
    created_at:    new Date(),
    updated_at:    new Date()
    // deleted_at: omit — null/absent means active
})
```

> `org_id` is intentionally omitted for `developer` users. Developers bypass
> org-scoping (`Role.IsCrossOrg() == true`). For `admin` and `business_user`
> accounts, `org_id` is required — but those are created through the API.

### Step 3 — verify

```bash
curl -s -X POST http://localhost:8080/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@onfinance.ai","password":"your-strong-password-here"}' \
  | jq .

# expected: 200 with {"token":"...","expires_at":"...","user":{...}}
```

Use the returned token for all subsequent API calls:

```bash
TOKEN="eyJ..."   # paste the token here

# Create the first admin user for a real org
curl -s -X POST http://localhost:8080/v1/auth/signup \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@acme.example.com",
    "password": "another-strong-password",
    "role": "admin",
    "org_id": "<some-mongo-objectid-hex>"
  }' | jq .
```

---

## 5. Building the binary

```bash
make build
# produces: bin/server
```

The binary is compiled with ldflags that embed version, commit hash, and build
timestamp. To set them explicitly:

```bash
VERSION=$(git describe --tags --always) \
COMMIT=$(git rev-parse HEAD) \
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
make build
```

Run it:

```bash
# source your .env or export the vars manually, then:
./bin/server
```

---

## 6. Docker image

### Build

```bash
make docker
# tags the image as sebi-crud:<git-describe>
```

Under the hood:

```bash
docker build \
  --build-arg VERSION=$(git describe --tags --always) \
  --build-arg COMMIT=$(git rev-parse HEAD) \
  --build-arg BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  -t sebi-crud:<tag> \
  -f deploy/Dockerfile .
```

The image is **multi-stage, distroless, non-root**:

- Builder stage: `golang:1.23-alpine` — compiles the binary with `CGO_ENABLED=0`
- Runtime stage: `gcr.io/distroless/static-debian12:nonroot` — no shell, no package manager, runs as UID `nonroot`
- Final image size: ~10–15 MB

### Run

```bash
docker run --rm \
  -e ENV=prod \
  -e HTTP_PORT=8080 \
  -e MONGO_URI="mongodb://host.docker.internal:27017" \
  -e MONGO_DB=sebi_crud \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e CORS_ORIGINS="https://app.onfinance.ai" \
  -p 8080:8080 \
  sebi-crud:<tag>
```

---

## 7. Production deployment checklist

- [ ] `ENV=prod` is set — enables JSON logging and strict CORS validation.
- [ ] `JWT_SECRET` is at least 32 bytes and is stored in a secrets manager (AWS Secrets Manager, GCP Secret Manager, Vault, etc.), **not** in a plain `.env` file on disk.
- [ ] `MONGO_URI` uses a dedicated, least-privilege Mongo user (`readWrite` on the app DB only).
- [ ] `CORS_ORIGINS` is an explicit list. `*` is rejected by the config loader in prod.
- [ ] TLS termination is handled by a load balancer or ingress (the app itself speaks plain HTTP).
- [ ] Liveness probe (`/health`) and readiness probe (`/readyz`) are configured in Kubernetes / ECS / your orchestrator.
- [ ] Graceful shutdown is wired: send `SIGTERM` and wait for `SHUTDOWN_TIMEOUT` before sending `SIGKILL`.
- [ ] Resource limits (CPU/memory) are set on the container.
- [ ] The Mongo replica set has write concern `majority` and journal enabled.
- [ ] `govulncheck` (`make vuln`) and `golangci-lint` (`make lint`) pass on every deploy.

---

## 8. Health & readiness probes

| Endpoint | Method | Auth | Meaning |
|----------|--------|------|---------|
| `/health` | GET | none | **Liveness.** Always returns `200 {"status":"ok"}` if the process is up. Restarts the container if this fails. |
| `/readyz` | GET | none | **Readiness.** Pings MongoDB with a 2-second timeout. Returns `503` if Mongo is unreachable. Remove the pod from the load-balancer rotation while this is failing. |

### Kubernetes example

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /readyz
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
  failureThreshold: 3
```

---

## 9. Graceful shutdown

The server listens for `SIGINT` and `SIGTERM`. On receipt:

1. Stops accepting new connections.
2. Waits up to `SHUTDOWN_TIMEOUT` (default `15s`) for in-flight requests to complete.
3. Disconnects the MongoDB client.
4. Exits with code `0`.

If in-flight requests do not drain within the timeout, the HTTP server stops
and Mongo is disconnected anyway — no hard kill loop. Tune `SHUTDOWN_TIMEOUT`
to match your longest expected request latency.

In Kubernetes, set `terminationGracePeriodSeconds` slightly longer than
`SHUTDOWN_TIMEOUT` (e.g. `SHUTDOWN_TIMEOUT=15s` → `terminationGracePeriodSeconds: 20`).

---

## 10. Observability

### Logs

- **Format:** JSON in `staging`/`prod`, text in `dev` (set by `ENV`).
- Every log line includes `env`, `service`, and — for request logs — `request_id`, `method`, `route`, `status`, `latency`, `client_ip`.
- Secrets (`JWT_SECRET`, `MONGO_URI`, raw tokens, passwords) are **never** logged. Do not add them to log lines.

### Metrics (Prometheus)

`GET /metrics` exposes the Prometheus exposition format. Key metrics:

| Metric | Type | Labels |
|--------|------|--------|
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status` |
| `http_requests_in_flight` | Gauge | — |

Scrape config example:

```yaml
scrape_configs:
  - job_name: sebi-crud
    static_configs:
      - targets: ["sebi-crud-service:8080"]
```

### Build info

`GET /version` returns the values baked in by `make build` ldflags:

```json
{
  "version": "v1.2.3",
  "commit": "abc1234",
  "build_time": "2026-05-14T12:00:00Z"
}
```

---

*Last updated: 2026-05-14*

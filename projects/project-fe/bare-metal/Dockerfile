# Bare-metal Dockerfile for SEBI frontend.
# Builds a static SPA and serves it via nginx. Runtime config (listen port,
# backend proxy target) is driven by env vars: nginx:alpine runs `envsubst`
# on /etc/nginx/templates/*.template at container start.
# Target: linux/amd64. No internet required at runtime.

# ── Build stage ──────────────────────────────────────────────────────────────
FROM --platform=linux/amd64 node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* .npmrc* ./
RUN npm ci

COPY . .
RUN npm run build

# ── Runtime stage — nginx serves static files ────────────────────────────────
FROM --platform=linux/amd64 nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html

# Templated nginx config — placeholders ${FRONTEND_PORT}, ${BACKEND_HOST},
# ${HTTP_PORT}, ${MINIO_*}, ${AI_*} are substituted from the container's env
# at startup.
COPY bare-metal/nginx.conf.template /etc/nginx/templates/default.conf.template

# Default values — overridden by the env vars passed in via docker-compose.
# MINIO_HOST/PORT/BUCKET configure the /docs/ proxy that fronts the MinIO
# bucket where complaint attachments are stored.
# AI_HOST/PORT configure the /ai/ proxy that fronts the AI service.
ENV FRONTEND_PORT=3000 \
    BACKEND_HOST=backend \
    HTTP_PORT=8080 \
    MINIO_HOST=minio \
    MINIO_PORT=9000 \
    MINIO_BUCKET=sebi-complaints \
    AI_HOST=ai-backend \
    AI_PORT=9000

CMD ["nginx", "-g", "daemon off;"]

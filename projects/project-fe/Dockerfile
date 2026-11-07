# ── Build stage ──────────────────────────────────────────────────────────────
FROM --platform=linux/amd64 node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
# react-simple-maps@3 declares its peer dep as React 16/17/18, but the app
# runs on React 19 — npm ci enforces peer deps strictly, so the flag is
# required. The same setting is already in .npmrc for `npm install` locally.
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# ── Runtime stage — nginx serves static files ─────────────────────────────────
FROM --platform=linux/amd64 nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html

RUN printf 'server {\n\
  listen 8080;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location /v1/ {\n\
    proxy_pass http://backend.sebi.svc.cluster.local:80/v1/;\n\
    proxy_set_header Host $host;\n\
    proxy_set_header X-Real-IP $remote_addr;\n\
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
  }\n\
  location /docs/ {\n\
    proxy_pass http://minio.onfinance-data.svc.cluster.local:9000/sebi-complaints/;\n\
    proxy_set_header Host minio.onfinance-data.svc.cluster.local;\n\
    proxy_set_header X-Real-IP $remote_addr;\n\
    proxy_buffering off;\n\
  }\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]

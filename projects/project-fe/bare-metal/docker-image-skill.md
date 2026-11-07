# SEBI Frontend — Docker Image Build

Builds a `linux/amd64` image of the SEBI frontend (nginx-served SPA, runtime-configured via env vars) and saves it as a loadable tar at `dist/sebi-frontend.tar`.

No secrets are baked into the image — all runtime config (`FRONTEND_PORT`, `BACKEND_HOST`, `HTTP_PORT`, `MINIO_HOST`, `MINIO_PORT`, `MINIO_BUCKET`, `AI_HOST`, `AI_PORT`) is supplied at container start time via the docker-compose env file.

## Build

From anywhere in the repo:

```bash
./bare-metal/build-image.sh
```

What the script does:

1. `cd`s to the project root (Dockerfile context must be the repo root because the build copies the whole source tree).
2. Ensures `dist/` exists and removes any previous `dist/sebi-frontend.tar`.
3. Runs `docker build --platform linux/amd64 -f bare-metal/Dockerfile -t sebi-frontend:latest .`
4. Runs `docker save -o dist/sebi-frontend.tar sebi-frontend:latest`.

On success, the tar at `dist/sebi-frontend.tar` loads on the target VM as the image `sebi-frontend:latest`.

## .dockerignore

The build context excludes `dist/` so the tar itself (and any stale Vite output) is never slurped into a subsequent build. Two ignore files exist:

- `.dockerignore` at the repo root — fallback for any Dockerfile.
- `bare-metal/Dockerfile.dockerignore` — preferred by BuildKit specifically for `bare-metal/Dockerfile`.

Both list `dist` so either one being honoured produces the same result.

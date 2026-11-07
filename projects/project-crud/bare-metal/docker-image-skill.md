# Building the bare-metal Docker image

Produces a single tarball you can transfer to an offline bare-metal VM and
`docker load` there. On load, the image is tagged `sebi-crud:latest`.

| What              | Value                     |
|-------------------|---------------------------|
| Image tag         | `sebi-crud:latest`        |
| Platform          | `linux/amd64`             |
| Dockerfile        | `bare-metal/Dockerfile`   |
| Build context     | repo root                 |
| Output tarball    | `dist/sebi-crud.tar`      |

## Prereqs

- Docker installed and the daemon running on the build machine.
- No internet on the target VM is fine — everything is baked into the tar.

## One-shot (recommended)

```bash
# first time only:
chmod +x bare-metal/build-image.sh

# build + save:
./bare-metal/build-image.sh
```

The script:
1. Deletes any existing `dist/sebi-crud.tar`.
2. Builds the image for `linux/amd64` from `bare-metal/Dockerfile`, tagged `sebi-crud:latest`.
3. Saves it to `dist/sebi-crud.tar`.
4. Prints the size + SHA-256 so you can verify after `scp`.

## Manual steps (if you want to run commands by hand)

From the repo root:

```bash
rm -f dist/sebi-crud.tar
mkdir -p dist

docker build \
  --platform=linux/amd64 \
  -f bare-metal/Dockerfile \
  -t sebi-crud:latest \
  .

docker save -o dist/sebi-crud.tar sebi-crud:latest

ls -lh dist/sebi-crud.tar
shasum -a 256 dist/sebi-crud.tar   # or: sha256sum dist/sebi-crud.tar
```

## Notes

- **No build args are passed.** The binary reports `version=dev`,
  `commit=unknown`, `buildTime=unknown` via `/version`. That's intentional for
  bare-metal builds. Add `--build-arg VERSION=…` later if you ever need real
  version stamps.
- **Single tag only.** The tar contains exactly one image with one tag
  (`sebi-crud:latest`). `docker load` on the VM will give you that tag and
  nothing else — no `bare-metal-<sha>` companion tag to clean up.
- **Apple Silicon dev machines:** the `linux/amd64` build runs under
  emulation and is noticeably slower than a native build. Expected.
- **`dist/` is gitignored and dockerignored**, so the tar won't bloat the
  next build's context.

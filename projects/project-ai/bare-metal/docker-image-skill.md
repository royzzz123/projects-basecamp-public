# Building the bare-metal Docker image

Produces a single tarball you can transfer to an offline bare-metal VM and
`docker load` there. On load, the image is tagged `sebi-ai:latest`.

| What              | Value                     |
|-------------------|---------------------------|
| Image tag         | `sebi-ai:latest`          |
| Platform          | `linux/amd64`             |
| Dockerfile        | `bare-metal/Dockerfile`   |
| Build context     | repo root                 |
| Output tarball    | `dist/sebi-ai.tar`        |

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
1. Deletes any existing `dist/sebi-ai.tar`.
2. Builds the image for `linux/amd64` from `bare-metal/Dockerfile`, tagged `sebi-ai:latest`.
3. Saves it to `dist/sebi-ai.tar`.
4. Prints the size + SHA-256 so you can verify after `scp`.

## Manual steps (if you want to run commands by hand)

From the repo root:

```bash
rm -f dist/sebi-ai.tar
mkdir -p dist

docker build \
  --platform=linux/amd64 \
  -f bare-metal/Dockerfile \
  -t sebi-ai:latest \
  .

docker save -o dist/sebi-ai.tar sebi-ai:latest

ls -lh dist/sebi-ai.tar
shasum -a 256 dist/sebi-ai.tar   # or: sha256sum dist/sebi-ai.tar
```

## Notes

- **Apple Silicon dev machines:** the `linux/amd64` build runs under
  emulation and is noticeably slower than a native build. Expected.
- **Single tag only.** The tar contains exactly one image with one tag
  (`sebi-ai:latest`). `docker load` on the VM will give you that tag and
  nothing else.
- **`dist/` is gitignored and dockerignored**, so the tar won't bloat the
  next build's context.
- **PyMuPDF / Pillow** include native code; the build stage installs
  `build-essential` to compile any sdist that doesn't ship a manylinux
  wheel. The final image discards the toolchain.

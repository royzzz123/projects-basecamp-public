# Building the bare-metal Docker image

Produces a single tarball you can transfer to an offline bare-metal VM and
`docker load` there. On load, the image is tagged `sebi-chat:bare-metal`.

| What              | Value                       |
|-------------------|-----------------------------|
| Image tag         | `sebi-chat:bare-metal`      |
| Platform          | `linux/amd64`               |
| Dockerfile        | `bare-metal/Dockerfile`     |
| Build context     | repo root                   |
| Output tarball    | `dist/sebi-chat.tar`        |

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
1. Deletes any existing `dist/sebi-chat.tar`.
2. Builds the image for `linux/amd64` from `bare-metal/Dockerfile`, tagged `sebi-chat:bare-metal`.
3. Saves it to `dist/sebi-chat.tar`.
4. Prints the size + SHA-256 so you can verify after `scp`.

## Manual steps (if you want to run commands by hand)

From the repo root:

```bash
rm -f dist/sebi-chat.tar
mkdir -p dist

docker build \
  --platform=linux/amd64 \
  -f bare-metal/Dockerfile \
  -t sebi-chat:bare-metal \
  .

docker save -o dist/sebi-chat.tar sebi-chat:bare-metal

ls -lh dist/sebi-chat.tar
shasum -a 256 dist/sebi-chat.tar   # or: sha256sum dist/sebi-chat.tar
```

## Notes

- **Apple Silicon dev machines:** the `linux/amd64` build runs under
  emulation and is noticeably slower than a native build. Expected.
- **Single tag only.** The tar contains exactly one image with one tag
  (`sebi-chat:bare-metal`). `docker load` on the VM will give you that tag
  and nothing else.
- **`dist/` is gitignored and dockerignored**, so the tar won't bloat the
  next build's context.

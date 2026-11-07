#!/usr/bin/env bash
# Builds the SEBI frontend docker image for linux/amd64 and writes it as a
# loadable tar to dist/sebi-frontend.tar at the project root. Any existing tar
# at that path is replaced.
#
# Usage: ./bare-metal/build-image.sh  (works from any cwd)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="sebi-frontend:latest"
DIST_DIR="$PROJECT_ROOT/dist"
TAR_PATH="$DIST_DIR/sebi-frontend.tar"

cd "$PROJECT_ROOT"

mkdir -p "$DIST_DIR"
rm -f "$TAR_PATH"

echo ">> Building $IMAGE_NAME for linux/amd64"
docker build \
  --platform linux/amd64 \
  -f bare-metal/Dockerfile \
  -t "$IMAGE_NAME" \
  .

echo ">> Saving image to $TAR_PATH"
docker save -o "$TAR_PATH" "$IMAGE_NAME"

SIZE="$(du -h "$TAR_PATH" | cut -f1)"
echo ">> Done. $TAR_PATH ($SIZE)"
echo "   Load on target VM: docker load -i sebi-frontend.tar"

#!/usr/bin/env bash
# Build a linux/amd64 image of the SEBI chatbot service and save it to
# dist/sebi-chat.tar for offline transfer to a bare-metal VM.
#
# Output:  dist/sebi-chat.tar   (loads as image tag: sebi-chat:bare-metal)
# Usage:   ./bare-metal/build-image.sh    (run from anywhere in the repo)

set -euo pipefail

command -v docker >/dev/null || { echo "ERROR: docker not found in PATH" >&2; exit 1; }

# Resolve repo root from this script's location so it works from any CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

IMAGE_TAG="sebi-chat:bare-metal"
DOCKERFILE="${REPO_ROOT}/bare-metal/Dockerfile"
OUT_DIR="${REPO_ROOT}/dist"
OUT_TAR="${OUT_DIR}/sebi-chat.tar"

mkdir -p "${OUT_DIR}"

if [[ -f "${OUT_TAR}" ]]; then
    echo "==> Removing existing ${OUT_TAR}"
    rm -f "${OUT_TAR}"
fi

echo "==> Building ${IMAGE_TAG} (linux/amd64) from ${DOCKERFILE}"
docker build \
    --platform=linux/amd64 \
    -f "${DOCKERFILE}" \
    -t "${IMAGE_TAG}" \
    "${REPO_ROOT}"

echo "==> Saving image to ${OUT_TAR}"
docker save -o "${OUT_TAR}" "${IMAGE_TAG}"

echo
echo "Image:   ${IMAGE_TAG}"
echo "Tarball: ${OUT_TAR}"
ls -lh "${OUT_TAR}"
if command -v sha256sum >/dev/null; then
    sha256sum "${OUT_TAR}"
elif command -v shasum >/dev/null; then
    shasum -a 256 "${OUT_TAR}"
fi

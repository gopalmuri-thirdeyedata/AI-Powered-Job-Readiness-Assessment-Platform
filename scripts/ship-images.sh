#!/usr/bin/env bash
# Optional: build the images on this machine and load them on the server, so the server never builds anything.
#   bash scripts/ship-images.sh server2 frontend                  # ship only the frontend image (small)
#   bash scripts/ship-images.sh server2 backend frontend code_runner
# Run it from a checkout of the exact commit you want to deploy. Afterwards, on the server:
#   cd ~/interviewer-platform && docker compose -f docker-compose.prod.yml up -d --no-build
# It assumes the server is linux/amd64 (check with `uname -m` there). `docker save` sends whole images, not layer differences, so ship only the
# services that changed: the backend image is large. No secrets are in the images (backend/.env is excluded by .dockerignore and read at run time).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SERVER="${1:?usage: ship-images.sh <ssh-host> <service>...}"
shift
[ "$#" -gt 0 ] || { echo "name at least one service: backend frontend code_runner" >&2; exit 2; }

export DOCKER_DEFAULT_PLATFORM=linux/amd64
bash scripts/build-images.sh "$@"

images=()
for s in "$@"; do images+=("interviewer-platform-$s"); done
echo "[ship] sending ${images[*]} to $SERVER"
docker save "${images[@]}" | gzip | ssh "$SERVER" 'gunzip | docker load'
echo "[ship] done. On the server: docker compose -f docker-compose.prod.yml up -d --no-build"

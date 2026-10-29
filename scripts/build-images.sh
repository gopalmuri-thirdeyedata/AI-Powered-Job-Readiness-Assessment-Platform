#!/usr/bin/env bash
# Builds the production images on this machine (server2, or a developer machine).
#   bash scripts/build-images.sh                 # every service
#   bash scripts/build-images.sh frontend        # only the services you name (extra flags such as --no-cache are passed through)
#
# The backend's dependencies (system packages, requirements.txt: ONNX Runtime + OpenCV for proctoring, no PyTorch) live in a tagged "base" image. Its tag is
# a hash of requirements.txt plus the dependency part of backend/Dockerfile, and it is built only when no image with that tag exists. So a
# code-only deploy takes seconds and cannot be slowed down by a pruned build cache: `docker builder prune` removes cache, not tagged images.
# Old base tags are left in place; remove the ones you no longer need with `docker rmi`.
# Run it with `bash`: the exec bit is lost when the project is shipped as a tarball.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

services=()
for a in "$@"; do case "$a" in -*) ;; *) services+=("$a") ;; esac; done

need_base=1
if [ "${#services[@]}" -gt 0 ]; then
  need_base=0
  for s in "${services[@]}"; do [ "$s" = backend ] && need_base=1; done
fi

if [ "$need_base" = 1 ]; then
  # CR characters are stripped first so the tag is the same whether the files were checked out with LF or CRLF line endings
  HASH=$( { sed '/^# ==== RUNTIME STAGE/,$d' backend/Dockerfile; cat backend/requirements.txt; } | tr -d '\r' | sha256sum | cut -c1-12 )
  BASE="interviewer-backend-base:${HASH}"
  if docker image inspect "$BASE" >/dev/null 2>&1; then
    echo "[build] base image $BASE found, reusing it"
  else
    echo "[build] base image $BASE not found: building it (slow; only needed when requirements.txt or the dependency part of backend/Dockerfile changed)"
    docker build --target deps -t "$BASE" backend
  fi
  export BACKEND_BASE_IMAGE="$BASE"
fi

exec docker compose -f "$COMPOSE_FILE" build "$@"

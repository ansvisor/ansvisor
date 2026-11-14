#!/usr/bin/env bash
# Release, on the API server (run through ssm-run.sh, as root): start the image
# server-build.sh built, then check it stays up and answers. If it doesn't,
# put back what ran before (noted in ~/.release-previous) and fail.
set -euo pipefail
runuser -u ubuntu -- bash -lc '
  set -uo pipefail
  cd ~/ansvisor

  healthy() {
    sleep 20
    local state code
    state=$(docker inspect -f "{{.State.Running}} {{.RestartCount}}" ansvisor-server-1 2>/dev/null)
    # /api/health sits behind auth: 401 means the server is up and answering.
    code=$(curl -s -o /dev/null -m 10 -w "%{http_code}" http://localhost/api/health)
    echo "container: ${state:-missing}, /api/health: $code"
    [ "$state" = "true 0" ] && { [ "$code" = 200 ] || [ "$code" = 401 ]; }
  }

  docker compose up -d --force-recreate server
  if healthy; then
    docker logs --tail 6 ansvisor-server-1
    exit 0
  fi

  echo "The new server is not healthy; its last log lines:"
  docker logs --tail 30 ansvisor-server-1 2>&1
  if [ ! -s ~/.release-previous ]; then
    echo "Nothing noted to roll back to."
    exit 1
  fi
  read -r prev_sha prev_image prev_name < ~/.release-previous
  echo "Rolling back to $prev_sha"
  git checkout -q --detach "$prev_sha"
  docker tag "$prev_image" "$prev_name"
  docker compose up -d --force-recreate server
  healthy || echo "The rolled-back server is not healthy either."
  exit 1
'

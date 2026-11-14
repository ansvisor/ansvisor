#!/usr/bin/env bash
# Release, on the API server (run through ssm-run.sh, as root): check out the
# release commit and build its server image. The running container is left
# alone. What is running now is noted, for server-up.sh to roll back to.
# __SHA__ is replaced with the release commit before this is sent.
set -euo pipefail
runuser -u ubuntu -- bash -lc '
  set -euo pipefail
  cd ~/ansvisor
  if docker inspect ansvisor-server-1 >/dev/null 2>&1; then
    printf "%s %s %s\n" \
      "$(git rev-parse HEAD)" \
      "$(docker inspect -f "{{.Image}}" ansvisor-server-1)" \
      "$(docker inspect -f "{{.Config.Image}}" ansvisor-server-1)" > ~/.release-previous
  fi
  git fetch -q origin
  git checkout -q --detach __SHA__
  git --no-pager log -1 --oneline
  docker compose build server 2>&1 | tail -n 5
'

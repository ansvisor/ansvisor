#!/usr/bin/env bash
# Runs a shell script on the API server through AWS Systems Manager and waits
# for it, printing its output (the Release workflow's server steps).
#
#   scripts/release/ssm-run.sh <script.sh> [timeout-seconds]
#
# Needs AWS credentials (the workflow's OIDC role), AWS_REGION and
# EC2_INSTANCE_ID. The script runs as root on the server; the server scripts
# switch to the `ubuntu` user themselves.
set -euo pipefail

script="$1"
timeout="${2:-1200}"
: "${EC2_INSTANCE_ID:?}" "${AWS_REGION:?}"

params=$(jq -Rs '{commands: [.], executionTimeout: ["'"$timeout"'"]}' < "$script")
id=$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "release: $(basename "$script")" \
  --parameters "$params" \
  --query Command.CommandId --output text)
echo "SSM command $id ($(basename "$script"))"

deadline=$(( $(date +%s) + timeout + 60 ))
status=Pending
while :; do
  sleep 5
  status=$(aws ssm get-command-invocation --region "$AWS_REGION" \
    --command-id "$id" --instance-id "$EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$status" in
    Pending | InProgress | Delayed) ;;
    *) break ;;
  esac
  if [ "$(date +%s)" -gt "$deadline" ]; then
    echo "Timed out waiting for $id (last status $status)" >&2
    exit 1
  fi
done

aws ssm get-command-invocation --region "$AWS_REGION" \
  --command-id "$id" --instance-id "$EC2_INSTANCE_ID" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text

echo "Status: $status"
[ "$status" = Success ]

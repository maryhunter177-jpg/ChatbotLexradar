#!/usr/bin/env bash
set -euo pipefail

cd /opt/lexradar-bot/app
set -a
source deploy/.env
set +a

printf 'EVOLUTION_API='
curl -fsS \
  -H 'Origin: http://127.0.0.1:3100' \
  -H "apikey: ${EVOLUTION_API_KEY}" \
  http://127.0.0.1:8080/instance/fetchInstances
printf '\nBOT_STATUS='
curl -fsS \
  -H "Authorization: Bearer ${BOT_ADMIN_TOKEN}" \
  http://127.0.0.1:3100/api/status
printf '\n'

docker compose --env-file deploy/.env -f deploy/compose.vps.yaml ps

#!/usr/bin/env bash
set -euo pipefail

target="${1:-/opt/lexradar-bot/app/deploy/.env}"
if [[ -e "$target" ]]; then
  echo "env-already-exists"
  exit 0
fi

umask 077
postgres_password="$(openssl rand -hex 32)"
redis_password="$(openssl rand -hex 32)"
evolution_api_key="$(openssl rand -hex 32)"
admin_token="$(openssl rand -hex 32)"
bridge_token="$(openssl rand -hex 32)"
webhook_secret="$(openssl rand -hex 32)"

{
  printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
  printf 'REDIS_PASSWORD=%s\n' "$redis_password"
  printf 'EVOLUTION_API_KEY=%s\n' "$evolution_api_key"
  printf 'BOT_ADMIN_TOKEN=%s\n' "$admin_token"
  printf 'BOT_BRIDGE_TOKEN=%s\n' "$bridge_token"
  printf 'EVOLUTION_WEBHOOK_SECRET=%s\n' "$webhook_secret"
  printf 'DISPATCH_ENABLED=false\n'
} >"$target"
chmod 0600 "$target"
echo 'env-created'

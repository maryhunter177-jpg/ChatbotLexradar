#!/usr/bin/env sh
set -eu

APP_DIR="${1:-/opt/lexradar-bot/app}"
RELEASE="${2:-manual}"
BACKUP_DIR="${3:-/opt/lexradar-bot/backups}"

cd "$APP_DIR"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Existem alteracoes versionadas pendentes na VPS; atualizacao cancelada." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
docker cp lexradar-whatsapp-bot-1:/app/data/bot-state.json "$BACKUP_DIR/bot-state-before-$RELEASE.json"

git pull --ff-only origin main
docker compose --env-file deploy/.env -f deploy/compose.vps.yaml build bot
docker compose --env-file deploy/.env -f deploy/compose.vps.yaml up -d --no-deps bot

echo "Bot atualizado; Evolution API e sessao do WhatsApp preservadas."

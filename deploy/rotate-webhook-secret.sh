#!/usr/bin/env sh
set -eu

APP_DIR="${1:-/opt/lexradar-bot/app}"
INSTANCE_NAME="${2:-lexradar-homologacao-01}"
ENV_FILE="$APP_DIR/deploy/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Arquivo de ambiente nao encontrado." >&2
  exit 1
fi

EVOLUTION_API_KEY="$(sed -n 's/^EVOLUTION_API_KEY=//p' "$ENV_FILE")"
NEW_WEBHOOK_SECRET="$(openssl rand -hex 32)"
PAYLOAD_FILE="$(mktemp)"
RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$PAYLOAD_FILE" "$RESPONSE_FILE"' EXIT

printf '%s' "{\"webhook\":{\"enabled\":true,\"url\":\"http://bot:3100/webhooks/evolution\",\"webhookByEvents\":false,\"webhookBase64\":false,\"headers\":{\"x-webhook-secret\":\"$NEW_WEBHOOK_SECRET\"},\"events\":[\"QRCODE_UPDATED\",\"MESSAGES_UPSERT\",\"CONNECTION_UPDATE\",\"SEND_MESSAGE\"]}}" > "$PAYLOAD_FILE"

HTTP_STATUS="$(curl --silent --show-error --output "$RESPONSE_FILE" --write-out '%{http_code}' \
  --request POST \
  --header "apikey: $EVOLUTION_API_KEY" \
  --header 'Origin: http://127.0.0.1:3100' \
  --header 'Content-Type: application/json' \
  --data-binary "@$PAYLOAD_FILE" \
  "http://127.0.0.1:8080/webhook/set/$INSTANCE_NAME")"

case "$HTTP_STATUS" in
  2??) ;;
  *)
    echo "A Evolution API recusou a renovacao do webhook (HTTP $HTTP_STATUS)." >&2
    sed -E 's/[[:xdigit:]]{64}/[REDACTED]/g' "$RESPONSE_FILE" >&2
    exit 1
    ;;
esac

sed -i "s/^EVOLUTION_WEBHOOK_SECRET=.*/EVOLUTION_WEBHOOK_SECRET=$NEW_WEBHOOK_SECRET/" "$ENV_FILE"
cd "$APP_DIR"
docker compose --env-file deploy/.env -f deploy/compose.vps.yaml up -d --force-recreate bot >/dev/null

echo "Credencial interna do webhook renovada com sucesso."

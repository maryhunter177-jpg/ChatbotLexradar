#!/usr/bin/env bash
set -euo pipefail

readonly ACCOUNT_PREFIX="lrb-"
readonly ACCOUNT_BASE="/var/lib/lexradar-tunnel"

usage() {
  printf 'Uso (como root): revoke-client-tunnel.sh CLIENT_ID\n' >&2
}

fail() {
  printf 'erro: %s\n' "$*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "execute como root"
[[ "$#" -eq 1 ]] || { usage; exit 2; }

client_id="$1"
[[ "$client_id" =~ ^[a-z0-9][a-z0-9-]{0,18}[a-z0-9]$ ]] || fail "CLIENT_ID invalido"

account_name="${ACCOUNT_PREFIX}${client_id}"
authorized_keys="${ACCOUNT_BASE}/${client_id}/.ssh/authorized_keys"
id "$account_name" >/dev/null 2>&1 || fail "cliente nao provisionado"

# Revoga a chave de forma atomica e encerra tuneis atualmente conectados.
if [[ -e "$authorized_keys" ]]; then
  revoked_copy="${authorized_keys}.revoked.$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$authorized_keys" "$revoked_copy"
fi
install -m 0600 -o "$account_name" -g lexradar-tunnel /dev/null "$authorized_keys"
passwd --lock "$account_name" >/dev/null 2>&1 || true
pkill -KILL -u "$account_name" 2>/dev/null || true

logger -t lexradar-tunnel "revoked client=${client_id} user=${account_name}"
printf 'acesso revogado: cliente=%s usuario=%s\n' "$client_id" "$account_name"

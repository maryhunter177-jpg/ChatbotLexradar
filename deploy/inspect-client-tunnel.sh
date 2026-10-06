#!/usr/bin/env bash
set -euo pipefail

readonly ACCOUNT_PREFIX="lrb-"
readonly ACCOUNT_BASE="/var/lib/lexradar-tunnel"

[[ "$#" -eq 1 ]] || { printf 'Uso: inspect-client-tunnel.sh CLIENT_ID\n' >&2; exit 2; }
client_id="$1"
[[ "$client_id" =~ ^[a-z0-9][a-z0-9-]{0,18}[a-z0-9]$ ]] || { printf 'CLIENT_ID invalido\n' >&2; exit 2; }

account_name="${ACCOUNT_PREFIX}${client_id}"
authorized_keys="${ACCOUNT_BASE}/${client_id}/.ssh/authorized_keys"
sshd_fragment="/etc/ssh/sshd_config.d/70-lexradar-${client_id}.conf"

if ! id "$account_name" >/dev/null 2>&1; then
  printf 'estado: ausente\ncliente: %s\n' "$client_id"
  exit 1
fi

printf 'estado: provisionado\ncliente: %s\nusuario: %s\n' "$client_id" "$account_name"
printf 'restricao sshd: %s\n' "$([[ -f "$sshd_fragment" ]] && printf presente || printf ausente)"
if [[ -s "$authorized_keys" ]]; then
  printf 'chave: ativa\n'
  ssh-keygen -l -f "$authorized_keys"
else
  printf 'chave: revogada\n'
fi
printf 'sessoes ativas: '
pgrep -u "$account_name" sshd 2>/dev/null | wc -l

#!/usr/bin/env bash
set -euo pipefail

readonly PANEL_TARGET="127.0.0.1:3100"
readonly ACCOUNT_PREFIX="lrb-"
readonly TUNNEL_GROUP="lexradar-tunnel"
readonly ACCOUNT_BASE="/var/lib/lexradar-tunnel"

usage() {
  cat <<'EOF'
Uso (como root):
  provision-client-tunnel.sh CLIENT_ID ARQUIVO_CHAVE_PUBLICA

Exemplo:
  sudo ./deploy/provision-client-tunnel.sh escritorio-01 /tmp/escritorio-01.pub

CLIENT_ID aceita apenas letras minusculas, numeros e hifen (2 a 20 caracteres).
Somente chaves Ed25519 sem opcoes prefixadas sao aceitas.
EOF
}

fail() {
  printf 'erro: %s\n' "$*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || fail "execute como root"
[[ "$#" -eq 2 ]] || { usage; exit 2; }

client_id="$1"
public_key_file="$2"

[[ "$client_id" =~ ^[a-z0-9][a-z0-9-]{0,18}[a-z0-9]$ ]] || \
  fail "CLIENT_ID invalido"
[[ -f "$public_key_file" ]] || fail "arquivo de chave publica nao encontrado"
[[ -s "$public_key_file" ]] || fail "arquivo de chave publica vazio"
[[ "$(wc -c < "$public_key_file")" -le 16384 ]] || fail "chave publica grande demais"

mapfile -t key_lines < <(tr -d '\r' < "$public_key_file")
[[ "${#key_lines[@]}" -eq 1 ]] || fail "informe exatamente uma chave publica"
public_key="${key_lines[0]}"
[[ "$public_key" =~ ^ssh-ed25519[[:space:]]+[A-Za-z0-9+/]+={0,3}([[:space:]].*)?$ ]] || \
  fail "somente chave publica Ed25519, sem opcoes prefixadas"
ssh-keygen -l -f "$public_key_file" >/dev/null 2>&1 || fail "chave publica Ed25519 invalida"

account_name="${ACCOUNT_PREFIX}${client_id}"
account_home="${ACCOUNT_BASE}/${client_id}"
ssh_dir="${account_home}/.ssh"
authorized_keys="${ssh_dir}/authorized_keys"
sshd_fragment="/etc/ssh/sshd_config.d/70-lexradar-${client_id}.conf"

getent group "$TUNNEL_GROUP" >/dev/null || groupadd --system "$TUNNEL_GROUP"

if id "$account_name" >/dev/null 2>&1; then
  actual_home="$(getent passwd "$account_name" | cut -d: -f6)"
  [[ "$actual_home" == "$account_home" ]] || fail "usuario existente possui home inesperado: $actual_home"
  usermod --shell /usr/sbin/nologin --gid "$TUNNEL_GROUP" "$account_name"
else
  useradd \
    --create-home \
    --home-dir "$account_home" \
    --shell /usr/sbin/nologin \
    --gid "$TUNNEL_GROUP" \
    "$account_name"
fi

# Impede senha local sem desabilitar autenticacao por chave publica.
passwd --lock "$account_name" >/dev/null 2>&1 || true
install -d -m 0700 -o "$account_name" -g "$TUNNEL_GROUP" "$ssh_dir"

key_options="restrict,port-forwarding,permitopen=\"${PANEL_TARGET}\""
temporary_key="$(mktemp "${ssh_dir}/authorized_keys.XXXXXX")"
trap 'rm -f "$temporary_key"' EXIT
printf '%s %s\n' "$key_options" "$public_key" > "$temporary_key"
chown "$account_name:$TUNNEL_GROUP" "$temporary_key"
chmod 0600 "$temporary_key"
mv -f "$temporary_key" "$authorized_keys"
trap - EXIT

temporary_config="$(mktemp)"
cat > "$temporary_config" <<EOF
# Gerenciado por provision-client-tunnel.sh para ${client_id}.
Match User ${account_name}
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PubkeyAuthentication yes
    AuthenticationMethods publickey
    AllowTcpForwarding local
    PermitOpen ${PANEL_TARGET}
    X11Forwarding no
    AllowAgentForwarding no
    PermitTTY no
    PermitUserRC no
EOF
chmod 0644 "$temporary_config"

backup_config=""
if [[ -f "$sshd_fragment" ]]; then
  backup_config="$(mktemp)"
  cp -p "$sshd_fragment" "$backup_config"
fi
install -m 0644 "$temporary_config" "$sshd_fragment"
rm -f "$temporary_config"

if ! sshd -t; then
  if [[ -n "$backup_config" ]]; then
    install -m 0644 "$backup_config" "$sshd_fragment"
  else
    rm -f "$sshd_fragment"
  fi
  rm -f "$backup_config"
  fail "sshd rejeitou a configuracao; fragmento anterior restaurado"
fi
rm -f "$backup_config"

if systemctl is-active --quiet ssh; then
  systemctl reload ssh
elif systemctl is-active --quiet sshd; then
  systemctl reload sshd
else
  fail "servico SSH nao esta ativo"
fi

fingerprint="$(ssh-keygen -l -f "$authorized_keys" | awk '{print $2}')"
logger -t lexradar-tunnel "provisioned client=${client_id} user=${account_name} fingerprint=${fingerprint} target=${PANEL_TARGET}"

cat <<EOF
provisionamento concluido
cliente: ${client_id}
usuario SSH: ${account_name}
destino permitido: ${PANEL_TARGET}
fingerprint: ${fingerprint}

A chave privada permanece exclusivamente no computador do cliente.
EOF

#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 git ca-certificates curl ufw fail2ban unattended-upgrades openssl
systemctl enable --now docker fail2ban unattended-upgrades
timedatectl set-timezone America/Sao_Paulo

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

install -d -m 0700 /opt/lexradar-bot

cat >/etc/ssh/sshd_config.d/99-lexradar-security.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
EOF
sshd -t
systemctl reload ssh

echo 'bootstrap-complete'

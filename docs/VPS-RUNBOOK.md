# Runbook da VPS de homologacao

## Arquitetura

A stack usa Docker Compose com Evolution API `v2.3.7`, PostgreSQL 15, Redis 7 e o bot. Nenhuma porta da aplicacao fica exposta publicamente durante a homologacao; o acesso ocorre por tunel SSH.

## Acesso local por tunel

O comando abaixo usa a credencial administrativa de desenvolvimento e nao deve ser entregue ao cliente final. Para provisionar uma conta individual limitada exclusivamente ao painel, siga [CLIENT-TUNNEL-ACCESS.md](CLIENT-TUNNEL-ACCESS.md).

```powershell
ssh -i "$env:USERPROFILE\.ssh\lexradar-vps" -L 3100:127.0.0.1:3100 -L 8080:127.0.0.1:8080 root@IP_DA_VPS
```

Com o tunel aberto, use `http://127.0.0.1:3100` para o bot e `http://127.0.0.1:8080` para a Evolution API.

## Operacao na VPS

```bash
cd /opt/lexradar-bot/app
docker compose --env-file deploy/.env -f deploy/compose.vps.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.vps.yaml logs --tail=100
docker compose --env-file deploy/.env -f deploy/compose.vps.yaml up -d --build
```

O arquivo `deploy/.env` contem segredos e nunca deve sair da VPS nem entrar no Git. O disparo permanece desativado ate a homologacao.

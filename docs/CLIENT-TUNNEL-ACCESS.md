# Acesso restrito do conector do cliente

## Objetivo

O computador do cliente acessa somente o painel do bot em `127.0.0.1:3100` na VPS por encaminhamento SSH local. A chave entregue ao cliente nao permite acesso root, terminal, TTY, encaminhamento remoto, Evolution API ou outros servicos da VPS.

Cada instalacao recebe uma conta e uma chave Ed25519 exclusivas. Assim, um cliente pode ser revogado ou ter sua chave rotacionada sem interromper os demais.

## Limites de seguranca

- O painel continua escutando apenas em `127.0.0.1:3100` na VPS.
- A conta tem shell `/usr/sbin/nologin` e senha bloqueada.
- O `sshd` permite apenas encaminhamento local para `127.0.0.1:3100`.
- A propria chave repete a restricao com `restrict`, `port-forwarding` e `permitopen`.
- A chave privada nunca deve ser enviada ao servidor, Git, WhatsApp ou suporte.
- Nao reutilizar a chave de desenvolvimento/root no computador do cliente.

## 1. Gerar a chave no computador do cliente

No PowerShell, usando um identificador unico para a instalacao:

```powershell
$KeyPath = Join-Path $env:LOCALAPPDATA 'LexRadarBot\keys\client-tunnel'
New-Item -ItemType Directory -Force (Split-Path $KeyPath) | Out-Null
ssh-keygen -t ed25519 -a 100 -f $KeyPath -C 'lexradar-escritorio-01'
```

Defina uma frase secreta quando o conector possuir suporte seguro para desbloquea-la. Durante a homologacao automatizada, se for indispensavel iniciar sem interacao, proteja a chave com ACL exclusiva da conta Windows e nunca a copie para outro computador.

Somente o arquivo `client-tunnel.pub` e enviado ao administrador da VPS por canal autenticado. Confirme o fingerprint por um segundo canal:

```powershell
ssh-keygen -lf "$KeyPath.pub"
```

## 2. Provisionar na VPS

Primeiro revise o script; depois execute como root com a chave publica recebida:

```bash
cd /opt/lexradar-bot/app
sudo bash deploy/provision-client-tunnel.sh escritorio-01 /tmp/escritorio-01.pub
sudo bash deploy/inspect-client-tunnel.sh escritorio-01
```

O identificador deve ser minusculo, ter de 2 a 20 caracteres e conter somente letras, numeros ou hifen. A conta criada no exemplo sera `lrb-escritorio-01`.

Apague a copia temporaria da chave publica depois de conferir o fingerprint. A chave publica nao e secreta, mas a remocao evita confusao operacional.

## 3. Validar no computador do cliente

Abra o tunel sem solicitar terminal:

```powershell
$KeyPath = Join-Path $env:LOCALAPPDATA 'LexRadarBot\keys\client-tunnel'
ssh -N -T `
  -i $KeyPath `
  -L '127.0.0.1:3100:127.0.0.1:3100' `
  -o 'ExitOnForwardFailure=yes' `
  -o 'ServerAliveInterval=30' `
  -o 'ServerAliveCountMax=3' `
  lrb-escritorio-01@IP_DA_VPS
```

Com o processo ativo, `http://127.0.0.1:3100` deve abrir. Os seguintes testes devem falhar:

```powershell
ssh -i $KeyPath lrb-escritorio-01@IP_DA_VPS
ssh -N -T -i $KeyPath -L '127.0.0.1:8080:127.0.0.1:8080' lrb-escritorio-01@IP_DA_VPS
```

O primeiro nao pode fornecer terminal e o segundo nao pode abrir acesso a Evolution API.

## 4. Rotacionar uma chave

Gere uma nova chave em arquivo diferente, confira o fingerprint e execute novamente o provisionamento com o mesmo `CLIENT_ID`:

```bash
sudo bash deploy/provision-client-tunnel.sh escritorio-01 /tmp/escritorio-01-nova.pub
sudo bash deploy/inspect-client-tunnel.sh escritorio-01
```

O script substitui atomicamente a chave autorizada. Depois do teste com a nova chave, encerre processos antigos do conector e remova a chave privada anterior do computador pela politica interna de descarte seguro.

Rotacione imediatamente em caso de perda do computador, suspeita de copia ou mudanca de responsavel. Como rotina, recomenda-se revisar acessos trimestralmente e rotacionar ao menos anualmente.

## 5. Revogar

```bash
sudo bash deploy/revoke-client-tunnel.sh escritorio-01
sudo bash deploy/inspect-client-tunnel.sh escritorio-01
```

A revogacao esvazia `authorized_keys`, bloqueia a conta e encerra os tuneis ativos daquele cliente. O fragmento restritivo do `sshd` permanece instalado como defesa adicional. Para reativar, gere uma chave nova e execute o provisionamento novamente.

## Auditoria

Provisionamentos e revogacoes sao enviados ao journal com a etiqueta `lexradar-tunnel`:

```bash
journalctl -t lexradar-tunnel
journalctl -u ssh --since today
```

O log registra identificador, usuario, fingerprint publico e destino permitido; nunca registra chave privada, token administrativo ou dados de leads.

## Checklist antes de entregar ao cliente

1. Confirmar que o fingerprint recebido coincide com o exibido pelo provisionamento.
2. Executar `sshd -t` e verificar que o servico SSH continua ativo.
3. Confirmar abertura de `http://127.0.0.1:3100` pelo tunel.
4. Confirmar que terminal e porta `8080` foram recusados.
5. Confirmar que a chave root/de desenvolvimento nao existe no computador do cliente.
6. Registrar cliente, responsavel, computador, fingerprint, criacao e proxima revisao no inventario interno.

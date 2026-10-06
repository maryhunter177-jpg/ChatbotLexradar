# Integracao LexRadar 1.7.0 -> Bot

## Fronteira

O LexRadar permanece desktop/local. A ponte faz conexao de saida para a VPS e nunca altera `lexradar-data.json`. A leitura usa uma copia em memoria e valida a estrutura antes de extrair dados.

Na homologacao, `BOT_REMOTE_URL` aponta exclusivamente para `http://127.0.0.1:3100`. Esse endereco e encaminhado por SSH para `127.0.0.1:3100` da VPS; a API do bot nao precisa de porta publica. A ponte rejeita destinos remotos HTTP por padrao. `BRIDGE_ALLOW_REMOTE=true` existe apenas para uma futura publicacao deliberada com HTTPS.

## Instalacao local da ponte (Windows)

1. Copie `.env.example` para `.env` e configure `LEXRADAR_STATE_PATH` com o JSON real.
2. Coloque em `BOT_BRIDGE_TOKEN` o mesmo segredo existente na VPS. O segredo fica apenas no `.env`, que e ignorado pelo Git.
3. Mantenha `BOT_REMOTE_URL=http://127.0.0.1:3100` e `BRIDGE_ALLOW_REMOTE=false`.
4. Mantenha a chave SSH privada fora do repositorio, preferencialmente em `%USERPROFILE%\.ssh\lexradar-vps`.
5. Valide sem enviar dados:

```powershell
npm run bridge:check
.\deploy\run-lexradar-bridge.ps1 -VpsHost '<IP_DA_VPS>' -DryRun
```

6. Execute uma sincronizacao controlada:

```powershell
.\deploy\run-lexradar-bridge.ps1 -VpsHost '<IP_DA_VPS>' -Once
```

7. Depois da conferencia no painel, deixe o supervisor ativo:

```powershell
.\deploy\run-lexradar-bridge.ps1 -VpsHost '<IP_DA_VPS>'
```

O supervisor usa `StrictHostKeyChecking=yes`, falha se o encaminhamento nao puder ser criado, envia keepalive e reabre o tunel/bridge apos uma queda. Logs locais sao gravados em `logs/`, sem registrar o token.

Para iniciar automaticamente no logon do usuario atual:

```powershell
.\deploy\install-lexradar-bridge-task.ps1 -VpsHost '<IP_DA_VPS>'
Start-ScheduledTask -TaskName 'LexRadar Bridge'
```

Antes disso, conecte manualmente uma vez por SSH e confira a chave de host apresentada pelo provedor. Nao desative `StrictHostKeyChecking`.

## Controles de volume e leitura

- `BRIDGE_MAX_STATE_BYTES` limita o JSON local (padrao: 50 MiB).
- `BRIDGE_MAX_LEADS` interrompe a sincronizacao se o lote elegivel for inesperadamente grande (padrao: 10.000).
- `--dry-run` le, valida e conta, mas nao exige token nem chama a VPS.
- A ponte nao altera o arquivo, nao envia CPF/placa/AIT e limita o tamanho dos campos textuais no DTO.

## Elegibilidade tecnica

Um registro pode ser importado quando possui `id`, ao menos um telefone brasileiro valido, modo `live` e um status de resultado concluido. Importar nao autoriza enviar. O campo `contactPermission` nasce como `pending_review`.

## DTO versionado

`schemaVersion`, `sourceId`, `sourceBatchId`, `type`, `name`, `phones`, `classification`, `infractionCode`, `infractionDescription`, `processNumber`, `sourceFile`, `sourceUpdatedAt` e `dataMode`.

Dados como CPF, placa, AIT e conteudo original nao atravessam a ponte. A chave idempotente e `lexradar:<sourceId>`; atualizacoes do mesmo registro nao criam outro lead.

## Envio

A chave de idempotencia de um job combina campanha, lead e telefone. O worker exige:

- `DISPATCH_ENABLED=true` no ambiente;
- campanha ativa;
- lead aprovado;
- instancia conectada e habilitada;
- horario permitido, limite diario e delay respeitados.

Falhas transitorias usam backoff limitado. Falhas definitivas vao para `failed`, sem troca automatica de numero depois de uma resposta ambigua da API.

O painel cria campanhas inicialmente em rascunho. Antes da ativacao, a API gera uma previa sem criar job nem chamar a Evolution. Na ativacao, a mensagem renderizada e salva no job como uma fotografia da revisao realizada. A janela padrao do painel e de segunda a sexta, das 09:00 as 18:00, no fuso `America/Sao_Paulo`.

Mensagens recebidas pela Evolution sao verificadas para pedidos objetivos de descadastro. Ao receber `SAIR`, `PARE`, `PARAR`, `REMOVER`, `CANCELAR`, `DESCADASTRAR`, `NAO QUERO`, `NAO QUERO RECEBER` ou `NAO TENHO INTERESSE`, o telefone entra na lista persistente de supressao, os leads correspondentes sao bloqueados e jobs ainda em fila sao cancelados.

## Variaveis de mensagem

Disponiveis: `{{nome}}`, `{{primeiro_nome}}`, `{{nome_atendente}}`, `{{classificacao}}`, `{{codigo_infracao}}`, `{{descricao_infracao}}`, `{{numero_processo}}` e `{{arquivo_origem}}`. Variaveis ausentes viram texto vazio. Variaveis desconhecidas bloqueiam a campanha.

O perfil `infraction_first_contact` possui abertura obrigatoria e protegida:

```text
Olá {{primeiro_nome}}, meu nome é {{nome_atendente}}. Identificamos através do Diário Oficial a multa {{descricao_infracao}}.
```

O nome do atendente e configurado na campanha. A continuacao pode variar por tipo de edital, mas nao substitui a abertura. Leads sem descricao da infracao nao entram na fila desse perfil.

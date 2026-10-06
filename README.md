# Bot WhatsApp do LexRadar

Fundacao do modulo complementar ao LexRadar 1.7.0. O projeto mantem o aplicativo final intacto e separa duas responsabilidades:

- **Agente local (`bridge`)**: le `lexradar-data.json` em modo somente leitura e envia ao bot apenas leads finalizados com telefone.
- **Servico do bot**: roda localmente para homologacao ou em VPS, gerencia instancias da Evolution API, campanhas, fila persistente, linha principal, contingencias e delays.

Por seguranca, leads entram como `pending_review`, o worker inicia desabilitado e nenhum disparo ocorre sem aprovacao explicita.

O painel operacional permite revisar leads, gerar a previa com a abertura obrigatoria, aprovar ou bloquear contatos, configurar a linha principal e contingencias e preparar campanhas em rascunho. A ativacao congela a mensagem revisada em cada job para que uma alteracao posterior no LexRadar nao modifique um envio ja aprovado.

## Gestao de linhas

- A primeira linha cadastrada nasce como `primary`; as seguintes entram como `standby`.
- O painel permite promover, pausar, reativar, conferir conexao e ajustar limite diario por linha.
- Campanhas usam uma linha principal fixa. O failover e `manual` por padrao e pode ser configurado como `automatic` por campanha.
- Um failover nunca recria jobs: a chave de idempotencia preserva uma mensagem por lead/campanha/telefone.
- Cada campanha pode limitar a execucao a dias e horarios definidos em `America/Sao_Paulo`.
- Respostas claras de descadastro, como `SAIR`, `PARE` e `NAO QUERO RECEBER`, bloqueiam o telefone e cancelam jobs ainda na fila.

## Inicio local

Requer Node.js 20 ou superior e nao depende de pacotes npm externos.

```powershell
Copy-Item .env.example .env
# edite os segredos e caminhos de .env
npm test
npm start
```

Abra `http://127.0.0.1:3100`. Para sincronizar uma vez:

```powershell
npm run bridge:check
.\deploy\run-lexradar-bridge.ps1 -VpsHost '<IP_DA_VPS>' -Once
```

A ponte de homologacao usa um tunel SSH local e nao publica a API da VPS. Para operacao continua e inicializacao no logon, consulte `docs/INTEGRATION.md`.

## Fluxo seguro de homologacao

1. Configure a Evolution API e mantenha `DISPATCH_ENABLED=false`.
2. Cadastre uma instancia e leia seu QR Code.
3. Rode a ponte e confira os leads importados.
4. Aprove somente contatos com base legal/autorizacao documentada.
5. Crie uma campanha em rascunho e valide a previa das variaveis.
6. Use exclusivamente numeros de teste na homologacao.
7. Ative o worker somente depois dos testes e da definicao dos limites operacionais.

## Contrato de integracao

O arquivo `docs/INTEGRATION.md` descreve campos, elegibilidade, idempotencia e operacao. O bot nunca grava no banco do LexRadar.

Consulte tambem `docs/LEXRADAR-AUDIT.md` para o mapa do sistema final e `docs/DECISIONS.md` para as decisoes que ainda precisam de homologacao.

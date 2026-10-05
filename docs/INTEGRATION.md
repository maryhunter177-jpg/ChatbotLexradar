# Integracao LexRadar 1.7.0 -> Bot

## Fronteira

O LexRadar permanece desktop/local. A ponte faz conexao de saida para a VPS e nunca altera `lexradar-data.json`. A leitura usa uma copia em memoria e valida a estrutura antes de extrair dados.

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

## Variaveis de mensagem

Disponiveis: `{{nome}}`, `{{primeiro_nome}}`, `{{nome_atendente}}`, `{{classificacao}}`, `{{codigo_infracao}}`, `{{descricao_infracao}}`, `{{numero_processo}}` e `{{arquivo_origem}}`. Variaveis ausentes viram texto vazio. Variaveis desconhecidas bloqueiam a campanha.

O perfil `infraction_first_contact` possui abertura obrigatoria e protegida:

```text
Olá {{primeiro_nome}}, meu nome é {{nome_atendente}}. Identificamos através do Diário Oficial a multa {{descricao_infracao}}.
```

O nome do atendente e configurado na campanha. A continuacao pode variar por tipo de edital, mas nao substitui a abertura. Leads sem descricao da infracao nao entram na fila desse perfil.

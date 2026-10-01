# Decisoes e pendencias para homologacao

## Decisoes ja aplicadas

- Projeto separado em `D:\BotLexradar`; nenhum arquivo do LexRadar 1.7.0 foi alterado.
- Ponte local somente de saida e leitura, com DTO minimo e sem CPF, placa ou AIT.
- Estado inicial sem disparos (`DISPATCH_ENABLED=false`).
- Todo lead exige aprovacao explicita e motivo registravel.
- Uma mensagem por lead/campanha, usando inicialmente o primeiro celular normalizado; nenhum envio para todos os telefones sem nova decisao do contratante.
- Job marcado `sending` antes da chamada externa. Interrupcao nesse ponto exige reconciliacao manual para impedir duplicidade.

## Decisoes necessarias antes de producao

1. VPS, dominio/TLS e versao exata homologada da Evolution API.
2. Gatilho de campanha: manual por lote, automatico por classificacao ou agenda.
3. Base legal/evidencia de autorizacao, texto de descadastro e lista de supressao.
4. Limites por chip/dia, janela de horario, delays minimo/maximo e feriados.
5. Regra para multiplos telefones do mesmo lead.
6. Templates oficiais e tratamento de respostas/transferencia humana.
7. Retencao de leads, mensagens, eventos e backups.
8. Estrategia de restauracao, monitoramento e responsavel por incidentes.

## Alerta de fornecedor

A Evolution API e uma integracao paralela sujeita a mudancas de contrato e risco de bloqueio. Rodizio e delay sao controles operacionais, nao mecanismos de garantia nem autorizacao para contornar regras da plataforma. A versao deve ser fixada somente depois do teste real de QR, envio e webhook na VPS escolhida.

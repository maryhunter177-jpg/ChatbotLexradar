# LexRadar Bot Connector para Windows

O conector e instalado separadamente e nao altera o executavel nem a base do LexRadar. Ele apenas le os registros concluidos que possuem telefone, envia o conjunto minimo de dados pela ponte segura e abre o painel local.

## Entrega segura

O ZIP gerado por Build-ClientPackage.ps1 inclui o runtime Node.js, launcher, diagnostico e desinstalador. Ele deliberadamente nao inclui tokens, chave SSH, configuracao do cliente ou acesso root.

Antes da instalacao, o operador deve provisionar:

1. Conta SSH Linux dedicada, sem privilegios administrativos e autorizada somente a encaminhar a porta local do bot.
2. Chave SSH exclusiva daquele computador.
3. Arquivo known_hosts obtido por canal confiavel.
4. Token administrativo de homologacao e token exclusivo de importacao.

Execute Instalar.cmd, informe os itens solicitados e depois use o atalho LexRadar Bot. Tokens ficam cifrados pelo DPAPI do usuario Windows; a pasta de segredos recebe ACL exclusiva. O navegador nunca recebe nem armazena o token.

## Fluxo

LexRadar somente leitura -> bridge local -> tunel SSH 127.0.0.1:3199 -> bot na VPS

Navegador -> proxy 127.0.0.1:3100 -> tunel 127.0.0.1:3199 -> painel na VPS

O proxy injeta o token administrativo apenas nas chamadas de API, aceita somente Host local e retorna no diagnostico somente estado operacional sem caminhos ou segredos.

## Suporte e remocao

- Diagnostico.cmd cria na Area de Trabalho um relatorio sem CPF, placa, telefone, tokens, chaves ou caminhos privados.
- Desinstalar.cmd remove somente a pasta do conector em LocalAppData, atalhos e tarefa agendada. O LexRadar e sua base permanecem intactos.
- Para preservar logs tecnicos, execute o desinstalador PowerShell com o parametro KeepDiagnostics.

## Geracao do ZIP

Use uma distribuicao oficial do Node.js 20 ou superior extraida, contendo node.exe e LICENSE:

    .\deploy\windows\Build-ClientPackage.ps1 -Version 1.0.0 -NodeRuntimeDir C:\runtime\node

Assine o ZIP e os scripts conforme o processo de release da empresa antes da entrega ao cliente.

# Arquitetura inicial

```text
LexRadar 1.7.0 (Windows/local, somente leitura)
        |
        | HTTPS de saida + token da ponte
        v
Servico Bot (VPS) -> fila persistente -> roteador principal/contingencia -> Evolution API -> WhatsApp
        ^                                      |
        | webhook autenticado                  | QR/status
        +--------------------------------------+
```

O armazenamento JSON atomico permite homologacao sem infraestrutura adicional. Antes de carga real/multiplas replicas, deve ser substituido por PostgreSQL e uma fila com lock distribuido, preservando as interfaces de dominio.

## Roteamento de linhas

Cada campanha possui uma linha principal e uma lista ordenada de contingencias. No modo `manual`, a fila aguarda se a principal ficar indisponivel. No modo `automatic`, apenas a primeira contingencia saudavel e dentro do limite diario assume os jobs ainda nao enviados. Jobs concluidos nao sao reenfileirados.

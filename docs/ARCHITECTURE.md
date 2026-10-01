# Arquitetura inicial

```text
LexRadar 1.7.0 (Windows/local, somente leitura)
        |
        | HTTPS de saida + token da ponte
        v
Servico Bot (VPS) -> fila persistente -> seletor multi-chip -> Evolution API -> WhatsApp
        ^                                      |
        | webhook autenticado                  | QR/status
        +--------------------------------------+
```

O armazenamento JSON atomico permite homologacao sem infraestrutura adicional. Antes de carga real/multiplas replicas, deve ser substituido por PostgreSQL e uma fila com lock distribuido, preservando as interfaces de dominio.


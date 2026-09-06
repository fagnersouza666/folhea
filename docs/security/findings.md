# Findings de segurança em aberto

Este arquivo registra dependências operacionais que não podem ser confundidas
com uma permissão para remover as proteções do código.

## SEC-001 — armazenamento compartilhado para sessão e rate limit

- **Severidade:** P1 operacional
- **Estado:** aberto para a infraestrutura de produção
- **Impacto:** o fallback atual mantém o `TokenStateManager`, os tokens CSRF e
  os contadores de rate limit na memória do processo. Em mais de uma instância,
  uma requisição pode atingir outra instância e escapar de uma janela local ou
  perder uma sessão após reinício.
- **Mitigação entregue:** tokens OIDC permanecem atrás de uma referência opaca
  no servidor; tickets CSRF são aleatórios, vinculados ao cookie `__Host-` e
  expiram; todos os nós aplicam limites locais, e nenhum limite foi removido.
- **Remediação requerida antes de produção:** provisionar Redis ou outro
  armazenamento compartilhado com TTL, autenticação, TLS e política de acesso
  mínimo; adaptar `ServerTokenStateManager`, `CsrfTokenService` e `RateLimiter`
  para o backend compartilhado e testar failover.
- **Responsável:** plataforma

O fallback fail-closed para ausência de token/CSRF e continua adequado para
desenvolvimento, testes e uma única instância controlada. Ele não é aceite
como substituto de proteção distribuída na publicação final.

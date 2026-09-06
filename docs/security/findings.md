# Findings de segurança

Este arquivo registra dependências operacionais remediadas e ressalvas
vigentes. A auditoria completa de 06/09/2026 está em
[docs/relatorio-seguranca.md](../relatorio-seguranca.md) (veredicto
**APROVADO COM RESSALVAS**).

## SEC-K001 — Keycloak e CVE-2026-18963

- **Severidade:** P0 (bloqueava deploy)
- **Estado:** **fechado** (06/09/2026)
- **Remediação:** Keycloak `26.7.3` com digest pinado; realm prod/dev
  separados; cliente confidencial; overlay prod com `start --optimized` e
  `KC_HOSTNAME_STRICT=true`; guard `validate-production-compose.sh`.

## SEC-001 — armazenamento compartilhado para sessão e rate limit

- **Severidade:** P1 operacional
- **Estado:** **fechado** (06/09/2026)
- **Remediação:** Redis 7 na rede privada do Compose (`--requirepass`,
  sem porta pública). `ServerTokenStateManager`, `CsrfTokenService` e
  `RateLimiter` usam stores Redis em `%prod`; testes unitários mantêm
  fallback in-memory.

## Ressalva em aberto — TLS Redis fora do Compose

- **Severidade:** operacional (não bloqueia o stack Docker atual)
- **Estado:** documentado
- **Ação:** ao publicar Redis em rede compartilhada ou multi-host, exigir
  TLS (`rediss://`) e rotação de senha. Ver `docs/operations.md`.

## Demais findings (SEC-004–SEC-013)

Todos mitigados neste ciclo. Detalhes por finding permanecem no relatório
como registro histórico e evidência de correção.

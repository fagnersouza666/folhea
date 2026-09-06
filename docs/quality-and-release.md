# Qualidade, analytics e release

Este documento é o contrato operacional das seções 88–100 do PRD-01.

## E2E determinístico

`frontend/e2e/critical.spec.ts` cobre landing, login, cadastro de livro,
registro de leitura, estatísticas, criação de card e os contratos de edição e
exclusão de sessão, finalização/reabertura de livro e compartilhamento/download
de card. `frontend/e2e/fixtures.ts` intercepta `/api/v1/**` com estado em
memória determinístico; portanto o gate não depende de PostgreSQL, OIDC ou de
um serviço externo.

Execute localmente com:

```text
cd frontend
npm ci
npx playwright install --with-deps chromium
npm run e2e:critical
```

O relatório HTML, screenshots, vídeos, traces e JUnit ficam em
`frontend/playwright-report/` e `frontend/test-results/`.

## Contrato e cobertura

`scripts/ci/validate-api-contract.mjs` verifica que os métodos do client
Angular têm as mesmas operações dos resources Quarkus. Quando
`OPENAPI_FILE` ou `OPENAPI_URL` é fornecido, os mesmos paths também são
validados contra o documento OpenAPI. O CI executa essa validação junto com o
lint e publica o relatório.

Vitest cobre regras e serviços do frontend; `npm run test:coverage` gera a
cobertura V8. O Maven executa JUnit 5, Quarkus Test e RestAssured quando os
testes de integração do backend estiverem disponíveis.

## Analytics privado por desenho

Os eventos permitidos são:

```text
account_created, book_created, reading_session_created,
reading_session_updated, reading_session_deleted, book_finished,
book_reopened, stats_viewed, card_created, card_shared,
card_downloaded, pwa_installed
```

O `AnalyticsService` aceita somente dimensões anônimas (`screen`, `source`,
`method`, `days`, `pages`, `minutes` e contagens). Título, autor, foto,
conteúdo privado, e-mail, token e IDs são descartados antes do envio. Eventos
são enviados via `HttpClient` com `withCredentials` para que o interceptor
CSRF anexe `X-CSRF-Token` nas mutações autenticadas. Falhas de telemetria
nunca interrompem o fluxo do usuário.

## Métricas de produto e release

- Ativação: primeiro `reading_session_created` por conta.
- Ativação forte: sessões em três dias distintos nos primeiros sete dias.
- Retenção: percentual que registra na semana seguinte.
- Frequência: sessões / usuários ativos.
- Uso do card: cards gerados / usuários ativos.
- Compartilhamento: cards compartilhados / cards gerados.
- North Star: dias com leitura registrada por usuário ativo.

O workflow `CD` executa lint, testes, build de produção, SSG, build do
backend e imagem Docker. Depois do build, dispara o hook de deploy configurado
em `PRODUCTION_DEPLOY_HOOK` e valida liveness/readiness em
`PRODUCTION_HEALTH_URL`. Sem esses segredos/variáveis o workflow mantém os
artefatos e informa a configuração ausente, sem fingir que houve deploy.

Critérios de release: `CI / merge-gate` verde, contrato OpenAPI alinhado,
Playwright crítico verde, imagem reproduzível, health checks `UP`, nenhuma
credencial em logs/artefatos e aprovação da revisão das métricas e eventos.

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
validados contra o documento OpenAPI. Em produção o spec não é público
(`%prod.quarkus.smallrye-openapi.enable=false` e bloqueio na borda); use
`OPENAPI_FILE` de um build dev/test quando quiser cruzar o contrato com o
documento. O CI executa essa validação junto com o
lint e publica o relatório. `contract-report.txt` e `seo-report/` não entram
no git; são artefatos do validador local e da CI.

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

## Versão do produto

A versão do Folhea é um único SemVer `X.Y.Z` compartilhado por
`frontend/package.json` (e o lockfile), `backend/pom.xml` e
`quarkus.smallrye-openapi.info-version`. O incremento acontece no mesmo
commit da mudança de produto, com `./scripts/versao.sh`. Correção usa
`corrigir` (patch), feature usa `funcionalidade` (minor) e major (`grande`)
só com pedido explícito. Docs, chore, teste ou infra sem mudança de
produto não incrementam. A regra está em
[`.cursor/rules/versionamento.mdc`](../.cursor/rules/versionamento.mdc).

## Métricas de produto e release

- Ativação: primeiro `reading_session_created` por conta.
- Ativação forte: sessões em três dias distintos nos primeiros sete dias.
- Retenção: percentual que registra na semana seguinte.
- Frequência: sessões / usuários ativos.
- Uso do card: cards gerados / usuários ativos.
- Compartilhamento: cards compartilhados / cards gerados.
- North Star: dias com leitura registrada por usuário ativo.

O workflow `CD` executa lint, testes, build de produção, SSG, build do
backend e três imagens Docker (backend, Caddy com SSG e Keycloak otimizado). Depois do build, dispara o hook de deploy configurado
em `PRODUCTION_DEPLOY_HOOK` e valida liveness/readiness em
`PRODUCTION_HEALTH_URL`. Sem esses segredos/variáveis o workflow mantém os
artefatos e informa a configuração ausente, sem fingir que houve deploy.

Critérios de release: `CI / merge-gate` verde, contrato OpenAPI alinhado,
Playwright crítico verde, imagem reproduzível, health checks `UP`, nenhuma
credencial em logs/artefatos, aprovação da revisão das métricas e eventos, e
nenhum finding P0 aberto em [`docs/relatorio-seguranca.md`](relatorio-seguranca.md)
(hoje: Keycloak ≥ 26.7.2 ou reset de senha desligado).

## Entrega do CD e configuração externa

O CD salva as três imagens em `folhea-images.tar.gz` dentro de
`release-evidence`. O hook recebe JSON com `revision`, `runId` e o nome desse
artefato; o serviço de deploy deve baixar o artefato do run autenticado,
carregar as imagens e iniciar o Compose correspondente. Não existe registry
ou deploy externo implícito. Sem hook, o pipeline registra somente o build.
Um hook configurado exige `PRODUCTION_HEALTH_URL`; a URL deve ser acessível
pelo runner por uma via operacional protegida para `/q/health/*`, que não é
publicada na borda do produto. O CI exige todos os componentes v1, valida
realm/backup/restore e constrói o target otimizado de Keycloak.

## Aceite com stack real

Depois de `./scripts/local-stack.sh up`, execute:

```bash
E2E_REAL_URL=https://localhost:9443 node scripts/ci/e2e-real.mjs
```

Valide também os proxies reais e as superfícies privadas, confiando a CA local
somente nesse processo de teste:

```bash
NODE_EXTRA_CA_CERTS="$PWD/.local/caddy-root.crt" EDGE_BASE_URL=https://localhost:9443 node scripts/ci/validate-oidc-surface.mjs
```

O gate exige `/me` anônimo401, desafio OIDC302 com PKCE/nonce/state e404 para
Admin, token/JWKS públicos e métricas privadas. Assim um fallback estático não
pode mascarar falhas de roteamento como páginas404.
Exige também404 em URL inexistente e `/q`, e shell CSR com `no-store`/`noindex`
em `/app`, `/entrar` e `/cadastro`. O `e2e-real.mjs` completa a cobertura de
precedência com POST de cadastro controlado201 e primeiro login BFF real.

O teste usa Playwright instalado em `frontend/`, duas contas novas criadas pelo
cadastro público, PostgreSQL persistente e Keycloak real. Não intercepta APIs
nem desativa limites de produção; respeita `Retry-After` quando o roteiro
atinge o limite de mutações por IP.
Verifica cadastro pela UI e pela API, login no browser, cookies Secure/HttpOnly/SameSite, CSRF negativo e
positivo, 404 entre contas, CRUD de leitura e recálculo de métricas, finalização
idempotente/reabertura, períodos e paginação, PNG 1080x1920 com quatro métricas,
foto/crop sem upload, fallback de compartilhamento, cache/offline real do SW,
exportação, exclusão e logout.
O coletor de eventos também é exercitado com payload permitido202 e propriedade
privada rejeitada400. As fórmulas de métricasPRD99–100 são verificadas pelo
gate SQL isolado `scripts/ops/tests/test-product-metrics.sh`.
Senhas/tokens/cookies não entram na evidência. Por padrão ficam em memória;
Em caso de falha, screenshots com inputs mascarados ficam em
`frontend/test-results/real-failure-*.png`; o diagnóstico imprime somente o
path, omitindo parâmetros OIDC. Não anexe traces ou credenciais aos relatórios.
`E2E_REAL_CREDENTIAL_FILE` permite conservar a primeira conta em arquivo local
0600 para o teste opt-in de UI e de restart. Use um caminho gitignored em
`.local/`, nunca anexe esse arquivo aos relatórios.
As contas usam e-mails de teste únicos; a segunda é excluída no final e a
primeira mantém um livro e duas leituras para verificar persistência local.
Execute somente numa stack de aceite/local. Instale o Chromium antes com
`cd frontend && npx playwright install chromium`.

Os builds Docker limitam Maven a 1 GiB/4 CPUs e Angular a dois workers/1,5 GiB
para reduzir concorrência e swap na integração local. Execute os builds e
gates pesados em sequência quando outras sessões compartilharem o host.

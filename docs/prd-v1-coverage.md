# Auditoria de cobertura do PRD-01 e release readiness

**Data da auditoria:** 2026-09-06

**Baseline auditado:** `origin/main` em `4df79cc` (`fix: align security, CI and frontend gates (#8)`)

**Escopo:** PRD-01-Folhea-v1, seções 1–110, e os critérios CA01–CA20, CP01–CP07 e CS01–CS13.
**Método:** inspeção somente leitura do código/configuração/documentação, execução de gates locais não destrutivos e consulta dos escopos `fo-9qv.5` a `fo-9qv.9`. Branches de outros agentes não foram tratados como entregues.

## Veredito executivo

**Release: BLOQUEADA no baseline.** Existem fundações úteis e alguns critérios já implementados, mas não há evidência de um fluxo de produção completo. Os bloqueadores principais são autenticação real/BFF, infraestrutura de produção, card, proteção do cache privado, 404 HTTP, e2e/integração e operação de release.

Legenda:

- **PASS** — implementação e evidência suficiente no baseline para o item;
- **PARTIAL** — há implementação, mas falta uma parte do requisito, integração ou teste;
- **GAP** — ausente ou em desacordo com o PRD;
- **UNVERIFIED** — depende de ambiente/artefato que não está disponível nesta auditoria.

Um `PASS` de código não substitui a aprovação dos gates e a validação do ambiente de produção. Findings P0/P1 do modelo de ameaças continuam bloqueando a release até correção ou aceite formal.

## Escopos em andamento

| Bead | Escopo atribuído | Situação em `origin/main` | Critérios/seções relacionados |
| --- | --- | --- | --- |
| `fo-9qv.5` | Backend, domínio, autenticação e testes | Não incorporado; bead `IN_PROGRESS` | CA01–CA13, CA20; §§48–76, 90–91 |
| `fo-9qv.6` | App privado, CRUD, cards, PWA e UX | Não incorporado; bead `IN_PROGRESS` | CA03–CA19; CP01–CP07; §§7–9, 22–47, 82–87 |
| `fo-9qv.7` | Docker, Caddy, Keycloak e operação | Não incorporado; bead `IN_PROGRESS` | §§68–81, 93–97 |
| `fo-9qv.8` | Playwright, contratos, CI/CD e analytics | Não incorporado; bead `IN_PROGRESS` | §§88–100; evidência de CA/CP |
| `fo-9qv.9` | Superfície pública, legais e SEO | Não incorporado; bead `IN_PROGRESS` | CA01–CA03, CA16–CA18; CS01–CS03, CS10–CS13 |

Esses escopos devem ser reavaliados sobre um baseline comum depois do merge. O status abaixo descreve o que já está em `origin/main`, não a intenção das branches paralelas.

## Evidência executada

| Verificação | Resultado no ambiente da auditoria |
| --- | --- |
| `git rev-parse origin/main` | `4df79cc` |
| `npm ci` em `frontend/` | PASS; 879 pacotes instalados, 10 vulnerabilidades reportadas (7 moderate, 3 high) |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test -- --run` | PASS; 1 arquivo, 3 testes |
| `npm run build -- --configuration production` | NÃO EXECUTADO COM SUCESSO: Node local `22.22.1`; Angular exige `22.22.3+` |
| `npm run build:ssg -- --configuration production` | Mesmo bloqueio de versão do Node; não houve artefato SSG para validar |
| `node ../scripts/ci/validate-seo.mjs dist seo-report/seo-validation.txt` | GAP de evidência: `dist` não existe porque o build SSG não completou |
| `./mvnw -B clean verify` em `backend/` | PASS; build Quarkus e 3 testes JUnit |
| `docker compose config` | PASS sintático, mas mostra somente o serviço PostgreSQL |
| `node --check scripts/ci/validate-seo.mjs` | PASS |

Os comandos acima não iniciaram serviços, não publicaram artefatos e não alteraram dados de negócio.

## Cobertura por seção do PRD

| Seções | Implementação/evidência observada | Status |
| --- | --- | --- |
| 1–6 | Landing explica o produto e o hábito; hipóteses, ativação e retenção ainda não têm instrumentação/evidência. | PARTIAL |
| 7 | Angular 22, Router, Signals, HttpClient, Reactive Forms e dependência PWA presentes em `frontend/package.json`. | PARTIAL |
| 8 | `server.routes.ts` separa `/app/**` como CSR e o restante como prerender; não há artefato SSG validado. | PARTIAL |
| 9 | Node é usado em build/teste; não existe imagem de produção para provar ausência de Node no runtime. | PARTIAL |
| 10–11 | SEO é requisito documentado e há páginas públicas básicas, mas conteúdo legal é placeholder e não há evidência de Lighthouse. | PARTIAL |
| 12 | `lang`, headings, title/description/canonical e HTML semântico existem em parte; metadados não são completos em todas as páginas. | PARTIAL |
| 13–15 | `SeoService`, `robots.txt` e canonical dinâmica existem; a borda/Caddy e o 404 efetivo ainda falham. | PARTIAL |
| 16–18 | Não há JSON-LD nem `og:image`; URLs públicas são legíveis e sitemap estático existe. | PARTIAL |
| 19–21 | Há budgets de bundle, CSS responsivo e foco visível; não há medição de Core Web Vitals nem teste WCAG AA. | PARTIAL |
| 22–23 | Home pública e CTA existem; autenticação e primeiro uso real não estão conectados ao IdP. | PARTIAL |
| 24–25 | Home privada, shell e navegação mobile existem; dados exibidos podem cair em dados demo e não há settings. | PARTIAL |
| 26–27 | Formulário de sessão e feedback existem; envio é otimista, sem estado de erro adequado e sem backend confirmado no frontend. | PARTIAL |
| 28–29 | Entidade, endpoints e operações de livro estão no backend; UI só lista/cria e não edita/finaliza/reabre/exclui. | PARTIAL |
| 30–32 | `LocalDate`, CRUD de sessão e regra de entrada existem no backend; faltam testes REST e UI de edição/exclusão. | PARTIAL |
| 33–37 | Streak e agregações existem; período nomeado, testes de timezone e tela de filtros completos não existem. | PARTIAL |
| 38–42 | Não há Canvas, templates, foto local, PNG, Web Share ou fallback de card. | GAP |
| 43–44 | Manifesto e service worker estão configurados; não há fluxo offline/aviso de indisponibilidade. | PARTIAL |
| 45 | `ngsw-config.json` configura cache de `/api/v1/**`, inclusive respostas privadas. Isso contradiz expressamente o PRD. | GAP / P0 |
| 46–47 | Não há `SwUpdate`/CTA de atualização nem matriz/teste de navegadores. | GAP |
| 48–49 | Quarkus REST, Panache, Flyway, OIDC, OpenAPI e Health estão no POM; observabilidade não está configurada. | PARTIAL |
| 50–51 | Monólito modular com pacotes por domínio existe; organização ainda é rasa e falta módulo analytics. | PARTIAL |
| 52–54 | PostgreSQL/Flyway/UUID/índices e `database.generation=validate` existem; defaults inseguros permanecem. | PARTIAL |
| 55–59 | User/Book/ReadingSession, DATE e TIMESTAMPTZ aparecem no schema/entidades; não há cobertura de persistência/integridade real no CI local. | PARTIAL |
| 60–67 | REST `/api/v1`, OpenAPI, `/me`, books, sessions, stats e dashboard existem; contrato publicado não é testado e filtros do produto são incompletos. | PARTIAL |
| 68–71 | Dependência OIDC e `@Authenticated` existem, mas frontend usa login demo e não há fluxo BFF/cookie/Keycloak. | GAP |
| 72–76 | Headers estão no Caddy e secrets usam variáveis, mas CSRF, rate limit, body limit e defaults seguros não estão implementados. | GAP / P0–P1 |
| 77–81 | Compose só possui PostgreSQL; faltam Keycloak, backend, Caddy runtime, Dockerfile, redes privadas e runbook. | GAP / P0 |
| 82–86 | Monorepo e tokens/canonical mobile-first existem; páginas/settings compartilhados e UX completa não existem. | PARTIAL |
| 87 | Há dois arquivos de teste frontend, mas não cobertura de services/signals/componentes críticos. | PARTIAL |
| 88–91 | Há 3 testes unitários de streak e 3 de validator; não há Playwright nem RestAssured/Dev Services/integridade de timezone. | GAP |
| 92 | CI declara lint/build/SSG/Vitest/backend/SEO/Playwright/Docker; Playwright e Docker ficam skipped quando os componentes estão ausentes. | PARTIAL |
| 93 | Não há workflow CD, imagem/deploy/health check pós-merge. | GAP |
| 94–97 | Health dependency existe no POM, mas não há stack operacional, logs JSON, backup externo/restore testado ou observabilidade configurada. | GAP |
| 98–100 | Workflow de qualidade e security scan existem; analytics de produto, métricas e North Star não têm implementação/telemetria. | GAP |
| 101–103 | Matriz detalhada abaixo; vários critérios têm somente código parcial e nenhum teste de aceitação. | PARTIAL |
| 104 | Não foram encontrados Flutter, apps nativos, microserviços, Kubernetes, GraphQL ou processamento de card no backend. | PASS |
| 105 | Evoluções futuras permanecem fora da implementação auditada. | PASS |
| 106 | A interface dá mais destaque ao registro que ao CRUD, mas o registro ainda é demo/otimista. | PARTIAL |
| 107 | A forma do monorepo segue Angular + Quarkus + PostgreSQL; falta o provedor/edge operável. | PARTIAL |
| 108 | Versões principais declaradas no POM/package; Playwright e CD não estão entregues. | PARTIAL |
| 109–110 | A separação pública/privada está modelada nas rotas, mas não é segura/operável como arquitetura final. | PARTIAL |

## Matriz de critérios funcionais (CA)

| ID | Implementação no baseline | Teste/evidência | Status | Próximo escopo |
| --- | --- | --- | --- | --- |
| CA01 | Tela de login chama `AuthService.signIn`, que cria `demo-user`; não há OIDC/BFF. | `login.component.ts`; `auth.service.ts`; sem teste de autenticação. | GAP | `.5`, `.6`, `.7` |
| CA02 | `POST /api/v1/books` e formulário de novo livro existem. | `BookResource.java:42–55`; UI não confirma backend real. | PARTIAL | `.5`, `.6` |
| CA03 | Formulário/API aceitam páginas, minutos ou ambos. | validator Vitest (3 testes); ausência de teste REST. | PARTIAL | `.5`, `.6` |
| CA04 | Validator, validação no resource e constraint SQL rejeitam progresso vazio/negativo. | `reading-session.validator.spec.ts`; migration V001; sem integração. | PASS* | `.5`, `.8` |
| CA05 | `PATCH /sessions/{id}` existe; não há UI de edição. | `ReadingSessionResource.java:63–74`; sem teste REST. | PARTIAL | `.5`, `.6`, `.8` |
| CA06 | `DELETE /sessions/{id}` existe; não há UI de exclusão. | `ReadingSessionResource.java:76–77`; sem teste REST. | PARTIAL | `.5`, `.6`, `.8` |
| CA07 | Serviço soma sessões do período; store atualiza somente um dashboard de forma otimista. | `StatisticsService.java:20–27`; nenhuma prova após edição/exclusão. | PARTIAL | `.5`, `.6`, `.8` |
| CA08 | `POST /books/{id}/finish` altera status/data. | `BookResource.java:75–88`; sem teste nem UI. | PARTIAL | `.5`, `.6`, `.8` |
| CA09 | `DELETE /books/{id}/finish` reabre o livro. | `BookResource.java:90–96`; sem teste nem UI. | PARTIAL | `.5`, `.6`, `.8` |
| CA10 | Repetição de finish preserva a data final quando já finalizado. | Código em `BookResource.java:80–86`; idempotência não testada. | PARTIAL | `.5`, `.8` |
| CA11 | Calculadora cobre hoje/ontem, gap e duplicidade; timezone/edição/exclusão não têm cobertura. | `StreakCalculatorTest.java` tem 3 testes. | PARTIAL | `.5`, `.8` |
| CA12 | `StatisticsService` calcula streak com todas as sessões, fora do período filtrado. | `StatisticsService.java:39–40`; sem teste de filtro. | PASS* | `.5`, `.8` |
| CA13 | API aceita `from/to` e default de 7 dias; não há controles Hoje/7/30/Tudo completos. | `StatisticsResource.java:24–30`; UI usa apenas dados do dashboard. | PARTIAL | `.5`, `.6`, `.8` |
| CA14 | Nenhum gerador de card 1080×1920 existe. | Não há Canvas/card feature no inventário. | GAP | `.6`, `.8` |
| CA15 | Tela não apresenta card com as quatro métricas. | Botão de progresso só alterna texto `Card criado ✓`. | GAP | `.6`, `.8` |
| CA16 | Não há seleção/crop/reposicionamento de foto. | Nenhum input de imagem ou Canvas. | GAP | `.6` |
| CA17 | Não há upload de foto, mas também não há funcionalidade para validar o requisito. | Ausência de implementação não é evidência de atendimento. | GAP | `.6`, `.8` |
| CA18 | Não há Blob/PNG/download. | Nenhuma chamada `toBlob`, download ou arquivo gerado. | GAP | `.6` |
| CA19 | Não há Web Share nem fallback de compartilhamento. | Nenhuma chamada `navigator.share`. | GAP | `.6`, `.8` |
| CA20 | Repositórios filtram por `userId` e migration reforça vínculo book/session. | Código de ownership; nenhum teste com dois usuários e auth real. | PARTIAL | `.5`, `.8` |

\* `PASS*` significa regra demonstrada por código/unitário/constraint, mas ainda sem a prova de integração exigida para release.

## Matriz de critérios PWA (CP)

| ID | Implementação/evidência | Status | Ação requerida |
| --- | --- | --- | --- |
| CP01 | Aplicação web tem configuração de build/serve padrão e não depende de instalação no design; o build não foi validado neste Node. | PARTIAL | Confirmar após build E2E. |
| CP02 | `manifest.webmanifest` tem name, start_url, display, cores e um ícone SVG; compatibilidade de instalação não foi validada. | PARTIAL | Validar manifesto no browser e fornecer ícones raster se necessário. |
| CP03 | `provideServiceWorker` e configuração de produção existem. | PARTIAL | Testar instalação em browsers alvo. |
| CP04 | Manifesto declara `display: standalone`. | PARTIAL | Confirmar instalação/abertura real. |
| CP05 | Asset groups prefetch/lazy cacheiam shell/assets. | GAP / P0 | Remover data group de `/api/v1/**`; respostas privadas nunca podem ser cacheadas. |
| CP06 | `ApiClient` propaga erros, mas `DashboardStore` troca erro por dados demo e o formulário navega mesmo com falha. | GAP | Exibir estado offline/erro sem mascarar falha. |
| CP07 | Service worker registra, mas não há `SwUpdate` nem CTA “Atualizar”. | GAP | Implementar aviso, atualização e teste. |

## Matriz de critérios SEO (CS)

| ID | Implementação/evidência | Status | Ação requerida |
| --- | --- | --- | --- |
| CS01 | `server.routes.ts` marca rotas públicas como `Prerender`; `build:ssg` é alias de `ng build`. | PARTIAL | Gerar e validar artefato SSG em Node compatível. |
| CS02 | Landing e páginas públicas têm texto/h1 no template; legais dizem que serão atualizadas antes do lançamento. | PARTIAL | Substituir placeholders e confirmar HTML inicial. |
| CS03 | Routes, `SeoService` e páginas fornecem títulos/descriptions distintos. | PARTIAL | Validar todas as páginas geradas; login é privado. |
| CS04 | `SeoService` cria/atualiza canonical por caminho. | PARTIAL | Confirmar canonical no SSG e evitar canonical em 404. |
| CS05 | `frontend/public/sitemap.xml` lista seis URLs públicas e não lista `/app`. | PASS* | Confirmar cópia no artefato gerado. |
| CS06 | `frontend/public/robots.txt` permite `/`, bloqueia `/app/` e aponta sitemap. | PASS* | Confirmar entrega HTTP. |
| CS07 | App shell/login chamam `SeoService.update(..., false)` e `/app/**` é CSR. | PARTIAL | Testar cada rota privada e headers; robots não pode ser a única defesa. |
| CS08 | Rotas públicas são `/`, `/como-funciona`, `/recursos`, `/sobre`, `/privacidade`, `/termos`. | PASS* | Manter URLs estáveis. |
| CS09 | Há `og:title`, `og:description`, `og:url` básicos; falta `og:image` e dimensão apropriada. | GAP | Adicionar imagem social e validar previews. |
| CS10 | Existe `public/404.html`, mas `server.ts` e Caddy usam catch-all/fallback para `index.html`. | GAP | Servir 404 com status HTTP 404 no runtime. |
| CS11 | Não há redirect permanente configurado; validator aceita variáveis de redirect, mas não há evidência de status 301/308. | UNVERIFIED | Definir/testar redirects quando houver rota migrada. |
| CS12 | Wildcard Angular redireciona para `/`; Caddy faz `try_files ... /index.html`, caracterizando soft 404. | GAP | Remover redirect/fallback de inexistente e preservar 404. |
| CS13 | Há budgets Angular e CSS responsivo; não há Lighthouse, RUM ou medição LCP/INP/CLS. | PARTIAL | Adicionar medição e evidência no gate/release. |

## Checklist de release

### Produto e segurança

- [ ] CA01–CA20 revalidados end-to-end com dois usuários e sem dados demo.
- [ ] OIDC Authorization Code + PKCE via BFF, sessão `HttpOnly/Secure/SameSite`, logout e mapeamento `sub → User` verificados.
- [ ] CSRF, `Origin`, content-type e limites de body cobertos para toda mutação.
- [ ] Cache de `/api/*` removido do service worker; respostas privadas têm `Cache-Control: no-store`.
- [ ] Nenhum finding P0/P1 aberto sem aceite formal; resolver as 3 vulnerabilidades high reportadas por `npm ci`/`npm audit`.

### Experiência e PWA

- [ ] CRUD de livros/sessões, finish/reopen, períodos Hoje/7/30/Tudo e recalculo após edição/exclusão validados.
- [ ] Card Canvas 1080×1920 com Minimal/Foto/Dark, crop/overlay, PNG/download e Web Share/fallback validados.
- [ ] CP01–CP07 validados em Chrome, Edge, Firefox, Safari e Samsung Internet modernos.
- [ ] Offline exibe erro acionável sem fingir sucesso; atualização do service worker exibe CTA.

### SEO e web pública

- [ ] Build SSG gera páginas públicas e o validator passa com relatório arquivado.
- [ ] Legal pages deixam de ser placeholders; cada página tem title, description, canonical, h1, OG completo e conteúdo indexável.
- [ ] `sitemap.xml` contém somente URLs públicas; `robots.txt` e `/app/**` noindex são confirmados por HTTP.
- [ ] Rota inexistente responde 404 real; não existe redirect/fallback soft 404; redirects migratórios são 301/308.
- [ ] Lighthouse/Core Web Vitals e acessibilidade AA têm evidência revisável.

### Operação e gates

- [ ] Compose de produção inclui redes privadas, PostgreSQL, Keycloak, Quarkus e Caddy; DB/admin não ficam expostos indiscriminadamente.
- [ ] Docker multi-stage não mantém Node no runtime; health check exige backend e PostgreSQL saudáveis.
- [ ] CD executa build → testes → SSG → imagem → deploy → health check.
- [ ] Logs JSON não contêm tokens, cookies, payloads, e-mail, título, autor ou foto; observabilidade mínima está ativa.
- [ ] Backup diário fora do host, retenção mínima de 7 dias e restore periódico testado/documentado.
- [ ] CI passa com frontend, backend, SSG/SEO, Playwright crítico, Docker e security scans disponíveis; `CI / merge-gate` verde.
- [ ] Analytics registra os eventos do PRD sem título/autor/foto/dados privados; ativação, retenção, frequência, cards e North Star têm definição e painel.

## Riscos e lacunas que exigem outros beads

| ID | Risco | Severidade | Encaminhamento |
| --- | --- | --- | --- |
| R-01 | Cache de `/api/v1/**` pode persistir resposta privada no service worker. | P0 | `fo-9qv.6`; corrigir antes de qualquer release. |
| R-02 | Login é demo-only; não existe BFF/Keycloak/cookie/CSRF. | P0 | `fo-9qv.5` + `fo-9qv.7`; atualizar threat model/testes. |
| R-03 | Fallback de Caddy/SSR e wildcard Angular produzem soft 404. | P1 | `fo-9qv.7` + `fo-9qv.9`; validar por HTTP. |
| R-04 | Compose não entrega backend, Keycloak, Caddy runtime, redes privadas ou backup. | P0 | `fo-9qv.7`. |
| R-05 | Card, compartilhamento e atualização PWA ausentes. | P1 | `fo-9qv.6` + `fo-9qv.8`. |
| R-06 | Não há testes REST/E2E/contrato/analytics/CD; frontend build depende de Node compatível e `npm audit` reporta 3 high. | P1 | `fo-9qv.8`; ajustar matriz de dependências e gates. |
| R-07 | Legal/SEO e Core Web Vitals não têm evidência de release. | P1 | `fo-9qv.9` + `fo-9qv.8`. |

**Conclusão:** a branch de auditoria está pronta para revisão documental, mas o produto não está pronto para release até que os beads acima sejam incorporados e o checklist seja reexecutado sobre o merge resultante.

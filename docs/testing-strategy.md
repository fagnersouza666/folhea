# Estratégia de testes e gate de merge

Este documento define a estratégia mínima do Folhea v1. O workflow
`.github/workflows/ci.yml` é a implementação automatizada e o contrato de
scripts abaixo deve ser mantido quando frontend e backend forem evoluídos.

## Pirâmide de testes

| Camada | Ferramenta | Escopo mínimo | Execução |
| --- | --- | --- | --- |
| Unitário | Vitest | services, Signals, forms, regras de apresentação e componentes críticos | `npm run test -- --run` |
| Smoke/contrato | JUnit 5, Quarkus Test, RestAssured | inicialização da API, autenticação, endpoints e schema OpenAPI | `./mvnw -B clean verify` |
| Integração | Dev Services/Testcontainers | PostgreSQL, Redis (store de sessão) e dependências reais, migrações e isolamento | `./mvnw -B clean verify` |
| E2E | Playwright | landing, login, livro, sessão, edição/exclusão, finalização, stats e isolamento | `npm run e2e:critical` |
| SEO | Node + artefato SSG | title, description, canonical, robots, sitemap, noindex, 404 e redirects | `node ../scripts/ci/validate-seo.mjs dist seo-report/seo-validation.txt` |

### Regras do streak

Os testes de domínio devem cobrir explicitamente:

- leitura hoje, ontem e hoje + ontem;
- sequência contínua e quebra de sequência;
- múltiplas sessões no mesmo dia;
- mudança de timezone;
- edição e exclusão de uma sessão.

Casos de data devem usar um relógio injetável e timezone explícito. Assim, o
resultado não depende do fuso horário ou do horário do runner do CI.

`RedisSecurityStoreTest` cobre CSRF, token state e rate limit contra Redis
real. O perfil `%test` não define `quarkus.redis.hosts`: um valor explícito
`redis://127.0.0.1:6379` desliga o Dev Services e o teste passaria contra um
`redis-server` da máquina, falhando no CI. O container é `redis:7-alpine`,
alinhado ao Compose.

`BackendResourceTest` cobre 401 anônimo, 415 de content-type, e os rejeites
autenticados do `SecurityBoundaryFilter`: 403 para host, origem CSRF e CSRF
inválido, e 413 para corpo acima de `folhea.security.max-json-body-bytes`.
O `abort()` registra `status` e o problema (`invalid-host`, `csrf-origin`,
`csrf-invalid`, `body-too-large`) sem o token. No `%test` o limite de corpo é
1024 bytes para o 413 chegar no filtro, não na camada HTTP de 64K.

`dashboard.store.spec.ts` cobre os três casos de carga (selectableBooks,
retry após load 500 e stats `all`) e o rollback otimista de `addBook`,
`finishBook`, `deleteBook` e `addSession`: cada mutação aplica o estado
otimista, o HTTP devolve 500 e o spec exige `books`/`sessions` no estado
anterior com `error` visível (`setMutationError`). O store não ganha API
de teste.

Os cenários E2E usam Playwright com fixtures em memória. A fixture intercepta a
API em `/api/v1/**` e mantém livros e sessões em estado isolado por teste; não
há dependência de serviços externos para validar a jornada crítica. O relatório
Playwright inclui HTML, JUnit, trace e evidências de falha.

## Contratos do CI

Cada comando abaixo deve retornar código diferente de zero em caso de falha:

```text
frontend: npm ci && npm run lint
frontend: npm run build -- --configuration production
frontend: npm run build:ssg -- --configuration production
frontend: npm run test -- --run
frontend: npm run test:coverage
frontend: node ../scripts/ci/validate-seo.mjs dist seo-report/seo-validation.txt
frontend: node ../scripts/ci/validate-api-contract.mjs contract-report.txt
backend:  ./mvnw -B clean verify
e2e:      npm run e2e:critical
docker:   docker build -f infra/Dockerfile .
```

O workflow mantém jobs separados para diagnóstico e começa pelo job
`components`, que detecta os contratos disponíveis na revisão. Frontend só é
considerado disponível com `package.json`, lockfile, o validador de contrato e
os scripts realmente executados pelo job (`lint`, `build`, `build:ssg` e
`test:coverage`); backend precisa de `pom.xml`, `mvnw` executável e o wrapper
do Maven. Docker precisa do Dockerfile, Caddy, Compose, templates de realm,
validador OIDC e os insumos de build do frontend/backend; SEO depende do
frontend completo, do validador e de `infra/Caddyfile`; Playwright depende do
frontend e backend completos, `e2e:critical`, a configuração e os fixtures/specs
críticos.

O `CI / merge-gate` agrega os resultados usando essa expectativa: componente
disponível exige `success`, componente ausente ou parcial exige `skipped`. Um
job disponível falho, cancelado ou interrompido deixa o gate vermelho, e o
detector também é obrigatório. Isso permite a entrega incremental do monorepo
sem transformar diretórios ausentes em falhas de setup/cache/build, mantendo a
execução completa assim que cada contrato estiver presente.

O job frontend também valida a correspondência entre métodos do client Angular
e resources Quarkus. Se `OPENAPI_FILE` ou `OPENAPI_URL` estiver definido, o
validador confere os mesmos paths no documento OpenAPI. Produção não expõe o
spec publicamente; prefira `OPENAPI_FILE` de build dev/test em vez de
`OPENAPI_URL` apontando para o domínio público. A cobertura V8 do
Vitest e os relatórios JUnit/Surefire são publicados como artefatos. Os
arquivos `contract-report.txt` e o diretório `seo-report/` são evidência
local/CI e ficam no `.gitignore`; o workflow sobe esses artefatos sem
versioná-los.

## SEO e HTTP

O teste SEO deve examinar somente páginas públicas indexáveis e garantir que:

- cada rota pública (`/`, `/como-funciona`, `/recursos`, `/sobre`,
  `/privacidade` e `/termos`) responda HTTP 200 com `title`, meta description,
  canonical, `h1`, `lang="pt-BR"` e Open Graph coerentes;
- páginas públicas não recebam `noindex` acidentalmente;
- `robots.txt` exista e não seja usado como único mecanismo de proteção da
  área privada;
- `sitemap.xml` exista e contenha apenas URLs públicas indexáveis;
- `/app` e seus deep links entreguem o shell privado com proteção
  `noindex,nofollow`;
- wildcard inexistente entregue o documento 404 com status HTTP 404, sem
  repetir o conteúdo da landing (soft 404);
- redirects configurados tenham status permanente 301 ou 308 e destino exato.

No CI, o artefato SSG é montado em um container Caddy 2.10.0 usando o mesmo
`infra/Caddyfile` da imagem de produção. O validador faz as requisições contra
essa borda real, cobrindo shell para `/app/**`, arquivos prerenderizados para
rotas públicas, 404 real para caminhos ausentes e redirects configurados. O
servidor Node `scripts/ci/serve-seo.mjs` permanece disponível apenas para
debug local e não é usado como substituto do Caddy no gate.

Quando houver uma rota de redirect configurada, defina as variáveis de
repositório `SEO_REDIRECT_PATH` e `SEO_REDIRECT_TARGET`. O CI fará a requisição
sem seguir o redirect e exigirá status permanente 301 ou 308 e o destino exato.

## Evidências e aprovação

Todos os jobs enviam logs e resultados mesmo quando falham (`if: always()`).
Relatórios JUnit, Playwright, screenshots/videos e o relatório SEO ficam
disponíveis por 14 dias. A revisão do pull request deve confirmar o status
`CI / merge-gate` verde e consultar os artefatos quando houver falha ou
comportamento inesperado.

Na proteção de `main`, o status check obrigatório é `CI / merge-gate`, com
pull request obrigatório e branch atualizada antes do merge. Nenhum merge
manual deve contornar esse check.

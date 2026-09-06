# Estratégia de testes e gate de merge

Este documento define a estratégia mínima do Folhea v1. O workflow
`.github/workflows/ci.yml` é a implementação automatizada e o contrato de
scripts abaixo deve ser mantido quando frontend e backend forem evoluídos.

## Pirâmide de testes

| Camada | Ferramenta | Escopo mínimo | Execução |
| --- | --- | --- | --- |
| Unitário | Vitest | services, Signals, forms, regras de apresentação e componentes críticos | `npm run test -- --run` |
| Smoke/contrato | JUnit 5, Quarkus Test, RestAssured | inicialização da API, autenticação, endpoints e schema OpenAPI | `./mvnw -B clean verify` |
| Integração | Dev Services/Testcontainers | PostgreSQL e dependências reais, migrações e isolamento | `./mvnw -B clean verify` |
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

## Contratos do CI

Cada comando abaixo deve retornar código diferente de zero em caso de falha:

```text
frontend: npm ci && npm run lint
frontend: npm run build -- --configuration production
frontend: npm run build:ssg -- --configuration production
frontend: npm run test -- --run
frontend: node ../scripts/ci/validate-seo.mjs dist seo-report/seo-validation.txt
backend:  ./mvnw -B clean verify
e2e:      npm run e2e:critical
docker:   docker build -f infra/Dockerfile .
```

O workflow mantém jobs separados para diagnóstico e começa pelo job
`components`, que detecta os contratos disponíveis na revisão. Frontend só é
considerado disponível com `package.json`, lockfile e os scripts de lint, build,
SSG e teste; backend precisa de `pom.xml` e `mvnw`; Docker precisa de
`infra/Dockerfile`; SEO depende do frontend e do validador; Playwright depende
do frontend, backend e do script `e2e:critical`.

O `CI / merge-gate` agrega os resultados usando essa expectativa: componente
disponível exige `success`, componente ausente ou parcial exige `skipped`. Um
job disponível falho, cancelado ou interrompido deixa o gate vermelho, e o
detector também é obrigatório. Isso permite a entrega incremental do monorepo
sem transformar diretórios ausentes em falhas de setup/cache/build, mantendo a
execução completa assim que cada contrato estiver presente.

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

No CI, `scripts/ci/serve-seo.mjs` serve o artefato SSG com as mesmas decisões
de borda relevantes: shell para `/app/**`, arquivos prerenderizados para
rotas públicas e 404 real para caminhos ausentes.

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

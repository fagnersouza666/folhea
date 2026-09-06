# Folhea

Folhea is a reading habit tracker. The backend is a Java 25 / Quarkus 3.33 monolith with PostgreSQL and Flyway.

## Backend

Create a local environment file, then start the complete local stack:

```bash
cp .env.example .env
docker compose --env-file .env up -d --build
```

The public edge is available at `https://localhost:8443` (Caddy's local
certificate may need to be trusted once). To run only the backend from Maven,
start PostgreSQL and Keycloak with `docker compose --env-file .env up -d
postgres keycloak`, then run:

```bash
cd backend
set -a && . ../.env && set +a
./mvnw quarkus:dev
```

The API is rooted at `/api/v1`; OpenAPI is available at `/api/openapi`. Configure OIDC and database credentials through environment variables rather than committing secrets.

Operational deployment, health checks, daily backups, retention, and restore
procedures are documented in [docs/operations.md](docs/operations.md).

## License

Licensed under the Apache License 2.0.

You are free to use, modify, distribute and commercialize this software.

Attribution to the original project and author must be preserved as described
in the LICENSE and NOTICE files.

## Desenvolvimento local

O Folhea é um monorepo com `frontend/`, `backend/` e `infra/`. Os comandos
abaixo são o contrato usado pelo CI; execute-os antes de abrir um pull request.

### Pré-requisitos

- Node.js 22 ou superior e npm;
- Java 25 e Docker (necessário para Dev Services/Testcontainers);
- Docker Compose, quando for necessário executar a stack completa.

### Frontend

```bash
cd frontend
npm ci
npm run lint
npm run build -- --configuration production
npm run build:ssg -- --configuration production
npm run test -- --run
node ../scripts/ci/validate-seo.mjs dist seo-report/seo-validation.txt
```

O build SSG deve gerar as páginas públicas. O teste de SEO executado no CI
verifica o artefato gerado, incluindo `title`, description, canonical,
`robots.txt`, `sitemap.xml`, `noindex`, status 404 e redirects.

### Backend

```bash
cd backend
./mvnw -B clean verify
```

Esse comando compila o Quarkus e executa os testes JUnit 5, incluindo os
testes REST/RestAssured, smoke e contrato. Docker deve estar disponível para
os testes que usam Dev Services ou Testcontainers.

### Fluxos críticos

Com o frontend e o backend disponíveis localmente, instale os navegadores e
execute os testes Playwright:

```bash
cd frontend
npm ci
npx playwright install --with-deps chromium
npm run e2e:critical
```

Os fluxos cobertos são landing, login, cadastro de livro, registro/edição/
exclusão de leitura, finalização, estatísticas e isolamento básico entre
usuários. As regras do streak também devem cobrir hoje, ontem, sequência,
quebra, múltiplas sessões no dia, timezone, edição e exclusão.

### Docker

```bash
docker build -f infra/Dockerfile .
```

## Gate de merge

Todo pull request deve passar pelo workflow `CI`. O job `CI / merge-gate` é o
único status check necessário para a proteção de `main`. O workflow primeiro
detecta os contratos dos componentes: frontend exige `package.json`, lockfile e
os scripts de lint, build, SSG e teste; backend exige `pom.xml` e `mvnw`; SEO
exige o validador; Playwright exige frontend, backend e `e2e:critical`; Docker
exige `infra/Dockerfile`.

Um componente ausente ou ainda parcial tem seu job marcado como `skipped`, e o
merge-gate aceita esse resultado somente para o componente que foi detectado
como indisponível. Quando o contrato existe, a execução completa continua
obrigatória e qualquer falha ou cancelamento deixa o gate vermelho. Assim,
branches que entregam o monorepo por etapas não falham por diretórios ausentes,
sem ocultar falhas de componentes disponíveis. Os gates completos são:

- frontend lint, build de produção, build SSG e Vitest;
- backend build e testes;
- Playwright dos fluxos críticos;
- validação SEO do artefato SSG;
- Docker build.

O workflow `CD` executado após merge repete lint, testes, build de produção,
SSG e backend, constrói a imagem quando `infra/Dockerfile` está disponível,
dispara `PRODUCTION_DEPLOY_HOOK` e verifica liveness/readiness em
`PRODUCTION_HEALTH_URL`. O contrato completo de release, métricas de produto,
eventos analytics e a política de privacidade ficam em
[`docs/quality-and-release.md`](docs/quality-and-release.md).

Em Settings → Branches → Branch protection rules, configure `main` para exigir
pull request, exigir `CI / merge-gate`, exigir branch atualizada e bloquear
force-push. Não permita bypass para merges normais. O workflow publica logs,
relatórios de teste, relatório Playwright e artefato SEO por 14 dias; esses
artefatos são a evidência da aprovação.

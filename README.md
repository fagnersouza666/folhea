# Folhea

O Folhea é um rastreador de hábito de leitura. O backend é um monolito Java 25 / Quarkus 3.33 LTS com PostgreSQL e Flyway.

## Versão do produto

Frontend (`frontend/package.json`), backend (`backend/pom.xml`) e OpenAPI
(`quarkus.smallrye-openapi.info-version`) compartilham a mesma versão SemVer
`X.Y.Z`, sem `-SNAPSHOT`. Não edite esses arquivos à mão: use
`./scripts/versao.sh` (`corrigir`, `funcionalidade` ou `grande`). Só docs,
chore, teste ou infra sem mudança de produto não incrementam. Detalhe em
`.cursor/rules/versionamento.mdc`.

Versão atual: **0.3.3**

## Backend

Crie um arquivo de ambiente local e suba a stack completa:

```bash
cp .env.example .env
docker compose --env-file .env up -d --build
```

Para produção, use o overlay `docker-compose.prod.yml` (Keycloak
`start --optimized`):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build
```

A borda pública fica em `https://localhost:8443` (talvez seja preciso
confiar uma vez no certificado local do Caddy). Para rodar só o backend
pelo Maven, suba o PostgreSQL e o Keycloak com
`docker compose --env-file .env up -d postgres keycloak` e depois execute:

```bash
./scripts/dev-backend.sh
```

O script carrega o `.env` da raiz antes de invocar `./mvnw quarkus:dev`, evitando
falha de autenticação SCRAM no PostgreSQL por `DB_PASSWORD` vazio. Alternativa
manual:

```bash
cd backend
set -a && . ../.env && set +a
./mvnw quarkus:dev
```

O Postgres do Compose fica na rede Docker, sem porta no host. O `quarkus:dev`
usa `localhost`. Nesta máquina o `:5432` costuma ser o PostgreSQL do sistema, não
o container `folhea-postgres-1`. O perfil `%dev` usa `jdbc:postgresql://localhost:5433/folhea` por padrão, a porta
do override local. `localhost:5432` costuma ser o PostgreSQL do sistema. O mesmo
override publica o Keycloak em `127.0.0.1:8180` e define `KC_HOSTNAME` para
`http://localhost:8180`, para o clique em Entrar abrir o login OIDC sem Caddy.

O perfil `%dev` não define `folhea.clock.fixed-instant`; o relógio da aplicação
é o UTC do sistema. Só o perfil `%test` fixa o instante para testes
determinísticos.

A raiz da API é `/api/v1`; o OpenAPI fica em `/api/openapi` em dev/test (em
produção o spec é desligado no Quarkus e bloqueado no Caddy). Configure Redis,
OIDC e banco por variáveis de ambiente, sem gravar segredos no repositório.

O deploy operacional e os health checks estão em
[docs/operations.md](docs/operations.md). Os procedimentos executáveis de
backup, restore, verificação de recuperação, retenção e incidentes estão em
[docs/backup-restore.md](docs/backup-restore.md).

## Licença

Licenciado sob a Apache License 2.0.

Você pode usar, modificar, distribuir e comercializar este software.

A atribuição ao projeto original e ao autor deve ser preservada conforme
descrito nos arquivos LICENSE e NOTICE.

## Desenvolvimento local

O Folhea é um monorepo com `frontend/`, `backend/` e `infra/`. Os comandos
abaixo são o contrato usado pelo CI; execute-os antes de abrir um pull request.

### Pré-requisitos

- Node.js 24 ou superior e npm;
- Java 25 e Docker (necessário para Dev Services/Testcontainers);
- Docker Compose, quando for necessário executar a stack completa.

Se `java -version` mostrar 21, o Maven usa o JDK errado. Exporte o JDK 25
antes de `./mvnw` (em Debian/Ubuntu/Pop!_OS: `/usr/lib/jvm/java-25-openjdk-amd64`).

### Frontend

Com o BFF em `http://localhost:8080` (`./scripts/dev-backend.sh`), o hot reload local é:

```bash
cd frontend
npm start
```

O `ng serve` na porta 4200 encaminha `/api` e `/auth` ao Quarkus, como o Caddy
faz na borda pública, e envia `X-Forwarded-Host: localhost:4200` para o
callback OIDC voltar à SPA. A tela de entrar é `/entrar`; `/auth/login` inicia o
fluxo OIDC no BFF e não é rota Angular. O perfil `%dev` fala com o Keycloak em
`http://localhost:8180` (porta publicada pelo override local). Crie um usuário
no realm `folhea` pelo console em `http://localhost:8180` (credenciais
`KEYCLOAK_ADMIN_*` do `.env`).

```bash
cd frontend
npm ci
npm run lint
npm run build -- --configuration production
npm run build:ssg -- --configuration production
npm run test:coverage
node ../scripts/ci/validate-api-contract.mjs contract-report.txt
node ../scripts/ci/validate-seo.mjs dist seo-report/seo-validation.txt
```

O build SSG deve gerar as páginas públicas. O teste de SEO executado no CI
serve o artefato e verifica as rotas públicas (`title`, description,
canonical, `h1`, `lang`, Open Graph), `robots.txt`, `sitemap.xml`, o shell
privado `/app`, um 404 real sem soft-404 e redirects permanentes quando
configurados. Os relatórios `contract-report.txt` e `seo-report/` ficam
fora do git.

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
detecta os contratos dos componentes. Frontend exige `package.json`, lockfile,
o validador de contrato e os scripts de lint, build, SSG e cobertura; backend
exige `pom.xml`, `mvnw` executável e o wrapper do Maven. SEO exige o frontend
completo, o validador e `infra/Caddyfile`; Playwright exige frontend e backend
completos, `e2e:critical`, a configuração e os fixtures/specs críticos; Docker
exige `infra/Dockerfile`, Caddy, Compose, os templates de realm, o validador
OIDC e os insumos de build do frontend/backend.

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
O relatório da última varredura de bugs (modo full) está em
[`docs/bug-report.md`](docs/bug-report.md). A auditoria de segurança
(06/09/2026, veredicto **APROVADO COM RESSALVAS** — findings SEC-001–SEC-013
remediados) está em
[`docs/relatorio-seguranca.md`](docs/relatorio-seguranca.md).

Em Settings → Branches → Branch protection rules, configure `main` para exigir
pull request, exigir `CI / merge-gate`, exigir branch atualizada e bloquear
force-push. Não permita bypass para merges normais. O workflow publica logs,
relatórios de teste, relatório Playwright e artefato SEO por 14 dias; esses
artefatos são a evidência da aprovação.

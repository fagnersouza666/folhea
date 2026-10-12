# Folhea

O Folhea é um rastreador de hábito de leitura. O backend é um monolito Java 27 / Quarkus 3.40.1 LTS com PostgreSQL e Flyway.

## Versão do produto

Frontend (`frontend/package.json`), backend (`backend/pom.xml`) e OpenAPI
(`quarkus.smallrye-openapi.info-version`) compartilham a mesma versão SemVer
`X.Y.Z`, sem `-SNAPSHOT`. Não edite esses arquivos à mão: use
`./scripts/versao.sh` (`corrigir`, `funcionalidade` ou `grande`). Só docs,
chore, teste ou infra sem mudança de produto não incrementam. Detalhe em
`.cursor/rules/versionamento.mdc`.

Versão atual: **0.5.0**

## Estante privada

Cada livro pode guardar título, autor, edição, total de páginas e capa privada.
Na tela de cadastro, título e total são obrigatórios; autor, edição e capa são
opcionais. Livros antigos continuam disponíveis e podem completar os metadados.
As capas JPEG/PNG ficam no PostgreSQL, são incluídas no backup e na exportação e
só podem ser lidas pelo proprietário. Upload e metadados são gravados juntos;
falha de imagem não cria um livro parcial.

A estante mostra páginas lidas, páginas totais, progresso até 100% e média de
páginas/dia. A média soma todas as páginas do livro e divide pelos dias corridos
**inclusivos** desde sua primeira leitura até hoje no fuso da conta, incluindo
dias sem leitura; em livros concluídos, a referência é a data de conclusão.
Criar, editar ou excluir leitura recalcula os valores. O percentual é truncado
em duas casas e não mostra 100% antes de atingir o total. Um livro legado sem
total mantém as páginas/média, com percentual indisponível até completar o campo.

## Backend

Crie um arquivo de ambiente local e suba a stack completa:

```bash
./scripts/local-stack.sh up
```

Para produção, use o overlay `docker-compose.prod.yml` (Keycloak
`start --optimized`):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build
```

O comando cria `.env` com segredos aleatórios somente se ainda não existir e
preserva usuários/volumes em execuções posteriores. A stack usa o projeto
`folhea-local`, uma rede própria e portas 9080/9443, sem afetar a infraestrutura
de desenvolvimento existente em 5433/8180. Crie a conta na tela **Criar conta**
e entre com e-mail/senha. Para interromper sem apagar dados, execute
`./scripts/local-stack.sh stop`; para retomar, `./scripts/local-stack.sh start`.

A borda pública fica em `https://localhost:9443` (talvez seja preciso
confiar uma vez no certificado local do Caddy). Para rodar só o backend
pelo Maven, suba o PostgreSQL e o Keycloak com
`docker compose --env-file .env up -d postgres keycloak` e depois execute:

```bash
./scripts/dev-backend.sh
```

O script carrega o `.env` da raiz antes de invocar `./mvnw quarkus:dev` e cria
um symlink local `backend/.env` → `../.env` (gitignored) para o Quarkus ler os
segredos mesmo quando o Maven é iniciado de dentro de `backend/`. Sem isso o
`DB_PASSWORD` fica vazio e o Flyway falha com SCRAM. Alternativa manual:

```bash
cd backend
ln -sfn ../.env .env
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

A CA pública local pode ser extraída com `./scripts/local-stack.sh certificate`
e importada no navegador. Não use as credenciais do `.env.example` como
segredos reais. Google e recuperação de senha por e-mail exigem OAuth e SMTP
externos; `./scripts/ops/configure-keycloak.sh diagnose` mostra o que falta.

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

O frontend usa Angular 22.2.2 e o builder `@angular/build` 22.2.2. As dependências
de build são fixadas no lockfile validado; a migração remove a cadeia antiga de
build, e `proxy-addr` 2.0.8 corrige a versão vulnerável detectada pelo Trivy.

- Node.js26.11.1 estável e npm (engines Angular: `^22.22.3 || ^24.15.0 || >=26.0.0`);
- Java 27 estável e Docker (necessário para Dev Services/Testcontainers);
- Docker Compose, quando for necessário executar a stack completa.

Se `java -version` mostrar uma versão menor que27, o Maven usa o JDK errado.
Exporte `JAVA_HOME` para uma instalação do JDK27 antes de `./mvnw`.
O Docker e o CI usam Temurin27+35 GA. O PRD fonte mantém a referência Java25
LTS; o target27 segue a política do projeto de usar a última versão estável.

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
`http://localhost:8180` (porta publicada pelo override local). Use o cadastro
público em `/cadastro`: o BFF provisiona a identidade no realm `folhea` usando o cliente técnico, sem intervenção administrativa.

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

Instale os navegadores e execute os testes Playwright de regressão da UI:

```bash
cd frontend
npm ci
npx playwright install --with-deps chromium
npm run e2e:critical
```

`e2e:critical` usa API, BFF e Web Share simulados. Cobre landing, login,
cadastro de livro, registro/edição/exclusão de leitura, finalização,
estatísticas e respostas de isolamento; não comprova autenticação nem banco
reais. `e2e:integrated` é opt-in e usa a stack HTTPS9443 com credenciais de
uma conta local de teste. O [aceite com stack real](docs/quality-and-release.md#aceite-com-stack-real)
cria duas contas pelo cadastro, passa pelo Keycloak/BFF e comprova ownership404,
CSRF, métricas, exportação, exclusão e logout sem interceptar APIs.

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

O monorepo v1 exige todos os componentes. Um contrato removido ou parcial
faz a detecção falhar; uma falha ou cancelamento em qualquer gate bloqueia
o merge. Os gates completos são:

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

Build frontend/CI: Node26.11.1 estável e TypeScript6.0.3, compatíveis com
Angular22.2.2. O runtime do frontend é estático no Caddy e não contém Node.

# Operação da infraestrutura

Este runbook cobre a stack inicial do Folhea: Caddy, Quarkus, PostgreSQL 18,
Keycloak e Redis 8. PostgreSQL, Keycloak e Redis ficam somente na rede privada do
Compose; a única superfície publicada é o Caddy.

`/app/**`, `/entrar` e `/cadastro` entregam o shell CSR com
`X-Robots-Tag: noindex, nofollow` e `Cache-Control: no-store`. O `try_files`
das páginas públicas fica no handler de fallback, depois da seleção das rotas
privadas; isso impede que um arquivo SSG de autenticação evite esses cabeçalhos.
O gate HTTP `scripts/ci/validate-seo.mjs` exige `no-store` também nas duas telas
de autenticação, além da proteção de indexação.
API, BFF e IdP possuem handlers próprios no mesmo grupo do fallback, para
que o servidor de arquivos nunca intercepte as chamadas de autenticação.

## Deploy

1. Instale Docker Engine com Docker Compose atual e prepare um host Linux com
   armazenamento persistente para os volumes `folhea-postgres` e `caddy-data`.
2. Injete as variáveis de [`.env.example`](../.env.example) por um secret
   manager ou pelo ambiente de CI/CD. Para desenvolvimento local, copie-o para
   `.env` e substitua todos os valores `replace-with-*` por valores aleatórios.
   O arquivo `.env` nunca deve ser commitado.
3. Antes do primeiro deploy, valide a configuração sem iniciar containers:

   ```bash
   docker compose --env-file .env config --quiet
   ```

4. Construa e inicie a stack:

   ```bash
   docker compose --env-file .env up -d --build
   docker compose --env-file .env ps
   ```

   Em produção, use o overlay `docker-compose.prod.yml` para o Keycloak em modo
   otimizado:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build
   ```

   A imagem possui três targets: `backend-runtime` (Quarkus/JVM),
   `caddy-runtime` (Angular estático/Caddy) e `keycloak-runtime` (IdP
   pré-construído). Nenhum runtime contém Node.js.
5. Em produção, defina `PUBLIC_BIND_ADDRESS=0.0.0.0`, use um domínio HTTPS em
   `PUBLIC_DOMAIN`, mantenha `DB_PASSWORD`, `KEYCLOAK_DB_PASSWORD` e
   `KEYCLOAK_ADMIN_PASSWORD` fora do Git e suba o Keycloak com
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml` (modo
   `start --optimized`). Use Keycloak **26.8.0** (digest pinado no Compose).
   CVE-2026-18963 exige ≥ 26.7.2 ([relatório](relatorio-seguranca.md)). Defina
   `OIDC_PUBLIC_ORIGIN`, `OIDC_PUBLIC_ISSUER`, `OIDC_PUBLIC_AUTHORIZATION_URL` e
   `OIDC_PUBLIC_LOGOUT_URL` para o mesmo domínio público HTTPS. O backend
   continua usando `http://keycloak:8080` somente no back-channel; Caddy
   publica apenas as rotas de login/logout e recursos estáticos necessários ao
   navegador. O console administrativo, token endpoint, introspection, JWKS e
   realm-management não são roteados pelo Caddy. `/realms/folhea/login-actions/*`
   permanece público porque o formulário de login do IdP precisa dele — por
   isso o patch de reset de senha não pode esperar. O Caddy também responde
   `404` em `/api/openapi`; o Quarkus desliga o SmallRye OpenAPI no perfil
   `%prod`. Defina `REDIS_PASSWORD` e `OIDC_CLIENT_SECRET` no secret store; o
   backend usa `REDIS_URL=redis://:<senha>@redis:6379` na rede privada.

## Redis (store de sessão)

O Redis persiste referências opacas de sessão OIDC, tokens CSRF e janelas de
rate limit. No Compose atual:

- sem `ports` publicados;
- `--requirepass` obrigatório;
- `maxmemory` 256 MiB com política `allkeys-lru`;
- healthcheck antes do backend subir.

**Fora do Compose:** use TLS (`rediss://`), ACL mínima e rotação periódica da
senha. A ausência de TLS na rede Docker interna é a ressalva registrada no
veredicto **APROVADO COM RESSALVAS**.

## Métricas de produto (PRD98–100)

`scripts/ops/product-metrics.sh 7` retorna JSON agregado em transação
`REPEATABLE READ READ ONLY`, sem IDs, e-mails, títulos ou autores. A janela
inclui hoje e os seis dias anteriores no fuso da conta (altere7 para outro
período). Denominador zero retorna `null`, evitando uma taxa fictícia.

- Ativação: contas com pelo menos uma leitura / contas persistentes.
- Ativação forte: contas com leitura em três datas nos sete primeiros dias /
  contas cuja janela inicial de sete dias já terminou.
- Retenção: contas com nova leitura nos dias7–13 depois da primeira leitura /
  contas cuja janela de14dias já terminou. Esta é a definição operacional de
  “semana seguinte”; não usa coortes ainda incompletas como fracasso.
- Frequência: sessões na janela / usuários com leitura na janela.
- North Star: pares distintos usuário/data de leitura na janela / usuários
  com leitura na janela. Múltiplas sessões no dia contam uma vez.

Esses agregados refletem os dados ainda existentes: editar/excluir leituras ou
excluir a conta altera os resultados. Não preservam histórico de dados apagados.
Os eventosPRD98 aceitos geram logs JSON sanitizados e
`folhea_product_events_total{event}` no `/q/metrics` privado. Um coletor
Prometheus pode calcular uso do card (`increase(card_created[7d]) / usuários
ativos7d`) e compartilhamento (`increase(card_shared[7d]) /
increase(card_created[7d])`). Sem coletor persistente configurado, o contador
vale apenas desde o último início do processo; não representa uma taxa
histórica. Download de fallback é `card_downloaded`, não compartilhamento
nativo bem-sucedido. Grafana/Prometheus completos não são obrigatórios no v1.
`scripts/ops/tests/test-product-metrics.sh` aplica todas as migrações do repositório em um
PostgreSQL18.6 temporário sem rede/portas/volumes compartilhados e verifica
fórmulas, coortes incompletas, datas distintas e denominadores vazios. Esses
dados são fixtures de SQL; o aceite da aplicação usa contas e leituras reais.

## Supply chain (imagens e Actions)

Imagens base e serviços usam digest SHA256 pinado (`infra/Dockerfile`,
`docker-compose.yml`). GitHub Actions usam commit SHA imutável com comentário
de tag (`# v7`, `# v5`).

Regenerar digests:

```bash
docker buildx imagetools inspect <imagem:tag>
gh api repos/actions/checkout/commits/v7 --jq .sha
```

Validar overlay de produção:

```bash
scripts/ops/validate-production-compose.sh
```

O overlay de produção constrói `keycloak-runtime` com `kc.sh build` para
PostgreSQL, health e métricas antes de usar `start --optimized`. O cliente
`folhea-registration` recebe somente `realm-management/manage-users`; seu
secret é diferente do cliente BFF. O renderer JSON escapa segredos, substitui
a origem de callback/login/logout e grava o import com permissão 0600.
Um realm existente é preservado pelo `--import-realm`; mudanças de clientes
ou secrets em instalações antigas exigem atualização administrativa explícita.
Nunca remova o volume para aplicar configuração.

O perfil de usuário v1 mantém e-mail obrigatório e nomes opcionais. Isso evita
que o Keycloak exija nome/sobrenome após o cadastro e-mail/senha do produto.
Os templates incluem o componente `declarative-user-profile`; a configuração
usa a chave oficial `kc.user.profile.config` do [Keycloak26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/userprofile/DeclarativeUserProfileProvider.java).
Para atualizar um realm existente sem apagar usuários ou credenciais, execute
`scripts/ops/configure-keycloak.sh profile`. O comando aplica
`infra/keycloak/user-profile.json` pela Admin API privada e define português
brasileiro como idioma do login. Ele não configura Google nem SMTP.

O primeiro boot do PostgreSQL cria duas bases independentes (`folhea` e
`keycloak`). O script de inicialização roda apenas quando o volume é criado;
alterar os nomes depois do primeiro boot exige uma migração operacional
explícita, não a edição do script.

## Desenvolvimento local com `ng serve`

A borda pública de Compose continua no Caddy (`https://localhost:9443`). Para
hot reload do Angular, `npm start` em `frontend/` escuta `http://localhost:4200`
e usa `frontend/proxy.conf.json` para encaminhar `/api` e `/auth` ao Quarkus em
`http://localhost:8080`, com `X-Forwarded-Host: localhost:4200` para o redirect
OIDC voltar à SPA. `/auth/login` não é página Angular; é o início OIDC do BFF.
O realm de desenvolvimento inclui `http://localhost:4200/auth/callback`.

O Postgres do Compose não publica `5432` no host. Se o `quarkus:dev` apontar
para `localhost:5432`, ele pode autenticar no PostgreSQL do sistema e falhar
com `28P01`. Use `docker-compose.override.example.yml` (`127.0.0.1:5433`,
Keycloak em `127.0.0.1:8180`, `KC_HOSTNAME=http://localhost:8180` e rede
`default` + `private`) e `DB_JDBC_URL=jdbc:postgresql://localhost:5433/folhea`.
Suba o BFF com `./scripts/dev-backend.sh` na raiz do repositório: o script
carrega o `.env` antes do `quarkus:dev` e cria o symlink local gitignored
`backend/.env` → `../.env`. Sem esse arquivo no diretório de trabalho do Maven,
o Quarkus resolve `DB_PASSWORD` para vazio e o Flyway falha com SCRAM
(sintoma comum: HTTP 500 em `/auth/login` via proxy do `ng serve`). Se
`backend/.env` já existir como arquivo regular, o script avisa e não
sobrescreve. Um symlink apontando para outro caminho é substituído. O healthcheck do Keycloak usa `/dev/tcp` em bash (a imagem
oficial não tem `wget` nem `curl`); `wget` permanece nos healthchecks do
backend e do Caddy, que rodam em Alpine.
O `%dev` liga o OIDC contra `http://localhost:8180/realms/folhea`. Sem isso o
BFF devolve `/app/inicio` sem sessão e o guard Angular devolve `/entrar` — o
botão Entrar parece não fazer nada. Use `/cadastro` para criar a conta pelo
produto. O cliente técnico
`folhea-registration` provisiona o usuário no realm `folhea`, sem intervenção
administrativa. O console na porta8180 pertence apenas ao override de desenvolvimento.

## Health checks e diagnóstico

O Quarkus expõe apenas na rede interna:

```text
/q/health/live   processo disponível
/q/health/ready  processo e dependências prontas, incluindo PostgreSQL
```

O Caddy expõe `/healthz` para seu próprio healthcheck. O endpoint não substitui
`/q/health/ready` no monitoramento do deploy.

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --since=10m backend
curl -kfsS https://localhost:9443/healthz
docker compose --env-file .env exec backend \
  wget --no-verbose --spider http://127.0.0.1:8080/q/health/ready
```

Os logs do backend são JSON e o access log HTTP está desligado para não
registrar cookies, tokens, query strings ou payloads privados. Cada resposta
inclui `X-Request-ID` (eco do cliente ou UUID gerado) e o MDC registra
`requestId`, `userId` interno, `route` e `httpStatus` para correlação.
Não use
`docker compose config` em um terminal compartilhado: a saída renderiza os
valores das variáveis injetadas.

## Backup diário e retenção

Execute uma vez ao dia em um host de backup dedicado ou em um job de CI/CD com
acesso mínimo ao secret manager. O destino deve estar fora do servidor
principal e ser compatível com S3; habilite criptografia e versionamento no
bucket.

Exemplo de comando (não grava senha no shell history):

```bash
set -o pipefail
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups
docker compose --env-file .env exec -T postgres \
  pg_dump --format=custom --no-owner --no-privileges \
  --username="$DB_USERNAME" --dbname="$DB_NAME" \
  | gzip > "backups/folhea-${stamp}.dump.gz"
aws s3 cp "backups/folhea-${stamp}.dump.gz" \
  "s3://folhea-backups/postgres/" --sse AES256
find backups -type f -name 'folhea-*.dump.gz' -mtime +7 -delete
```

O job deve falhar se `pg_dump`, o upload ou a verificação do objeto falhar.
Configure a política de ciclo de vida do bucket para manter no mínimo sete
backups diários, além de uma cópia independente da retenção local. Não faça
backup do volume bruto enquanto o PostgreSQL estiver escrevendo.

## Restore e teste periódico

Teste o restore pelo menos mensalmente em um projeto/volume isolado. Nunca
restaure diretamente sobre o volume de produção sem uma janela aprovada.

```bash
gunzip -c backups/folhea-20260906T000000Z.dump.gz \
  | docker compose --env-file .env exec -T postgres \
      pg_restore --clean --if-exists --no-owner --dbname="$DB_NAME" \
      --username="$DB_USERNAME"
docker compose --env-file .env exec backend \
  wget --no-verbose --spider http://127.0.0.1:8080/q/health/ready
```

Registre data, origem, checksum, duração, resultado do healthcheck e a versão
da aplicação restaurada. Keycloak possui uma base separada e deve ter seu
backup/restauração coordenado com o backup de `folhea` quando a continuidade
de identidade for necessária; não copie nem consulte tabelas internas do
Keycloak pelo backend.

## Stack local pronta para uso

Execute `./scripts/local-stack.sh up`. O launcher cria segredos aleatórios em
`.env` (0600), exige bind loopback e seleciona somente `docker-compose.yml`,
sem herdar overrides de outra instalação. Abra `https://localhost:9443`, crie
uma conta e entre pelo Keycloak. `certificate` extrai somente a CA pública;
`stop` e `start` preservam o PostgreSQL. Nunca use `down -v` em dados úteis.
Os containers carregam os rótulos `ao.session` e `ao.spare=true` para preservar
o ambiente persistente entregue ao operador.

Para outra stack, escolha `COMPOSE_PROJECT_NAME`, `EDGE_SUBNET`, `CADDY_IPV4`,
`BACKEND_IPV4`, `HTTP_PORT` e `HTTPS_PORT` exclusivos. Alinhe todas as origens
OIDC/segurança do `.env` com o HTTPS escolhido. Caddy preserva host e porta nos
headers de forwarding, entrega o shell CSR em rotas privadas e respostas 404
reais nas rotas públicas desconhecidas. CSS inline é permitido porque Angular
injeta estilos e o canvas de card usa estilos dinâmicos; scripts permanecem
limitados à origem nas páginas/API Folhea. Fotos em `blob:`/`data:` permanecem no navegador.

O upstream `backend-edge:8080` resolve exclusivamente a rede edge, garantindo
que o BFF receba conexões do IP exato de Caddy em `TRUSTED_PROXIES`. O alias
`backend` existe em duas redes e pode produzir redirects HTTP incorretos por
forwarding não confiado. Não amplie o trust para a rede inteira.
Caddy substitui `X-Forwarded-For/Host/Proto` pelos valores canônicos; não combine
`header_up -Nome` com `header_up Nome` para o mesmo header, pois deletes são
aplicados após sets e removem inclusive o valor confiável
([implementação oficial](https://github.com/caddyserver/caddy/blob/v2.11.7/modules/caddyhttp/headers/headers.go)). A superfície
pública do IdP preserva a CSP emitida pelo Keycloak para seu tema; a política
Angular não deve sobrescrever os scripts próprios do formulário de login.
[Referência Keycloak](https://www.keycloak.org/docs/latest/server_admin/#clickjacking).

O edge possui saída para ACME; Keycloak possui saída para Google/SMTP. Banco,
Redis e API continuam sem portas no host. O cache de bundles com fingerprint é
imutável, mas arquivos do service worker/manifesto são revalidados.

O logout usa `/auth/logout` com autenticação code-flow e retorna a
`/auth/logged-out`, onde o backend valida o state/cookie antes do redirect 303
para a Home. Os dois templates autorizam esse caminho exato em
`attributes["post.logout.redirect.uris"]`: `${OIDC_PUBLIC_ORIGIN}/auth/logged-out`
em prod e o mesmo retorno público mais os caminhos exatos de localhost:8080
e localhost:4200 em dev. As URLs de login `/auth/callback` permanecem separadas.
O gate OIDC renderiza ambos os templates e verifica os retornos autorizados;
não substitui a execução autenticada no Keycloak.

A importação de inicialização não atualiza realms existentes. Ao atualizar um
ambiente, ajuste somente esse atributo do cliente `folhea-api` no console
administrativo, preservando usuários, credenciais e volumes
([contrato Keycloak](https://www.keycloak.org/docs/26.7.0/server_admin/index.html#_oidc-logout)).
O callback continua público para concluir uma sessão já encerrada;
state ausente, incorreto, duplicado ou sem cookie retorna 403
(`application/problem+json`) e expira o cookie de state. O retorno válido é
303 para `/`, sem state no Location. O aceite real também usa os botões de
exportação/exclusão e saída da conta, verifica replay de cookies e confirma
que o IdP pede credenciais novamente depois da saída. Chamadas REST de aceite
não seguem redirects: uma sessão inválida deve retornar 401 na API, sem
converter o erro em HTML 200 do formulário de login. Os cookies de sessão/binding/state expiram
explicitamente. `OIDC_LOGOUT_CLEAR_SITE_DATA=cache,storage` evita apagar o cookie
de state antes da validação; não use `cookies` no começo desse fluxo.

## Exclusão durável e recuperação

A V007 cria a tabela privada `account_deletion`. A intenção de exclusão é
commitada antes da chamada ao IdP; o cascade dos dados e `local_deleted` são
commitados juntos. `completed_at` só é preenchido depois do cleanup Redis.
Uma falha transitória deixa a intenção para retry privado a cada 60 segundos,
em lotes de até 25, sem depender de novo login ou de uma API administrativa.
Falha do provedor retorna 503 e preserva imediatamente conta, sessão e dados;
a intenção persistente cobre também respostas ambíguas e interrupções.

Após concluir o cleanup, referências de usuário, identidade, CSRF e OIDC são
compactadas para null; o hash é mantido por oito horas. Para diagnosticar
progresso, use apenas contagens agregadas, sem selecionar essas referências:

```sql
SELECT local_deleted, completed_at IS NULL AS pending, count(*)
FROM account_deletion GROUP BY local_deleted, pending;
SELECT count(*) FROM flyway_schema_history WHERE version IN ('7', '007') AND success;
```

O backup completo inclui essa tabela; `verify-recovery.sh` exige V007 e sua
presença por padrão. Não apague intenções/tombstones para desbloquear login.
Veja [backup e restore](backup-restore.md) para o teste em destino isolado.

## Google e SMTP

Sem credenciais externas, e-mail/senha e cadastro funcionam localmente.
`./scripts/ops/configure-keycloak.sh diagnose` lista apenas presença/ausência de
configuração, nunca os valores. Para habilitar provedores, preencha as variáveis
`GOOGLE_*`/`SMTP_*` do `.env`, e execute `configure-keycloak.sh apply`.
O script usa o admin bootstrap somente para configuração operacional privada;
o backend usa o cliente técnico restrito. Contas e dados existentes são mantidos.

Cadastre no console Google o callback
`<OIDC_PUBLIC_ORIGIN>/realms/folhea/broker/google/endpoint`. Configure TLS, porta,
remetente e autenticação SMTP e valide a entrega no console administrativo.
Sem SMTP, o realm inicial mantém recuperação de senha escondida; o apply com
SMTP ativa essa opção. Google aparece no IdP somente depois de configurado.
Ausência de SMTP bloqueia o envio de recuperação de senha, não o login local.
O domínio DNS/HTTPS público, entrega OAuth/e-mail e storage S3 dependem de
credenciais/serviços do operador; não são simulados pela stack local.

## Versões verificadas em 11/10/2026

Metadados oficiais e manifests multiarch consultados: PostgreSQL **18.6**,
[Keycloak **26.8.0**](https://github.com/keycloak/keycloak/releases/tag/26.8.0),
[Caddy **2.11.7**](https://github.com/caddyserver/caddy/releases/tag/v2.11.7),
[Redis **8.10.2**](https://github.com/redis/redis/releases/tag/8.10.2),
[Temurin **27+35** GA](https://github.com/adoptium/temurin27-binaries/releases/tag/jdk-27%2B35)
e [Node **26.11.1**](https://nodejs.org/dist/index.json).
Os digests ficam fixados em Compose/Dockerfile; valide updates com
`docker buildx imagetools inspect` nos registros oficiais.

Java27 é a versão feature estável mais recente, sem preview habilitado;
Java25.0.4.1+1 continua sendo a última LTS, conforme o
[calendário Adoptium](https://adoptium.net/support/). O target27 e as imagens
JDK/JRE27 seguem a política `latest stable` autorizada para o projeto.
O PRD fonte conserva a referência25LTS para rastreabilidade; esta atualização
de toolchain exige os gates Quarkus3.40.1 e o aceite OIDC na JVM27.

As métricas do backend ficam em `/q/metrics`, na rede privada. O exportador
Prometheus é habilitado no build (`quarkus.micrometer.export.prometheus.enabled=true`);
não existe um toggle `METRICS_ENABLED` de runtime. `OTEL_SDK_DISABLED=true` mantém tracing
externo desligado até existir um coletor; defina `false` e
`OTEL_EXPORTER_OTLP_ENDPOINT` para habilitá-lo. Health e observabilidade não
são publicados pelo Caddy do produto.

O Caddy mantém emissão/renovação TLS automática, mas usa um redirecionamento
HTTP explícito para `OIDC_PUBLIC_ORIGIN`, incluindo a porta9443 no ambiente
local. Isso evita que o redirect automático do Caddy perca a porta publicada.

A etapa de build e o CI usam Node26.11.1 estável, verificado em
[releases oficiais](https://nodejs.org/dist/index.json) e pinado por digest na
imagem Docker. Angular22.2.2 aceita `^22.22.3 || ^24.15.0 || >=26.0.0`;
TypeScript6.0.3 satisfaz o peer `>=6.0 <6.1`. A escolha de26 segue a versão
estável mais recente; Node24.15+ também atende ao contrato de engines.
Os runtimes publicados pelo Compose contêm apenas Caddy, JVM e Keycloak.

No hot reload, `scripts/dev-backend.sh` usa `DEV_HTTP_PORT=8080` e ignora
o `HTTP_PORT` reservado ao Caddy. Se a stack original já ocupa5433/8180,
use a stack completa isolada em9443; não ative o override nessas portas.
Um ambiente separado de hot reload precisa configurar portas/origens e
credenciais da própria instância antes de conectar o Maven ao banco.

## Capas privadas de livros

As capas usam `book_cover` (`bytea`) no PostgreSQL existente. Não exigem S3,
volume de imagens, URL pública nem serviço externo. GET da capa verifica o
proprietário pelo livro e retorna `Cache-Control: no-store`/`nosniff`; capas não
entram no cache offline do service worker, cujas exclusões abrangem `/api/**`.
A prévia usa a política `img-src` já restrita à própria origem, `data:` e `blob:`.

O Caddy permite envelope **3MiB** apenas para `multipart/form-data` em
`POST /api/v1/books` e `PATCH /api/v1/books/{id}`. Outras rotas, métodos e
requisições JSON preservam o limite de **64KB** da borda. O backend mantém as
validações independentes: parte JSON até 8KiB; capa JPEG/PNG até 2MiB; lados até
4096 e total até 4.194.304 pixels, também limitando a imagem recodificada. Os
bytes da imagem ficam fora de respostas/listas de livros. Cadastro e edição
multipart são atômicos: falha de capa não deixa cadastro parcial.

O gate `node scripts/ci/tests/test-api-body-limits.mjs` usa Caddy real e um
upstream que conta somente bytes sintéticos para conferir esses limites e
headers. Ele não comprova autenticação ou dados da aplicação. O aceite com
Keycloak/PG real deve enviar uma imagem válida maior que 64KiB pela UI,
comparar o SHA da imagem persistida entre GET privado, exportação e restore,
e verificar CSRF, isolamento de duas contas e exclusão em cascata.

Para testar outra stack na mesma máquina, use outro projeto Compose, volumes,
rede, portas, segredos e CA. Prefira a origem `https://127.0.0.1:9444` quando a
stack habitual usa `https://localhost:9443`: cookies host-only e PWA não são
isolados por porta. Guarde env e credenciais de teste fora do git com modo
0600. Use o launcher com `FOLHEA_ENV_FILE=/caminho/privado/staging.env`; não
reutilize a identidade, o perfil do navegador ou os volumes de usuários reais.

### Aceite opt-in da estante em staging isolado

O helper `scripts/ci/e2e-bookshelf-real.mjs` recusa a origem canônica e usa somente
`https://127.0.0.1:9444`. A fase `bootstrap` requer a stack anterior V7 em volumes
novos: cria uma conta própria por cadastro/login reais e dados legados; `accept`
usa a stack V8, testa Canvas/multipart, métricas, ownership, export e cascatas.
As fases `covers`/`finish` permitem continuar probes já comprovados sem recriar
a identidade; `upload-failure` usa offline real do navegador, não resposta fake.
`legacy-ui` verifica seleção de livro fora dos primeiros 100. `baseline` compara
PG/GET/export e grava somente hashes/metadados em `E2E_REAL_BASELINE_FILE`.
`persistence` compara o export e a capa após restart. Use
`E2E_REAL_CREDENTIAL_FILE` apontando para um JSON privado fora do checkout
(diretório 0700/arquivo 0600). Nunca use uma conta do usuário nesses testes.
O observer do helper mede somente `File.size` no `FormData` real da UI; mantém a
serialização nativa e não simula respostas de API, BFF ou IdP. Ele evita a medida
incompleta de arquivos que Chromium expõe em `postDataBuffer` quando há SW.

No overlay privado de staging, configure `default_sni 127.0.0.1` no bloco global
do Caddy: clientes TLS que acessam um IP não enviam SNI. Conserve a CA e os
volumes exclusivos do staging. Não altere a origem/CA/cookies da stack canônica.

### Startup do gate Caddy na CI

O teste de limite multipart cria o Caddy em modo destacado: o pull/create tem
prazo de120s e precisa terminar antes de iniciar a readiness de60s. O cleanup
remove somente seu container temporário com prazo explícito, sem aguardar um
`docker run` que possa iniciar depois da remoção. A regressão
`test-caddy-startup.mjs` atrasa esse comando9s e executa os mesmos14casos reais;
exige conclusão/cleanup em20s. Nenhum status/limite ou scanner é ignorado.
O workflow conserva todos os gates e acrescenta essa regressão e prazos de steps.

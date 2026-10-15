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

## Contrato público e geração SEO (DOMINIO-01 B)

`shared/public-contract.json` contém a origem SEO e os IDs de problemas relativos.
O backend continua recebendo sua origem de runtime pelas variáveis documentadas;
o catálogo de build não altera OIDC, CSRF, cookies ou configuração do servidor.
Java `ProblemTypes` e TypeScript `PROBLEM_TYPES`/`PUBLIC_SITE_ORIGIN` são outputs
versionados, gerados pelo mesmo script. Comparadores usam igualdade exata aos
IDs `/problems/slug`, sem aliases de URLs absolutas.

Ao editar o catálogo, na raiz do repositório:

```sh
node scripts/ci/generate-public-contract.mjs
npm --prefix frontend run generate:seo
node scripts/ci/generate-public-contract.mjs --check
npm --prefix frontend run check:seo
node scripts/ci/validate-domain-surface.mjs
```

Commite o catálogo e os outputs Java, TypeScript, index, robots e sitemap juntos.
O CI verifica drift antes do build, porque o build regenera os assets SEO.
`validate-seo.mjs` lê a mesma `publicOrigin`, sem fallback de domínio ou override
`SEO_CANONICAL_ORIGIN`. `SEO_BASE_URL` continua sendo apenas o alvo opcional dos
checks HTTP; não redefine a origem dos metadados. Os testes negativos usam
origens reservadas genéricas. O gate de domínio examina todos os textos
rastreados, inclusive docs/specs/fixtures e pontos escapados; reporta só arquivo
e linha, ignora binários e recusa symlinks sem ler seus destinos.

O estágio frontend do Docker recebe somente o JSON no diretório irmão `shared`.
O gerador SEO não depende de Java nesse estágio. O check completo Java+TS roda
na raiz do CI; Maven isolado usa o Java já gerado e não exige Node.

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

### Origem pública e contato (DOMINIO-01 Parte A)

O domínio público é `PUBLIC_DOMAIN`. A origem principal é `PUBLIC_ORIGIN`;
`OIDC_PUBLIC_ORIGIN` permite uma origem diferente para o IdP quando o
desenvolvimento local usa portas distintas. Em produção, a origem
compartilhada parte do domínio:

```dotenv
PUBLIC_DOMAIN=folhea.app
PUBLIC_ORIGIN=https://${PUBLIC_DOMAIN}
```

O [`.env.example`](../.env.example) deriva `OIDC_PUBLIC_ORIGIN`, issuer,
authorization/logout e `SECURITY_CANONICAL_ORIGIN`/`SECURITY_ALLOWED_ORIGINS`
dessa origem. A stack Docker local usa explicitamente
`PUBLIC_ORIGIN=https://${PUBLIC_DOMAIN}:${HTTPS_PORT}` para seu listener TLS;
isso é diferente do desenvolvimento do backend sem edge, cujo padrão é
`http://localhost`. Sem origem explícita, produção exige `PUBLIC_DOMAIN`.
Overrides individuais existentes continuam válidos e não
devem ser regravados se já apontam corretamente para a mesma origem.
O [Compose faz a interpolação](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/):
não execute o arquivo privado como um script nem publique `compose config`
com valores de credenciais. Use `config --quiet` ou verificações em memória.

CORS permanece desabilitado na operação de mesma origem. O back-channel
`http://keycloak:8080/realms/folhea` permanece privado. Callback, web origins,+pós-logout e `frontendUrl` no export do realm usam o placeholder da origem
pública; a importação de inicialização não reconcilia um realm já povoado.
Se `frontendUrl` estiver ausente, aplique somente esse atributo pelo canal
administrativo privado, preservando os demais atributos, usuários e segredos.
Esta entrega não muda a política de cadastro.

Privacidade, termos e Sobre compartilham `LEGAL_CONTACT_EMAIL`, definido como
`contato@folhea.app`. O responsável confirmou em 14/10/2026 que a caixa existe
e recebe mensagens; a aplicação não cria a caixa nem altera DNS de e-mail.
Problem types e SEO pertencem à Parte B e não são alterados nesta entrega.

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
`folhea-registration` mantém seu identificador por compatibilidade de configuração,
mas é usado somente para excluir contas e retomar intenções duráveis V007.
Recebe somente `realm-management/manage-users`, sem `fullScopeAllowed`,
password grant ou fluxo de login. Seu secret é diferente do cliente BFF e o
atributo `access.token.lifespan` limita cada token de serviço a 300 segundos.
O backend também rejeita respostas de token com TTL fora de 1..300 segundos.
Não use esse cliente no cadastro: a senha vai diretamente ao Keycloak.
O gate `scripts/ci/validate-api-contract.mjs` verifica redirects de navegador,
GET CSRF e fontes de cookie/header/binding, além de recusar os POSTs de
cadastro aposentados, analytics e formulário de senha Angular.
`test-auth-contract.mjs` exerce a fonte atual e oito mutações negativas em
fixtures privadas, sem alterar a fonte real. Esses checks são estáticos:
o aceite continua exigindo cadastro/login na tela real do Keycloak e
inspeção de cookies/mutações na stack isolada.
Os templates habilitam `registrationAllowed` e `registrationEmailAsUsername`: o
Keycloak usa o e-mail como identificador, sem um username adicional no Angular.
Mantêm o tema padrão do IdP e
ligam `adminEventsEnabled`, com `adminEventsDetailsEnabled=false` para guardar
as ações administrativas sem persistir os corpos privados das requisições
([Keycloak: tokens e auditoria](https://www.keycloak.org/docs/latest/server_admin/index.html)).
O renderer JSON escapa segredos, substitui
a origem de callback/login/logout e grava o import com permissão 0600.
O `--import-realm` ignora realms existentes; reiniciar não aplica os novos
templates ([Keycloak: importação no boot](https://www.keycloak.org/server/importExport)).
Antes de usar AUTH-01 numa instalação existente, execute
`COMPOSE_ENV_FILE=/caminho/privado/staging.env scripts/ops/configure-keycloak.sh auth`
com a configuração do projeto correto e o Keycloak saudável. O helper usa a
Admin API privada para reconciliar cadastro/e-mail como identificador, login
por e-mail, tema padrão, auditoria administrativa sem detalhes, desativação de
password grant e o cliente exclusivo de exclusão/recovery com TTL de 300s.
Verifica a configuração efetiva e uma segunda execução não escreve novamente.
Atualiza somente esses campos e preserva usuários, credenciais, secrets,
callbacks, demais atributos de clientes e provedores existentes. Se os clientes
esperados estiverem ausentes ou ambíguos, falha antes de escrever. Requer o
administrador operacional configurado no arquivo privado, não o cliente de
serviço de exclusão. O launcher não aplica essa alteração automaticamente.
Nunca remova volumes nem delete/reimporte o realm com override para aplicar
configuração. Secrets não são girados por esse procedimento.
As credenciais operacionais são obtidas do modelo efetivo de
`docker compose config --format json`, capturado somente em memória. Isso mantém
a sintaxe de `.env`, interpolação `${VAR}` e precedência do ambiente do Compose
sem avaliar o arquivo como shell nem imprimir configuração ou credenciais
([Docker: interpolação](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)).

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

Nesse modo sem edge, ajuste as duas origens no arquivo `.env` privado antes
das linhas que derivam issuer, authorization/logout e origens de segurança:

```dotenv
PUBLIC_ORIGIN=http://localhost:4200
OIDC_PUBLIC_ORIGIN=http://localhost:8180
```

Mantenha as demais derivações do `.env.example`; configurações individuais
continuam sobrescrevendo os defaults. O perfil `%dev` não força mais as URLs
públicas por cima de valores explícitos do ambiente. Não use esse arquivo de
desenvolvimento no deploy HTTPS.

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
botão Entrar parece não fazer nada. O link Criar conta navega para
`/auth/register`, que abre o cadastro do Keycloak. `/auth/login` abre o login;
`/auth/reauthenticate` pede novamente a senha no IdP antes da confirmação de
exclusão quando `auth_time` tem mais de 300 segundos. O Folhea não recebe
senha. O cliente técnico é exclusivo da exclusão e da recuperação V007.
O console na porta8180 pertence apenas ao override de desenvolvimento.

## Health checks e diagnóstico

O Quarkus expõe apenas na rede interna:

```text
/q/health/live   processo disponível
/q/health/ready  processo e dependências prontas, incluindo PostgreSQL
```

O Caddy expõe `/healthz` para seu próprio healthcheck. O endpoint não substitui
`/q/health/ready` no monitoramento do deploy.

No standalone, o domínio atende `/healthz` em um `handle` antes do fallback
estático; o listener interno `:81` mantém seu handler e redirecionamento.
No perfil NPM, o health local continua disponível em loopback. A resposta pública
é liberada somente após validar o peer NPM e o Host canônico, com corpo vazio,
status 200 e `Cache-Control: no-store`, sem consultar backend ou Keycloak.
Outros peers continuam 403, Host inválido 421 e endpoints administrativos e `/q`
continuam 404. Rotas privadas `/app/*` mantêm o shell CSR; URLs públicas
inexistentes mantêm o 404 real e a página de erro existentes.

Depois do merge, checks da MAIN e aplicação da configuração na release própria,
o operador configura as variáveis **não secretas** do repositório:

```text
PRODUCTION_HEALTH_URL=https://folhea.app
PRODUCTION_HEALTH_PATHS=/healthz
```

O job `health-check` verifica a URL quando configurada mesmo sem hook. Isso não
ativa o hook, não executa POST nem transforma health de borda em readiness de
dependências. Preferir reexecutar somente esse job para comprovar a configuração,
preservando os gates/deploy existentes. Escolher um run MAIN que já contenha
FIX-03: reruns preservam o SHA/REF original. Obter o `databaseId` do job, não um
número inferido da URL:

```sh
gh run view RUN_MAIN_FIX03 --json jobs \
  --jq '.jobs[] | select(.name == "production health check") | .databaseId'
gh api --method POST repos/OWNER/REPO/actions/jobs/DATABASE_ID/rerun
```

O endpoint oficial reexecuta o job e seus descendentes; este health é terminal
no DAG atual e não requer reexecutar ancestors release/deploy. A documentação
não garante explicitamente o frescor de variáveis alteradas entre run e rerun;
confirmar pela execução efetiva, sem presumir. Não ativar hook ou disparar um
workflow completo para contornar essa condição. Antes, conferir 200 direto com TLS normal
e sem seguir redirects; o checker atual aceita 2xx e segue redirects, portanto
seu EXIT0 isolado não é prova de 200 direto:

```sh
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' https://folhea.app/healthz)" = 200
HEALTHCHECK_URL=https://folhea.app HEALTHCHECK_PATHS=/healthz \
  HEALTHCHECK_ATTEMPTS=1 node scripts/ci/health-check.mjs
```

O gate `test-caddy-health.mjs` exercita Caddy real e os handlers standalone/:81;
`test-npm-proxy.mjs` cobre health público/local e rejeições de peer/Host, sem
chamar upstream no health. O CI reutiliza a imagem Caddy já construída para ambos,
sem novo build de produto. As portas dos testes são efêmeras em loopback; os
containers próprios são limitados a 128 MiB e 0,5 CPU e removidos no finally. Esses
gates locais não comprovam TLS público ou aplicação da configuração no servidor.

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

O backup completo inclui essa tabela. O guard padrão de `verify-recovery.sh`
exige Flyway V007/V008/V009/V010 com sucesso (formatos sem padding ou `007`,
`008`, `009`, `010`), V010 do tipo `JDBC`, as tabelas `folhea_user`,
`account_deletion` e `book_photo`, coluna de imagem `bytea` e a
**ausência** de `password_hash` e `login_identifier`. A V009 remove somente
as credenciais delegadas antigas; não edite checksums das V001..V008.
O teste PostgreSQL existente cobre versões ausentes/falhas e colunas antigas
reintroduzidas mesmo com V009 marcada bem-sucedida.
Não apague intenções/tombstones para desbloquear login.
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

Em 15/10/2026, a etapa de build e o CI foram alinhados ao Node26.12.0 estável, verificado em
[releases oficiais](https://nodejs.org/dist/index.json) e pinado por digest na
imagem Docker. Angular22.2.3 aceita `^22.22.3 || ^24.15.0 || >=26.0.0`;
TypeScript6.0.3 satisfaz o peer `>=6.0 <6.1`. A referência Node26.11.1 na lista de 11/10 acima é histórica. A escolha de26 segue a versão
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
requisições JSON preservam o limite de **64KiB (65.536 bytes)** da borda. O backend mantém as
validações independentes: parte JSON até 8KiB; entrada de imagem até
**1.000.000 bytes**, **16.384 pixels por lado** e **24.000.000 pixels** tanto no
multipart quanto no PUTRAW. Excesso de bytes retorna413; excesso de dimensões ou
pixels retorna400 com o mesmo detail nos dois caminhos. Os formatos existentes
são preservados: JPEG/PNG no multipart, JPEG/PNG/WebP no PUT. A saída normalizada
é JPEG sem EXIF, até1.000.000 bytes e1.600 pixels por lado. Os bytes ficam fora
de respostas/listas de livros. Cadastro e edição multipart são atômicos: falha
de capa não deixa cadastro parcial.

A V010 usa um algoritmo privado e congelado no pacote de migração, sem depender
do normalizador HTTP atual. O backfill conserva entrada legada de **2 MiB**,
**16.384 pixels por lado** e **24.000.000 pixels**, distinta do limite HTTP de
1.000.000 bytes. Mantém o checksum Java NULL já aplicado; V001..V009 permanecem
intactas. A mudança dos limites HTTP não redefine a conversão de capas antigas
e não cria uma V011.

O gate `node scripts/ci/tests/test-api-body-limits.mjs` usa Caddy real e um
upstream que conta somente bytes sintéticos para conferir esses limites e
headers. Ele não comprova autenticação ou dados da aplicação. O aceite com
Keycloak/PG real deve enviar uma imagem válida maior que 64KiB pela UI,
comparar o SHA da imagem persistida entre GET privado, exportação e restore,
e verificar CSRF, isolamento de duas contas e exclusão em cascata.

### Fotos privadas de LIVRO-02

`PUT /api/v1/books/{UUID}/photo` recebe a imagem RAW com limite próprio de
**1.000.000 bytes**. MIME e assinatura são validados pelo backend: um arquivo
inválido dentro do limite chega à resposta `415`. As demais rotas de API
continuam limitadas a **65.536 bytes**, e o envelope multipart legado mantém
3MiB. Não envie a imagem como JSON/base64 nem altere o boundary multipart da
compatibilidade existente.

Somente `GET` de foto com status `200` ou `304` usa
`Cache-Control: private, no-cache, max-age=0, must-revalidate`. O proxy preserva
o ETag, status e corpo do backend; `401`, `404` e outros erros continuam
`no-store`. A propriedade do livro deve ser verificada pelo backend antes de
avaliar `If-None-Match`, inclusive quando duas contas tenham a mesma imagem.
O cabeçalho é definido no envio da resposta, após os headers do upstream, e a
resposta é copiada uma única vez, evitando duplicar `Cache-Control` ou headers
de tamanho do corpo.
As APIs continuam excluídas do service worker: cache privado com revalidação
HTTP não autoriza armazenamento offline da foto no PWA.

O gate de borda inclui os limites exatos de RAW/JSON e a combinação de método,
path e status de cache com respostas sintéticas de upstream. Ele comprova o
proxy, não autenticação, autorização, formato de imagem ou migração. Essas
provas exigem a stack real e o Flyway/JVM para executar V010; aplicar arquivos
`.sql` pelo psql não executa uma migração Java.
O scanner de contratos exige GET/PUT/DELETE de `/photo`: o GET aceita a URL
declarativa usada pelo `<img>`, e cada método é associado à sua rota backend.
As regressões negativas do scanner preservam as verificações AUTH anteriores;
esse gate estático não substitui a prova de sessão, propriedade e ETag no stage.
O SQL padrão compartilhado está em `scripts/ops/verify-recovery.sql` e é
avaliado pelo teste `BookPhotoMigrationTest` após o Flyway real. As regressões
shell V009 continuam explícitas e o fixture somente SQL deve falhar no guard
atual; ele não cria sucesso V010 nem tabela de foto para simular o JVM.

Para testar outra stack na mesma máquina, use outro projeto Compose, volumes,
rede, portas, segredos e CA. Prefira a origem `https://127.0.0.1:9444` quando a
stack habitual usa `https://localhost:9443`: cookies host-only e PWA não são
isolados por porta. Guarde env e credenciais de teste fora do git com modo
0600. Use o launcher com `FOLHEA_ENV_FILE=/caminho/privado/staging.env`; não
reutilize a identidade, o perfil do navegador ou os volumes de usuários reais.

### Aceite opt-in da estante em staging isolado

Execute o **arquivo do repositório** `scripts/ci/e2e-bookshelf-real.mjs` contra uma
stack atual, nova e exclusiva: `https://127.0.0.3:9446`, projeto
`folhea-fix02`, HTTP9083, volumes/rede/segredos/CA próprios. O script recusa outras
origens, incluindo as stacks já existentes em localhost:9443,
127.0.0.1:9444 e 127.0.0.2:9445. Cookies host-only não são isolados por porta.
Não reutilize credenciais, contas, perfil de navegador ou volumes de usuários.

A stack deve estar saudável com as imagens construídas da fonte que será
verificada; o backend aplica as migrações do zero pelo Flyway/JVM. O aceite não
marca migrações no banco nem simula migrações Java por psql. Comparações de
migração de capas legadas pertencem ao teste Flyway real, não às antigas fases
V7/V8 do helper, agora aposentadas.

Na raiz do checkout, com dependências do frontend e Chromium do Playwright já
instalados, rode este comando (caminhos sem valores secretos):

```bash
mkdir -p "$HOME/.config/folhea/fix02-stage/acceptance"
chmod 700 "$HOME/.config/folhea/fix02-stage/acceptance"
E2E_REAL_URL=https://127.0.0.3:9446 \
E2E_REAL_CA_FILE="$HOME/.config/folhea/fix02-stage/caddy-root.crt" \
E2E_REAL_CREDENTIAL_FILE="$HOME/.config/folhea/fix02-stage/acceptance/accounts.json" \
node scripts/ci/e2e-bookshelf-real.mjs accept
```

O script gera as credenciais das próprias fixtures em memória e as guarda somente
nesse arquivo privado 0600, fora do Git. Não usa email/senha de operador. Cada
execução concluída exclui suas duas contas e livros/fotos pelo fluxo normal;
para executar novamente, forneça **outro nome de arquivo privado**, preservando
os registros anteriores. Falha na execução ou no cleanup termina com EXIT1 e
uma categoria/etapa sanitizada. EXIT0 e o último PASS comprovam o arquivo inteiro,
não apenas uma fase de um harness auxiliar.

Cadastro abre `/auth/register` e preenche email/senha/confirmação somente no
formulário do Keycloak; login real abre `/auth/login`. Cookies de sessão/binding
continuam HttpOnly; `__Host-folhea_csrf` é legível, Secure/Lax e seu valor é usado
no header das mutações. A exclusão das fixtures faz novo login real para atender
`auth_time` recente, sem contornar o guard. Quotas de produção são preservadas:
as mutações são espaçadas e respostas429 obedecem Retry-After com retry limitado.

A verificação usa somente os campos oficiais **top-level** do livro:
`pagesRead`, `averagePagesPerReadingDay` e `progressPercent`. Inclui null sem
leituras com páginas, minutos-only fora do denominador, 75 páginas em duas datas
=37,5, sessões na mesma data, edição/exclusão, floor/cap100 e ausência de
finalização automática. Não usa média por dias corridos nem fallback de stats.
Cadastro de livro/foto pela UI usa o contrato atual POSTJSON seguido de PUTRAW;
verifica capa privada, propriedade404, CSRF403, outro login, bytes persistidos
iguais no GET/export, export byte-estável sem métricas dinâmicas,390/1440 sem
overflow e nenhuma API no cache do service worker. Não intercepta/responde
requisições HTTP/IdP, forja cookies, grava traces ou screenshots.

Extraia previamente a CA pública do Caddy dessa stack para `E2E_REAL_CA_FILE`.
O script valida a conexão TLS contra essa CA e fixa o SPKI do certificado de
servidor verificado apenas no Chromium temporário. Também acrescenta a mesma CA
às CAs padrão **somente da thread Node do helper**, preservando as existentes,
para as chamadas `context.request` do Playwright. Usa
[`tls.setDefaultCACertificates`](https://nodejs.org/api/tls.html#tlssetdefaultcacertificatescerts),
disponível no Node26 do projeto; não instala certificados no sistema/perfil do
usuário. Assim, API e worker mantêm verificação TLS sem `ignoreHTTPSErrors` ou
`NODE_TLS_REJECT_UNAUTHORIZED=0`.
No overlay privado, configure `default_sni 127.0.0.3` no bloco global do Caddy:
clientes TLS que acessam um IP não enviam SNI. Preserve a CA e os volumes dessa
stack; não altere origem/CA/cookies das outras instalações. A validação TLS do
operador deve usar a CA pública própria, nunca a configuração de um outro ambiente.

### Startup do gate Caddy na CI

O teste de limite multipart cria o Caddy em modo destacado: o pull/create tem
prazo de120s e precisa terminar antes de iniciar a readiness de60s. O cleanup
remove somente seu container temporário com prazo explícito, sem aguardar um
`docker run` que possa iniciar depois da remoção. A regressão
`test-caddy-startup.mjs` atrasa esse comando9s e executa os mesmos14casos reais;
exige conclusão/cleanup em20s. Nenhum status/limite ou scanner é ignorado.
O workflow conserva todos os gates e acrescenta essa regressão e prazos de steps.

## Deploy em host compartilhado com PostgreSQL externo

O perfil `docker-compose.external-pg.yml` +
`docker-compose.external-pg.runtime.yml` gerencia **somente** backend, Keycloak,
Redis e Caddy do Folhea. O Nginx Proxy Manager continua responsável pelo TLS
público. Apenas Caddy entra na rede externa do proxy, com alias `folhea-caddy` e
porta interna 80. Somente backend e Keycloak entram na rede privada do PostgreSQL.
Não combinar esse perfil com os overlays de PostgreSQL gerenciado. O perfil
standalone continua separado.

A engine única é `scripts/ops/deploy-folhea.py`. Ela não provisiona servidor,
configura DNS/NPM, altera PostgreSQL compartilhado, faz build remoto ou publica
imagens em registry. O transporte é `docker save | SSH docker load`, com
host key estrita, imagens imutáveis, manifesto e checksums. O identificador de
configuração escaneado e o identificador runtime do Docker/containerd são
preservados separadamente e vinculados pela atestação de exportação da imagem.

### Configuração explícita e privada

Não há destino SSH, usuário ou diretório de produção embutido no programa.
Escolha um diretório absoluto exclusivo cujo último componente seja `folhea` e
um projeto Compose `folhea` ou `folhea-<sufixo>`. O diretório remoto deve pertencer
ao operador, modo 0700; `production.env` e os recibos privados, modo 0600. Não
transportar `production.env` no bundle, nem usar credenciais em argumentos,
build args ou logs.

Além das origens canônicas descritas acima, o arquivo privado deve declarar os
metadados observados `NPM_PROXY_CONTAINER`, `NPM_PROXY_CONTAINER_ID`,
`NPM_PROXY_IP`, `NPM_PROXY_NETWORK`, `EXTERNAL_PG_CONTAINER`,
`EXTERNAL_PG_CONTAINER_ID`, `EXTERNAL_PG_IMAGE_ID`, `EXTERNAL_PG_HOST`,
`EXTERNAL_PG_NETWORK`, `EDGE_SUBNET`, `BACKEND_IPV4` e `CADDY_EDGE_IP`. Não adivinhar esses valores:
a engine confere container, imagem, saúde, rede e o peer único do proxy antes de
alterar recursos Folhea. O BFF confia somente no IPv4 dedicado do Caddy; o Caddy
valida Host e peer, reconstrói HTTPS canônico e encaminha o IP de cliente conforme
o contrato NPM, preservando limites, cache privado e endpoints administrativos
externos 404.

Backend e Caddy usam IPv4 explícitos na rede edge, preservando o alias
`backend-edge`. `BACKEND_IPV4` é obrigatório neste perfil, sem usar o fallback
standalone; ambos os endereços devem pertencer à faixa utilizável de
`EDGE_SUBNET`, sem duplicação. O guard rejeita backend ou Caddy dinâmico, IP
fora da faixa, gateway reservado, duplicação ou alias incorreto antes de iniciar serviços.

Isso evita que um backend criado primeiro receba por alocação dinâmica o endereço
reservado ao Caddy: declarar o IP estático de um serviço no Compose não o reserva
antecipadamente para outros containers. Ao atualizar uma instalação existente,
confira os dois IPs próprios já usados e mantenha-os; não recrie a rede nem altere
endereços de outros sistemas para satisfazer o guard.

O gate `scripts/ci/tests/test-npm-proxy.mjs` também cria uma rede interna e dois
containers descartáveis limitados, com a imagem Caddy já construída: inicia
primeiro o backend sintético e depois o Caddy, usando os endereços do perfil
Compose renderizado. Ambos devem iniciar com IPs distintos, e o `finally` remove
somente esses recursos. Para rodar apenas essa regressão, sem repetir os testes
HTTP: `CADDY_TEST_IMAGE=sha256:<ID completo> node scripts/ci/tests/test-npm-proxy.mjs --ipam-only`.
O processo executado nesses containers é apenas `sleep`; esse gate verifica
alocação de rede e não substitui os aceites HTTP, backend ou autenticação.

O banco compartilhado continua PostgreSQL **16.13**, sem novo serviço, volume,
publicação de porta ou ciclo de vida Folhea. Os pares exclusivos são
`folhea/folhea_app` e `folhea_keycloak/folhea_keycloak`, owners com markers próprios,
sem privilégios globais elevados. O helper `folhea-postgres.py` exige container e
redes explícitos; seu default é plano sem SQL. `--check` é catálogo/configuração;
`--apply` só cria os objetos ausentes e nunca toma posse ou gira senha de objetos
existentes. O init de cluster standalone não é executado no compartilhado.

Os pools são limitados a 10 conexões no backend (mínimo/inicial 0) e 10 no
Keycloak (mínimo/inicial 1). O preflight exige margem no servidor compartilhado,
sem alterar `max_connections`, ACL global, HBA, roles ou dados de outros sistemas.

### Preparar e transferir

Com HEAD limpo/commitado, toolchains locais do projeto e Trivy disponíveis no
PATH **somente do processo**, execute as fases explicitamente. Use cache Trivy
próprio gravável; não ignorar severidades ou reutilizar o cache de outro usuário.
Os valores abaixo são exemplos não operacionais, sem credenciais:

```bash
SOURCE="$(git rev-parse HEAD)"
DEPLOY_HOST='operator@server.example'
DEPLOY_ROOT='/srv/folhea'
DEPLOY_ADDRESS='192.0.2.10'
DEPLOY_PROJECT='folhea-prod'
TARGET=(--host "$DEPLOY_HOST" --remote-root "$DEPLOY_ROOT" \
  --project-name "$DEPLOY_PROJECT" --server-address "$DEPLOY_ADDRESS")
OUTPUT="$HOME/.local/state/folhea/packages/$SOURCE"

# Puro: não consulta Git, rede, Docker, banco ou arquivo de configuração.
python3 -B scripts/ops/deploy-folhea.py --dry-run --source "$SOURCE" "${TARGET[@]}"

# Local: testes, builds sequenciais, scans e bundle; output deve ser novo e fora do Git.
python3 -B scripts/ops/deploy-folhea.py --prepare --source "$SOURCE" --output "$OUTPUT"

# Remoto: recebe/verifica release e imagens; NÃO inicia serviços.
python3 -B scripts/ops/deploy-folhea.py --transfer --source "$SOURCE" \
  --bundle "$OUTPUT/release" "${TARGET[@]}"
```

O `--prepare` não tem flags para omitir testes/scans. Usa o PostgreSQL 16 local de
teste equivalente, nunca o volume compartilhado. O manifesto permite exatamente
os arquivos públicos do runtime e as quatro imagens. `--reuse-transferred-from`
é exclusivo para os mesmos quatro config digests já carregados e novamente
atestados; não aceita igualdade apenas de tags. Não usar `prune` global.

#### Uso diário pelo shell

Para publicar com **uma chamada**, configure o alvo uma única vez:

~~~bash
install -d -m 700 "$HOME/.config/folhea"
install -m 600 scripts/ops/deploy-config.example.json "$HOME/.config/folhea/deploy.json"
# Edite esse JSON com o alvo autorizado e output_parent absoluto/privado/próprio.
# O exemplo usa host/IP reservados e não é uma configuração operacional.
~~~

O JSON contém somente host, remote_root, project_name, server_address e
output_parent. O arquivo precisa ser regular, próprio e modo 0600; campos
extras são recusados. Não coloque senha, token, chave ou conteúdo de
production.env nele. Ele é lido como dados JSON, nunca com source/eval.

Num checkout limpo e commitado da versão revisada, com os gates de CI aprovados
e toolchains/cache disponíveis, este comando **executa o deploy de produção**:

~~~bash
./scripts/ops/deploy-folhea.sh --production
~~~

Para escolher outro arquivo, use --production --config /caminho/privado/deploy.json.
FOLHEA_DEPLOY_CONFIG também seleciona esse arquivo, sem alterar o PATH global.
Para **somente simular**, sem terminal, SSH, Docker, build ou escrita:

~~~bash
./scripts/ops/deploy-folhea.sh --production --dry-run
~~~

A produção valida configuração, HEAD limpo e terminal **antes** de gastar com
build ou acessar o servidor. O source padrão é esse HEAD; --source SHA40 precisa
corresponder a ele. Observa e verifica a release ativa e usa seu SHA como
expected-current em todo o restante do fluxo. --expected-current SHA40
opcional também pode fixar o valor esperado pelo operador; uma divergência
interrompe antes de preparar.

O comando conduz, em ordem: preflight próprio, prepare local e transfer pela
engine, dois backups reais PG16 e cópias privadas/guards pelos helpers existentes,
resumo de previous/candidata/caminhos/checksums e **revisão explícita do operador**.
Somente após digitar PUBLICAR, declarando que revisou código, migrations,
Keycloak e plano de recuperação dessa candidata, delega record-backup-review e
activate upgrade à mesma engine. O prompt não decide ou comprova compatibilidade
por você. Não há aprovação antecipada ou não interativa nesse modo.

Os backups usam apenas APP folhea/folhea_app e KC folhea_keycloak/folhea_keycloak;
endpoint/identidade PG vêm do modelo privado validado pela engine em memória.
Dumps, sidecars e cópias ficam em diretórios novos próprios sob
REMOTE_ROOT/backups, com modos 0700/0600 e nomes reais do helper. A cópia local
não é offsite; dumps sequenciais não provam consistência entre os bancos,
restore ou RTO. O recibo só é criado pela engine depois da declaração explícita
e da validação dos dumps/TOC/hashes/históricos.

Cancelamento, erro, current alterado ou perda da revisão impede ativar; bundle,
backups e recibos existentes são preservados. Não há retry cego ou cleanup
global. Não repita uma transferência já concluída sem investigar a fronteira
da falha; os modos avançados abaixo permanecem disponíveis. Depois de um
activate iniciado, journal/rollback e recusa de downgrade continuam na engine.
Nenhum ciclo de vida de NPM, PG compartilhado ou outros sistemas foi acrescentado.

##### Modos avançados preservados

`scripts/ops/deploy-folhea.sh` é uma interface fina dessa mesma engine Python.
O padrão é **PLANO**, sem SSH, Docker, testes ou escrita. Com `--source` completo,
nem Git ou outros subprocessos são chamados; sem essa opção, o shell lê o HEAD
e o status do checkout do próprio script com Git, sem atualizar o índice.
Na execução, a fonte precisa ser o HEAD limpo/commitado desse checkout, mesmo
quando informada explicitamente. O script funciona por caminho absoluto fora
da raiz, mas não aceita symlink ou engine não versionada/alterada. O plano não
comprova validade do alvo, dos dumps ou do recibo: a engine aplica esses guards
quando a ação é executada.

Há três ações separadas: `--stage` (padrão) prepara e transfere, **PARA e NÃO
publica a versão**; `--review` pede à engine da candidata o registro da revisão;
`--activate` pede o upgrade com o recibo. **Só `--execute` permite executar a ação
selecionada.** Não há modo `all`, confirmação automática, bypass de gates,
instalação inicial, recuperação ou otimização de transporte implícita.

Na raiz de um checkout limpo, reutilize o mesmo alvo explícito nos três comandos.
Os exemplos usam endereço e host reservados, sem destino privado embutido:

```bash
SOURCE="$(git rev-parse HEAD)"
PREVIOUS='<SHA40 confirmado em current>'
DEPLOY_ROOT='/srv/folhea'
TARGET=(--host 'operator@server.example' --remote-root "$DEPLOY_ROOT" \
  --project-name 'folhea-prod' --server-address '192.0.2.10')
OUTPUT="$HOME/.local/state/folhea/packages/$SOURCE"
REVIEW="$DEPLOY_ROOT/receipts/$SOURCE.backup-review.json"
APP_DUMP="$DEPLOY_ROOT/backups/$SOURCE/<nome-real-do-dump-app>"
IDP_DUMP="$DEPLOY_ROOT/backups/$SOURCE/<nome-real-do-dump-kc>"

# Plano puro: nenhum build ou acesso ao servidor.
./scripts/ops/deploy-folhea.sh --source "$SOURCE" "${TARGET[@]}" --output "$OUTPUT"

# 1. Executa os gates/builds da engine e transfere a candidata; NÃO ativa.
./scripts/ops/deploy-folhea.sh --execute --stage --source "$SOURCE" \
  "${TARGET[@]}" --output "$OUTPUT"

# PARE: crie os dois backups reais PG16 conforme a seção abaixo. Confirme os
# nomes dos dumps e current; revise schema/dados. O shell não faz isso por você.
# 2. SOMENTE após essa revisão humana, registre-a junto aos dois dumps reais.
./scripts/ops/deploy-folhea.sh --execute --review --source "$SOURCE" \
  "${TARGET[@]}" --expected-current "$PREVIOUS" --app-backup "$APP_DUMP" \
  --idp-backup "$IDP_DUMP" --backup-evidence "$REVIEW" --schema-compatible-reviewed

# 3. Use o mesmo source/alvo/current e o recibo validado para pedir o upgrade.
./scripts/ops/deploy-folhea.sh --execute --activate --source "$SOURCE" \
  "${TARGET[@]}" --expected-current "$PREVIOUS" --backup-evidence "$REVIEW" \
  --schema-compatible-reviewed
```

Retire `--execute` ou use `--dry-run` para apenas planejar qualquer uma dessas
ações; não combine os dois. As opções de revisão são obrigatórias para review e
activate e representam uma declaração do operador, **não aprovação calculada
pelo shell**. A engine valida os dois dumps, hashes, privacidade, histórico,
current e vínculo do recibo antes de registrar/ativar. O shell não gera recibo,
nesses modos não cria backups, não prova restore/RTO, não decide compatibilidade e não faz
downgrade de banco. Uma falha interrompe a sequência e preserva o código de
saída da engine/SSH, sem transferir, revisar ou ativar automaticamente depois.
Depois de `stage`, não o repita para uma candidata já transferida: a engine não
sobrescreve releases. Investigue a falha e use a fase apropriada documentada.

Não há `--env-file` nessa CLI: somente a engine remota lê e valida
`REMOTE_ROOT/production.env` existente, privado e próprio. O shell não lê,
sourceia, imprime ou transporta esse arquivo. Se necessário, prefixe `PATH`,
`JAVA_HOME` e `TRIVY_CACHE_DIR` somente no comando com suas toolchains e cache
próprio gravável; o shell não instala ferramentas nem muda o PATH global.
Manifesto/OCI, CAS, namespace, recursos, backups e rollback continuam sendo
responsabilidade da engine. NPM, PostgreSQL compartilhado e outros sistemas não
recebem comandos de ciclo de vida desse wrapper.

### Backup e revisão antes de upgrade

`--expected-current` é o SHA completo da release atualmente ativa, não a revisão
que se deseja instalar. `--schema-compatible-reviewed` é uma declaração explícita
do operador **após** revisar compatibilidade e o plano de dados; não comprova
compatibilidade, CI, backup ou restore por si só. Não passar essa declaração para
uma migração desconhecida. Alteração de versão do Keycloak ou Redis requer plano
separado. Não há downgrade automático de banco.

Antes de ativar, criar dumps separados APP e KC com os scripts reais do runtime.
Para o transporte externo, fornecer `OPS_EXTERNAL_POSTGRES_CONTAINER`,
`OPS_EXTERNAL_POSTGRES_CONTAINER_ID` e `OPS_EXTERNAL_POSTGRES_IMAGE_ID`, além do
par `DB_NAME/DB_USERNAME` correto. `ops_postgres_exec` usa `docker exec` diretamente
no container observado **somente para clientes PG16** (`pg_dump`, `pg_restore`,
`psql`, `pg_isready`), nunca `compose exec --service` de outro projeto. Não copiar
PGDATA ou usar cliente PG18 para restaurar no PG16; não filtrar erros/GUCs.

Definir `COMPOSE_FILE` para o perfil externo do runtime e `COMPOSE_ENV_FILE` para
o arquivo privado próprio. Para cada um dos dois pares, executar
`backup-postgres.sh --output-dir <raiz>/backups/<candidate>` e
`--external-destination file://<cópia-privada-própria>`. Diretórios 0700, dumps e
sidecars 0600. A cópia deve diferir da origem; uma cópia local não é offsite. Não
executar dump/restore de cluster, globals ou bancos de outros sistemas. Dumps
`--no-owner --no-privileges` exigem owners/grants próprios previamente preparados.

Registrar a revisão no servidor usando a engine da **candidata já transferida**:

```bash
PREVIOUS='<SHA completo confirmado em current>'
REVIEW="$DEPLOY_ROOT/receipts/$SOURCE.backup-review.json"
ENGINE="$DEPLOY_ROOT/releases/$SOURCE/scripts/ops/deploy-folhea.py"

# printf %q protege os argumentos ao compor o comando remoto, sem segredos.
printf -v REMOTE '%q ' python3 -B "$ENGINE" --record-backup-review \
  --source "$SOURCE" --expected-current "$PREVIOUS" --schema-compatible-reviewed \
  --app-backup "$DEPLOY_ROOT/backups/$SOURCE/app.dump" \
  --idp-backup "$DEPLOY_ROOT/backups/$SOURCE/idp.dump" \
  --backup-evidence "$REVIEW" "${TARGET[@]}"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$DEPLOY_HOST" "$REMOTE"
```

Usar os **nomes reais** produzidos pelo script de backup, não renomear outro dump
para fazê-lo passar. O registro valida TOC com `pg_restore16`, banco de origem e
versão do cliente, hashes dos dois dumps, privacidade e vínculo com previous,
candidate, alvo, env e históricos Flyway/Liquibase. Recibo novo, sem sobrescrita.
Isso não demonstra snapshot consistente entre os dois bancos, restore testado,
RTO ou aprovação automática de mudanças de esquema.

### Ativação e recuperação

```bash
printf -v REMOTE '%q ' python3 -B "$ENGINE" --activate --source "$SOURCE" \
  --installation upgrade --expected-current "$PREVIOUS" \
  --schema-compatible-reviewed --backup-evidence "$REVIEW" "${TARGET[@]}"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$DEPLOY_HOST" "$REMOTE"
```

Sob lock próprio, o upgrade verifica CAS de current, manifesto, atestação de
imagens, ownership e snapshot saudável dos quatro serviços, configuração privada,
peers, histórico e evidência de backup **antes** da parada. Grava journal 0600 por
rename atômico, com fsync de arquivo/diretório; para somente backend, Keycloak e
Caddy Folhea. Redis continua rodando. NPM, PostgreSQL e outros projetos nunca
entram em stop/up/snapshot/rollback Folhea.

Após a parada, mede **MemAvailable real**. Mantém o piso de soma dos quatro
limites finitos efetivos + **512 MiB**, e disco livre **8 GiB**. As quotas atuais
somam 2304 MiB; o piso é **2816 MiB**. Não credita aritmeticamente a memória que
supostamente seria liberada, não diminui margem nem limpa caches globais. Se
continuar insuficiente, restaura e verifica previous sem iniciar candidate e
sem alterar current. Há indisponibilidade temporária própria durante o upgrade;
não é blue/green nem garantia de tempo de recuperação.

Falha parcial, timeout e sinais capturáveis acionam restauração dos writers
anteriores quando a configuração e os históricos ainda permitem. Depois que a
candidata puder ter executado, primeiro para e confirma a parada de todos os
writers próprios, depois aguarda a ausência de conexões dos dois roles Folhea
no PostgreSQL, com prazo limitado e consultas somente leitura. Só então compara
os históricos estáveis; falha na parada, confirmação ou espera impede iniciar
previous. Histórico diferente impede downgrade: writers
próprios ficam parados e journal exige recuperação manual. Nunca restaurar dados
automaticamente para satisfazer um guard. Somente promover current após saúde
interna, HTTPS/status canônicos e imagens runtime exatas.

SIGKILL, queda do processo ou energia não permitem promessa de trap. O journal
pendente bloqueia nova ativação. Para recuperar, investigar a causa e executar
explicitamente a engine da candidata com `--recover --source "$SOURCE"`,
`--expected-current "$PREVIOUS"` e os mesmos argumentos `TARGET`. Ela revalida
alvo, env, manifests/imagens, backup e históricos antes de restaurar previous;
quando a candidata foi iniciada, aplica a mesma parada confirmada e espera das
conexões próprias antes da leitura dos históricos, inclusive após timeout/crash;
se esses vínculos mudaram ou os schemas divergiram, recusa downgrade. Não apagar
journal para contornar a proteção. O estado final e o aceite real de OIDC/CSRF e
dados precisam ser conferidos separadamente; homepage 200 não comprova login.

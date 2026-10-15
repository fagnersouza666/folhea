# DEPLOY-01 Ambiente de teste no servidor atual (NPM e PostgreSQL compartilhados)

Status: Versão final aguardando ok do Mestre

Base: decisões do Arquiteto de 14/10/2026 (comentário no card e respostas às perguntas do Analista) e código do repo em `main` (b10e387). Substitui o plano antigo de VPS exclusiva, que não deve ser implementado.

## Objetivo

Colocar o Folhea no ar em https://folhea.app como ambiente de teste fechado (não é produção pública), no servidor que já roda o AcertoAPP, com deploy automático pelo CD, sem expor segredos no repo público e sem afetar o AcertoAPP.

## Contexto

- Não há VPS exclusiva. O servidor atual tem um Nginx Proxy Manager (NPM) que termina o TLS de todos os sites e um PostgreSQL usado pelo AcertoAPP.
- Hoje o `docker-compose.yml` sobe o próprio `postgres` (com o init `infra/postgres/init/10-keycloak-database.sh`), `keycloak`, `redis`, `backend` e `caddy`. O Caddy publica 80/443 em `PUBLIC_BIND_ADDRESS` (padrão 127.0.0.1) e emite certificado próprio.
- O Caddyfile repassa `X-Forwarded-For {remote_host}` ao Quarkus. Com o NPM na frente, `remote_host` passa a ser o IP do NPM na rede Docker, e não o do cliente.
- O Quarkus em `%prod` usa `quarkus.http.proxy.trusted-proxies=${TRUSTED_PROXIES}`, que no compose aponta para o IP do Caddy (`CADDY_IPV4`).
- O backend já tem healthcheck em `/q/health/ready` no compose. O Caddy responde `/healthz` (hoje retorna 404 em produção, tratado na FIX-03).
- O CD (`.github/workflows/cd.yml`) dispara `PRODUCTION_DEPLOY_HOOK` e depois roda `scripts/ci/health-check.mjs` em `PRODUCTION_HEALTH_URL` com `PRODUCTION_HEALTH_PATHS` (padrão `/q/health/live,/q/health/ready`, que o Caddy não expõe).
- O inventário da base acima registrou 145 ocorrências do domínio comercial anterior em 49 arquivos (defaults do `application.properties`, URIs de problema, SEO, sitemap, docs) e uma referência ao domínio técnico anterior no `NOTICE`. Estes números são históricos; a limpeza de DOMINIO-01 não altera os demais requisitos desta spec.

## Escopo

1. Rede e borda
   - Fluxo: cliente > NPM (TLS, folhea.app) > Caddy do Folhea > Quarkus e Keycloak.
   - O Caddy deixa de emitir certificado público e passa a atender HTTP só na interface interna que o NPM alcança. Nenhuma porta nova do Folhea aberta para a internet.
   - O domínio vem só de `PUBLIC_DOMAIN` (e das variáveis de origem derivadas dele). Nenhum domínio fixo no código.
2. IP real do cliente
   - Caddy: bloco global `servers { trusted_proxies static <NPM_SUBNET> }`, com a subnet fixa da rede do NPM declarada no compose (rede com `ipam` fixo, valor por variável, ex.: `NPM_SUBNET`).
   - Remover `header_up X-Forwarded-For {remote_host}` dos `reverse_proxy` (o Caddy repassa o XFF já validado).
   - O log de acesso do Caddy registra `{client_ip}`.
   - Quarkus: `TRUSTED_PROXIES` é só o IP do Caddy (`CADDY_IPV4`), nunca a rede do NPM. Keycloak continua com `KC_PROXY_HEADERS: xforwarded`.
   - NPM: o proxy host de folhea.app envia `X-Forwarded-For` e `X-Forwarded-Proto` (feito no painel, fora do repo).
3. PostgreSQL compartilhado
   - Bancos `folhea` e `folhea_keycloak`, com usuários próprios (`folhea` e `folhea_keycloak`), sem SUPERUSER, CREATEDB nem CREATEROLE, donos só dos seus bancos.
   - `REVOKE CONNECT ON DATABASE ... FROM PUBLIC` em `folhea` e `folhea_keycloak`, com `GRANT CONNECT` só ao dono. A DEPLOY-01 não mexe no banco `acertoapp`: o GRANT/REVOKE CONNECT dele é do card DB-01 do AcertoAPP.
   - Script SQL idempotente de provisionamento em `infra/postgres/` com placeholders, rodado uma vez à mão por um admin. Senhas nunca no repo.
   - No overlay de produção o serviço `postgres` do compose não sobe; `DB_JDBC_URL` e `KC_DB_URL` apontam para o host do PostgreSQL compartilhado por variável.
   - Backup por banco (`pg_dump` só de `folhea` e `folhea_keycloak`), ajustando `scripts/ops/backup-postgres.sh` e o timer `infra/systemd/folhea-backup.*`.
4. Redis e Keycloak continuam no compose do Folhea, com rede e volumes próprios do projeto.
5. Deploy
   - Hook (webhook como serviço systemd em loopback, com token no header), exposto pelo Caddy do Folhea num path próprio, no mesmo proxy host de folhea.app no NPM (sem proxy host novo). O hook roda `git pull --ff-only` e `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait`, sempre com `COMPOSE_PROJECT_NAME=folhea`.
   - O hook retorna erro (e o CD falha) se o `--wait` não terminar com o backend saudável em `/q/health/ready`.
   - CD: `PRODUCTION_HEALTH_URL` aponta para a URL pública e `PRODUCTION_HEALTH_PATHS=/healthz`.
   - Exemplos de `hooks.json`, unit systemd e trecho de proxy só com placeholders.
6. Limpeza de domínio: trocar os dois domínios legados identificados por `folhea.app` ou por variável, incluindo os testes que verificam esses valores.
7. Cadastro: `registrationAllowed: false` e usuários criados à mão. O cadastro só é ligado durante o teste do Avaliador e desligado depois.

## Critérios de aceite

1. No PostgreSQL compartilhado existem os bancos `folhea` e `folhea_keycloak`, cada um com usuário próprio sem SUPERUSER, CREATEDB e CREATEROLE.
2. `psql -U folhea -d acertoapp` falha com `permission denied for database`.
3. No sentido contrário, o usuário do AcertoAPP tentando `psql -d folhea` (e `-d folhea_keycloak`) falha com `permission denied for database`.
4. O backup roda por banco e gera dumps só de `folhea` e `folhea_keycloak`; o restore de teste (`scripts/ops/verify-recovery.sh`) passa.
5. O Caddyfile tem `servers { trusted_proxies static ... }` com a subnet do NPM (subnet fixa declarada no compose), não tem `header_up X-Forwarded-For {remote_host}`, e o log usa `{client_ip}`; uma requisição de fora para https://folhea.app aparece com o IP real no log do Caddy e no do Quarkus, e não com o IP da rede Docker do NPM.
6. Um `X-Forwarded-For` falso enviado pelo cliente não substitui o IP real nos logs (o Caddy confia só na subnet do NPM e o Quarkus confia só no Caddy).
7. O healthcheck do serviço `backend` no compose usa `/q/health/ready`.
8. O hook é chamado pelo Caddy, no mesmo proxy host de folhea.app no NPM, exige o token e roda `docker compose ... up -d --build --wait`; se o backend não ficar saudável, o hook retorna erro e o job de deploy do CD falha.
9. O job `health-check` do CD verifica o `/healthz` público via `PRODUCTION_HEALTH_URL` e falha se não receber 200.
10. `node scripts/ci/validate-domain-surface.mjs` na raiz não encontra os domínios legados nos textos rastreados, incluindo literais escapados.
11. O domínio público vem só de `PUBLIC_DOMAIN` (e variáveis derivadas no `.env`); trocar o valor no `.env` muda o domínio sem mexer em código.
12. Nenhum segredo, IP real, nome de host interno ou detalhe de infra do servidor aparece em código, docs ou exemplos; só placeholders (ex.: `<NPM_SUBNET>`, `<DB_HOST>`, `<TOKEN>`). O `security.yml` (varredura de segredos) passa.
13. Um deploy do Folhea não derruba nem reinicia nenhum container do AcertoAPP: comparar `docker ps --format '{{.Names}} {{.Status}}'` dos containers do AcertoAPP antes e depois, com o mesmo uptime.
14. O script do Folhea faz `REVOKE CONNECT ... FROM PUBLIC` só em `folhea` e `folhea_keycloak` e não altera o banco `acertoapp` nem configuração do PostgreSQL (sem reiniciar e sem mudar `postgresql.conf`).
15. Login e cadastro manual funcionam em https://folhea.app com o cadastro público do Keycloak desligado.

## Dependências

- DOMINIO-01 Parte A (configuração do login e `contato@folhea.app`).
- FIX-03 (`/healthz` público retornando 200).
- SEG-02.
- DB-01 do AcertoAPP (https://trello.com/c/ztRsXeFL): faz o GRANT/REVOKE CONNECT no banco `acertoapp`, necessário para o critério 2.

## Fora do escopo

- Limite por IP e investigação de timeout (card próprio).
- DOMINIO-01 Parte B.
- VPS exclusiva, migração do AcertoAPP ou mudanças no NPM além do proxy host de folhea.app.
- Produção pública (só depois do aceite da LIVRO-02 e da LAYOUT-01).

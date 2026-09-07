# Operação da infraestrutura

Este runbook cobre a stack inicial do Folhea: Caddy, Quarkus, PostgreSQL 18,
Keycloak e Redis. PostgreSQL, Keycloak e Redis ficam somente na rede privada do
Compose; a única superfície publicada é o Caddy.

## Deploy

1. Instale Docker Engine com Docker Compose v2 e prepare um host Linux com
   armazenamento persistente para os volumes `folhea-postgres` e `caddy-data`.
2. Injete as variáveis de [`.env.example`](../.env.example) por um secret
   manager ou pelo ambiente de CI/CD. Para desenvolvimento local, copie-o para
   `.env` e substitua todos os valores `replace-with-*` por valores aleatórios.
   O arquivo `.env` nunca deve ser commitado.
3. Antes do primeiro deploy, valide a configuração sem iniciar containers:

   ```bash
   docker compose --env-file .env config
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

   A imagem possui dois targets: `backend-runtime` (Quarkus/JVM) e
   `caddy-runtime` (Angular estático/Caddy). Nenhum runtime contém Node.js.
5. Em produção, defina `PUBLIC_BIND_ADDRESS=0.0.0.0`, use um domínio HTTPS em
   `PUBLIC_DOMAIN`, mantenha `DB_PASSWORD`, `KEYCLOAK_DB_PASSWORD` e
   `KEYCLOAK_ADMIN_PASSWORD` fora do Git e suba o Keycloak com
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml` (modo
   `start --optimized`). Use Keycloak **26.7.3** (digest pinado no Compose).
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

## Supply chain (imagens e Actions)

Imagens base e serviços usam digest SHA256 pinado (`infra/Dockerfile`,
`docker-compose.yml`). GitHub Actions usam commit SHA imutável com comentário
de tag (`# v4`).

Regenerar digests:

```bash
docker buildx imagetools inspect <imagem:tag>
gh api repos/actions/checkout/commits/v4 --jq .sha
```

Validar overlay de produção:

```bash
scripts/ops/validate-production-compose.sh
```

O primeiro boot do PostgreSQL cria duas bases independentes (`folhea` e
`keycloak`). O script de inicialização roda apenas quando o volume é criado;
alterar os nomes depois do primeiro boot exige uma migração operacional
explícita, não a edição do script.

## Desenvolvimento local com `ng serve`

A borda pública de Compose continua no Caddy (`https://localhost:8443`). Para
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
carrega o `.env` antes do `quarkus:dev` e evita erro SCRAM por `DB_PASSWORD`
vazio (sintoma comum: HTTP 500 em `/auth/login` via proxy do `ng serve`).
O `%dev` liga o OIDC contra `http://localhost:8180/realms/folhea`. Sem isso o
BFF devolve `/app/inicio` sem sessão e o guard Angular devolve `/entrar` — o
botão Entrar parece não fazer nada. Crie um usuário no realm `folhea` em
`http://localhost:8180` com o admin do `.env`.

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
curl -kfsS https://localhost:8443/healthz
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

# Operação da infraestrutura

Este runbook cobre a stack inicial do Folhea: Caddy, Quarkus, PostgreSQL 18 e
Keycloak. PostgreSQL e Keycloak ficam somente na rede privada do Compose; a
única superfície publicada é o Caddy.

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

   A imagem possui dois targets: `backend-runtime` (Quarkus/JVM) e
   `caddy-runtime` (Angular estático/Caddy). Nenhum runtime contém Node.js.
5. Em produção, defina `PUBLIC_BIND_ADDRESS=0.0.0.0`, use um domínio HTTPS em
   `PUBLIC_DOMAIN`, mantenha `DB_PASSWORD`, `KEYCLOAK_DB_PASSWORD` e
   `KEYCLOAK_ADMIN_PASSWORD` fora do Git e substitua `start-dev` do Keycloak por
   uma imagem otimizada (`start --optimized`) construída pela equipe de
   plataforma. Defina também `OIDC_PUBLIC_ORIGIN`, `OIDC_PUBLIC_ISSUER`,
   `OIDC_PUBLIC_AUTHORIZATION_URL` e `OIDC_PUBLIC_LOGOUT_URL` para o mesmo
   domínio público HTTPS. O backend continua usando `http://keycloak:8080`
   somente no back-channel; Caddy publica apenas as rotas de login/logout e
   recursos estáticos necessários ao navegador. O console administrativo,
   token endpoint, introspection, JWKS e realm-management não são roteados pelo
   Caddy.

O primeiro boot do PostgreSQL cria duas bases independentes (`folhea` e
`keycloak`). O script de inicialização roda apenas quando o volume é criado;
alterar os nomes depois do primeiro boot exige uma migração operacional
explícita, não a edição do script.

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
registrar cookies, tokens, query strings ou payloads privados. Não use
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

# Backup, restore e verificação de recuperação

Este runbook automatiza o requisito 97 do PRD-01: backup diário do PostgreSQL,
retenção mínima de sete dias, uma cópia fora do servidor principal e restores
testados periodicamente. Os scripts usam o serviço `postgres` do Compose e não
fazem backup de volumes enquanto o banco está escrevendo.

## Contrato dos scripts

Os scripts ficam em `scripts/ops/` e falham cedo com `set -Eeuo pipefail`:

| Script | Função |
| --- | --- |
| `backup-postgres.sh` | Gera um dump PostgreSQL custom-format, checksum SHA-256, cópia externa e rotação local. |
| `restore-postgres.sh` | Valida o checksum e restaura `.dump` ou `.dump.gz` com `pg_restore --clean --if-exists`. |
| `verify-recovery.sh` | Confere `pg_isready`, a tabela de migrações e o readiness do backend. |

Os comandos exigem `COMPOSE_FILE`/`--compose-file` e
`COMPOSE_ENV_FILE`/`--env-file`; por padrão são `docker-compose.yml` e `.env`.
O arquivo de ambiente precisa existir e conter as credenciais que o Compose
exige. Os scripts passam apenas usuário e nome do banco aos clientes
PostgreSQL executados dentro do container; a senha continua no ambiente do
Compose e nunca é argumento, saída normal ou log do script.

O dump usa o formato custom (`--format=custom`), não depende de um arquivo SQL
intermediário e é criado com `umask 077`. O arquivo e seu `.sha256` são
publicados por renomeação atômica e não substituem um backup que já exista para
o mesmo timestamp. Preserve o par de arquivos ao mover ou baixar um backup.

## Backup diário

O destino externo é obrigatório. Pode ser um diretório montado fora do host
principal (`file:///mnt/backup-offsite/postgres`), um caminho absoluto, ou um
bucket S3 compatível (`s3://folhea-backups/postgres`). Para S3, o script usa o
perfil/credenciais já fornecidos pelo ambiente do job, envia o checksum junto e
confirma o objeto com `head-object`. Não coloque credenciais na URI.

Exemplo de execução manual:

```bash
export COMPOSE_ENV_FILE=.env
export BACKUP_EXTERNAL_DESTINATION=s3://folhea-backups/postgres
export BACKUP_RETENTION_DAYS=14
scripts/ops/backup-postgres.sh
```

Os nomes de banco e usuário podem ser ajustados com `DB_NAME` e `DB_USERNAME`.
Para uma cópia local externa:

```bash
scripts/ops/backup-postgres.sh \
  --output-dir /var/lib/folhea/backups \
  --external-destination file:///mnt/offsite/folhea/postgres \
  --retention-days 14
```

O job deve alertar quando o processo retornar diferente de zero. Isso inclui
falha do `pg_dump`, checksum, upload/verificação externa ou rotação local. A
retenção local nunca pode ser menor que sete dias. Para S3, configure também
uma regra de lifecycle/versionamento do bucket de pelo menos sete dias; a
rotação local não substitui essa cópia independente.

### Cron

Use um usuário de serviço com acesso mínimo ao Docker e ao secret manager. O
cron deve executar no diretório do checkout, com `PATH` explícito e saída para
o coletor de logs:

```cron
17 2 * * * cd /srv/folhea && PATH=/usr/local/bin:/usr/bin:/bin BACKUP_EXTERNAL_DESTINATION=s3://folhea-backups/postgres BACKUP_RETENTION_DAYS=14 scripts/ops/backup-postgres.sh >>/var/log/folhea-backup.log 2>&1
```

Em produção, prefira injetar `COMPOSE_ENV_FILE` e as credenciais AWS a partir
do secret manager do host. Não escreva o conteúdo de `.env`, `docker compose
config` ou variáveis de segredo no log do cron.

### CI/CD

Um job agendado pode executar o mesmo script depois de obter um token curto do
secret manager. O job precisa ter Docker/Compose, `sha256sum` e AWS CLI (para
S3), e deve falhar se o comando não retornar zero. O artefato do job deve
conter somente o nome do backup, checksum, duração e status; nunca tokens,
senhas ou a saída completa do Compose.

## Restore

Faça restore primeiro em uma instância, projeto e volume isolados. O modo
normal identifica o alvo como `isolated`; `--target production` exige a
confirmação explícita `--confirm-production-restore` para reduzir o risco de
apagar dados no ambiente errado.

```bash
scripts/ops/restore-postgres.sh \
  /mnt/offsite/folhea/postgres/folhea-20260906T020000Z.dump \
  --env-file .env-recovery \
  --target isolated
scripts/ops/verify-recovery.sh \
  --env-file .env-recovery \
  --report-file /var/log/folhea/recovery.log
```

Para um artefato comprimido, use o mesmo comando com `.dump.gz`; o script
testa o stream gzip antes de iniciar o `pg_restore`. O sidecar `.sha256` dos
backups gerados por este processo é validado antes de qualquer alteração no
banco. Um sidecar ausente permite restaurar artefatos legados, mas o operador
deve registrar a exceção e gerar checksum antes de promover os dados.

O restore usa `--clean --if-exists --no-owner --no-privileges` e deve ser
executado com o serviço backend parado ou apontando para outra base enquanto a
operação acontece. Depois, execute `verify-recovery.sh`; o teste padrão
confirma que `public.flyway_schema_history` existe e que
`/q/health/ready` responde dentro do container backend. Para uma instalação
com uma verificação específica, informe uma asserção somente leitura:

```bash
scripts/ops/verify-recovery.sh \
  --sql "SELECT CASE WHEN EXISTS (SELECT 1 FROM public.book) THEN 1 ELSE 0 END;" \
  --expected 1
```

Quando o restore for somente de PostgreSQL e não houver backend disponível,
use `--skip-backend`. A base separada do Keycloak deve ser incluída em um
procedimento coordenado quando a continuidade de identidade for necessária;
não copie tabelas internas do Keycloak para a base do Folhea.

## RPO, RTO e evidência

Para o perfil V1, adote como alvo operacional:

| Medida | Alvo | Como verificar |
| --- | --- | --- |
| RPO | até 24 horas | último backup diário confirmado no destino externo |
| RTO | até 4 horas | duração registrada entre decisão, restore e readiness |
| Retenção | 7 dias ou mais | `BACKUP_RETENTION_DAYS` e lifecycle do bucket |
| Teste de recuperação | mensal | execução em ambiente isolado com relatório |

Registre no ticket de operação o timestamp UTC, origem do backup, checksum,
versão da aplicação/migrações, início/fim, duração, resultado do restore,
resultado do readiness e qualquer desvio de RPO/RTO. O `--report-file` do
verificador registra apenas status, banco e se o check do backend foi usado.

## Procedimento de incidente

1. Declare o incidente e congele alterações no banco afetado; preserve logs e
   o último checksum confirmado.
2. Determine o timestamp do último backup externo íntegro e calcule o RPO
   provável. Não sobrescreva o volume original.
3. Crie um projeto/volume isolado, baixe o par `.dump`/`.sha256` e execute o
   restore seguido da verificação. Registre a duração e os erros.
4. Compare o resultado com a versão da aplicação e das migrações que serão
   usadas. Faça smoke tests de login, livros e sessões sem expor dados em logs.
5. Com aprovação da janela de mudança, promova o ambiente recuperado ou
   repita o restore no destino definido. Para produção, use explicitamente
   `--target production --confirm-production-restore`.
6. Faça backup novamente após a recuperação, valide o destino externo e
   documente causa, perda de dados, RPO/RTO observado e ações corretivas.

## Teste periódico

Agende pelo menos uma vez por mês um job que selecione o backup externo mais
recente, restaure em um Compose isolado e execute `verify-recovery.sh`. O job
deve ser não destrutivo para produção, limpar apenas seu próprio ambiente
temporário e publicar um relatório sem dados privados. Falha no checksum,
restore ou readiness deve abrir alerta e bloquear a indicação de recuperação
bem-sucedida.

Os testes shell em `scripts/ops/tests/test-backup-restore.sh` usam um Compose e
um cliente Docker falsos em um diretório temporário; eles cobrem argumentos,
caminhos, retenção, checksum, confirmação de produção e falhas de healthcheck
sem iniciar containers ou tocar em dados reais.

# Backup, restore e verificação de recuperação

Este runbook automatiza o requisito 97 do PRD-01: backup diário do PostgreSQL,
retenção mínima de sete dias, uma cópia fora do servidor principal e restores
testados periodicamente. Os scripts usam o serviço `postgres` do Compose e não
fazem backup de volumes enquanto o banco está escrevendo.

## Retenção e direitos do titular (LGPD)

Backups PostgreSQL podem conter dados pessoais (e-mail, hábitos de leitura)
por até `BACKUP_RETENTION_DAYS` (mínimo operacional de sete dias). A exclusão
self-service em **Configurações → Privacidade** (`DELETE /api/v1/me`) remove os
dados ativos imediatamente; cópias históricas expiram conforme a rotação de
backup. Restores de teste devem usar ambientes isolados e descartar o volume após
a verificação.

Exportação self-service: `GET /api/v1/me/export` (JSON com usuário, livros,
sessões e capas privadas). As capas ficam em `book_cover` como bytes PostgreSQL;
o dump custom-format inclui esses bytes, sem bucket ou volume adicional.
Inclua a tabela no restore e compare tamanho/hash da imagem além dos metadados.
A exclusão do livro ou da conta também remove a capa pela chave estrangeira;
backups históricos continuam sujeitos à retenção descrita acima.

## Contrato dos scripts

Os scripts ficam em `scripts/ops/` e falham cedo com `set -Eeuo pipefail`:

| Script | Função |
| --- | --- |
| `backup-postgres.sh` | Gera um dump PostgreSQL custom-format, checksum SHA-256, cópia externa e rotação local. |
| `restore-postgres.sh` | Valida o checksum e restaura `.dump` ou `.dump.gz` com `pg_restore --single-transaction --clean --if-exists`. |
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
O bucket ou prefixo pode terminar em `/`: o script remove as barras finais e
usa a mesma chave para upload e verificação, inclusive na raiz `s3://bucket/`.

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
  /mnt/offsite/folhea/postgres/folhea-folhea-20260906T020000Z.dump \
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

O restore usa `--single-transaction --clean --if-exists --no-owner --no-privileges` e deve ser
executado com o serviço backend parado ou apontando para outra base enquanto a
operação acontece. DROP, criação e carga pertencem à mesma transação: um erro
durante a restauração desfaz as alterações dessa tentativa, preservando a base
anterior. Isso vale para `.dump` e `.dump.gz`; a validação prévia do TOC não
substitui essa garantia. Depois, execute `verify-recovery.sh`; o teste padrão
confirma as migrações V007, V008 e V009 aplicadas com sucesso (`version` igual a
`7`/`007`, `8`/`008` e `9`/`009`, formatos do histórico Flyway), a presença de
`public.folhea_user`, `public.account_deletion` e `public.book_cover`, a ausência
das colunas `password_hash` e `login_identifier` e que `/q/health/ready` responde
dentro do container backend. Isso impede aceitar um restore anterior à exclusão
durável, às capas persistentes ou à delegação completa das credenciais ao IdP. Inclua as intenções pendentes e os tombstones no backup da base do
Folhea; não restaure somente as tabelas de livros/sessões. Para uma instalação
com uma verificação específica, informe uma asserção somente leitura:

```bash
scripts/ops/verify-recovery.sh \
  --sql "SELECT CASE WHEN EXISTS (SELECT 1 FROM public.book) THEN 1 ELSE 0 END;" \
  --expected 1
```

Quando o restore for somente de PostgreSQL e não houver backend disponível,
use `--skip-backend`. A base separada do Keycloak deve ser incluída em um
procedimento coordenado quando a continuidade de identidade for necessária;
não copie tabelas internas do Keycloak para a base do Folhea. Ao verificar a
base do Keycloak, passe uma asserção `--sql` própria desse schema; a verificação
padrão exige as migrações do Folhea.

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
`test_backup_destinations.py` exercita o script com um transporte S3 falso que
distingue chaves exatas, cobrindo bucket/prefixo com e sem barras finais.
`test_restore_atomicity.py` inicia um PostgreSQL temporário próprio e verifica
que uma falha de COPY após o início do restore preserva os dados anteriores,
além do restore válido nos dois formatos. Ele requer os binários PostgreSQL
locais (ou `PG_TEST_BIN`) e permissão para socket Unix; registra skip explícito
em execução local quando esse ambiente não estiver disponível. No CI,
`FOLHEA_REQUIRE_POSTGRES_TESTS=1` transforma essa indisponibilidade em falha:
o gate não pode aprovar atomicidade sem executar o PostgreSQL real. O teste
nunca conecta a uma base existente.

## Continuidade de identidade e instâncias isoladas

Os artefatos incluem o nome da base (`folhea-folhea-<timestamp>.dump` e
`folhea-keycloak-<timestamp>.dump`), permitindo salvar as duas bases no mesmo
diretório sem colisão. A rotação aplica-se somente à base selecionada.
Faça ambos os backups diariamente: use `--database keycloak --username keycloak`
para a identidade. Nomes customizados devem ser passados explicitamente.
`COMPOSE_PROJECT_NAME` escolhe o projeto de destino e evita atingir a stack
original quando há mais de uma instalação. Não misture segredos de uma
instalação com volumes de outra.

Para S3 compatível, `AWS_ENDPOINT_URL` e o perfil AWS vêm do ambiente do
operador; o script não incorpora chaves. O destino `file://` permite testar
cópia/restore local, mas somente um mount remoto comprovado satisfaz a cópia
fora do servidor. Agende o cron diário descrito acima e o restore mensal no
host operacional; a presença dos scripts não prova que esses jobs estão ativos.
O verificador envolve a asserção SQL em uma transação `READ ONLY` para rejeitar
mutações acidentais.

O guard atual de `verify-recovery.sh` usa `scripts/ops/verify-recovery.sql`: exige
V007/V008/V009 e V010 com sucesso, aceitando os formatos numéricos com/sem zeros.
V010 precisa ter tipo `JDBC` e armazenamento `book_photo.bytes` do tipo `bytea`;
as colunas delegadas de credenciais continuam proibidas. V010 Java converte as
capas antigas pela aplicação/Flyway, e não pode ser reproduzida aplicando apenas
`.sql` por psql. Um dump pós-migração já inclui as fotos normalizadas: o restore
preserva esses bytes, sem refazer a conversão. `book_cover` pode existir vazio
por compatibilidade; o guard não o exige como armazenamento permanente.

### Backup das duas bases e timer

`scripts/ops/backup-all.sh` usa os nomes/usuários do `.env`, salva Folhea e
Keycloak no mesmo ciclo e falha se qualquer dump/cópia falhar. Configure o destino
em `.env` ou no ambiente; a ausência dele impede execução, evitando afirmar
backup externo sem uma cópia. As bases são snapshots sequenciais, não uma
transação distribuída: suspenda mutações de conta durante recuperação conjunta.

Os modelos `infra/systemd/folhea-backup.service` e `.timer` executam diariamente
às 02:17, recuperando execução perdida com `Persistent=true`. Para instalar no
host operacional, ajuste `/srv/folhea` ao checkout, crie
`/etc/folhea/backup.env` (0600) com `COMPOSE_ENV_FILE`, `BACKUP_DIR`,
`BACKUP_EXTERNAL_DESTINATION` e `BACKUP_RETENTION_DAYS>=7`, copie os units para
`/etc/systemd/system/` e execute `systemctl enable --now folhea-backup.timer`.
Verifique `systemctl list-timers folhea-backup.timer` e o journal do serviço.
A stack local não instala serviços do sistema automaticamente; sem destino
offsite verificado, esse requisito operacional permanece externo.

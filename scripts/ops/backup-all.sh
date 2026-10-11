#!/usr/bin/env bash
# Back up application and identity together, using independent dump names.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$ROOT"
ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.env}"
backup_destination="${BACKUP_EXTERNAL_DESTINATION:-}"
backup_directory="${BACKUP_DIR:-}"
backup_retention="${BACKUP_RETENTION_DAYS:-}"
set -a
source "$ENV_FILE"
set +a
export BACKUP_EXTERNAL_DESTINATION="${backup_destination:-${BACKUP_EXTERNAL_DESTINATION:-}}"
export BACKUP_DIR="${backup_directory:-${BACKUP_DIR:-backups/postgres}}"
export BACKUP_RETENTION_DAYS="${backup_retention:-${BACKUP_RETENTION_DAYS:-7}}"
: "${BACKUP_EXTERNAL_DESTINATION:?Configure an offsite destination before scheduling backups}"
export COMPOSE_ENV_FILE="$ENV_FILE"
"$ROOT/scripts/ops/backup-postgres.sh" --database "${DB_NAME:-folhea}" --username "${DB_USERNAME:-folhea}"
"$ROOT/scripts/ops/backup-postgres.sh" --database "${KEYCLOAK_DB_NAME:-keycloak}" --username "${KEYCLOAK_DB_USER:-keycloak}"
echo 'Backup de aplicação e identidade concluído e cópias verificadas.'

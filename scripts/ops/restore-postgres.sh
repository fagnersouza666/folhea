#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat >&2 <<'USAGE'
Usage: restore-postgres.sh BACKUP_FILE [options]

Restores a PostgreSQL custom-format dump into the configured Compose database.
Both .dump and gzip-compressed .dump.gz artifacts are accepted. Production
restores require --confirm-production-restore.

Options:
  --backup-file FILE          Alternative to the positional backup file
  --target NAME               Restore target label (default: isolated)
  --compose-file FILE         Compose file (default: docker-compose.yml)
  --env-file FILE             Compose env file (default: .env)
  --service NAME               PostgreSQL service (default: postgres)
  --database NAME              Database (default: DB_NAME or folhea)
  --username NAME              Database user (default: DB_USERNAME or folhea)
  --confirm-production-restore
                              Required when --target is production
  -h, --help                   Show this help
USAGE
}

BACKUP_FILE=""
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
DB_NAME="${DB_NAME:-folhea}"
DB_USERNAME="${DB_USERNAME:-folhea}"
RESTORE_TARGET="${RESTORE_TARGET:-isolated}"
confirmed_production=0

while (($# > 0)); do
  case "$1" in
    --backup-file)
      (($# >= 2)) || { usage; ops_die "--backup-file requires a value"; }
      BACKUP_FILE="$2"
      shift 2
      ;;
    --target)
      (($# >= 2)) || { usage; ops_die "--target requires a value"; }
      RESTORE_TARGET="$2"
      shift 2
      ;;
    --compose-file)
      (($# >= 2)) || { usage; ops_die "--compose-file requires a value"; }
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --env-file)
      (($# >= 2)) || { usage; ops_die "--env-file requires a value"; }
      COMPOSE_ENV_FILE="$2"
      shift 2
      ;;
    --service)
      (($# >= 2)) || { usage; ops_die "--service requires a value"; }
      POSTGRES_SERVICE="$2"
      shift 2
      ;;
    --database)
      (($# >= 2)) || { usage; ops_die "--database requires a value"; }
      DB_NAME="$2"
      shift 2
      ;;
    --username)
      (($# >= 2)) || { usage; ops_die "--username requires a value"; }
      DB_USERNAME="$2"
      shift 2
      ;;
    --confirm-production-restore)
      confirmed_production=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      usage
      ops_die "unknown argument: $1"
      ;;
    *)
      [[ -z "$BACKUP_FILE" ]] || { usage; ops_die "only one backup file may be supplied"; }
      BACKUP_FILE="$1"
      shift
      ;;
  esac
done

ops_require_nonempty "$BACKUP_FILE" BACKUP_FILE
ops_require_file "$BACKUP_FILE" "backup file"
ops_validate_name "$RESTORE_TARGET" RESTORE_TARGET
ops_validate_name "$POSTGRES_SERVICE" POSTGRES_SERVICE
ops_validate_name "$DB_NAME" DB_NAME
ops_validate_name "$DB_USERNAME" DB_USERNAME
ops_init_compose
ops_require_command sha256sum

if [[ "$RESTORE_TARGET" == production && "$confirmed_production" -ne 1 ]]; then
  ops_die "production restore requires --confirm-production-restore"
fi

checksum_file="$BACKUP_FILE.sha256"
if [[ -f "$checksum_file" ]]; then
  ops_require_file "$checksum_file" "backup checksum"
  expected_digest="$(awk 'NF >= 1 { print $1; exit }' "$checksum_file")"
  [[ "$expected_digest" =~ ^[[:xdigit:]]{64}$ ]] || ops_die "backup checksum is malformed"
  actual_digest="$(sha256sum -- "$BACKUP_FILE" | awk '{print $1}')"
  [[ "$actual_digest" == "$expected_digest" ]] || ops_die "backup checksum verification failed"
fi

case "$BACKUP_FILE" in
  *.gz)
    ops_require_command gzip
    gzip -t -- "$BACKUP_FILE" >/dev/null 2>&1 || ops_die "backup gzip stream is invalid"
    ;;
esac

validate_backup_format() {
  case "$BACKUP_FILE" in
    *.gz)
      gzip -dc -- "$BACKUP_FILE" |
        "${COMPOSE[@]}" exec -T "$POSTGRES_SERVICE" pg_restore --list >/dev/null
      ;;
    *)
      cat -- "$BACKUP_FILE" |
        "${COMPOSE[@]}" exec -T "$POSTGRES_SERVICE" pg_restore --list >/dev/null
      ;;
  esac
}

if ! validate_backup_format; then
  ops_die "backup is not a valid PostgreSQL custom-format artifact"
fi

ops_log "Starting PostgreSQL restore into target $RESTORE_TARGET"
case "$BACKUP_FILE" in
  *.gz)
    gzip -dc -- "$BACKUP_FILE" |
      "${COMPOSE[@]}" exec -T "$POSTGRES_SERVICE" pg_restore \
        --exit-on-error \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        --no-password \
        --username "$DB_USERNAME" \
        --dbname "$DB_NAME"
    ;;
  *)
    cat -- "$BACKUP_FILE" |
      "${COMPOSE[@]}" exec -T "$POSTGRES_SERVICE" pg_restore \
        --exit-on-error \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        --no-password \
        --username "$DB_USERNAME" \
        --dbname "$DB_NAME"
    ;;
esac
ops_log "PostgreSQL restore completed"

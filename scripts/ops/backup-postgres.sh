#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat >&2 <<'USAGE'
Usage: backup-postgres.sh [options]

Creates a PostgreSQL custom-format dump, a SHA-256 sidecar, and copies both to
an external destination. The external destination is required and must be a
file:// path, an absolute path, or an s3:// URI.

Options:
  --output-dir DIR             Local backup directory (default: backups/postgres)
  --external-destination URI  External destination (required)
  --retention-days DAYS       Local retention, minimum 7 (default: 7)
  --compose-file FILE         Compose file (default: docker-compose.yml)
  --env-file FILE             Compose env file (default: .env)
  --service NAME               PostgreSQL service (default: postgres)
  --database NAME              Database (default: DB_NAME or folhea)
  --username NAME              Database user (default: DB_USERNAME or folhea)
  -h, --help                   Show this help
USAGE
}

BACKUP_DIR="${BACKUP_DIR:-backups/postgres}"
BACKUP_EXTERNAL_DESTINATION="${BACKUP_EXTERNAL_DESTINATION:-${BACKUP_DESTINATION:-}}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
DB_NAME="${DB_NAME:-folhea}"
DB_USERNAME="${DB_USERNAME:-folhea}"

while (($# > 0)); do
  case "$1" in
    --output-dir)
      (($# >= 2)) || { usage; ops_die "--output-dir requires a value"; }
      BACKUP_DIR="$2"
      shift 2
      ;;
    --external-destination)
      (($# >= 2)) || { usage; ops_die "--external-destination requires a value"; }
      BACKUP_EXTERNAL_DESTINATION="$2"
      shift 2
      ;;
    --retention-days)
      (($# >= 2)) || { usage; ops_die "--retention-days requires a value"; }
      BACKUP_RETENTION_DAYS="$2"
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
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      ops_die "unknown argument: $1"
      ;;
  esac
done

ops_validate_target_directory "$BACKUP_DIR" BACKUP_DIR
ops_require_nonempty "$BACKUP_EXTERNAL_DESTINATION" BACKUP_EXTERNAL_DESTINATION
ops_validate_retention "$BACKUP_RETENTION_DAYS"
ops_validate_name "$POSTGRES_SERVICE" POSTGRES_SERVICE
ops_validate_name "$DB_NAME" DB_NAME
ops_validate_name "$DB_USERNAME" DB_USERNAME
ops_init_compose
ops_require_command date
ops_require_command find
ops_require_command mktemp
ops_require_command sha256sum

umask 077
mkdir -p -- "$BACKUP_DIR"
[[ -d "$BACKUP_DIR" && -w "$BACKUP_DIR" ]] || ops_die "BACKUP_DIR is not writable: $BACKUP_DIR"

case "$BACKUP_EXTERNAL_DESTINATION" in
  s3://*)
    ops_require_command "${AWS_BIN:-aws}"
    ;;
  file://*|/*)
    external_path="${BACKUP_EXTERNAL_DESTINATION#file://}"
    [[ "$external_path" == /* ]] || ops_die "file external destination must be absolute"
    ops_validate_target_directory "$external_path" "external destination"
    mkdir -p -- "$external_path"
    [[ -d "$external_path" && -w "$external_path" ]] || ops_die "external destination is not writable"
    ;;
  *)
    ops_die "external destination must use file://, an absolute path, or s3://"
    ;;
esac

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact_name="folhea-${stamp}.dump"
artifact="$BACKUP_DIR/$artifact_name"
checksum="$artifact.sha256"
[[ ! -e "$artifact" && ! -e "$checksum" ]] || ops_die "backup already exists for timestamp $stamp"

temporary_artifact=""
temporary_checksum=""
cleanup() {
  [[ -z "$temporary_artifact" ]] || rm -f -- "$temporary_artifact"
  [[ -z "$temporary_checksum" ]] || rm -f -- "$temporary_checksum"
}
trap cleanup EXIT

temporary_artifact="$(mktemp "$BACKUP_DIR/.folhea-backup.XXXXXX")"
ops_log "Starting PostgreSQL backup"
"${COMPOSE[@]}" exec -T "$POSTGRES_SERVICE" pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --no-password \
  --username "$DB_USERNAME" \
  --dbname "$DB_NAME" > "$temporary_artifact"
[[ -s "$temporary_artifact" ]] || ops_die "pg_dump produced an empty artifact"
chmod 600 -- "$temporary_artifact"

digest="$(sha256sum -- "$temporary_artifact" | awk '{print $1}')"
[[ "$digest" =~ ^[[:xdigit:]]{64}$ ]] || ops_die "could not calculate backup checksum"
temporary_checksum="$(mktemp "$BACKUP_DIR/.folhea-checksum.XXXXXX")"
printf '%s  %s\n' "$digest" "$artifact" > "$temporary_checksum"
chmod 600 -- "$temporary_checksum"
mv -- "$temporary_artifact" "$artifact"
temporary_artifact=""
mv -- "$temporary_checksum" "$checksum"
temporary_checksum=""

case "$BACKUP_EXTERNAL_DESTINATION" in
  s3://*)
    external_uri="${BACKUP_EXTERNAL_DESTINATION%/}/$artifact_name"
    external_checksum_uri="${external_uri}.sha256"
    aws_bin="${AWS_BIN:-aws}"
    s3_location="${BACKUP_EXTERNAL_DESTINATION#s3://}"
    s3_bucket="${s3_location%%/*}"
    [[ -n "$s3_bucket" ]] || ops_die "s3 external destination is missing a bucket"
    if [[ "$s3_location" == */* ]]; then
      s3_prefix="${s3_location#*/}"
      [[ -n "$s3_prefix" ]] || ops_die "s3 external destination has an empty prefix"
      s3_key="$s3_prefix/$artifact_name"
      s3_checksum_key="$s3_prefix/$artifact_name.sha256"
    else
      s3_key="$artifact_name"
      s3_checksum_key="$artifact_name.sha256"
    fi
    "$aws_bin" s3 cp --only-show-errors --no-progress "$artifact" "$external_uri"
    "$aws_bin" s3 cp --only-show-errors --no-progress "$checksum" "$external_checksum_uri"
    "$aws_bin" s3api head-object --bucket "$s3_bucket" --key "$s3_key" >/dev/null
    "$aws_bin" s3api head-object --bucket "$s3_bucket" --key "$s3_checksum_key" >/dev/null
    ;;
  file://*|/*)
    external_path="${BACKUP_EXTERNAL_DESTINATION#file://}"
    external_artifact="$external_path/$artifact_name"
    external_checksum="$external_artifact.sha256"
    [[ "$(realpath -m -- "$external_artifact")" != "$(realpath -m -- "$artifact")" ]] || ops_die "external destination must differ from BACKUP_DIR"
    install -m 600 -- "$artifact" "$external_artifact"
    install -m 600 -- "$checksum" "$external_checksum"
    cmp -s -- "$artifact" "$external_artifact" || ops_die "external backup verification failed"
    cmp -s -- "$checksum" "$external_checksum" || ops_die "external checksum verification failed"
    ;;
esac

pruned=0
while IFS= read -r -d '' old_artifact; do
  [[ "$old_artifact" == "$artifact" ]] && continue
  rm -f -- "$old_artifact" "$old_artifact.sha256"
  pruned=$((pruned + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'folhea-*.dump' -mtime "+$BACKUP_RETENTION_DAYS" -print0)

ops_log "PostgreSQL backup completed; retention removed $pruned local artifact(s)"

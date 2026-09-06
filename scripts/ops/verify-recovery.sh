#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat >&2 <<'USAGE'
Usage: verify-recovery.sh [options]

Checks PostgreSQL readiness, runs a read-only recovery assertion, and checks
the backend readiness endpoint. Custom SQL is passed to psql but its output is
never written to the operation log.

Options:
  --sql SQL                    Read-only recovery assertion
  --expected VALUE             Expected compact output (default: 1)
  --skip-backend               Skip backend health check for DB-only restores
  --compose-file FILE         Compose file (default: docker-compose.yml)
  --env-file FILE             Compose env file (default: .env)
  --service NAME               PostgreSQL service (default: postgres)
  --backend-service NAME       Backend service (default: backend)
  --database NAME              Database (default: DB_NAME or folhea)
  --username NAME              Database user (default: DB_USERNAME or folhea)
  --health-url URL             Backend URL (default: http://127.0.0.1:8080/q/health/ready)
  --report-file FILE           Append a secret-free verification record
  -h, --help                   Show this help
USAGE
}

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
DB_NAME="${DB_NAME:-folhea}"
DB_USERNAME="${DB_USERNAME:-folhea}"
RECOVERY_VERIFY_SQL="${RECOVERY_VERIFY_SQL:-SELECT CASE WHEN to_regclass('public.flyway_schema_history') IS NOT NULL THEN 1 ELSE 0 END;}"
RECOVERY_EXPECTED_OUTPUT="${RECOVERY_EXPECTED_OUTPUT:-1}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:8080/q/health/ready}"
RECOVERY_REPORT_FILE="${RECOVERY_REPORT_FILE:-}"
skip_backend=0

while (($# > 0)); do
  case "$1" in
    --sql)
      (($# >= 2)) || { usage; ops_die "--sql requires a value"; }
      RECOVERY_VERIFY_SQL="$2"
      shift 2
      ;;
    --expected)
      (($# >= 2)) || { usage; ops_die "--expected requires a value"; }
      RECOVERY_EXPECTED_OUTPUT="$2"
      shift 2
      ;;
    --skip-backend)
      skip_backend=1
      shift
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
    --backend-service)
      (($# >= 2)) || { usage; ops_die "--backend-service requires a value"; }
      BACKEND_SERVICE="$2"
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
    --health-url)
      (($# >= 2)) || { usage; ops_die "--health-url requires a value"; }
      BACKEND_HEALTH_URL="$2"
      shift 2
      ;;
    --report-file)
      (($# >= 2)) || { usage; ops_die "--report-file requires a value"; }
      RECOVERY_REPORT_FILE="$2"
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

ops_validate_name "$POSTGRES_SERVICE" POSTGRES_SERVICE
ops_validate_name "$BACKEND_SERVICE" BACKEND_SERVICE
ops_validate_name "$DB_NAME" DB_NAME
ops_validate_name "$DB_USERNAME" DB_USERNAME
ops_require_nonempty "$BACKEND_HEALTH_URL" BACKEND_HEALTH_URL
ops_init_compose

if [[ -n "$RECOVERY_REPORT_FILE" ]]; then
  report_parent="$(dirname -- "$RECOVERY_REPORT_FILE")"
  ops_require_nonempty "$report_parent" "report parent"
  [[ "$report_parent" != *$'\n'* && "$report_parent" != *$'\r'* ]] || ops_die "report parent must not contain a newline"
  [[ ! -e "$RECOVERY_REPORT_FILE" || -f "$RECOVERY_REPORT_FILE" ]] || ops_die "report path is not a file"
  umask 077
  touch -- "$RECOVERY_REPORT_FILE"
  chmod 600 -- "$RECOVERY_REPORT_FILE"
fi

ops_log "Checking PostgreSQL readiness"
"${COMPOSE[@]}" exec -T "$POSTGRES_SERVICE" pg_isready \
  --username="$DB_USERNAME" --dbname="$DB_NAME" >/dev/null 2>&1 ||
  ops_die "PostgreSQL readiness check failed"

query_output=""
if ! query_output="$("${COMPOSE[@]}" exec -T "$POSTGRES_SERVICE" psql \
  --no-password \
  --quiet \
  --tuples-only \
  --no-align \
  --username "$DB_USERNAME" \
  --dbname "$DB_NAME" \
  --command "$RECOVERY_VERIFY_SQL" 2>/dev/null)"; then
  ops_die "recovery SQL assertion failed"
fi

compact_output="$(printf '%s' "$query_output" | tr -d '[:space:]')"
if [[ -n "$RECOVERY_EXPECTED_OUTPUT" && "$compact_output" != "$RECOVERY_EXPECTED_OUTPUT" ]]; then
  ops_die "recovery SQL assertion returned an unexpected result"
fi

if (( skip_backend == 0 )); then
  ops_log "Checking backend readiness"
  "${COMPOSE[@]}" exec -T "$BACKEND_SERVICE" wget \
    --no-verbose --tries=1 --spider "$BACKEND_HEALTH_URL" >/dev/null 2>&1 ||
    ops_die "backend readiness check failed"
fi

if [[ -n "$RECOVERY_REPORT_FILE" ]]; then
  if (( skip_backend == 0 )); then
    backend_check="enabled"
  else
    backend_check="skipped"
  fi
  printf '%s status=passed database=%s backend_check=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DB_NAME" "$backend_check" \
    >> "$RECOVERY_REPORT_FILE"
fi

ops_log "Recovery verification passed"

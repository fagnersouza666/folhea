#!/usr/bin/env bash
# Operational product aggregates, no private identifiers or destructive SQL.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "$SCRIPT_DIR/lib.sh"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.env}"
ops_require_file "$COMPOSE_ENV_FILE" 'Compose environment file'
set -a
source "$COMPOSE_ENV_FILE"
set +a
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.yml}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
DB_NAME="${DB_NAME:-folhea}"
DB_USERNAME="${DB_USERNAME:-folhea}"
window_days="${1:-7}"
ops_validate_positive_integer "$window_days" window_days
(( window_days <= 3660 )) || ops_die 'window_days must be at most 3660'
for name in POSTGRES_SERVICE DB_NAME DB_USERNAME; do ops_validate_name "${!name}" "$name"; done
ops_init_compose
ops_postgres_exec psql --no-password --quiet --tuples-only --no-align \
  --set=ON_ERROR_STOP=1 --set="window_days=$window_days" --username "$DB_USERNAME" --dbname "$DB_NAME" \
  --file=/dev/stdin < "$SCRIPT_DIR/product-metrics.sql"

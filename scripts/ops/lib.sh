#!/usr/bin/env bash

# Shared, deliberately small helpers for the PostgreSQL operations scripts.
# This file is sourced; it is not intended to be executed directly.

set -Eeuo pipefail
IFS=$'\n\t'

ops_log() {
  printf '[folhea-ops] %s\n' "$*" >&2
}
ops_die() {
  ops_log "ERROR: $*"
  exit 1
}

ops_require_command() {
  command -v "$1" >/dev/null 2>&1 || ops_die "required command is unavailable: $1"
}

ops_require_file() {
  local path="$1"
  local description="$2"

  [[ -f "$path" ]] || ops_die "$description does not exist: $path"
  [[ -r "$path" ]] || ops_die "$description is not readable: $path"
  [[ ! -L "$path" ]] || ops_die "$description must not be a symbolic link: $path"
}

ops_require_nonempty() {
  local value="$1"
  local name="$2"

  [[ -n "$value" ]] || ops_die "$name must not be empty"
}

ops_validate_name() {
  local value="$1"
  local name="$2"

  ops_require_nonempty "$value" "$name"
  [[ "$value" != *[[:space:]]* ]] || ops_die "$name must not contain whitespace"
  [[ "$value" =~ ^[[:alnum:]_.-]+$ ]] || ops_die "$name contains unsupported characters"
}

ops_validate_positive_integer() {
  local value="$1"
  local name="$2"

  [[ "$value" =~ ^[0-9]+$ ]] || ops_die "$name must be an integer"
  (( value > 0 )) || ops_die "$name must be greater than zero"
}

ops_validate_retention() {
  local value="$1"

  ops_validate_positive_integer "$value" BACKUP_RETENTION_DAYS
  (( value >= 7 )) || ops_die "BACKUP_RETENTION_DAYS must be at least 7 days"
}

ops_validate_target_directory() {
  local path="$1"
  local name="$2"

  ops_require_nonempty "$path" "$name"
  case "$path" in
    /|.|..)
      ops_die "$name points to an unsafe directory: $path"
      ;;
  esac
  [[ "$path" != *$'\n'* && "$path" != *$'\r'* ]] || ops_die "$name must not contain a newline"
}

ops_init_compose() {
  local docker_bin="${DOCKER_BIN:-docker}"

  ops_require_command "$docker_bin"
  ops_require_file "$COMPOSE_FILE" "Compose file"
  ops_require_file "$COMPOSE_ENV_FILE" "Compose environment file"
  COMPOSE=("$docker_bin" compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE")
  if [[ -n "${COMPOSE_PROJECT_NAME:-}" ]]; then
    ops_validate_name "$COMPOSE_PROJECT_NAME" COMPOSE_PROJECT_NAME
    COMPOSE+=(--project-name "$COMPOSE_PROJECT_NAME")
  fi
}

# An existing PostgreSQL container is NOT a service of the Folhea project.
# Only database client execution is supported; never Docker/Compose lifecycle.
ops_postgres_exec() {
  if [[ -z "${OPS_EXTERNAL_POSTGRES_CONTAINER:-}" ]]; then
    "${COMPOSE[@]}" exec -T "$POSTGRES_SERVICE" "$@"
    return
  fi
  case "${DB_NAME:-}:${DB_USERNAME:-}" in
    folhea:folhea_app|folhea_keycloak:folhea_keycloak) ;;
    *) ops_die "external transport permits only the dedicated Folhea DB/role pairs" ;;
  esac
  case "$1" in
    pg_dump|pg_restore|psql|pg_isready) ;;
    *) ops_die "external transport permits only PostgreSQL client tools" ;;
  esac
  local docker_bin="${DOCKER_BIN:-docker}" metadata version argument expected=""
  for argument in "$@"; do
    if [[ -n "$expected" ]]; then
      [[ "$argument" == "$expected" ]] || ops_die "client DB/role argument differs from the dedicated target"
      expected=""
      continue
    fi
    case "$argument" in
      --dbname|-d) expected="$DB_NAME" ;;
      --username|-U) expected="$DB_USERNAME" ;;
      --dbname=*) [[ "${argument#*=}" == "$DB_NAME" ]] || ops_die "client database argument differs" ;;
      --username=*) [[ "${argument#*=}" == "$DB_USERNAME" ]] || ops_die "client role argument differs" ;;
      --host*|-h|--port*|-p|--role*) ops_die "external endpoint or role override forbidden" ;;
    esac
  done
  [[ -z "$expected" ]] || ops_die "missing client DB/role argument"
  ops_validate_name "$OPS_EXTERNAL_POSTGRES_CONTAINER" OPS_EXTERNAL_POSTGRES_CONTAINER
  [[ "${OPS_EXTERNAL_POSTGRES_CONTAINER_ID:-}" =~ ^[0-9a-f]{64}$ ]] || ops_die "observed PG container ID required"
  [[ "${OPS_EXTERNAL_POSTGRES_IMAGE_ID:-}" =~ ^sha256:[0-9a-f]{64}$ ]] || ops_die "observed PG image ID required"
  metadata="$("$docker_bin" inspect --format '{{.Id}}|{{.Image}}|{{.State.Running}}|{{.State.Health.Status}}' "$OPS_EXTERNAL_POSTGRES_CONTAINER")" || ops_die "external PG metadata unavailable"
  [[ "$metadata" == "$OPS_EXTERNAL_POSTGRES_CONTAINER_ID|$OPS_EXTERNAL_POSTGRES_IMAGE_ID|true|healthy" ]] || ops_die "external PG identity or health changed"
  version="$("$docker_bin" exec "$OPS_EXTERNAL_POSTGRES_CONTAINER" pg_dump --version)" || ops_die "PG client version unavailable"
  [[ "$version" == 'pg_dump (PostgreSQL) 16.'* ]] || ops_die "compatible PostgreSQL 16 client required; never filter restore errors"
  "$docker_bin" exec -i "$OPS_EXTERNAL_POSTGRES_CONTAINER" "$@"
}

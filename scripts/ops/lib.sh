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
}

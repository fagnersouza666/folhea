#!/usr/bin/env bash
set -Eeuo pipefail

# Fails when a public bind is combined with Keycloak start-dev or missing prod overlay.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.yml}"
COMPOSE_PROD_FILE="${COMPOSE_PROD_FILE:-$ROOT/docker-compose.prod.yml}"
ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: environment file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

PUBLIC_BIND="${PUBLIC_BIND_ADDRESS:-127.0.0.1}"
if [[ "$PUBLIC_BIND" != "0.0.0.0" ]]; then
  echo "Production compose guard: PUBLIC_BIND_ADDRESS is not public; no further checks."
  exit 0
fi

if [[ ! -f "$COMPOSE_PROD_FILE" ]]; then
  echo "ERROR: PUBLIC_BIND_ADDRESS=0.0.0.0 requires docker-compose.prod.yml" >&2
  exit 1
fi

rendered="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$COMPOSE_PROD_FILE" config 2>/dev/null || true)"
if [[ -z "$rendered" ]]; then
  echo "ERROR: unable to render compose configuration for production guard" >&2
  exit 1
fi

if grep -q 'start-dev' <<<"$rendered"; then
  echo "ERROR: Keycloak start-dev must not be used when PUBLIC_BIND_ADDRESS=0.0.0.0" >&2
  exit 1
fi

if ! grep -q 'KC_HOSTNAME_STRICT: "true"' <<<"$rendered"; then
  echo "ERROR: KC_HOSTNAME_STRICT must be true for public production deploys" >&2
  exit 1
fi

echo "Production compose guard: OK"

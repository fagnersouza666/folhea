#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

ROOT="${FOLHEA_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="$ROOT/.env"
BACKEND_DIR="$ROOT/backend"
MVNW="$BACKEND_DIR/mvnw"

die() {
  printf 'dev-backend: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'dev-backend: aviso: %s\n' "$*" >&2
}

if [[ ! -f "$ENV_FILE" ]]; then
  die "arquivo .env não encontrado em $ROOT. Copie .env.example para .env e preencha os segredos."
fi

if [[ ! -x "$MVNW" ]]; then
  die "wrapper Maven não encontrado ou não executável em $MVNW"
fi

JAVA_BIN=""
if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" ]]; then
  JAVA_BIN="${JAVA_HOME}/bin/java"
elif command -v java >/dev/null 2>&1; then
  JAVA_BIN="$(command -v java)"
fi

if [[ -z "$JAVA_BIN" ]]; then
  die "java não encontrado. Instale o JDK 25 e exporte JAVA_HOME antes de subir o backend."
fi

java_major_version="$("$JAVA_BIN" -version 2>&1 | awk -F '[\".-]' '/version/ {print $2; exit}')"
if [[ -z "$java_major_version" || "$java_major_version" -lt 25 ]]; then
  die "JDK 25 ou superior é obrigatório (detectado: ${java_major_version:-desconhecido}). Exporte JAVA_HOME para o JDK 25 antes de continuar."
fi

if [[ -n "${JAVA_HOME:-}" ]]; then
  export PATH="${JAVA_HOME}/bin:${PATH}"
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [[ -z "${DB_PASSWORD:-}" ]]; then
  die "DB_PASSWORD está vazio após carregar .env. Defina um segredo em .env antes de subir o backend."
fi

if command -v docker >/dev/null 2>&1; then
  if ! docker ps --format '{{.Names}}' | grep -qx 'folhea-postgres-1'; then
    warn "container folhea-postgres-1 não está em execução. Suba com: docker compose --env-file .env up -d postgres keycloak"
  fi
  if ! docker ps --format '{{.Names}}' | grep -qx 'folhea-keycloak-1'; then
    warn "container folhea-keycloak-1 não está em execução. Suba com: docker compose --env-file .env up -d postgres keycloak"
  fi
fi

cd "$BACKEND_DIR"
exec "$MVNW" quarkus:dev

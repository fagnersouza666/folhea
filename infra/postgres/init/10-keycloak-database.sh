#!/usr/bin/env bash
set -euo pipefail

: "${KEYCLOAK_DB_NAME:?KEYCLOAK_DB_NAME is required}"
: "${KEYCLOAK_DB_USER:?KEYCLOAK_DB_USER is required}"
: "${KEYCLOAK_DB_PASSWORD:?KEYCLOAK_DB_PASSWORD is required}"

# psql variables provide identifier/literal escaping; credentials are never
# echoed into the container logs.
psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=keycloak_db="$KEYCLOAK_DB_NAME" \
  --set=keycloak_user="$KEYCLOAK_DB_USER" \
  --set=keycloak_password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
\set ON_ERROR_STOP on
CREATE USER :"keycloak_user" WITH PASSWORD :'keycloak_password';
CREATE DATABASE :"keycloak_db" OWNER :"keycloak_user";
SQL

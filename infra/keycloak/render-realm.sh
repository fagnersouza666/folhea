#!/bin/sh
set -eu

template="${KEYCLOAK_REALM_TEMPLATE:-/templates/folhea-realm.template.json}"
output="${KEYCLOAK_REALM_OUTPUT:-/opt/keycloak/data/import/folhea-realm.json}"

if [ -z "${OIDC_CLIENT_SECRET:-}" ]; then
  echo "OIDC_CLIENT_SECRET is required to render the Keycloak realm import." >&2
  exit 1
fi

export OIDC_CLIENT_SECRET
envsubst '${OIDC_CLIENT_SECRET}' < "$template" > "$output"
exec /opt/keycloak/bin/kc.sh "$@"

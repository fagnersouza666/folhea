#!/bin/bash
set -eu

template="${KEYCLOAK_REALM_TEMPLATE:-/templates/folhea-realm.template.json}"
output="${KEYCLOAK_REALM_OUTPUT:-/opt/keycloak/data/import/folhea-realm.json}"

if [ -z "${OIDC_CLIENT_SECRET:-}" ]; then
  echo "OIDC_CLIENT_SECRET is required to render the Keycloak realm import." >&2
  exit 1
fi

mkdir -p "$(dirname "$output")"
# The Keycloak image has no gettext. Build a sed script so the secret is
# copied literally and never expanded as shell.
sed_script=$(mktemp)
trap 'rm -f "$sed_script"' EXIT
{
  printf 's/'
  printf '%s' '${OIDC_CLIENT_SECRET}' | sed 's/[/\\&]/\\&/g'
  printf '/'
  printf '%s' "$OIDC_CLIENT_SECRET" | sed 's/[/\\&]/\\&/g'
  printf '/g\n'
} > "$sed_script"
sed -f "$sed_script" "$template" > "$output"
if [ "${FOLHEA_REALM_RENDER_ONLY:-}" = "1" ]; then
  exit 0
fi
exec /opt/keycloak/bin/kc.sh "$@"

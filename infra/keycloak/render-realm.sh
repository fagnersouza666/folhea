#!/bin/bash
set -euo pipefail
umask 077

template="${KEYCLOAK_REALM_TEMPLATE:-/templates/folhea-realm.template.json}"
output="${KEYCLOAK_REALM_OUTPUT:-/opt/keycloak/data/import/folhea-realm.json}"

for name in OIDC_CLIENT_SECRET KEYCLOAK_ADMIN_CLIENT_SECRET OIDC_PUBLIC_ORIGIN; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required to render the Keycloak realm import." >&2
    exit 1
  fi
done
if [[ ! "$OIDC_PUBLIC_ORIGIN" =~ ^https?://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]]; then
  echo 'OIDC_PUBLIC_ORIGIN must be an HTTP(S) origin without path or trailing slash.' >&2
  exit 1
fi

# JSON-escape before sed-escaping: literal substitution alone corrupts secrets
# containing quotes, backslashes or newlines. Values are never shell-evaluated.
json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  if LC_ALL=C printf '%s' "$value" | LC_ALL=C grep -q '[[:cntrl:]]'; then
    echo 'Realm variable contains an unsupported control character.' >&2
    return 1
  fi
  printf '%s' "$value"
}

mkdir -p "$(dirname "$output")"
sed_script=$(mktemp)
rendered=$(mktemp "${output}.XXXXXX")
trap 'rm -f "$sed_script" "$rendered"' EXIT
for name in OIDC_CLIENT_SECRET KEYCLOAK_ADMIN_CLIENT_SECRET OIDC_PUBLIC_ORIGIN; do
  value=$(json_escape "${!name}")
  printf 's/\${%s}/%s/g\n' "$name" "$(printf '%s' "$value" | sed 's/[/\\&]/\\&/g')" >> "$sed_script"
done
sed -f "$sed_script" "$template" > "$rendered"
chmod 600 "$rendered"
mv "$rendered" "$output"
if [[ "${FOLHEA_REALM_RENDER_ONLY:-}" == "1" ]]; then
  exit 0
fi
exec /opt/keycloak/bin/kc.sh "$@"

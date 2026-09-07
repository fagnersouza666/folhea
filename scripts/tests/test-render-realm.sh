#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/infra/keycloak/render-realm.sh"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/folhea-realm-test.XXXXXX")"

cleanup() {
  rm -rf -- "$WORKDIR"
}
trap cleanup EXIT

fail() {
  printf 'not ok - %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'ok - %s\n' "$*"
}

render() {
  local template=$1 secret=$2
  local template_path="$WORKDIR/template.json"
  local output_path="$WORKDIR/out.json"
  printf '%s' "$template" > "$template_path"
  FOLHEA_REALM_RENDER_ONLY=1 \
    KEYCLOAK_REALM_TEMPLATE="$template_path" \
    KEYCLOAK_REALM_OUTPUT="$output_path" \
    OIDC_CLIENT_SECRET="$secret" \
    bash "$SCRIPT"
  cat "$output_path"
}

expect_eq() {
  local actual=$1 expected=$2 label=$3
  [[ "$actual" == "$expected" ]] || fail "$label: expected $(printf %q "$expected"), got $(printf %q "$actual")"
  pass "$label"
}

expect_eq "$(render '{"secret":"${OIDC_CLIENT_SECRET}"}' 'plain-secret')" \
  '{"secret":"plain-secret"}' \
  'copies a secret without special characters'

expect_eq "$(render '{"secret":"${OIDC_CLIENT_SECRET}"}' 'abc/def&ghi\jkl')" \
  '{"secret":"abc/def&ghi\jkl"}' \
  'keeps slash, ampersand and backslash in the secret'

expect_eq "$(render '{"secret":"${OIDC_CLIENT_SECRET}"}' 'a$(id)&b/c\d')" \
  '{"secret":"a$(id)&b/c\d"}' \
  'copies command-like characters without expanding them'

expect_eq "$(render 'no-placeholder' 'abc&def')" \
  'no-placeholder' \
  'leaves templates without the placeholder unchanged'

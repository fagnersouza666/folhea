#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../../infra/keycloak/render-realm.sh
source "$ROOT/infra/keycloak/render-realm.sh"

fail() {
  printf 'not ok - %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'ok - %s\n' "$*"
}

expect_eq() {
  local actual=$1 expected=$2 label=$3
  [[ "$actual" == "$expected" ]] || fail "$label: expected $(printf %q "$expected"), got $(printf %q "$actual")"
  pass "$label"
}

template='{"secret":"${OIDC_CLIENT_SECRET}"}'

expect_eq "$(folhea_render_oidc_secret "$template" 'plain-secret')" \
  '{"secret":"plain-secret"}' \
  'copies a secret without special characters'

expect_eq "$(folhea_render_oidc_secret "$template" 'abc/def&ghi\jkl')" \
  '{"secret":"abc/def&ghi\jkl"}' \
  'keeps slash, ampersand and backslash in the secret'

expect_eq "$(folhea_render_oidc_secret 'no-placeholder' 'abc&def')" \
  'no-placeholder' \
  'leaves templates without the placeholder unchanged'

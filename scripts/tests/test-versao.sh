#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/versao.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/folhea-versao-test.XXXXXX")"

cleanup() {
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'not ok - %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'ok - %s\n' "$*"
}

write_tree() {
  local frontend_version="$1" backend_version="$2" openapi_version="$3"
  mkdir -p "$TEST_ROOT/frontend" "$TEST_ROOT/backend/src/main/resources"
  cat > "$TEST_ROOT/frontend/package.json" <<EOF
{"name":"folhea-frontend","version":"$frontend_version"}
EOF
  cat > "$TEST_ROOT/frontend/package-lock.json" <<EOF
{
  "name": "folhea-frontend",
  "version": "$frontend_version",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "folhea-frontend",
      "version": "$frontend_version"
    }
  }
}
EOF
  cat > "$TEST_ROOT/backend/pom.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<project>
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.folhea</groupId>
    <artifactId>folhea-backend</artifactId>
    <version>$backend_version</version>
</project>
EOF
  cat > "$TEST_ROOT/backend/src/main/resources/application.properties" <<EOF
quarkus.smallrye-openapi.info-title=Folhea API
quarkus.smallrye-openapi.info-version=$openapi_version
EOF
}

run_versao() {
  FOLHEA_ROOT="$TEST_ROOT" "$SCRIPT" "$@"
}

write_tree "0.1.0" "0.1.0" "0.1.0"

output="$(run_versao atual)"
[[ "$output" == *"0.1.0"* ]] || fail "atual should print 0.1.0"
[[ "$output" == *"mesma versão"* ]] || fail "atual should confirm matching versions"
pass "atual reports matching versions"

run_versao verificar >/dev/null || fail "verificar should pass when versions match"
pass "verificar accepts matching versions"

run_versao corrigir >/dev/null || fail "corrigir should bump patch"
[[ "$(node -pe "require('$TEST_ROOT/frontend/package.json').version")" == "0.1.1" ]] || fail "frontend should become 0.1.1"
[[ "$(grep -m1 -oP '(?<=<version>)[^<]+' "$TEST_ROOT/backend/pom.xml")" == "0.1.1" ]] || fail "backend should become 0.1.1"
[[ "$(grep -m1 -E '^quarkus\.smallrye-openapi\.info-version=' "$TEST_ROOT/backend/src/main/resources/application.properties" | cut -d= -f2-)" == "0.1.1" ]] || fail "OpenAPI should become 0.1.1"
[[ "$(node -pe "require('$TEST_ROOT/frontend/package-lock.json').version")" == "0.1.1" ]] || fail "lockfile should become 0.1.1"
pass "corrigir bumps patch on all product version files"

run_versao funcionalidade >/dev/null || fail "funcionalidade should bump minor"
[[ "$(node -pe "require('$TEST_ROOT/frontend/package.json').version")" == "0.2.0" ]] || fail "frontend should become 0.2.0"
pass "funcionalidade bumps minor and resets patch"

run_versao grande >/dev/null || fail "grande should bump major"
[[ "$(node -pe "require('$TEST_ROOT/frontend/package.json').version")" == "1.0.0" ]] || fail "frontend should become 1.0.0"
pass "grande bumps major and resets minor/patch"

write_tree "0.1.0" "1.0.0-SNAPSHOT" "1.0"
if FOLHEA_ROOT="$TEST_ROOT" "$SCRIPT" verificar >/dev/null 2>&1; then
  fail "verificar should fail when versions diverge"
fi
pass "verificar rejects diverging versions"

if FOLHEA_ROOT="$TEST_ROOT" "$SCRIPT" corrigir >/dev/null 2>&1; then
  fail "corrigir should refuse to bump diverging versions"
fi
pass "corrigir refuses to choose a version when files already diverge"

write_tree "1.0.0-SNAPSHOT" "1.0.0-SNAPSHOT" "1.0.0-SNAPSHOT"
if FOLHEA_ROOT="$TEST_ROOT" "$SCRIPT" corrigir >/dev/null 2>&1; then
  fail "corrigir should reject -SNAPSHOT"
fi
pass "corrigir rejects SNAPSHOT versions"

write_tree "0.1.0" "0.1.0" "0.1.0"
printf 'quarkus.smallrye-openapi.info-title=Folhea API\n' > "$TEST_ROOT/backend/src/main/resources/application.properties"
if FOLHEA_ROOT="$TEST_ROOT" "$SCRIPT" atual >/dev/null 2>&1; then
  fail "atual should fail when OpenAPI version property is missing"
fi
pass "atual fails when OpenAPI version property is missing"

write_tree "0.1.0" "0.1.0" "0.1.0"
if FOLHEA_ROOT="$TEST_ROOT" "$SCRIPT" desconhecido >/dev/null 2>&1; then
  fail "unknown command should fail"
fi
pass "unknown command fails"

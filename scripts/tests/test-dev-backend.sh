#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/dev-backend.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/folhea-dev-backend-test.XXXXXX")"

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

write_stub_mvnw() {
  cat > "$TEST_ROOT/backend/mvnw" <<'EOF'
#!/usr/bin/env bash
printf 'stub mvnw invoked: %s\n' "$*"
exit 0
EOF
  chmod +x "$TEST_ROOT/backend/mvnw"
}

write_env() {
  local password="$1"
  cat > "$TEST_ROOT/.env" <<EOF
DB_USERNAME=folhea
DB_PASSWORD=$password
DB_JDBC_URL=jdbc:postgresql://localhost:5433/folhea
EOF
}

write_stub_java() {
  cat > "$TEST_ROOT/bin/java" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "-version" ]]; then
  printf 'openjdk version "25.0.1"\n'
  exit 0
fi
printf 'stub java invoked\n'
exit 0
EOF
  chmod +x "$TEST_ROOT/bin/java"
}

run_dev_backend() {
  PATH="$TEST_ROOT/bin:$PATH" FOLHEA_ROOT="$TEST_ROOT" "$SCRIPT" "$@"
}

mkdir -p "$TEST_ROOT/backend" "$TEST_ROOT/bin"
write_stub_java
write_stub_mvnw

if [[ -f "$TEST_ROOT/.env" ]]; then
  fail "test root should not start with .env"
fi

output="$(run_dev_backend 2>&1)" && fail "should fail when .env is missing"
[[ "$output" == *".env não encontrado"* ]] || fail "missing .env should mention .env"
pass "fails clearly when .env is missing"

write_env ""
output="$(run_dev_backend 2>&1)" && fail "should fail when DB_PASSWORD is empty"
[[ "$output" == *"DB_PASSWORD está vazio"* ]] || fail "empty DB_PASSWORD should be reported"
pass "fails clearly when DB_PASSWORD is empty"

write_env "local-test-secret"
rm -f "$TEST_ROOT/backend/.env"
output="$(run_dev_backend 2>&1)" || fail "should succeed with valid .env and stub mvnw"
[[ "$output" == *"stub mvnw invoked: quarkus:dev"* ]] || fail "should exec mvnw quarkus:dev"
pass "loads .env and execs mvnw quarkus:dev"

[[ -L "$TEST_ROOT/backend/.env" ]] || fail "should create backend/.env symlink when absent"
[[ "$(readlink -- "$TEST_ROOT/backend/.env")" == "../.env" ]] || fail "created symlink should point to ../.env"
pass "creates backend/.env symlink when absent"

output="$(run_dev_backend 2>&1)" || fail "should succeed when backend/.env already points to ../.env"
[[ "$(readlink -- "$TEST_ROOT/backend/.env")" == "../.env" ]] || fail "should keep existing ../.env symlink"
[[ "$output" != *"aviso: backend/.env"* ]] || fail "correct symlink should not warn"
pass "keeps existing backend/.env symlink to ../.env"

rm -f "$TEST_ROOT/backend/.env"
printf 'keep-me\n' > "$TEST_ROOT/backend/.env"
output="$(run_dev_backend 2>&1)" || fail "should succeed when backend/.env is a regular file"
[[ "$output" == *"aviso: backend/.env já existe como arquivo regular"* ]] || fail "regular file should warn without overwrite"
[[ ! -L "$TEST_ROOT/backend/.env" ]] || fail "must not replace regular backend/.env with a symlink"
[[ "$(cat "$TEST_ROOT/backend/.env")" == "keep-me" ]] || fail "must not overwrite regular backend/.env"
pass "warns and keeps regular backend/.env"

rm -f "$TEST_ROOT/backend/.env"
ln -sfn /tmp/nao-e-o-env-da-raiz "$TEST_ROOT/backend/.env"
output="$(run_dev_backend 2>&1)" || fail "should succeed when backend/.env is a wrong symlink"
[[ "$(readlink -- "$TEST_ROOT/backend/.env")" == "../.env" ]] || fail "wrong symlink should be replaced with ../.env"
[[ "$output" != *"arquivo regular"* ]] || fail "replacing a wrong symlink should not warn as regular file"
pass "repairs backend/.env when it is a wrong symlink"

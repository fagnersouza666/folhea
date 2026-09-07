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
output="$(run_dev_backend 2>&1)" || fail "should succeed with valid .env and stub mvnw"
[[ "$output" == *"stub mvnw invoked: quarkus:dev"* ]] || fail "should exec mvnw quarkus:dev"
pass "loads .env and execs mvnw quarkus:dev"

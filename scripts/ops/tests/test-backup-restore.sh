#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/folhea-ops-test.XXXXXX")"
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

assert_file() {
  [[ -f "$1" ]] || fail "expected file: $1"
}

assert_failure() {
  if "$@" >/dev/null 2>&1; then
    fail "expected command to fail: $*"
  fi
}

cat > "$TEST_ROOT/docker-compose.yml" <<'YAML'
services:
  postgres:
    image: postgres:18
  backend:
    image: folhea-test
YAML
printf 'DB_PASSWORD=test-only-placeholder\n' > "$TEST_ROOT/.env"
printf 'PGDMP test fixture\n' > "$TEST_ROOT/seed.dump"

cat > "$TEST_ROOT/fake-docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

[[ "${1:-}" == compose ]] || exit 2
command_name=""
for argument in "$@"; do
  case "$argument" in
    pg_dump|pg_restore|pg_isready|psql|wget)
      command_name="$argument"
      ;;
  esac
done

printf '%s\n' "$command_name" >> "${FAKE_DOCKER_LOG:?}"
list_mode=0
for argument in "$@"; do
  [[ "$argument" == --list ]] && list_mode=1
done
if [[ "$command_name" == pg_restore && "${FAKE_DOCKER_FAIL_LIST:-0}" == 1 && "$list_mode" == 1 ]]; then
  exit 1
fi
case "$command_name" in
  pg_dump)
    [[ "${FAKE_DOCKER_FAIL_DUMP:-0}" != 1 ]]
    printf 'PGDMP fake custom-format dump\n'
    ;;
  pg_restore)
    cat >/dev/null
    ;;
  pg_isready)
    [[ "${FAKE_DOCKER_FAIL_READY:-0}" != 1 ]]
    ;;
  psql)
    [[ "${FAKE_DOCKER_FAIL_SQL:-0}" != 1 ]]
    printf '1\n'
    ;;
  wget)
    [[ "${FAKE_DOCKER_FAIL_HEALTH:-0}" != 1 ]]
    ;;
  *)
    exit 2
    ;;
esac
FAKE_DOCKER
chmod 700 "$TEST_ROOT/fake-docker"

cat > "$TEST_ROOT/fake-aws" <<'FAKE_AWS'
#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

printf '%s\n' "$*" >> "${FAKE_AWS_LOG:?}"
case "${1:-} ${2:-}" in
  s3\ cp|s3api\ head-object)
    ;;
  *)
    exit 2
    ;;
esac
FAKE_AWS
chmod 700 "$TEST_ROOT/fake-aws"

export DOCKER_BIN="$TEST_ROOT/fake-docker"
export FAKE_DOCKER_LOG="$TEST_ROOT/docker.log"
export COMPOSE_FILE="$TEST_ROOT/docker-compose.yml"
export COMPOSE_ENV_FILE="$TEST_ROOT/.env"
export BACKUP_DIR="$TEST_ROOT/local"
export BACKUP_EXTERNAL_DESTINATION="file://$TEST_ROOT/external"
export DB_NAME=folhea
export DB_USERNAME=folhea

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
backup_script="$SCRIPT_DIR/backup-postgres.sh"
restore_script="$SCRIPT_DIR/restore-postgres.sh"
verify_script="$SCRIPT_DIR/verify-recovery.sh"

mkdir -p "$BACKUP_DIR"
printf 'old dump\n' > "$BACKUP_DIR/folhea-20000101T000000Z.dump"
printf 'old checksum\n' > "$BACKUP_DIR/folhea-20000101T000000Z.dump.sha256"
touch -d '10 days ago' "$BACKUP_DIR/folhea-20000101T000000Z.dump" "$BACKUP_DIR/folhea-20000101T000000Z.dump.sha256"

bash "$backup_script" --retention-days 7
artifact="$(find "$BACKUP_DIR" -maxdepth 1 -name 'folhea-*.dump' -not -name 'folhea-20000101T000000Z.dump' -print -quit)"
assert_file "$artifact"
assert_file "$artifact.sha256"
assert_file "$TEST_ROOT/external/$(basename -- "$artifact")"
assert_file "$TEST_ROOT/external/$(basename -- "$artifact").sha256"
[[ "$(stat -c '%a' "$artifact")" == 600 ]] || fail 'backup artifact is not private'
[[ ! -e "$BACKUP_DIR/folhea-20000101T000000Z.dump" ]] || fail 'retention did not remove old dump'
grep -Fq 'pg_dump' "$FAKE_DOCKER_LOG" || fail 'backup did not invoke pg_dump'
if grep -Fq 'test-only-placeholder' "$FAKE_DOCKER_LOG"; then
  fail 'backup command log contains a password'
fi
pass 'backup creates private custom-format artifact, checksum, and external copy'

export FAKE_AWS_LOG="$TEST_ROOT/aws.log"
env BACKUP_DIR="$TEST_ROOT/s3-local" \
  BACKUP_EXTERNAL_DESTINATION=s3://bucket/prefix \
  AWS_BIN="$TEST_ROOT/fake-aws" \
  bash "$backup_script"
[[ "$(grep -c 'head-object' "$FAKE_AWS_LOG")" == 2 ]] || fail 'S3 backup did not verify both objects'
pass 'backup uploads and verifies S3 artifact and checksum'

assert_failure env BACKUP_RETENTION_DAYS=6 bash "$backup_script"
assert_failure env COMPOSE_ENV_FILE="$TEST_ROOT/missing.env" bash "$backup_script"
assert_failure env BACKUP_DIR="$TEST_ROOT/failed" FAKE_DOCKER_FAIL_DUMP=1 bash "$backup_script"
[[ -z "$(find "$TEST_ROOT/failed" -name '.folhea-*' -print -quit 2>/dev/null)" ]] || fail 'failed backup left a temporary artifact'
pass 'backup rejects unsafe retention, missing environment, and dump failures'

restore_log_before="$(wc -l < "$FAKE_DOCKER_LOG")"
bash "$restore_script" "$artifact"
restore_log_after="$(wc -l < "$FAKE_DOCKER_LOG")"
(( restore_log_after > restore_log_before )) || fail 'restore did not invoke Compose'
tail -n +$((restore_log_before + 1)) "$FAKE_DOCKER_LOG" | grep -Fq 'pg_restore' || fail 'restore did not invoke pg_restore'
pass 'restore accepts a checksummed custom-format artifact'

gzip_backup="$TEST_ROOT/compressed.dump.gz"
gzip -c "$artifact" > "$gzip_backup"
sha256sum "$gzip_backup" > "$gzip_backup.sha256"
bash "$restore_script" "$gzip_backup"
pass 'restore accepts gzip-compressed artifacts'

tampered_backup="$TEST_ROOT/tampered.dump"
cp -- "$artifact" "$tampered_backup"
printf 'tampered\n' >> "$tampered_backup"
cp -- "$artifact.sha256" "$tampered_backup.sha256"
restore_log_before="$(wc -l < "$FAKE_DOCKER_LOG")"
assert_failure bash "$restore_script" "$tampered_backup"
restore_log_after="$(wc -l < "$FAKE_DOCKER_LOG")"
[[ "$restore_log_after" == "$restore_log_before" ]] || fail 'checksum failure reached pg_restore'
pass 'restore rejects a tampered artifact before database access'

invalid_backup="$TEST_ROOT/invalid.dump"
printf 'not a PostgreSQL dump\n' > "$invalid_backup"
restore_log_before="$(wc -l < "$FAKE_DOCKER_LOG")"
assert_failure env FAKE_DOCKER_FAIL_LIST=1 bash "$restore_script" "$invalid_backup"
restore_log_after="$(wc -l < "$FAKE_DOCKER_LOG")"
(( restore_log_after == restore_log_before + 1 )) || fail 'format failure reached destructive restore'
pass 'restore validates custom format before database access'

assert_failure env RESTORE_TARGET=production bash "$restore_script" "$artifact"
bash "$restore_script" "$artifact" --target production --confirm-production-restore
pass 'production restore requires explicit confirmation'

bash "$verify_script" --report-file "$TEST_ROOT/recovery.log"
assert_file "$TEST_ROOT/recovery.log"
grep -Fq 'status=passed' "$TEST_ROOT/recovery.log" || fail 'verification report is not successful'
pass 'recovery verification checks database and backend readiness'

assert_failure env FAKE_DOCKER_FAIL_HEALTH=1 bash "$verify_script"
pass 'recovery verification reports backend health failures'

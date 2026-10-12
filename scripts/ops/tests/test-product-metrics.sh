#!/usr/bin/env bash
# Formula/legacy V009 regression against fresh isolated PostgreSQL.
# Java V010 is exercised by BookPhotoMigrationTest through actual Flyway/JVM.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
container="folhea-product-metrics-test-$RANDOM-$$"
scratch="$(mktemp -d)"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$scratch"' EXIT
docker run -d --name "$container" --label "ao.session=${AO_SESSION_ID:-manual}" \
  --network none --tmpfs /var/lib/postgresql:rw,size=512m \
  -e POSTGRES_USER=quarkus -e POSTGRES_PASSWORD=quarkus -e POSTGRES_DB=quarkus \
  postgres:18.6 >/dev/null
ready=0
for ((attempt=0;attempt<60;attempt++)); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U quarkus -d quarkus >/dev/null 2>&1; then ready=1;break;fi
  sleep .25
done
[[ "$ready" == 1 ]]
for migration in "$ROOT"/backend/src/main/resources/db/migration/*.sql; do
  docker exec -i "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus < "$migration" >/dev/null
done
# Retain every historical V007/V008/V009 assertion without treating this
# SQL-only fixture as a JVM V010 migration. The current default must reject it.
LEGACY_V009_SQL="SELECT CASE WHEN EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE version IN ('7', '007') AND success) AND EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE version IN ('8', '008') AND success) AND EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE version IN ('9', '009') AND success) AND to_regclass('public.folhea_user') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'folhea_user' AND column_name IN ('password_hash', 'login_identifier')) AND to_regclass('public.account_deletion') IS NOT NULL AND to_regclass('public.book_cover') IS NOT NULL THEN 1 ELSE 0 END;"
# Exercise the recovery script against PostgreSQL itself. Only Compose dispatch
# is adapted to this isolated container; no database/provider response is mocked.
cat > "$scratch/compose-db" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
while (($#)); do
  case "$1" in
    pg_isready|psql) exec docker exec "${RECOVERY_TEST_CONTAINER:?}" "$@" ;;
  esac
  shift
done
exit 2
SH
chmod 700 "$scratch/compose-db"
printf 'services: {}\n' > "$scratch/compose.yml"
printf 'DB_NAME=quarkus\n' > "$scratch/recovery.env"
verify_current_recovery() {
  env DOCKER_BIN="$scratch/compose-db" RECOVERY_TEST_CONTAINER="$container" \
    COMPOSE_FILE="$scratch/compose.yml" COMPOSE_ENV_FILE="$scratch/recovery.env" \
    bash "$ROOT/scripts/ops/verify-recovery.sh" --database quarkus --username quarkus --skip-backend
}
verify_recovery() {
  RECOVERY_VERIFY_SQL="$LEGACY_V009_SQL" verify_current_recovery
}
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "CREATE TABLE flyway_schema_history(version varchar(50), success boolean, type varchar(20) DEFAULT 'SQL'); INSERT INTO flyway_schema_history(version,success) SELECT lpad(n::text, 3, '0'), true FROM generate_series(1, 6) n; UPDATE flyway_schema_history SET version = '6' WHERE version = '006';"
if verify_recovery > "$scratch/verify.log" 2>&1; then
  echo 'not ok - recovery accepted a schema without successful V007' >&2; exit 1
fi
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "UPDATE flyway_schema_history SET version = '006' WHERE version = '6';"
if verify_recovery > "$scratch/verify.log" 2>&1; then
  echo 'not ok - recovery accepted a schema with only real Flyway V006' >&2; exit 1
fi
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "INSERT INTO flyway_schema_history(version,success) VALUES ('7', false);"
if verify_recovery > "$scratch/verify.log" 2>&1; then
  echo 'not ok - recovery accepted a failed V007' >&2; exit 1
fi
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "UPDATE flyway_schema_history SET version = '007' WHERE version = '7';"
if verify_recovery > "$scratch/verify.log" 2>&1; then
  echo 'not ok - recovery accepted a failed real Flyway V007' >&2; exit 1
fi
# A restore of the previous schema cannot pass the bookshelf recovery guard.
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "UPDATE flyway_schema_history SET success = true WHERE version = '007';"
if verify_recovery > "$scratch/verify.log" 2>&1; then
  echo 'not ok - recovery accepted successful V007 without V008 and private covers' >&2; exit 1
fi
# Flyway in the actual Quarkus runtime stores V001..V009 as 001..009.
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "INSERT INTO flyway_schema_history(version,success) VALUES ('8', false);"
if verify_recovery > "$scratch/verify.log" 2>&1; then
  echo 'not ok - recovery accepted failed V008' >&2; exit 1
fi
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "UPDATE flyway_schema_history SET version = '008' WHERE version = '8';"
if verify_recovery > "$scratch/verify.log" 2>&1; then
  echo 'not ok - recovery accepted failed real Flyway V008' >&2; exit 1
fi
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "UPDATE flyway_schema_history SET success = true WHERE version = '008';"
# Tables/removed columns come from the actual migrations above, not stand-ins.
if verify_recovery > "$scratch/verify.log" 2>&1; then
  echo 'not ok - recovery accepted successful V008 without V009 credential removal' >&2; exit 1
fi
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "INSERT INTO flyway_schema_history(version,success) VALUES ('9', false);"
if verify_recovery > "$scratch/verify.log" 2>&1; then
  echo 'not ok - recovery accepted failed V009' >&2; exit 1
fi
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "UPDATE flyway_schema_history SET version = '009' WHERE version = '9';"
if verify_recovery > "$scratch/verify.log" 2>&1; then
  echo 'not ok - recovery accepted failed real Flyway V009' >&2; exit 1
fi
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "UPDATE flyway_schema_history SET success = true WHERE version = '009';"
verify_recovery
for column in password_hash login_identifier; do
  docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
    -c "ALTER TABLE folhea_user ADD COLUMN $column TEXT;"
  if verify_recovery > "$scratch/verify.log" 2>&1; then
    echo 'not ok - successful V009 masked a delegated credential column' >&2; exit 1
  fi
  docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
    -c "ALTER TABLE folhea_user DROP COLUMN $column;"
  verify_recovery
done
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "UPDATE flyway_schema_history SET version = '8' WHERE version = '008'; UPDATE flyway_schema_history SET version = '7' WHERE version = '007'; UPDATE flyway_schema_history SET version = '9' WHERE version = '009';"
verify_recovery
for table in account_deletion book_cover folhea_user; do
  docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
    -c "ALTER TABLE $table RENAME TO hidden_$table;"
  if verify_recovery > "$scratch/verify.log" 2>&1; then
    echo "not ok - recovery accepted missing $table" >&2; exit 1
  fi
  docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
    -c "ALTER TABLE hidden_$table RENAME TO $table;"
  verify_recovery
done
# Presence of the table and a successful V008 must not mask failed V007 state.
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "UPDATE flyway_schema_history SET success = false WHERE version = '7';"
if verify_recovery > "$scratch/verify.log" 2>&1; then
  echo 'not ok - V008 masked failed V007 durable deletion state' >&2; exit 1
fi
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c "UPDATE flyway_schema_history SET success = true WHERE version = '7';"
verify_recovery
echo 'ok - historical V009 PostgreSQL recovery regression: 7/007, 8/008, 9/009, no delegated credential columns, covers and durable deletion'
if verify_current_recovery > "$scratch/verify-current.log" 2>&1; then
  echo 'not ok - current default accepted a SQL-only fixture without actual JVM V010' >&2; exit 1
fi
echo 'ok - current default rejects SQL-only V009; V010 positive/negative assertions require BookPhotoMigrationTest real Flyway/JVM'
docker exec -i "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus <<'SQL'
INSERT INTO folhea_user(id,identity_subject,email,timezone,created_at,updated_at)
SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'fixture-'||n,
       'fixture-'||n||'@example.com','UTC',now()-make_interval(days=>CASE WHEN n=4 THEN 1 ELSE 30 END),now()
FROM generate_series(1,4) n;
INSERT INTO book(id,user_id,title,status,created_at,updated_at)
SELECT gen_random_uuid(),id,'Fixture','READING',now(),now() FROM folhea_user;
INSERT INTO reading_session(id,user_id,book_id,reading_date,pages,minutes,created_at,updated_at)
SELECT gen_random_uuid(),b.user_id,b.id,current_date-v.age,1,0,now(),now()
FROM (VALUES (1,30),(1,29),(1,28),(1,23),(1,1),(1,0),(2,30),(4,0)) v(n,age)
JOIN book b ON b.user_id=('00000000-0000-0000-0000-'||lpad(v.n::text,12,'0'))::uuid;
SQL
docker exec -i "$container" psql -XqtA -v ON_ERROR_STOP=1 -v window_days=7 -U quarkus -d quarkus \
  < "$ROOT/scripts/ops/product-metrics.sql" > "$scratch/cohorts.json"
python3 - "$scratch/cohorts.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x['activation']=={'users':3,'eligible_users':4,'percent':75.00}
assert x['strong_activation']=={'users':1,'eligible_users':3,'percent':33.33}
assert x['next_week_retention']=={'users':1,'eligible_users':2,'percent':50.00}
assert x['frequency']=={'sessions':3,'active_users':2,'sessions_per_active_user':1.50}
assert x['north_star']=={'reading_days':3,'active_users':2,'reading_days_per_active_user':1.50}
assert all(name not in json.dumps(x) for name in ['email','identity_subject','title','author'])
print('ok - real SQL cohorts, denominators, incomplete windows and distinct reading days')
PY
docker exec "$container" psql -Xq -v ON_ERROR_STOP=1 -U quarkus -d quarkus \
  -c 'TRUNCATE folhea_user CASCADE' >/dev/null 2>&1
docker exec -i "$container" psql -XqtA -v ON_ERROR_STOP=1 -v window_days=7 -U quarkus -d quarkus \
  < "$ROOT/scripts/ops/product-metrics.sql" > "$scratch/empty.json"
python3 - "$scratch/empty.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
assert x['activation']['percent'] is None
assert x['strong_activation']['percent'] is None
assert x['next_week_retention']['percent'] is None
assert x['frequency']['sessions_per_active_user'] is None
assert x['north_star']['reading_days_per_active_user'] is None
print('ok - empty denominators remain null')
PY

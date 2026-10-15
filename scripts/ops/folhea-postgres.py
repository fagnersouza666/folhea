#!/usr/bin/env python3
"""Plan/check/provision ONLY Folhea objects in the existing PostgreSQL.

Default is a pure plan. SQL uses normal local socket access, never credentials
from other applications. No container/network/volume lifecycle operations.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

DATABASES = {'folhea': ('folhea_app', 'app'), 'folhea_keycloak': ('folhea_keycloak', 'keycloak')}
CONTAINER = None
NETWORK = None
PROXY_NETWORK = None
SECRET_FILE = None


class DatabaseFailure(RuntimeError):
    pass


def require(value, category):
    if not value: raise DatabaseFailure(category)


def configure(container, network, *, proxy_network, secret_file=None):
    require(all(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', value)
                for value in (container, network, proxy_network)), 'explicit-private-db-endpoint-required')
    require(network != proxy_network, 'database-on-proxy-network-forbidden')
    global CONTAINER, NETWORK, PROXY_NETWORK, SECRET_FILE
    CONTAINER, NETWORK, PROXY_NETWORK = container, network, proxy_network
    SECRET_FILE = Path(secret_file) if secret_file else None


def database_role(name):
    require(name in DATABASES, 'only-dedicated-folhea-database-allowed')
    return DATABASES[name][0]


def sql(query, database='postgres', role='postgres'):
    require(CONTAINER is not None, 'explicit-private-db-endpoint-required')
    require((database == role == 'postgres') or database_role(database) == role,
            'normal-admin-or-own-db-role-required')
    try:
        p = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '--no-password',
                            '--host=/var/run/postgresql', '--username', role, '--dbname', database,
                            '-v', 'ON_ERROR_STOP=1', '-qAt'], input=query.encode(),
                           capture_output=True, timeout=45, check=True)
        return p.stdout.decode()
    except (OSError, subprocess.SubprocessError):
        raise DatabaseFailure('normal-pg-operation-failed-no-credential-retry') from None


def inspect_catalog():
    query = """BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT json_build_object('version',current_setting('server_version'),
 'max_connections',current_setting('max_connections')::int,
 'connections',(SELECT count(*) FROM pg_stat_activity),
 'encoding',pg_encoding_to_char(encoding),'collate',datcollate,
 'ctype',datctype,'provider',datlocprovider::text) FROM pg_database WHERE datname=current_database();
ROLLBACK;
"""
    rows = [json.loads(x) for x in sql(query).splitlines() if x.startswith('{')]
    require(len(rows) == 1, 'catalog-metadata-unavailable'); out = rows[0]; out['objects'] = {}
    for database, (role, kind) in DATABASES.items():
        # Names are the fixed allowlist above; passwords/hashes/user data are absent.
        query = f"""BEGIN READ ONLY;
SELECT json_build_object('role',
 (SELECT json_build_object('name',rolname,'marker',shobj_description(oid,'pg_authid'),
   'login',rolcanlogin,'superuser',rolsuper,'createdb',rolcreatedb,'createrole',rolcreaterole,
   'replication',rolreplication,'bypassrls',rolbypassrls,
   'memberships',(SELECT count(*) FROM pg_auth_members WHERE member=r.oid))
  FROM pg_roles r WHERE rolname='{role}'),
 'database',(SELECT json_build_object('owner',pg_get_userbyid(datdba),
   'marker',shobj_description(oid,'pg_database'),'encoding',pg_encoding_to_char(encoding),
   'collate',datcollate,'ctype',datctype,'provider',datlocprovider::text,
   'public_database_acl',EXISTS(SELECT FROM aclexplode(coalesce(datacl,acldefault('d',datdba))) WHERE grantee=0))
   FROM pg_database WHERE datname='{database}'));
ROLLBACK;
"""
        item = next(json.loads(x) for x in sql(query).splitlines() if x.startswith('{'))
        if item['database'] and item['role']:
            # Inspect only the OWN schema after ownership/marker identity matches.
            expected = 'folhea:' + kind + ':v1'
            if item['database']['marker'] == item['role']['marker'] == expected and item['database']['owner'] == role:
                item['database']['public_schema_acl'] = sql("BEGIN READ ONLY; SELECT EXISTS(SELECT FROM pg_namespace n, LATERAL aclexplode(coalesce(nspacl,acldefault('n',nspowner))) a WHERE nspname='public' AND a.grantee=0); ROLLBACK;", database, role).strip() == 't'
        out['objects'][database] = item
    return out


def classify(status):
    absent = 0
    for database, (role, kind) in DATABASES.items():
        item = status['objects'][database]; r = item['role']; d = item['database']
        if r is None and d is None:
            absent += 1; continue
        require(r is not None and d is not None, 'partial-provisioning-needs-coordination-no-takeover')
        marker = 'folhea:' + kind + ':v1'
        require(r['name'] == d['owner'] == role and r['marker'] == d['marker'] == marker,
                'preexisting-object-not-owned')
        require(r['login'] and not any(r[k] for k in ('superuser', 'createdb', 'createrole', 'replication', 'bypassrls'))
                and r['memberships'] == 0, 'role-has-global-privileges')
        require(d['encoding'] == 'UTF8' and d['collate'] == d['ctype'] == 'en_US.utf8' and d['provider'] == 'c',
                'dedicated-db-locale-changed')
        require(d['public_database_acl'] is False and d.get('public_schema_acl') is False,
                'dedicated-db-public-access-not-restricted')
    require(absent in (0, 2), 'partial-provisioning-needs-coordination-no-takeover')
    return 'create' if absent == 2 else 'ready'


def credentials(path, *, create):
    require(not path.is_symlink(), 'secret-symlink-forbidden')
    if path.exists():
        require(path.is_file() and path.stat().st_uid == os.getuid() and path.stat().st_mode & 0o777 == 0o600,
                'private-owned-secret-required')
        result = json.loads(path.read_text())
        require(set(result) == {x[0] for x in DATABASES.values()} and
                all(isinstance(v, str) and len(v) >= 48 for v in result.values()), 'invalid-own-db-secret-store')
        return result
    require(create, 'existing-own-secret-required-no-rotation')
    require(path.parent.is_dir() and not path.parent.is_symlink() and
            path.parent.stat().st_uid == os.getuid() and path.parent.stat().st_mode & 0o777 == 0o700,
            'private-owned-secret-directory-required')
    result = {role: secrets.token_urlsafe(48) for role, _ in DATABASES.values()}
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(result, stream); stream.flush(); os.fsync(stream.fileno())
    return result


def scram_verifier(password):
    # Only this verifier is sent to PostgreSQL, never cleartext passwords.
    salt = secrets.token_bytes(16); iterations = 4096
    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iterations)
    client = hmac.new(salted, b'Client Key', hashlib.sha256).digest()
    stored = hashlib.sha256(client).digest(); server = hmac.new(salted, b'Server Key', hashlib.sha256).digest()
    b64 = lambda value: base64.b64encode(value).decode()
    return f'SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored)}:{b64(server)}'


def check_identity(container_id, image_id):
    require(re.fullmatch('[0-9a-f]{64}', container_id or '') and
            re.fullmatch('sha256:[0-9a-f]{64}', image_id or ''), 'observed-pg-identity-required')
    fmt = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"health":{{json .State.Health.Status}},"networks":{{json .NetworkSettings.Networks}}}'
    try: peer = json.loads(subprocess.check_output(['docker', 'inspect', '--format', fmt, CONTAINER], timeout=15))
    except (OSError, subprocess.SubprocessError): raise DatabaseFailure('pg-metadata-unavailable') from None
    require(peer['id'] == container_id and peer['image'] == image_id and peer['running'] and peer['health'] == 'healthy',
            'existing-pg-identity-or-health-changed')
    require(NETWORK in peer['networks'] and CONTAINER in peer['networks'][NETWORK].get('Aliases', []) and
            PROXY_NETWORK not in peer['networks'], 'existing-private-pg-network-changed')


def provision(status, secret_file):
    require(status['version'] == '16.13' and status['encoding'] == 'UTF8' and
            status['collate'] == status['ctype'] == 'en_US.utf8' and status['provider'] == 'c',
            'reviewed-pg-version-locale-required')
    require(status['max_connections'] - status['connections'] >= 28, 'pg-connection-headroom-insufficient')
    state = classify(status)
    if state == 'ready':
        credentials(secret_file, create=False)
        return {'state': 'ready', 'writes': 0, 'secrets_rotated': False}
    values = credentials(secret_file, create=True)
    parts = ["SET log_statement='none'; SET log_duration=off; SET log_min_duration_statement=-1; SET log_min_duration_sample=-1; SET log_transaction_sample_rate=0; SET log_min_error_statement='panic'; SELECT pg_advisory_lock(hashtext('folhea-provision-v1')); BEGIN;"]
    # Recheck collision inside the same locked connection immediately before CREATE.
    parts.append("DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname IN ('folhea_app','folhea_keycloak')) OR EXISTS(SELECT FROM pg_database WHERE datname IN ('folhea','folhea_keycloak')) THEN RAISE EXCEPTION 'Folhea namespace collision'; END IF; END $$;")
    for database, (role, kind) in DATABASES.items():
        verifier = scram_verifier(values[role]); require(re.fullmatch(r"SCRAM-SHA-256\$[A-Za-z0-9+/=:$]+", verifier), 'verifier-format-invalid')
        parts.append(f"CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '{verifier}'; COMMENT ON ROLE {role} IS 'folhea:{kind}:v1';")
    parts.append('COMMIT;')
    for database, (role, kind) in DATABASES.items():
        parts.append(f"CREATE DATABASE {database} OWNER {role} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.utf8' LC_CTYPE 'en_US.utf8' LOCALE_PROVIDER libc;")
        parts.append(f"REVOKE ALL ON DATABASE {database} FROM PUBLIC; COMMENT ON DATABASE {database} IS 'folhea:{kind}:v1';")
    parts.append("SELECT pg_advisory_unlock(hashtext('folhea-provision-v1'));")
    sql('\n'.join(parts))
    for database, (role, _) in DATABASES.items():
        sql('BEGIN; REVOKE ALL ON SCHEMA public FROM PUBLIC; COMMIT;', database, role)
    require(classify(inspect_catalog()) == 'ready', 'post-provisioning-check-failed')
    return {'state': 'ready', 'writes': 4, 'secrets_rotated': False}


def history(database):
    role = database_role(database)
    query = ('SELECT row_to_json(h)::text FROM flyway_schema_history h ORDER BY installed_rank' if database == 'folhea' else
             'SELECT row_to_json(h)::text FROM databasechangelog h ORDER BY orderexecuted,id,author,filename')
    return sql('BEGIN READ ONLY; SET LOCAL statement_timeout=\'5s\'; ' + query + '; ROLLBACK;', database, role)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--plan', action='store_true'); mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    parser.add_argument('--container-id'); parser.add_argument('--image-id')
    parser.add_argument('--container'); parser.add_argument('--network'); parser.add_argument('--proxy-network')
    parser.add_argument('--secret-file', help='Own private database credential store; apply only')
    args = parser.parse_args()
    try:
        if not (args.check or args.apply):
            print(json.dumps({'applied': False, 'container': CONTAINER, 'network': NETWORK, 'version': '16.13',
                              'databases': {db: {'role': role, 'marker': 'folhea:' + kind + ':v1'} for db, (role, kind) in DATABASES.items()},
                              'scope': 'CREATE only absent dedicated objects; no takeover/rotation/cluster lifecycle',
                              'locale': 'UTF8/en_US.utf8/libc', 'pools': {'app': 10, 'keycloak': 10}})); return 0
        configure(args.container, args.network, proxy_network=args.proxy_network, secret_file=args.secret_file)
        check_identity(args.container_id, args.image_id)
        status = inspect_catalog()
        if args.check:
            print(json.dumps({'state': classify(status), 'version': status['version'], 'writes': 0})); return 0
        require(SECRET_FILE is not None and SECRET_FILE.is_absolute(), 'explicit-own-secret-path-required')
        for directory in (SECRET_FILE.parent.parent, SECRET_FILE.parent):
            require(not directory.is_symlink(), 'secret-directory-symlink-forbidden')
            directory.mkdir(mode=0o700, exist_ok=True)
            require(directory.stat().st_uid == os.getuid() and directory.stat().st_mode & 0o777 == 0o700,
                    'private-owned-secret-directory-required')
        print(json.dumps(provision(status, SECRET_FILE))); return 0
    except (DatabaseFailure, OSError, ValueError, KeyError, subprocess.SubprocessError) as e:
        print('database: failed category=' + (str(e) if isinstance(e, DatabaseFailure) else 'metadata-unavailable'), file=sys.stderr)
        return 1


if __name__ == '__main__': sys.exit(main())

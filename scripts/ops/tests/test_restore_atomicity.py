"""Restore fixtures in an owned temporary PostgreSQL cluster, never an existing DB."""
import gzip
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


def unavailable_postgres(reason):
    if os.environ.get('FOLHEA_REQUIRE_POSTGRES_TESTS') == '1':
        raise RuntimeError('Required PostgreSQL restore regression cannot run: ' + reason)
    raise unittest.SkipTest(reason)


class RestoreAtomicityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        candidates = ([Path(os.environ['PG_TEST_BIN'])] if os.environ.get('PG_TEST_BIN') else
                      sorted(Path('/usr/lib/postgresql').glob('*/bin'), reverse=True))
        cls.pg = next((path for path in candidates if all((path / tool).is_file() for tool in
                       ('postgres', 'initdb', 'pg_ctl', 'psql', 'createdb', 'pg_dump', 'pg_restore'))), None)
        if cls.pg is None or os.getuid() == 0:
            unavailable_postgres('Temporary PostgreSQL needs installed binaries and a non-root user')
        cls.directory = tempfile.TemporaryDirectory(prefix='folhea-restore-test-')
        cls.addClassCleanup(cls.directory.cleanup)
        cls.base = Path(cls.directory.name)
        cls.data = cls.base / 'data'
        cls.env = {key: value for key, value in os.environ.items()
                   if not key.startswith('PG') and key != 'OPS_EXTERNAL_POSTGRES_CONTAINER'}
        cls.env.update(PGHOST=str(cls.base), PGPORT='5432', PGUSER='fixture')
        subprocess.run([str(cls.pg / 'initdb'), '-D', str(cls.data), '--auth=trust',
                        '--no-locale', '--encoding=UTF8', '-U', 'fixture'],
                       env=cls.env, capture_output=True, check=True, timeout=30)
        log = cls.base / 'postgres.log'
        result = subprocess.run([str(cls.pg / 'pg_ctl'), '-D', str(cls.data), '-l', str(log),
                                 '-o', f"-h '' -k {cls.base} -c max_connections=10 -c shared_buffers=16MB",
                                 '-w', 'start'], env=cls.env, capture_output=True, timeout=15)
        if result.returncode:
            details = log.read_text()
            if 'could not bind Unix address' in details and 'Operation not permitted' in details:
                unavailable_postgres('Sandbox blocks the temporary PostgreSQL Unix socket (EPERM)')
            raise RuntimeError('Temporary PostgreSQL startup failed: ' + details)
        cls.addClassCleanup(subprocess.run, [str(cls.pg / 'pg_ctl'), '-D', str(cls.data),
                            '-m', 'immediate', '-w', 'stop'], env=cls.env,
                            capture_output=True, check=True, timeout=15)
        for name in ('donor', 'target'):
            subprocess.run([str(cls.pg / 'createdb'), name], env=cls.env,
                           capture_output=True, check=True, timeout=10)
        cls.query('CREATE TABLE restore_probe (id integer PRIMARY KEY, label text NOT NULL); '
                  "INSERT INTO restore_probe VALUES (17, 'archive-fixture');", 'donor')
        cls.archive = subprocess.run([str(cls.pg / 'pg_dump'), '--format=custom', '--compress=0',
                                      '--no-owner', '--no-privileges', '--dbname=donor'],
                                     env=cls.env, capture_output=True, check=True, timeout=15).stdout
        cls.compose = cls.base / 'compose.yml'; cls.compose.write_text('services: {}\n')
        cls.env_file = cls.base / 'env'; cls.env_file.write_text('DB_PASSWORD=synthetic-fixture\n')
        # Only replace Docker transport. The real pg_restore connects to the
        # fixture socket and executes every DROP/COPY/constraint in PostgreSQL.
        cls.docker = cls.base / 'docker'
        cls.docker.write_text('''#!/usr/bin/env python3
import os,sys
args=sys.argv[1:]
index=args.index('pg_restore')
os.execv(os.environ['PG_TEST_RESTORE'], ['pg_restore', *args[index+1:]])
''')
        cls.docker.chmod(0o700)

    @classmethod
    def query(cls, sql, database='target'):
        return subprocess.run([str(cls.pg / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1',
                               '--dbname', database, '-c', sql], env=cls.env,
                              capture_output=True, text=True, check=True, timeout=10).stdout.strip()

    def restore(self, payload, compressed):
        self.query('DROP TABLE IF EXISTS restore_probe; '
                   'CREATE TABLE restore_probe (id integer PRIMARY KEY, label text NOT NULL); '
                   "INSERT INTO restore_probe VALUES (99, 'previous-preserved');")
        backup = self.base / ('fixture.dump.gz' if compressed else 'fixture.dump')
        backup.write_bytes(gzip.compress(payload) if compressed else payload)
        env = dict(self.env, DOCKER_BIN=str(self.docker), PG_TEST_RESTORE=str(self.pg / 'pg_restore'),
                   COMPOSE_FILE=str(self.compose), COMPOSE_ENV_FILE=str(self.env_file),
                   DB_NAME='target', DB_USERNAME='fixture')
        return subprocess.run(['bash', str(ROOT / 'scripts/ops/restore-postgres.sh'), str(backup)],
                              env=env, capture_output=True, text=True, timeout=20)

    def test_data_error_after_clean_preserves_previous_database(self):
        needle = b'17\tarchive-fixture\n'
        self.assertEqual(self.archive.count(needle), 1)
        damaged = self.archive.replace(needle, b'xx\tarchive-fixture\n', 1)
        for compressed in (False, True):
            with self.subTest(compressed=compressed):
                result = self.restore(damaged, compressed)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('invalid input syntax for type integer', result.stderr)
                self.assertEqual(self.query("SELECT id || ':' || label FROM restore_probe"),
                                 '99:previous-preserved')

    def test_valid_backup_replaces_previous_data(self):
        for compressed in (False, True):
            with self.subTest(compressed=compressed):
                result = self.restore(self.archive, compressed)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.query("SELECT id || ':' || label FROM restore_probe"),
                                 '17:archive-fixture')


if __name__ == '__main__':
    unittest.main()

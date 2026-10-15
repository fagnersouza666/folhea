"""Dedicated-object provisioning must not adopt or rotate existing identities."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
HELPER = ROOT / 'scripts/ops/folhea-postgres.py'


class FolheaPostgresTest(unittest.TestCase):
    def helper(self):
        self.assertTrue(HELPER.exists(), 'Dedicated DB-only helper is missing')
        spec = importlib.util.spec_from_file_location('folhea_pg', HELPER)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        return mod

    def test_endpoint_is_explicit_and_unconfigured_sql_cannot_invoke_docker(self):
        pg = self.helper()
        self.assertTrue(hasattr(pg, 'configure'), 'Explicit DB-only endpoint configuration is missing')
        with patch.object(pg.subprocess, 'run') as tool:
            with self.assertRaises(pg.DatabaseFailure): pg.sql('SELECT 1')
            tool.assert_not_called()
        pg.configure('shared-pg', 'database-private', proxy_network='edge-proxy-net')
        with patch.object(pg.subprocess, 'run') as tool:
            tool.return_value.stdout = b'1'
            self.assertEqual(pg.sql('SELECT 1'), '1')
            self.assertEqual(tool.call_args.args[0][:4], ['docker', 'exec', '-i', 'shared-pg'])

    def fixture(self, populated):
        out = {'version': '16.13', 'max_connections': 100, 'connections': 17,
               'encoding': 'UTF8', 'collate': 'en_US.utf8', 'ctype': 'en_US.utf8',
               'provider': 'c', 'objects': {}}
        for db, role, kind in [('folhea', 'folhea_app', 'app'), ('folhea_keycloak', 'folhea_keycloak', 'keycloak')]:
            out['objects'][db] = {'role': None, 'database': None}
            if populated:
                out['objects'][db] = {
                    'role': {'name': role, 'marker': 'folhea:' + kind + ':v1', 'login': True,
                             'superuser': False, 'createdb': False, 'createrole': False,
                             'replication': False, 'bypassrls': False, 'memberships': 0},
                    'database': {'owner': role, 'marker': 'folhea:' + kind + ':v1',
                                 'encoding': 'UTF8', 'collate': 'en_US.utf8', 'ctype': 'en_US.utf8',
                                 'provider': 'c', 'public_database_acl': False, 'public_schema_acl': False}}
        return out

    def test_absent_objects_create_owned_objects_but_existing_ready_is_zero_write(self):
        pg = self.helper()
        self.assertEqual(pg.classify(self.fixture(False)), 'create')
        self.assertEqual(pg.classify(self.fixture(True)), 'ready')
        for key, value in [('marker', None), ('owner', 'acerto'), ('public_database_acl', True)]:
            bad = self.fixture(True); bad['objects']['folhea']['database'][key] = value
            with self.assertRaises(pg.DatabaseFailure): pg.classify(bad)
        for key, value in [('superuser', True), ('createdb', True), ('createrole', True),
                           ('replication', True), ('bypassrls', True), ('memberships', 1), ('marker', None)]:
            bad = self.fixture(True); bad['objects']['folhea']['role'][key] = value
            with self.assertRaises(pg.DatabaseFailure): pg.classify(bad)
        partial = self.fixture(False); partial['objects']['folhea']['role'] = self.fixture(True)['objects']['folhea']['role']
        with self.assertRaises(pg.DatabaseFailure): pg.classify(partial)

    def test_only_two_names_are_allowed_for_db_only_tools(self):
        pg = self.helper()
        self.assertEqual(pg.database_role('folhea'), 'folhea_app')
        self.assertEqual(pg.database_role('folhea_keycloak'), 'folhea_keycloak')
        for name in ('postgres', 'acerto', 'template0', '../folhea', 'folhea;DROP DATABASE acerto'):
            with self.assertRaises(pg.DatabaseFailure): pg.database_role(name)

    def test_secret_store_reuse_keeps_bytes_and_mode_and_refuses_untrusted_file(self):
        pg = self.helper()
        with tempfile.TemporaryDirectory() as scratch:
            p = Path(scratch) / 'credentials.json'
            first = pg.credentials(p, create=True); saved = p.read_bytes()
            self.assertEqual(set(first), {'folhea_app', 'folhea_keycloak'})
            self.assertTrue(all(len(x) >= 48 for x in first.values()))
            self.assertEqual(pg.credentials(p, create=False), first)
            self.assertEqual(p.read_bytes(), saved)
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
            p.chmod(0o644)
            with self.assertRaises(pg.DatabaseFailure): pg.credentials(p, create=False)
            p.unlink(); p.symlink_to('/etc/hosts')
            with self.assertRaises(pg.DatabaseFailure): pg.credentials(p, create=True)


if __name__ == '__main__':
    unittest.main()

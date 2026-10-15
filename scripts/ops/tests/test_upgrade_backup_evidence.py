"""An operator's flag is not a backup: bind two private dumps and both schema histories."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
OLD, NEW = 'a' * 40, 'b' * 40
HISTORY = {'app': 'app-schema', 'idp': 'provider-schema'}


class BackupEvidenceTest(unittest.TestCase):
    def fixture(self, directory):
        spec = importlib.util.spec_from_file_location('backup_evidence', ROOT / 'scripts/ops/deploy-folhea.py')
        d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
        base = Path(directory) / 'folhea'; base.mkdir(mode=0o700)
        (base / 'backups').mkdir(mode=0o700)
        d.configure_target('operator@server.example', str(base), 'folhea-prod', '192.0.2.10')
        receipt = {'version': 1, 'candidate': NEW, 'previous': OLD, 'target': d.state_target(),
                   'env_sha256': 'c' * 64, 'history_sha256': {key: hashlib.sha256(value.encode()).hexdigest() for key, value in HISTORY.items()},
                   'schema_compatible_reviewed': True, 'dumps': {}}
        for key, name, role in [('app', 'folhea', 'folhea_app'), ('idp', 'folhea_keycloak', 'folhea_keycloak')]:
            dump = base / 'backups' / (key + '.dump')
            dump.write_bytes(b'PGDMP synthetic-unit-fixture-' + key.encode()); dump.chmod(0o600)
            receipt['dumps'][key] = {'database': name, 'role': role, 'path': str(dump),
                                    'sha256': d.sha(dump), 'client_major': 16}
        path = base / 'review.json'; path.write_text(json.dumps(receipt)); path.chmod(0o600)
        return d, base, path, receipt

    def test_two_dumps_schema_sources_target_and_hashes_are_required(self):
        with tempfile.TemporaryDirectory() as scratch:
            d, base, path, receipt = self.fixture(scratch)
            self.assertTrue(hasattr(d, 'verify_backup_evidence'), 'Bound backup evidence is missing')
            result = d.verify_backup_evidence(str(path), base, NEW, OLD, HISTORY, 'c' * 64)
            self.assertEqual(result['receipt_sha256'], d.sha(path))
            mutations = [lambda x: x.update(candidate='d' * 40), lambda x: x.update(previous='d' * 40),
                         lambda x: x.update(env_sha256='d' * 64), lambda x: x.update(schema_compatible_reviewed=False),
                         lambda x: x['target'].update(project='other-app'),
                         lambda x: x['history_sha256'].update(app='d' * 64),
                         lambda x: x['dumps'].pop('idp'), lambda x: x['dumps']['app'].update(client_major=18),
                         lambda x: x['dumps']['app'].update(database='another-app'),
                         lambda x: x['dumps']['app'].update(role='postgres')]
            for mutate in mutations:
                changed = copy.deepcopy(receipt); mutate(changed); path.write_text(json.dumps(changed))
                with self.subTest(mutation=mutate), self.assertRaises(d.DeployFailure):
                    d.verify_backup_evidence(str(path), base, NEW, OLD, HISTORY, 'c' * 64)

    def test_changed_dump_public_mode_or_symlink_cannot_be_backup_evidence(self):
        with tempfile.TemporaryDirectory() as scratch:
            d, base, path, receipt = self.fixture(scratch)
            self.assertTrue(hasattr(d, 'verify_backup_evidence'), 'Bound private backup validation is missing')
            dump = Path(receipt['dumps']['app']['path']); original = dump.read_bytes()
            dump.write_bytes(original + b'changed')
            with self.assertRaises(d.DeployFailure): d.verify_backup_evidence(str(path), base, NEW, OLD, HISTORY, 'c' * 64)
            dump.write_bytes(original); dump.chmod(0o644)
            with self.assertRaises(d.DeployFailure): d.verify_backup_evidence(str(path), base, NEW, OLD, HISTORY, 'c' * 64)
            dump.chmod(0o600); dump.unlink(); dump.symlink_to(path)
            with self.assertRaises(d.DeployFailure): d.verify_backup_evidence(str(path), base, NEW, OLD, HISTORY, 'c' * 64)

    def test_record_review_validates_pg16_toc_and_preserves_dump_bytes(self):
        for wrong_client in (False, True):
            with self.subTest(wrong_client=wrong_client), tempfile.TemporaryDirectory() as scratch, ExitStack() as stack:
                d, base, existing, receipt = self.fixture(scratch)
                env = base / 'production.env'; env.write_text('synthetic-private-config'); env.chmod(0o600)
                candidate = base / 'releases' / NEW; candidate.mkdir(parents=True)
                output = base / 'new-review.json'
                args = SimpleNamespace(source=NEW, expected_current=OLD, schema_compatible_reviewed=True,
                                       backup_evidence=str(output), app_backup=receipt['dumps']['app']['path'],
                                       idp_backup=receipt['dumps']['idp']['path'])
                guard = SimpleNamespace(validate_model=lambda *x: None, validate_peer=lambda *x: None)
                model = {'x-folhea-external-postgres': {'container': 'shared-pg'}}
                stack.enter_context(patch.object(d, 'activation_paths', return_value=(base, candidate, env)))
                stack.enter_context(patch.object(d, 'current_is', return_value=True))
                stack.enter_context(patch.object(d, 'compose', return_value=json.dumps(model).encode()))
                stack.enter_context(patch.object(d, 'load_guard', return_value=guard))
                stack.enter_context(patch.object(d, 'inspected_peer', return_value={}))
                stack.enter_context(patch.object(d, 'external_preflight'))
                stack.enter_context(patch.object(d, 'read_manifest', return_value={'images': {}}))
                stack.enter_context(patch.object(d, 'runtime_images', return_value={}))
                stack.enter_context(patch.object(d, 'snapshot', return_value={}))
                stack.enter_context(patch.object(d, 'history', return_value=HISTORY))
                stack.enter_context(patch.object(d, 'run', return_value=b'pg_restore (PostgreSQL) 16.13\n'))
                def listing(command, *, stdin, **kwargs):
                    self.assertEqual(command, ['docker', 'exec', '-i', 'shared-pg', 'pg_restore', '--list'])
                    key = 'app' if stdin.read().endswith(b'app') else 'idp'
                    database = receipt['dumps'][key]['database']
                    version = '18.6' if wrong_client else '16.13'
                    return SimpleNamespace(stdout=(';     dbname: ' + database + '\n; Dumped by pg_dump version: ' + version + '\n').encode())
                stack.enter_context(patch.object(d.subprocess, 'run', side_effect=listing))
                hashes = {key: d.sha(Path(value['path'])) for key, value in receipt['dumps'].items()}
                if wrong_client:
                    with self.assertRaises(d.DeployFailure): d.record_backup_review(args)
                    self.assertFalse(output.exists())
                else:
                    d.record_backup_review(args)
                    d.verify_backup_evidence(str(output), base, NEW, OLD, HISTORY, d.sha(env))
                    self.assertEqual(output.stat().st_mode & 0o777, 0o600)
                self.assertEqual(hashes, {key: d.sha(Path(value['path'])) for key, value in receipt['dumps'].items()})


if __name__ == '__main__': unittest.main()

"""Shared PostgreSQL is a dependency, never a Folhea lifecycle target."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
SOURCE = 'a' * 40
OWN = {'backend', 'caddy', 'keycloak', 'redis'}


def module(path):
    spec = importlib.util.spec_from_file_location(path.stem.replace('-', '_'), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ExternalPostgresTest(unittest.TestCase):
    def test_snapshot_visits_only_four_own_services_not_the_shared_container(self):
        deploy = module(ROOT / 'scripts/ops/deploy-folhea.py')
        with tempfile.TemporaryDirectory() as scratch:
            folder = Path(scratch); tool = folder / 'docker'; calls = folder / 'calls.jsonl'
            tool.write_text('#!/usr/bin/python3\nimport sys,json\na=sys.argv[1:]\nwith open(' + repr(str(calls)) + ',"a") as f:f.write(json.dumps(a)+"\\n")\nif a[0]=="compose":\n assert a[-1] in {"backend","keycloak","caddy","redis"}\n print(a[-1].encode().hex().ljust(64,"0"))\nelse:print(json.dumps({"image":"sha256:"+"d"*64,"running":True,"health":"healthy","project":"folhea-prod","service":bytes.fromhex(a[-1]).rstrip(bytes([0])).decode()}))\n')
            tool.chmod(0o700)
            with patch.dict(os.environ, {'PATH': scratch}):
                result = deploy.snapshot(ROOT, folder / 'unused-private.env',
                                         {name: 'sha256:' + 'd' * 64 for name in OWN})
            self.assertEqual(set(result), OWN)
            invocations = [json.loads(x) for x in calls.read_text().splitlines()]
            self.assertEqual({x[-1] for x in invocations if x[0] == 'compose'}, OWN)
            self.assertFalse(any('shared-pg' in x or 'postgres' in x for x in invocations))

    def test_snapshot_rejects_another_project_or_service_before_lifecycle(self):
        deploy = module(ROOT / 'scripts/ops/deploy-folhea.py')
        from unittest.mock import patch
        good = {'image': 'sha256:' + 'd' * 64, 'running': True, 'health': 'healthy',
                'project': 'folhea-prod', 'service': 'redis'}
        for change in ({'project': 'other-app'}, {'service': 'postgres'}):
            with patch.object(deploy, 'compose', return_value=('b' * 64).encode()), \
                 patch.object(deploy, 'run', return_value=json.dumps({**good, **change}).encode()):
                with self.assertRaises(deploy.DeployFailure):
                    deploy.snapshot(ROOT, Path('/unused-private.env'), {name: good['image'] for name in OWN})

    def test_shared_pg_never_enters_image_transport_or_rollback(self):
        deploy = module(ROOT / 'scripts/ops/deploy-folhea.py')
        self.assertEqual(set(deploy.SERVICES), OWN)
        images = {name: 'sha256:' + 'd' * 64 for name in OWN}
        self.assertEqual(set(deploy.transport_tags(SOURCE, images)), OWN)
        self.assertTrue(deploy.rollback_allowed(images, {'app': 'same', 'idp': 'same'},
                                               {'app': 'same', 'idp': 'same'}))
        self.assertFalse(deploy.rollback_allowed({**images, 'postgres': 'sha256:' + 'e' * 64},
                                                'same', 'same'))
        self.assertNotIn('postgres', deploy.WRITERS)

    def test_old_managed_pg_model_cannot_masquerade_as_external(self):
        fixture = module(ROOT / 'scripts/ops/tests/test_npm_compose.py')
        fixture.NpmComposeTest.setUpClass()
        config = copy.deepcopy(fixture.NpmComposeTest.model)
        config['services']['postgres'] = {'image': 'postgres:16', 'networks': {'private': {}}}
        guard = module(ROOT / 'scripts/ops/validate-npm-compose.py')
        with self.assertRaises(guard.GuardFailure):
            guard.validate_model(config)

    @staticmethod
    def external_metadata():
        return {'container': 'shared-pg', 'container_id': '9' * 64,
                'image_id': 'sha256:' + '2' * 64, 'version': '16.13',
                'network': 'database-private', 'host': 'shared-pg', 'port': 5432}

    def render(self):
        fixture = module(ROOT / 'scripts/ops/tests/test_npm_compose.py')
        fixture.NpmComposeTest.setUpClass()
        return copy.deepcopy(fixture.NpmComposeTest.model)

    def test_runtime_is_four_image_only_services_with_two_private_db_connections(self):
        config = self.render()
        self.assertEqual(set(config['services']), OWN)
        self.assertNotIn('folhea-postgres', config.get('volumes', {}))
        for name in OWN:
            self.assertFalse(config['services'][name].get('ports'))
            self.assertFalse(config['services'][name].get('build'))
        guard = module(ROOT / 'scripts/ops/validate-npm-compose.py')
        guard.validate_model(config)
        for name in ('backend', 'keycloak'):
            self.assertIn('postgres-external', config['services'][name]['networks'])
        for name in ('redis', 'caddy'):
            self.assertNotIn('postgres-external', config['services'][name]['networks'])
        self.assertEqual(config['services']['backend']['environment']['QUARKUS_DATASOURCE_JDBC_MAX_SIZE'], '10')
        self.assertEqual(config['services']['keycloak']['environment']['KC_DB_POOL_MAX_SIZE'], '10')
        mutations = [lambda c: c['services']['backend']['environment'].update(QUARKUS_DATASOURCE_JDBC_INITIAL_SIZE='1'),
                     lambda c: c['services']['keycloak']['environment'].update(KC_DB_URL='jdbc:postgresql://shared-pg:5432/acerto'),
                     lambda c: c['services']['backend']['environment'].update(DB_USERNAME='postgres'),
                     lambda c: c['networks']['postgres-external'].update(external=False),
                     lambda c: c['services']['caddy']['networks'].update({'postgres-external': {}}),
                     lambda c: c['services']['keycloak']['environment'].update(KC_DB_POOL_MAX_SIZE='100'),
                     lambda c: c['services']['keycloak'].update(depends_on={'postgres': {'condition': 'service_healthy'}})]
        for mutate in mutations:
            changed = copy.deepcopy(config); mutate(changed)
            with self.assertRaises(guard.GuardFailure):
                guard.validate_model(changed)

    def test_external_peer_must_match_identity_private_network_and_health(self):
        config = self.render()
        guard = module(ROOT / 'scripts/ops/validate-npm-compose.py')
        peer = {'id': '9' * 64, 'image': 'sha256:' + '2' * 64, 'running': True,
                'health': 'healthy', 'networks': {'database-private': {'Aliases': ['shared-pg']}}}
        guard.validate_external_peer(config, peer)
        for field, value in [('id', '8' * 64), ('image', 'sha256:' + '3' * 64),
                             ('running', False), ('health', 'unhealthy'), ('networks', {}),
                             ('networks', {**peer['networks'], 'edge-proxy-net': {}})]:
            with self.subTest(field=field), self.assertRaises(guard.GuardFailure):
                guard.validate_external_peer(config, {**peer, field: value})


if __name__ == '__main__':
    unittest.main()

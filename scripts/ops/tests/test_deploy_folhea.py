"""Local-only deploy safety tests: no SSH, application build or real deployment."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / 'scripts/ops/deploy-folhea.py'
SOURCE = 'a' * 40


class DeployFolheaTest(unittest.TestCase):
    def module(self):
        self.assertTrue(SCRIPT.exists(), 'Folhea deploy command is missing')
        spec = importlib.util.spec_from_file_location('folhea_deploy', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_dry_run_never_invokes_tools_or_writes_even_without_checkout_or_secrets(self):
        self.assertTrue(SCRIPT.exists(), 'Folhea side-effect-free dry-run is missing')
        with tempfile.TemporaryDirectory() as scratch:
            base = Path(scratch)
            forbidden = base / 'forbidden'
            forbidden.mkdir()
            for name in ['ssh', 'scp', 'docker', 'git', 'npm', 'trivy']:
                tool = forbidden / name
                tool.write_text('#!/bin/sh\n/usr/bin/touch "$MUTATION_SENTINEL"\nexit 91\n')
                tool.chmod(0o700)
            env = {'PATH': str(forbidden), 'HOME': scratch, 'MUTATION_SENTINEL': str(base / 'invoked')}
            before = sorted(str(p.relative_to(base)) for p in base.rglob('*'))
            result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--dry-run', '--source', SOURCE],
                                    cwd=scratch, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(before, sorted(str(p.relative_to(base)) for p in base.rglob('*')))
            plan = json.loads(result.stdout)
            self.assertFalse(plan['applied'])
            self.assertEqual(plan['source'], SOURCE)
            self.assertIn('docker save', plan['transport'])
            self.assertFalse((base / 'invoked').exists())

    def test_targets_fail_closed_before_network_or_disk_changes(self):
        mod = self.module()
        for source, host, target in [('main', 'operator@server.example', '/srv/folhea'),
                                     (SOURCE, '-oProxyCommand=anything', '/srv/folhea'),
                                     (SOURCE, 'operator@server.example', '/srv/acerto'),
                                     (SOURCE, 'operator@server.example', '/srv/folhea/../acerto')]:
            with self.subTest(source=source, target=target), self.assertRaises(mod.DeployFailure):
                mod.plan(source, host, target)

    def test_transport_uses_only_own_source_tags_not_unrelated_aliases_of_image_ids(self):
        mod = self.module()
        self.assertTrue(hasattr(mod, 'transport_tags'), 'Source-scoped image transport is missing')
        images = {service: 'sha256:' + 'd' * 64 for service in mod.SERVICES}
        tags = mod.transport_tags(SOURCE, images)
        self.assertEqual(set(tags), set(mod.SERVICES))
        self.assertEqual(set(tags.values()), {'folhea/' + service + ':' + SOURCE for service in mod.SERVICES})
        with self.assertRaises(mod.DeployFailure):
            mod.transport_tags(SOURCE, {**images, 'acerto': images['backend']})
        with self.assertRaises(mod.DeployFailure):
            mod.transport_tags(SOURCE, {**images, 'postgres': 'postgres:latest'})

    def test_bundle_checksums_reject_tampering_and_links(self):
        mod = self.module()
        with tempfile.TemporaryDirectory() as scratch:
            base = Path(scratch)
            (base / 'infra').mkdir()
            payload = base / 'infra/Caddyfile.npm'
            payload.write_text('public fixture\n')
            manifest = {'source': SOURCE, 'files': {'infra/Caddyfile.npm': mod.sha(payload)}}
            mod.verify_files(base, manifest)
            payload.write_text('changed\n')
            with self.assertRaises(mod.DeployFailure): mod.verify_files(base, manifest)
            payload.unlink(); payload.symlink_to('/etc/hosts')
            with self.assertRaises(mod.DeployFailure): mod.verify_files(base, manifest)
            for path in ['../outside', '/etc/hosts', '.env', 'private.env']:
                with self.assertRaises(mod.DeployFailure):
                    mod.verify_files(base, {'source': SOURCE, 'files': {path: 'b' * 64}})

    def test_public_bind_file_is_readable_by_container_uid_without_opening_secret_store(self):
        mod = self.module()
        self.assertTrue(hasattr(mod, 'copy_public_file'), 'Public runtime bind staging is missing')
        with tempfile.TemporaryDirectory() as scratch:
            base = Path(scratch); source = base / 'template'; target = base / 'release/infra/template'
            source.write_text('public template with variable names only\n'); source.chmod(0o600)
            private = base / 'production.env'; private.write_text('not-transferred'); private.chmod(0o600)
            mod.copy_public_file(source, target)
            self.assertEqual(target.read_bytes(), source.read_bytes())
            self.assertEqual(target.stat().st_mode & 0o777, 0o644)
            self.assertEqual(private.stat().st_mode & 0o777, 0o600)
            self.assertEqual(target.parent.stat().st_mode & 0o777, 0o700)

    def test_only_own_lock_and_atomic_current_pointer_are_changed(self):
        mod = self.module()
        with tempfile.TemporaryDirectory() as scratch:
            base = Path(scratch)
            (base / 'releases').mkdir()
            old = 'b' * 40
            (base / 'releases' / old).mkdir()
            (base / 'releases' / SOURCE).mkdir()
            (base / 'current').symlink_to('releases/' + old)
            unrelated = base / 'acerto'; unrelated.write_text('untouched')
            with mod.own_lock(base):
                with self.assertRaises(mod.DeployFailure):
                    with mod.own_lock(base): pass
                mod.promote(base, SOURCE)
            self.assertEqual(os.readlink(base / 'current'), 'releases/' + SOURCE)
            self.assertEqual(unrelated.read_text(), 'untouched')
            self.assertFalse((base / 'current.next').exists())
            mod.promote(base, old)
            self.assertEqual(os.readlink(base / 'current'), 'releases/' + old)

    def test_rollback_requires_previous_images_and_identical_known_flyway_history(self):
        mod = self.module()
        history = 'metadata of ranks/checksums/timestamps'
        images = {service: 'sha256:' + 'd' * 64 for service in mod.SERVICES}
        self.assertTrue(mod.rollback_allowed(images, history, history))
        self.assertFalse(mod.rollback_allowed(None, history, history))
        self.assertFalse(mod.rollback_allowed(images, history, history + '\nnew migration'))
        self.assertFalse(mod.rollback_allowed(images, None, None))
        self.assertFalse(mod.rollback_allowed(images, {'app': history, 'idp': 'old'},
                                               {'app': history, 'idp': 'new'}))
        self.assertFalse(mod.rollback_allowed({'backend': images['backend']}, history, history))

    def test_runtime_compose_resolves_without_build_public_ports_or_managed_postgres(self):
        sibling = ROOT / 'scripts/ops/tests/test_npm_compose.py'
        spec = importlib.util.spec_from_file_location('npm_fixture', sibling)
        fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
        fixture.NpmComposeTest.setUpClass()
        runtime = fixture.NpmComposeTest.model
        self.assertEqual(set(runtime['services']), {'redis', 'keycloak', 'backend', 'caddy'})
        for service in runtime['services'].values():
            self.assertFalse(service.get('build'))
            self.assertFalse(service.get('ports'))
            self.assertEqual(service['image'], 'sha256:' + 'd' * 64)
        self.assertNotIn('folhea-postgres', runtime.get('volumes', {}))


if __name__ == '__main__': unittest.main()

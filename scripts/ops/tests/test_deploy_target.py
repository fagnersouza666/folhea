"""Deployment target metadata is explicit; no host/user/path is inferred."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
SOURCE = 'a' * 40


def engine():
    spec = importlib.util.spec_from_file_location('deploy_target', ROOT / 'scripts/ops/deploy-folhea.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TargetTest(unittest.TestCase):
    def test_explicit_target_is_used_by_plan_and_strict_ssh(self):
        deploy = engine()
        self.assertTrue(hasattr(deploy, 'configure_target'), 'Explicit reviewed target configuration is missing')
        deploy.configure_target('operator@server.example', '/srv/folhea', 'folhea-prod', '192.0.2.10')
        plan = deploy.plan(SOURCE)
        self.assertEqual(plan['host'], 'operator@server.example')
        self.assertEqual(plan['root'], '/srv/folhea')
        self.assertEqual(plan['project'], 'folhea-prod')
        command = deploy.ssh(['python3', '-B', '/srv/folhea/tool.py'])
        self.assertIn('BatchMode=yes', command)
        self.assertIn('StrictHostKeyChecking=yes', command)
        self.assertEqual(command[-2], 'operator@server.example')

    def test_wrong_namespace_unsafe_host_and_nonliteral_address_fail_closed(self):
        deploy = engine()
        self.assertTrue(hasattr(deploy, 'configure_target'), 'Explicit target validation is missing')
        cases = [('-oProxyCommand=anything', '/srv/folhea', 'folhea-prod', '192.0.2.10'),
                 ('operator@server.example', '/srv/acerto', 'folhea-prod', '192.0.2.10'),
                 ('operator@server.example', '/srv/../folhea', 'folhea-prod', '192.0.2.10'),
                 ('operator@server.example', '/srv/folhea', 'other-app', '192.0.2.10'),
                 ('operator@server.example', '/srv/folhea', 'folhea-prod', 'server.example')]
        for values in cases:
            with self.subTest(values=values), self.assertRaises(deploy.DeployFailure):
                deploy.configure_target(*values)

    def test_cli_exposes_explicit_recovery_and_bound_backup_review(self):
        import subprocess
        import sys
        result = subprocess.run([sys.executable, '-B', str(ROOT / 'scripts/ops/deploy-folhea.py'), '--help'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        for flag in ('--recover', '--record-backup-review', '--backup-evidence', '--app-backup', '--idp-backup'):
            self.assertIn(flag, result.stdout)

    def test_unconfigured_target_cannot_reach_actual_ssh(self):
        deploy = engine()
        with self.assertRaises(deploy.DeployFailure):
            deploy.ssh(['true'])


if __name__ == '__main__':
    unittest.main()

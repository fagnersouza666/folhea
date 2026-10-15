"""Shell boundary tests: real private Git fixtures, simulated Python and SSH only."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
WRAPPER = ROOT / 'scripts/ops/deploy-folhea.sh'


class DeployShellTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='folhea-shell-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repo = self.base / 'checkout with spaces'
        self.ops = self.repo / 'scripts/ops'
        self.ops.mkdir(parents=True)
        self.wrapper = self.ops / 'deploy-folhea.sh'
        if WRAPPER.exists():
            shutil.copy2(WRAPPER, self.wrapper)
        self.engine = self.ops / 'deploy-folhea.py'
        self.engine.write_text('# Simulated trusted, tracked engine boundary.\n')
        (self.repo / '.gitignore').write_text('production.env\n')
        self.git('init', '-q')
        self.commit()
        self.source = self.git('rev-parse', 'HEAD').strip()
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.log = self.base / 'calls.jsonl'
        self.output = self.base / 'new package with spaces'
        self.fake('python3', '''
args = sys.argv[1:]
phase = next((v for v in args if v in ['--dry-run', '--prepare', '--transfer', '--activate', '--record-backup-review']), '')
if phase == '--prepare' and os.environ.get('DRIFT_PREPARE'):
    repo = os.path.dirname(os.path.dirname(os.path.dirname(args[1])))
    subprocess.run(['git', '-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
                    'commit', '--allow-empty', '-qm', 'concurrent fixture drift'], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
sys.exit(int(os.environ.get('FAIL_CODE', '19')) if phase == os.environ.get('FAIL_PHASE') else 0)
''')
        self.fake('ssh', '''
if os.environ.get('SSH_INTERPRET'):
    sys.exit(subprocess.run(['/bin/sh', '-c', sys.argv[-1]], env=os.environ).returncode)
sys.exit(int(os.environ.get('SSH_EXIT', '0')))
''')
        self.target = ['--host', 'operator@server.example', '--remote-root', '/srv/folhea',
                       '--project-name', 'folhea-prod', '--server-address', '192.0.2.10']
        self.current = 'b' * 40
        self.evidence = '/srv/folhea/receipts/review.json'

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True, stderr=subprocess.DEVNULL)

    def commit(self):
        self.git('add', '.')
        self.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture')

    def fake(self, name, body):
        script = self.bin / name
        script.write_text(f'#!{sys.executable}\n' + '''import json, os, subprocess, sys
with open(os.environ['CALL_LOG'], 'a') as log:
    log.write(json.dumps({'tool': os.path.basename(sys.argv[0]), 'args': sys.argv[1:]}) + '\\n')
''' + body)
        script.chmod(0o755)

    def call(self, args, extra=None):
        env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        env.update(PATH=str(self.bin) + os.pathsep + os.environ.get('PATH', ''), CALL_LOG=str(self.log))
        env.update(extra or {})
        return subprocess.run(['/bin/bash', str(self.wrapper), *args], cwd=self.base,
                              env=env, capture_output=True, text=True, timeout=10)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def stage(self):
        return self.target + ['--execute', '--stage', '--output', str(self.output)]

    def activate(self):
        return self.target + ['--execute', '--activate', '--expected-current', self.current,
                              '--backup-evidence', self.evidence, '--schema-compatible-reviewed']

    def review(self):
        return self.target + ['--execute', '--review', '--expected-current', self.current,
                              '--backup-evidence', self.evidence, '--schema-compatible-reviewed',
                              '--app-backup', '/srv/folhea/backups/app.dump',
                              '--idp-backup', '/srv/folhea/backups/idp.dump']

    @staticmethod
    def without(args, flag):
        result = args.copy()
        index = result.index(flag)
        del result[index:index + (1 if flag == '--schema-compatible-reviewed' else 2)]
        return result

    def assert_ok(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_full_source_default_plan_has_no_commands_or_writes(self):
        before = set(self.base.rglob('*'))
        # No Git double: no executable except the two external boundary spies is
        # on PATH. A full-source plan must not need Git or any other executable.
        result = self.call(self.target + ['--source', 'a' * 40, '--output', str(self.output)], {'PATH': str(self.bin)})
        self.assert_ok(result)
        self.assertIn('PLANO', result.stdout)
        self.assertIn('a' * 40, result.stdout)
        self.assertEqual(self.calls(), [])
        self.assertEqual(set(self.base.rglob('*')), before)

    def test_default_source_is_clean_head_and_works_outside_checkout(self):
        index = (self.repo / '.git/index').read_bytes()
        result = self.call(self.target + ['--output', str(self.output)])
        self.assert_ok(result)
        self.assertIn(self.source, result.stdout)
        self.assertEqual(self.calls(), [])
        self.assertEqual((self.repo / '.git/index').read_bytes(), index)

    def test_dirty_tracked_or_untracked_source_stops_before_external_action(self):
        for path in [self.engine, self.repo / 'untracked.txt']:
            with self.subTest(path=path.name):
                original = path.read_bytes() if path.exists() else None
                path.write_text('dirty fixture\n')
                result = self.call(self.stage())
                self.assertEqual(result.returncode, 2)
                self.assertEqual(self.calls(), [])
                if original is None:
                    path.unlink()
                else:
                    path.write_bytes(original)

    def test_explicit_source_must_match_checkout_before_execution(self):
        result = self.call(self.stage() + ['--source', 'a' * 40])
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls(), [])

    def test_stage_orders_preflight_prepare_transfer_and_never_reviews_or_activates(self):
        result = self.call(self.stage())
        self.assert_ok(result)
        calls = self.calls()
        self.assertEqual([c['tool'] for c in calls], ['python3'] * 3)
        self.assertEqual([c['args'][2] for c in calls], ['--dry-run', '--prepare', '--transfer'])
        for call in calls:
            self.assertEqual(call['args'][:2], ['-B', str(self.engine)])
            self.assertIn(self.source, call['args'])
        self.assertEqual(calls[1]['args'][calls[1]['args'].index('--output') + 1], str(self.output))
        self.assertEqual(calls[2]['args'][calls[2]['args'].index('--bundle') + 1], str(self.output / 'release'))
        self.assertFalse(self.output.exists())  # The fake engine never writes a bundle.

    def test_missing_targets_or_output_fail_before_python_or_ssh(self):
        for flag in ['--host', '--remote-root', '--project-name', '--server-address', '--output']:
            with self.subTest(flag=flag):
                result = self.call(self.without(self.stage(), flag))
                self.assertEqual(result.returncode, 2)
                self.assertEqual(self.calls(), [])

    def test_stage_stops_on_each_engine_failure_and_returns_its_code(self):
        for phase, count in [('--dry-run', 1), ('--prepare', 2), ('--transfer', 3)]:
            with self.subTest(phase=phase):
                self.log.unlink(missing_ok=True)
                result = self.call(self.stage(), {'FAIL_PHASE': phase, 'FAIL_CODE': '27'})
                self.assertEqual(result.returncode, 27)
                self.assertEqual(len(self.calls()), count)

    def test_real_git_head_drift_after_prepare_stops_before_transfer(self):
        result = self.call(self.stage(), {'DRIFT_PREPARE': '1'})
        self.assertEqual(result.returncode, 2)
        self.assertNotEqual(self.git('rev-parse', 'HEAD').strip(), self.source)
        self.assertEqual([call['args'][2] for call in self.calls()], ['--dry-run', '--prepare'])

    def test_review_requires_both_dumps_receipt_current_and_explicit_human_review(self):
        for flag in ['--expected-current', '--backup-evidence', '--app-backup', '--idp-backup', '--schema-compatible-reviewed']:
            with self.subTest(flag=flag):
                result = self.call(self.without(self.review(), flag))
                self.assertEqual(result.returncode, 2)
                self.assertEqual(self.calls(), [])

    def test_activate_requires_current_receipt_and_explicit_human_review(self):
        for flag in ['--expected-current', '--backup-evidence', '--schema-compatible-reviewed']:
            with self.subTest(flag=flag):
                result = self.call(self.without(self.activate(), flag))
                self.assertEqual(result.returncode, 2)
                self.assertEqual(self.calls(), [])

    def remote(self, action):
        calls = self.calls()
        self.assertEqual([call['tool'] for call in calls], ['python3', 'ssh'])
        self.assertEqual(calls[0]['args'][2], '--dry-run')
        ssh = calls[1]['args']
        for setting in ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'ConnectTimeout=10']:
            self.assertIn(setting, ssh)
        self.assertEqual(ssh[-2], 'operator@server.example')
        remote = shlex.split(ssh[-1])
        self.assertEqual(remote[:3], ['python3', '-B', f'/srv/folhea/releases/{self.source}/scripts/ops/deploy-folhea.py'])
        self.assertIn(action, remote)
        self.assertIn(self.current, remote)
        self.assertIn('--schema-compatible-reviewed', remote)
        return remote

    def test_review_delegates_validation_to_candidate_engine_without_activation(self):
        self.assert_ok(self.call(self.review()))
        remote = self.remote('--record-backup-review')
        self.assertIn('/srv/folhea/backups/app.dump', remote)
        self.assertIn('/srv/folhea/backups/idp.dump', remote)
        self.assertIn(self.evidence, remote)
        self.assertNotIn('--activate', remote)

    def test_activate_only_delegates_reviewed_upgrade_with_receipt_and_cas(self):
        self.assert_ok(self.call(self.activate()))
        remote = self.remote('--activate')
        self.assertEqual(remote[remote.index('--installation') + 1], 'upgrade')
        self.assertEqual(remote[remote.index('--backup-evidence') + 1], self.evidence)
        self.assertNotIn('--record-backup-review', remote)

    def test_ssh_failure_is_returned_without_followup_or_cleanup(self):
        result = self.call(self.activate(), {'SSH_EXIT': '37'})
        self.assertEqual(result.returncode, 37)
        self.assertEqual([call['tool'] for call in self.calls()], ['python3', 'ssh'])

    def test_remote_spaces_quotes_and_shell_syntax_are_data_in_actual_posix_shell(self):
        marker = self.base / 'injection-marker'
        evidence = f"/srv/folhea/receipts/review ' ; $(touch {shlex.quote(str(marker))}); x.json"
        args = self.activate()
        args[args.index('--backup-evidence') + 1] = evidence
        self.assert_ok(self.call(args, {'SSH_INTERPRET': '1'}))
        remote_call = self.calls()[-1]
        self.assertEqual(remote_call['tool'], 'python3')
        self.assertEqual(remote_call['args'][remote_call['args'].index('--backup-evidence') + 1], evidence)
        self.assertFalse(marker.exists())

    def test_local_output_shell_syntax_is_data_not_executed(self):
        marker = self.base / 'local-injection'
        output = self.base / f'package ; $(touch {marker.name})'
        args = self.stage()
        args[args.index('--output') + 1] = str(output)
        self.assert_ok(self.call(args))
        self.assertIn(str(output), self.calls()[1]['args'])
        self.assertFalse(marker.exists())

    def test_symlink_engine_cannot_be_selected(self):
        self.engine.unlink()
        other = self.base / 'untrusted-engine.py'
        other.write_text('untrusted\n')
        self.engine.symlink_to(other)
        self.commit()
        result = self.call(self.stage())
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls(), [])

    def test_conflicting_actions_and_unknown_flags_do_not_execute_or_echo_arguments(self):
        for extra in [['--review'], ['--dry-run'], ['--env-file', 'private-marker-do-not-print']]:
            with self.subTest(extra=extra[0]):
                result = self.call(self.stage() + extra)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn('private-marker-do-not-print', result.stdout + result.stderr)
                self.assertEqual(self.calls(), [])


if __name__ == '__main__':
    unittest.main()

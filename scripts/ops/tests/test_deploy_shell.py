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

    def test_git_status_failure_stops_head_plan_and_execution_before_external_action(self):
        invalid_status_config = {'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': 'status.relativePaths',
                                 'GIT_CONFIG_VALUE_0': 'invalid-boolean'}
        for action in [self.target + ['--output', str(self.output)], self.stage(), self.activate()]:
            with self.subTest(action=action):
                self.log.unlink(missing_ok=True)
                result = self.call(action, invalid_status_config)
                self.assertIn('bad boolean config value', result.stderr)
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


class ProductionBridgeTest(unittest.TestCase):
    """Execute the Python bridge locally against engine API fixtures, never Docker/SSH."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='folhea-bridge-')
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name) / 'folhea'
        self.base.mkdir(mode=0o700)
        self.source, self.previous = 'a' * 40, 'b' * 40
        self.release = self.base / 'releases' / self.source
        ops = self.release / 'scripts/ops'
        ops.mkdir(parents=True)
        (self.base / 'releases' / self.previous).mkdir()
        (self.base / 'current').symlink_to('releases/' + self.previous)
        (self.base / 'production.env').write_text('fixture-not-a-real-secret')
        (self.base / 'production.env').chmod(0o600)
        (ops / 'verify-recovery.sql').write_text('SELECT 1;')
        (ops / 'verify-recovery-keycloak.sql').write_text('SELECT 1;')
        # Reuse real private_dump/sha/lock/target/path APIs. Docker-facing APIs
        # alone are fixture doubles; run() produces synthetic archive bytes.
        (ops / 'deploy-folhea.py').write_text(f'''
import importlib.util, json, os, shutil
from pathlib import Path
spec=importlib.util.spec_from_file_location('real_engine', {str(ROOT / 'scripts/ops/deploy-folhea.py')!r})
real=importlib.util.module_from_spec(spec); spec.loader.exec_module(real)
real.ROOT=Path(__file__).resolve().parents[2]
require=real.require
sha=real.sha
private_dump=real.private_dump
own_lock=real.own_lock
safe_environment=real.safe_environment
configure_target=real.configure_target
activation_paths=real.activation_paths
pending_recovery=real.pending_recovery
current_is=real.current_is
images={{name:'sha256:'+'1'*64 for name in real.SERVICES}}
def read_manifest(*args): return {{}}
def runtime_images(*args): return images
def inspected_peer(*args): return {{}}
def inspected_database(*args): return {{'id':'2'*64,'image':'sha256:'+'3'*64}}
def snapshot(*args): return images
def external_preflight(*args): pass
def compose(*args): return json.dumps({{'x-folhea-external-postgres':{{'container':'pg-fixture'}}, 'private':'stay-in-memory'}})
class Guard:
    def validate_model(self,*args): pass
    def validate_peer(self,*args): pass
    def validate_external_peer(self,*args): pass
def load_guard(*args): return Guard()
def run(command,env=None,**kwargs):
    base=Path(real.REMOTE_ROOT)
    with (base/'calls.jsonl').open('a') as out:
        out.write(json.dumps({{'command':command,'database':env['DB_NAME'],'role':env['DB_USERNAME'],
          'container':env['OPS_EXTERNAL_POSTGRES_CONTAINER'],'id':env['OPS_EXTERNAL_POSTGRES_CONTAINER_ID'],
          'image':env['OPS_EXTERNAL_POSTGRES_IMAGE_ID']}})+'\\n')
    if command[1].endswith('/backup-postgres.sh'):
        destination=Path(command[command.index('--output-dir')+1])
        copy=Path(command[command.index('--external-destination')+1].removeprefix('file://'))
        artifact=destination/('folhea-'+env['DB_NAME']+'-20260101T000000Z.dump')
        artifact.write_bytes(b'PGDMP-synthetic-fixture'); artifact.chmod(0o600)
        sidecar=Path(str(artifact)+'.sha256')
        sidecar.write_text(sha(artifact)+'  '+str(artifact)+'\\n'); sidecar.chmod(0o600)
        shutil.copyfile(artifact,copy/artifact.name); (copy/artifact.name).chmod(0o600)
        shutil.copyfile(sidecar,copy/sidecar.name); (copy/sidecar.name).chmod(0o600)
        if os.environ.get('BRIDGE_FIXTURE_FAULT')=='missing-sidecar': sidecar.unlink()
    return b''
''')
        self.bridge = WRAPPER.read_text().split("<<'PRODUCTION_PY'\n", 1)[1].split('\nPRODUCTION_PY', 1)[0]

    def invoke(self, fault=None):
        env = os.environ.copy()
        if fault:
            env['BRIDGE_FIXTURE_FAULT'] = fault
        return subprocess.run([sys.executable, '-B', '-', 'backup', str(self.base), 'operator@server.example',
                               'folhea-prod', '192.0.2.10', self.source, self.previous],
                              input=self.bridge, env=env, text=True, capture_output=True, timeout=10)

    def test_bridge_uses_two_existing_helpers_own_roles_and_observed_identity(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        fields = result.stdout.splitlines()
        self.assertEqual(len(fields), 5)
        self.assertFalse(Path(fields[-1]).exists(), 'No review receipt before operator confirmation')
        self.assertEqual(fields[2], __import__('hashlib').sha256(Path(fields[0]).read_bytes()).hexdigest())
        calls = [json.loads(line) for line in (self.base / 'calls.jsonl').read_text().splitlines()]
        self.assertEqual([(c['database'], c['role']) for c in calls],
                         [('folhea', 'folhea_app')] * 2 + [('folhea_keycloak', 'folhea_keycloak')] * 2)
        self.assertEqual([Path(c['command'][1]).name for c in calls],
                         ['backup-postgres.sh', 'verify-recovery.sh'] * 2)
        for call in calls:
            self.assertEqual((call['container'], call['id'], call['image']),
                             ('pg-fixture', '2' * 64, 'sha256:' + '3' * 64))
        self.assertNotIn('stay-in-memory', result.stdout + result.stderr)

    def test_missing_checksum_sidecar_refuses_backup_metadata_and_receipt(self):
        result = self.invoke('missing-sidecar')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertFalse((self.base / 'receipts').exists())


class ProductionDeployTest(unittest.TestCase):
    git = DeployShellTest.git
    commit = DeployShellTest.commit
    fake = DeployShellTest.fake
    call = DeployShellTest.call
    calls = DeployShellTest.calls
    assert_ok = DeployShellTest.assert_ok

    def setUp(self):
        DeployShellTest.setUp(self)
        self.config = self.base / 'deployment.json'
        self.config.write_text(json.dumps({
            'host': 'operator@server.example', 'remote_root': '/srv/folhea',
            'project_name': 'folhea-prod', 'server_address': '192.0.2.10',
            'output_parent': str(self.base / 'packages'),
        }))
        self.config.chmod(0o600)
        # Config parsing is real stdlib Python. Only engine execution is a spy.
        (self.bin / 'python3').write_text(f'#!{sys.executable}\n' + '''
import json, os, subprocess, sys
args = sys.argv[1:]
if args[:2] == ['-B', '-']:
    sys.exit(subprocess.run([sys.executable, *args], input=sys.stdin.buffer.read()).returncode)
with open(os.environ['CALL_LOG'], 'a') as log:
    log.write(json.dumps({'tool': 'python3', 'args': args}) + '\\n')
phase = next((v for v in args if v in ['--dry-run', '--prepare', '--transfer']), '')
if phase == '--prepare' and os.environ.get('DRIFT_PREPARE'):
    repo = os.path.dirname(os.path.dirname(os.path.dirname(args[1])))
    subprocess.run(['git', '-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
                    'commit', '--allow-empty', '-qm', 'drift'], check=True)
sys.exit(int(os.environ.get('FAIL_CODE', '29')) if phase == os.environ.get('FAIL_PHASE') else 0)
''')
        (self.bin / 'python3').chmod(0o755)
        self.fake('ssh', '''
import shlex
remote = shlex.split(sys.argv[-1])
if remote[:3] == ['python3', '-B', '-']:
    mode = remote[3]
    source = remote[8]
    sys.stdin.read()  # Receive, never execute, the remote orchestration bridge.
else:
    mode = 'review' if '--record-backup-review' in remote else 'activate'
if mode == os.environ.get('FAIL_REMOTE'):
    sys.exit(41)
if mode == 'inspect':
    print('b' * 40)
elif mode == 'backup':
    print('/srv/folhea/backups/' + source + '-fixture/folhea-folhea-20260101T000000Z.dump')
    print('/srv/folhea/backups/' + source + '-fixture/folhea-folhea_keycloak-20260101T000000Z.dump')
    print('a' * 64)
    print('b' * 64)
    print('/srv/folhea/receipts/' + source + '-fixture.backup-review.json')
''')

    def production(self, *extra):
        return ['--production', '--config', str(self.config), *extra]

    def tty_call(self, args, answer='PUBLICAR\n', extra=None):
        import pty
        master, slave = pty.openpty()
        self.addCleanup(os.close, master)
        env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
        env.update(PATH=str(self.bin) + os.pathsep + os.environ.get('PATH', ''), CALL_LOG=str(self.log))
        env.update(extra or {})
        try:
            proc = subprocess.Popen(['/bin/bash', str(self.wrapper), *args], cwd=self.base,
                                    env=env, stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        finally:
            os.close(slave)
        os.write(master, answer.encode())
        stdout, stderr = proc.communicate(timeout=15)
        return subprocess.CompletedProcess(proc.args, proc.returncode, stdout, stderr)

    def actions(self):
        result = []
        for call in self.calls():
            if call['tool'] == 'python3':
                result.append(next(v for v in call['args'] if v in ['--dry-run', '--prepare', '--transfer']))
            else:
                remote = shlex.split(call['args'][-1])
                result.append(remote[3] if remote[:3] == ['python3', '-B', '-'] else
                              ('review' if '--record-backup-review' in remote else 'activate'))
        return result

    def test_production_dry_run_reads_config_without_tty_commands_or_writes(self):
        before = set(self.base.rglob('*'))
        index = (self.repo / '.git/index').read_bytes()
        result = self.call(self.production('--dry-run'))
        self.assert_ok(result)
        self.assertIn('PLANO', result.stdout)
        self.assertIn('backups', result.stdout)
        self.assertEqual(self.calls(), [])
        self.assertEqual(set(self.base.rglob('*')), before)
        self.assertEqual((self.repo / '.git/index').read_bytes(), index)

    def test_production_requires_tty_before_engine_prepare_or_ssh(self):
        result = self.call(self.production())
        self.assertEqual(result.returncode, 2)
        self.assertIn('terminal', result.stderr)
        self.assertEqual(self.calls(), [])

    def test_one_production_command_runs_backups_review_and_upgrade_after_confirmation(self):
        result = self.tty_call(self.production())
        self.assert_ok(result)
        self.assertEqual(self.actions(), ['--dry-run', 'inspect', '--prepare', '--transfer', 'backup', 'review', 'activate'])
        remotes = [shlex.split(c['args'][-1]) for c in self.calls() if c['tool'] == 'ssh']
        for remote in remotes[-2:]:
            self.assertIn(self.source, remote)
            self.assertIn(self.current, remote)
            self.assertIn('--schema-compatible-reviewed', remote)
            self.assertIn('/srv/folhea/receipts/' + self.source + '-fixture.backup-review.json', remote)
        review = remotes[-2]
        self.assertIn('/srv/folhea/backups/' + self.source + '-fixture/folhea-folhea-20260101T000000Z.dump', review)
        self.assertEqual(remotes[-1][remotes[-1].index('--installation') + 1], 'upgrade')
        self.assertIn('PUBLICAR', result.stdout)

    def test_cancelled_review_preserves_evidence_without_review_or_activation(self):
        result = self.tty_call(self.production(), answer='NAO\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.actions(), ['--dry-run', 'inspect', '--prepare', '--transfer', 'backup'])
        self.assertIn('backups', result.stdout)

    def test_configuration_is_private_strict_data_not_shell(self):
        self.config.chmod(0o644)
        result = self.tty_call(self.production())
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), [])
        self.config.chmod(0o600)
        values = json.loads(self.config.read_text())
        values['password'] = 'fixture-value-must-not-be-printed'
        self.config.write_text(json.dumps(values))
        result = self.tty_call(self.production())
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(values['password'], result.stdout + result.stderr)
        self.assertEqual(self.calls(), [])

    def test_backup_or_record_failure_never_reaches_activate(self):
        for phase, last in [('backup', 'backup'), ('review', 'review')]:
            with self.subTest(phase=phase):
                self.log.unlink(missing_ok=True)
                result = self.tty_call(self.production(), extra={'FAIL_REMOTE': phase})
                self.assertEqual(result.returncode, 41)
                self.assertEqual(self.actions()[-1], last)
                self.assertNotIn('activate', self.actions())

    def test_prepare_failure_and_head_drift_do_not_transfer_or_backup(self):
        result = self.tty_call(self.production(), extra={'FAIL_PHASE': '--prepare', 'FAIL_CODE': '29'})
        self.assertEqual(result.returncode, 29)
        self.assertEqual(self.actions(), ['--dry-run', 'inspect', '--prepare'])
        self.log.unlink()
        result = self.tty_call(self.production(), extra={'DRIFT_PREPARE': '1'})
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.actions(), ['--dry-run', 'inspect', '--prepare'])

    def test_observed_current_must_match_optional_operator_pin(self):
        result = self.tty_call(self.production('--expected-current', 'c' * 40))
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.actions(), ['--dry-run', 'inspect'])


if __name__ == '__main__':
    unittest.main()

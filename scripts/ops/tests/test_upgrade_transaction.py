"""Exercise activation ordering and recovery; Docker/PG/network boundaries are simulated."""
from contextlib import ExitStack, contextmanager
import importlib.util
import json
import signal
import subprocess
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
OLD = 'a' * 40
NEW = 'b' * 40
MiB = 1024 ** 2
IMAGES = {name: 'sha256:' + char * 64 for name, char in [('redis', '1'), ('keycloak', '2'), ('backend', '3'), ('caddy', '4')]}
NEXT = {**IMAGES, 'backend': 'sha256:' + '5' * 64, 'caddy': 'sha256:' + '6' * 64}
HISTORY = {'app': 'known-app-schema', 'idp': 'known-idp-schema'}


class UpgradeTransactionTest(unittest.TestCase):
    @contextmanager
    def fixture(self, *, stopped_memory=3072 * MiB, fail=None, changed_history=False):
        spec = importlib.util.spec_from_file_location('transaction', ROOT / 'scripts/ops/deploy-folhea.py')
        d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            base = Path(directory) / 'folhea'; base.mkdir(mode=0o700)
            previous = base / 'releases' / OLD; previous.mkdir(parents=True)
            candidate = base / 'releases' / NEW; candidate.mkdir()
            (base / 'current').symlink_to('releases/' + OLD)
            env = base / 'production.env'; env.write_text('synthetic-test-only\n'); env.chmod(0o600)
            d.configure_target('operator@server.example', str(base), 'folhea-prod', '192.0.2.10')
            d.ROOT = candidate
            events = []
            state = {'stopped': False, 'candidate_attempted': False, 'images': dict(IMAGES)}
            model = {'services': {name: {'mem_limit': size * MiB, 'environment': {}}
                     for name, size in [('redis', 384), ('keycloak', 1024), ('backend', 768), ('caddy', 128)]}}
            state['model'] = model
            model['services']['caddy']['environment'] = {'NPM_PROXY_IP': '198.51.100.2'}
            def event(name):
                events.append(name)
                if state.get('mutate_env_on') == name: env.write_text('changed-private-config\n')
                if events.count(name) == 1:
                    if fail == name: raise d.DeployFailure('injected-' + name)
                    if fail == 'interrupt-' + name: raise KeyboardInterrupt()
                    if fail == 'timeout-' + name: raise subprocess.TimeoutExpired('simulated-own-operation', 1)
            def compose(folder, env_file, images, *args):
                if args[:1] == ('config',): return json.dumps(model).encode()
                if args[:1] == ('stop',):
                    self.assertEqual(tuple(args[1:]), d.WRITERS)
                    journal = json.loads((base / 'deployment-state.json').read_text())
                    self.assertIn(journal['phase'], ('stopping-previous', 'stopping-candidate', 'manual-recovery-required-no-db-downgrade', 'starting-candidate'))
                    if state['candidate_attempted']:
                        event('candidate-stop')
                        if state.get('candidate_stop_raises'): raise d.DeployFailure('candidate-stop-failed')
                        state['stopped'] = True
                        if state.get('commit_migration_on_stop'): state['late_schema_commit'] = True
                    else:
                        state['stopped'] = True
                        event('stop')
                elif args[:1] == ('up',):
                    self.assertEqual(tuple(args[-3:]), d.WRITERS)
                    if folder == candidate:
                        state['candidate_attempted'] = True
                        state['stopped'] = False
                        state['images'] = dict(NEXT)
                        event('candidate-up')
                    else:
                        event('restore-up')
                        state['images'] = dict(IMAGES)
                    state['stopped'] = False
                elif args[:1] == ('exec',): event('backend-ready')
                else: self.fail('unexpected Compose operation: ' + repr(args))
                return b''
            def snapshot(folder, env_file, images):
                event('snapshot-' + ('previous' if folder == previous else 'candidate'))
                if state['stopped']: raise d.DeployFailure('snapshot-stopped')
                return dict(state['images'])
            def history(*unused):
                event('history')
                return {**HISTORY, 'app': 'changed'} if (changed_history and state['candidate_attempted']) or state.get('late_schema_commit') else dict(HISTORY)
            def meminfo(path, *args, **kwargs):
                if path == Path('/proc/meminfo'):
                    event('memory-after-stop' if state['stopped'] else 'memory-running')
                    value = stopped_memory if state['stopped'] else 2058 * MiB
                    return 'MemAvailable: ' + str(value // 1024) + ' kB\n'
                return original_read(path, *args, **kwargs)
            def run(command, **unused):
                if command[:2] == ['docker', 'ps']:
                    event('confirm-candidate-stop')
                    return ('\n'.join(char * 64 for char in '1234')).encode()
                if command[:2] == ['docker', 'inspect']:
                    service = dict(zip('1234', d.SERVICES))[command[-1][0]]
                    return json.dumps({'project': d.PROJECT, 'service': service,
                                       'running': service == 'redis' or not state['stopped'] or state.get('candidate_still_running', False)}).encode()
                event('caddy-validation')
                return b''
            def validate(*unused): event('model')
            guard = SimpleNamespace(validate_model=validate, validate_peer=lambda *x: event('peer'))
            manifest = lambda folder, source: {'source': source, 'images': NEXT if source == NEW else IMAGES,
                                               'keycloak_base': 'same-reviewed-provider'}
            original_read = Path.read_text
            stack.enter_context(patch.object(Path, 'read_text', meminfo))
            stack.enter_context(patch.object(d, 'compose', compose))
            stack.enter_context(patch.object(d, 'read_manifest', manifest))
            stack.enter_context(patch.object(d, 'runtime_images', lambda base, source, manifest: manifest['images']))
            stack.enter_context(patch.object(d, 'load_guard', lambda *x: guard))
            stack.enter_context(patch.object(d, 'inspected_peer', lambda *x: {}))
            stack.enter_context(patch.object(d, 'external_preflight', lambda *x: event('database')))
            stack.enter_context(patch.object(d, 'verify_backup_evidence', lambda *x: event('backup-evidence') or {'receipt_sha256': 'e' * 64}, create=True))
            stack.enter_context(patch.object(d, 'check_subnet', lambda *x: event('subnet')))
            stack.enter_context(patch.object(d, 'snapshot', snapshot))
            stack.enter_context(patch.object(d, 'history', history))
            stack.enter_context(patch.object(d, 'wait_database_writers', lambda *x, **k: event('database-writers-idle'), create=True))
            stack.enter_context(patch.object(d, 'public_preflight', lambda: event('public-preflight')))
            stack.enter_context(patch.object(d, 'public_health', lambda: event('public-health')))
            stack.enter_context(patch.object(d, 'run', run))
            stack.enter_context(patch.object(d.shutil, 'disk_usage', lambda *x: SimpleNamespace(free=9 * 1024 ** 3)))
            args = SimpleNamespace(source=NEW, installation='upgrade', expected_current=OLD,
                                   schema_compatible_reviewed=True, backup_evidence=str(base / 'backup-evidence.json'))
            yield d, args, base, events, state

    def test_upgrade_measures_real_ram_after_own_stop_and_keeps_full_budget(self):
        with self.fixture() as (d, args, base, events, state):
            error = None
            try: d.activate(args)
            except d.DeployFailure as failure: error = str(failure)
            self.assertIsNone(error, 'Upgrade reapplied fresh memory guard before stopping its own writers: ' + str(error))
            self.assertLess(events.index('snapshot-previous'), events.index('stop'))
            self.assertLess(events.index('history'), events.index('stop'))
            self.assertLess(events.index('backup-evidence'), events.index('stop'))
            self.assertLess(events.index('stop'), events.index('memory-after-stop'))
            self.assertLess(events.index('memory-after-stop'), events.index('candidate-up'))
            self.assertEqual((base / 'current').resolve().name, NEW)

    def test_insufficient_actual_memory_restores_previous_without_starting_candidate(self):
        with self.fixture(stopped_memory=2816 * MiB - 1024) as (d, args, base, events, state):
            with self.assertRaises(d.DeployFailure): d.activate(args)
            self.assertIn('stop', events)
            self.assertIn('restore-up', events)
            self.assertNotIn('candidate-up', events)
            self.assertEqual((base / 'current').resolve().name, OLD)
            self.assertFalse(state['stopped'])
            journal = json.loads((base / 'deployment-state.json').read_text())
            self.assertEqual(journal['phase'], 'previous-restored')
            self.assertEqual(journal['cause'], 'shared-host-headroom-insufficient')
            self.assertEqual((base / 'deployment-state.json').stat().st_mode & 0o777, 0o600)

    def test_failed_snapshot_never_stops_current_writers(self):
        with self.fixture(fail='snapshot-previous') as (d, args, base, events, state):
            with self.assertRaises(d.DeployFailure): d.activate(args)
            self.assertIn('snapshot-previous', events)
            self.assertNotIn('stop', events)
            self.assertEqual((base / 'current').resolve().name, OLD)

    def test_exact_threshold_succeeds_but_larger_effective_quota_restores(self):
        with self.fixture(stopped_memory=2816 * MiB) as (d, args, base, events, state):
            d.activate(args)
            self.assertEqual((base / 'current').resolve().name, NEW)
        with self.fixture(stopped_memory=2816 * MiB) as (d, args, base, events, state):
            state['model']['services']['keycloak']['mem_limit'] += 512 * MiB
            with self.assertRaises(d.DeployFailure): d.activate(args)
            self.assertIn('restore-up', events)
            self.assertNotIn('candidate-up', events)

    def test_partial_stop_start_timeout_and_interrupt_restore_only_own_writers(self):
        for failure in ('stop', 'candidate-up', 'timeout-candidate-up', 'interrupt-candidate-up', 'public-health'):
            with self.subTest(failure=failure), self.fixture(fail=failure) as (d, args, base, events, state):
                with self.assertRaises(d.DeployFailure): d.activate(args)
                self.assertIn('restore-up', events)
                self.assertFalse(state['stopped'])
                self.assertEqual((base / 'current').resolve().name, OLD)
                self.assertEqual(json.loads((base / 'deployment-state.json').read_text())['phase'], 'previous-restored')

    def test_unknown_quota_or_changed_config_never_stops_writers(self):
        with self.fixture() as (d, args, base, events, state):
            state['model']['services']['backend'].pop('mem_limit')
            with self.assertRaises(d.DeployFailure): d.activate(args)
            self.assertNotIn('stop', events)
        with self.fixture() as (d, args, base, events, state):
            state['mutate_env_on'] = 'caddy-validation'
            with self.assertRaises(d.DeployFailure): d.activate(args)
            self.assertNotIn('stop', events)

    def test_backup_failure_and_unattested_previous_image_never_stop_writers(self):
        with self.fixture(fail='backup-evidence') as (d, args, base, events, state):
            with self.assertRaises(d.DeployFailure): d.activate(args)
            self.assertNotIn('stop', events)
        with self.fixture() as (d, args, base, events, state):
            state['images']['backend'] = 'sha256:' + 'f' * 64
            with self.assertRaises(d.DeployFailure): d.activate(args)
            self.assertNotIn('stop', events)

    def test_schema_change_refuses_database_downgrade_and_keeps_durable_recovery(self):
        with self.fixture(fail='candidate-up', changed_history=True) as (d, args, base, events, state):
            with self.assertRaises(d.DeployFailure): d.activate(args)
            self.assertNotIn('restore-up', events)
            self.assertTrue(state['stopped'])
            journal = json.loads((base / 'deployment-state.json').read_text())
            self.assertEqual(journal['phase'], 'manual-recovery-required-no-db-downgrade')
            self.assertEqual((base / 'current').resolve().name, OLD)
            before = list(events)
            with self.assertRaisesRegex(d.DeployFailure, 'pending-recovery'):
                d.activate(args)
            self.assertEqual(events, before)

    def test_crash_journal_requires_explicit_source_bound_recovery(self):
        with self.fixture() as (d, args, base, events, state):
            journal = {'source': NEW, 'previous': OLD, 'target': d.state_target(),
                       'running_images': IMAGES, 'flyway_before': HISTORY, 'env_sha256': d.sha(base / 'production.env'),
                       'candidate_attempted': False, 'backup_evidence': args.backup_evidence, 'phase': 'previous-stopped'}
            d.write_json_atomic(base / 'deployment-state.json', journal)
            state['stopped'] = True
            with self.assertRaisesRegex(d.DeployFailure, 'pending-recovery'): d.activate(args)
            self.assertEqual(events, [])
            args.expected_current = 'c' * 40
            with self.assertRaises(d.DeployFailure): d.recover_activation(args)
            self.assertEqual(events, [])
            args.expected_current = OLD
            d.recover_activation(args)
            self.assertIn('restore-up', events)
            self.assertFalse(state['stopped'])
            self.assertEqual(json.loads((base / 'deployment-state.json').read_text())['phase'], 'previous-restored')

    def test_late_candidate_migration_is_observed_only_after_stop_and_confirmation(self):
        with self.fixture(fail='candidate-up') as (d, args, base, events, state):
            state['commit_migration_on_stop'] = True
            with self.assertRaises(d.DeployFailure): d.activate(args)
            self.assertIn('candidate-stop', events)
            self.assertLess(events.index('candidate-stop'), events.index('confirm-candidate-stop'))
            self.assertLess(events.index('confirm-candidate-stop'), events.index('database-writers-idle'))
            self.assertLess(events.index('database-writers-idle'), len(events) - 1 - events[::-1].index('history'))
            self.assertNotIn('restore-up', events)
            self.assertEqual((base / 'current').resolve().name, OLD)

    def test_failed_or_unconfirmed_candidate_stop_never_starts_previous(self):
        for condition in ('candidate_stop_raises', 'candidate_still_running'):
            with self.subTest(condition=condition), self.fixture(fail='candidate-up') as (d, args, base, events, state):
                state[condition] = True
                with self.assertRaises(d.DeployFailure): d.activate(args)
                self.assertNotIn('restore-up', events)
                self.assertNotIn('database-writers-idle', events)
                self.assertEqual(events.count('history'), 1)

    def test_explicit_recovery_also_stops_candidate_before_reading_schema(self):
        with self.fixture() as (d, args, base, events, state):
            journal = {'source': NEW, 'previous': OLD, 'target': d.state_target(),
                       'running_images': IMAGES, 'flyway_before': HISTORY, 'env_sha256': d.sha(base / 'production.env'),
                       'candidate_attempted': True, 'backup_evidence': args.backup_evidence, 'phase': 'starting-candidate'}
            d.write_json_atomic(base / 'deployment-state.json', journal)
            state.update(candidate_attempted=True, stopped=False, commit_migration_on_stop=True, images=dict(NEXT))
            with self.assertRaises(d.DeployFailure): d.recover_activation(args)
            self.assertLess(events.index('confirm-candidate-stop'), events.index('history'))
            self.assertNotIn('restore-up', events)

    def test_database_writer_drain_uses_only_own_roles_and_times_out_closed(self):
        spec = importlib.util.spec_from_file_location('writer_drain', ROOT / 'scripts/ops/deploy-folhea.py')
        d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
        self.assertTrue(hasattr(d, 'wait_database_writers'), 'Read-only database writer drain is missing')
        from unittest.mock import Mock
        sql = Mock(side_effect=['1', '0', '0', '0'])
        with patch.object(d, 'database_module', return_value=SimpleNamespace(sql=sql)), patch.object(d.time, 'sleep'):
            d.wait_database_writers(ROOT, {}, timeout=1)
        self.assertEqual(sql.call_count, 4)
        for query, database, role in (call.args for call in sql.call_args_list):
            self.assertIn((database, role), [('folhea', 'folhea_app'), ('folhea_keycloak', 'folhea_keycloak')])
            self.assertIn('BEGIN READ ONLY', query)
            self.assertNotIn('pg_terminate', query)
        sql = Mock(return_value='1')
        with patch.object(d, 'database_module', return_value=SimpleNamespace(sql=sql)), \
             patch.object(d.time, 'monotonic', side_effect=[0, 2]), patch.object(d.time, 'sleep'):
            with self.assertRaises(d.DeployFailure): d.wait_database_writers(ROOT, {}, timeout=1)

    def test_catchable_signal_handlers_restore_original_handlers(self):
        spec = importlib.util.spec_from_file_location('signals', ROOT / 'scripts/ops/deploy-folhea.py')
        d = importlib.util.module_from_spec(spec); spec.loader.exec_module(d)
        for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            original = signal.getsignal(number)
            with self.assertRaisesRegex(d.DeployFailure, 'activation-interrupted'):
                with d.interruption_handlers(): signal.raise_signal(number)
            self.assertEqual(signal.getsignal(number), original)


if __name__ == '__main__': unittest.main()

"""Execute the health CLI; replace only HTTP transport, never its validation."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


class HealthCheckTest(unittest.TestCase):
    def check(self, scenario, paths='/q/health/live,/q/health/ready', **overrides):
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / 'http.mjs'
            fixture.write_text('''
let attempts = 0;
globalThis.fetch = async (_url, options = {}) => {
  const scenario = process.env.HEALTH_FIXTURE;
  const good = () => new Response(JSON.stringify({ status: 'UP' }), {
    headers: { 'Content-Type': 'application/json' }
  });
  if (scenario === 'redirect') {
    if (options.redirect === 'error') throw new TypeError('redirect rejected');
    if (options.redirect === 'manual') return new Response(null, { status: 302 });
    return new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } });
  }
  if (scenario === 'timeout') {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 2000);
      options.signal?.addEventListener('abort', () => {
        clearTimeout(timer); reject(options.signal.reason);
      }, { once: true });
    });
    return good();
  }
  if (scenario === 'retry' && attempts++ === 0) return new Response(null, { status: 503 });
  if (scenario === 'up' || scenario === 'retry') return good();
  if (scenario === 'html') return new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } });
  if (scenario === 'empty') return new Response(null, { status: 200 });
  if (scenario === 'no-content') return new Response(null, { status: 204 });
  return new Response(scenario === 'down' ? '{"status":"DOWN"}' : '{}', {
    headers: { 'Content-Type': 'application/json' }
  });
};
''')
            env = dict(os.environ, HEALTHCHECK_URL='https://health-fixture.invalid',
                       HEALTHCHECK_PATHS=paths, HEALTHCHECK_ATTEMPTS='1',
                       HEALTHCHECK_DELAY_MS='1', HEALTHCHECK_TIMEOUT_MS='30',
                       HEALTH_FIXTURE=scenario)
            env.update(overrides)
            return subprocess.run(['node', '--import', str(fixture),
                                   str(ROOT / 'scripts/ci/health-check.mjs')],
                                  env=env, capture_output=True, text=True, timeout=5)

    def test_redirect_is_rejected_for_dependency_and_edge_health(self):
        for paths in ('/q/health/ready', '/healthz'):
            with self.subTest(paths=paths):
                self.assertNotEqual(self.check('redirect', paths).returncode, 0)

    def test_readiness_rejects_html_empty_missing_status_and_down(self):
        for scenario in ('html', 'empty', 'missing-status', 'down', 'no-content'):
            with self.subTest(scenario=scenario):
                self.assertNotEqual(self.check(scenario).returncode, 0)

    def test_readiness_accepts_up(self):
        self.assertEqual(self.check('up').returncode, 0)

    def test_edge_accepts_empty_200_but_rejects_204(self):
        self.assertEqual(self.check('empty', '/healthz').returncode, 0)
        self.assertNotEqual(self.check('no-content', '/healthz').returncode, 0)

    def test_edge_rejects_an_unrelated_page_or_json_response(self):
        for scenario in ('html', 'missing-status', 'down'):
            with self.subTest(scenario=scenario):
                self.assertNotEqual(self.check(scenario, '/healthz').returncode, 0)

    def test_no_endpoint_does_not_count_as_healthy(self):
        self.assertNotEqual(self.check('up', ' , ').returncode, 0)

    def test_slow_http_is_aborted_before_it_can_report_up(self):
        result = self.check('timeout')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('health check passed', result.stdout)

    def test_transient_http_failure_can_recover_on_next_attempt(self):
        result = self.check('retry', '/q/health/ready', HEALTHCHECK_ATTEMPTS='2')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('attempt 2', result.stdout)


if __name__ == '__main__':
    unittest.main()

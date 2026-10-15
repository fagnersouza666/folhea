#!/usr/bin/env node
// Actual Caddy HTTP boundary, with a synthetic header/body-counting upstream.
// No application, account, OIDC provider or certificate issuance is simulated.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const name = `folhea-npm-edge-${process.pid}`;
const image = process.env.CADDY_TEST_IMAGE ?? 'caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f';
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--ipam-only'), 'Only --ipam-only is supported');
const ipam = spawnSync('python3', ['-B', join(root, 'scripts/ops/tests/test_npm_compose.py'), '--edge-ipam', image],
  { encoding: 'utf8', timeout: 90000 });
assert.equal(ipam.status, 0, `Real edge IP allocation: ${ipam.error?.message ?? ipam.stderr}`);
process.stdout.write(ipam.stdout);
if (process.argv[2] === '--ipam-only') process.exit(0);
const scratch = await mkdtemp(join(tmpdir(), 'folhea-npm-edge-'));
const photo = '/api/v1/books/10000000-0000-0000-0000-000000000001/photo';
let upstreamCalls = 0;
const upstream = createServer((req, res) => {
  upstreamCalls++;
  let bytes = 0;
  req.on('data', data => { bytes += data.length; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers['x-fixture-status']) {
      res.statusCode = Number(req.headers['x-fixture-status']);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('ETag', '"synthetic-photo-digest"');
    }
    if (req.url === '/auth/login') {
      res.statusCode = 302;
      res.setHeader('Location', `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host']}/auth/callback`);
    }
    res.end(JSON.stringify({ bytes, headers: req.headers }));
  });
  req.on('error', () => res.destroy());
});
const listen = server => new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
async function unusedPort() {
  const server = createServer(); await listen(server); const port = server.address().port;
  await new Promise(ok => server.close(ok)); return port;
}
let port;
function request(path, { method = 'GET', headers = {}, body, peer = '127.0.0.2' } = {}) {
  return new Promise((ok, fail) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method, localAddress: peer,
      headers: { Host: 'folhea.app', 'X-Forwarded-For': '198.51.100.99, 203.0.113.10', ...headers },
      signal: AbortSignal.timeout(10000) }, res => {
      const chunks = [];
      res.on('data', data => chunks.push(data));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', fail);
    });
    req.on('error', fail); req.end(body);
  });
}
try {
  await listen(upstream); port = await unusedPort();
  const otherPort = await unusedPort();
  const source = await readFile(join(root, process.env.NPM_TEST_CADDYFILE ?? 'infra/Caddyfile.npm'), 'utf8');
  // Only the listener is relocated to an ephemeral local port. The shipped
  // boundary, routes and header policy are otherwise exercised unchanged.
  const config = source.replace('http://:80 {', `http://:${port} {\n\tbind 127.0.0.1`)
    .replace('{$PUBLIC_DOMAIN} {', `http://:${port} {\n\tbind 127.0.0.1`)
    .replace('{\n', '{\n\tadmin off\n');
  await writeFile(join(scratch, 'Caddyfile'), config, { mode: 0o600 });
  await mkdir(join(scratch, 'static'));
  for (const [file, content] of [['index.html', '<h1>Public fixture</h1>'], ['index.csr.html', '<h1>Private fixture</h1>'], ['404.html', '<h1>Not found fixture</h1>']]) {
    await writeFile(join(scratch, 'static', file), content, { mode: 0o644 });
  }
  const launched = spawnSync('docker', ['run', '--pull=never', '--detach', '--rm', '--name', name,
    '--label', `ao.session=${process.env.AO_SESSION_ID ?? 'manual'}`, '--memory=128m', '--cpus=0.5',
    '--network=host', '--volume', `${join(scratch, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`,
    '--volume', `${join(scratch, 'static')}:/srv:ro`, '--env', 'PUBLIC_DOMAIN=folhea.app',
    '--env', 'NPM_PROXY_IP=127.0.0.2', '--env', 'OIDC_PUBLIC_ORIGIN=https://folhea.app',
    '--env', `HTTP_SITE_ADDRESS=http://127.0.0.1:${otherPort}`,
    '--env', `API_UPSTREAM=http://127.0.0.1:${upstream.address().port}`,
    '--env', `KEYCLOAK_UPSTREAM=http://127.0.0.1:${upstream.address().port}`, '--env', 'STATIC_ROOT=/srv', image],
  { encoding: 'utf8', timeout: 30000 });
  assert.equal(launched.status, 0, `Caddy launch: ${launched.error?.message ?? launched.stderr}`);
  let ready = false;
  let startupStatus;
  for (let n = 0; n < 100; n++) {
    try { startupStatus = (await request('/api/v1/boundary-readiness')).status; ready = startupStatus === 200; } catch {}
    if (ready) break; await delay(100);
  }
  if (!ready) {
    const logs = spawnSync('docker', ['logs', '--tail', '12', name], { encoding: 'utf8', timeout: 5000 });
    assert.fail(`Caddy startup ${startupStatus}: ${(logs.stdout + logs.stderr).slice(-2500)}`);
  }
  const page = await request('/');
  assert.equal(page.status, 200, 'Private HTTP listener must serve, not redirect back to NPM');
  assert.equal(page.headers.location, undefined, 'No HTTPS redirect loop on private HTTP');
  const before = upstreamCalls;
  assert.equal((await request('/api/v1/me', { peer: '127.0.0.3' })).status, 403, 'Another shared-network peer must not reach Folhea');
  assert.equal((await request('/api/v1/me', { headers: { Host: 'attacker.example' } })).status, 421, 'Trusted peer still needs the canonical Host');
  assert.equal(upstreamCalls, before, 'Rejected peer/Host must not contact an upstream');
  assert.equal((await request('/healthz', { peer: '127.0.0.1' })).status, 200, 'Loopback Docker health remains available');
  assert.equal((await request('/healthz', { peer: '127.0.0.3' })).status, 403, 'Health is not a shared-network bypass');
  assert.equal((await request('/healthz', { headers: { Host: 'attacker.example' } })).status, 421, 'Public health must still validate Host');
  const callsBeforeHealth = upstreamCalls;
  const health = await request('/healthz');
  assert.equal(health.status, 200, 'The trusted NPM peer must reach public edge health');
  assert.equal(health.body.length, 0, 'Edge health must expose no application or dependency details');
  assert.equal(health.headers['cache-control'], 'no-store');
  assert.equal(health.headers.location, undefined);
  assert.equal(upstreamCalls, callsBeforeHealth, 'Edge health must not call a backend or IdP');
  for (const path of ['/unknown-own-route', '/healthz/extra']) {
    const missing = await request(path);
    assert.equal(missing.status, 404); assert.match(missing.body.toString(), /Not found fixture/);
  }
  for (const path of ['/api/v1/me', photo, '/auth/callback', '/realms/folhea/protocol/openid-connect/auth']) {
    const response = await request(path, { headers: { Forwarded: 'proto=http;host=attacker.example',
      'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Port': '81',
      'X-Forwarded-Ssl': 'off', 'X-Forwarded-Prefix': '/injected' } });
    assert.equal(response.status, 200);
    const received = JSON.parse(response.body).headers;
    assert.equal(received.host, 'folhea.app');
    assert.equal(received['x-forwarded-host'], 'folhea.app');
    assert.equal(received['x-forwarded-proto'], 'https');
    assert.equal(received['x-forwarded-for'], '203.0.113.10', 'Strict right-to-left parsing must discard forged left-hand addresses');
    for (const key of ['forwarded', 'x-forwarded-port', 'x-forwarded-ssl', 'x-forwarded-prefix']) assert.equal(received[key], undefined);
  }
  const login = await request('/auth/login');
  assert.equal(login.status, 302); assert.equal(login.headers.location, 'https://folhea.app/auth/callback');
  assert.equal(login.headers['cache-control'], 'no-store');
  for (const path of ['/admin/', '/realms/folhea/protocol/openid-connect/token', '/realms/folhea/protocol/openid-connect/certs', '/q/metrics', '/q/health/ready', '/api/openapi']) {
    assert.equal((await request(path)).status, 404, `${path} must stay outside the public surface`);
  }
  for (const path of ['/app/inicio', '/app/unknown-own-route', '/entrar', '/cadastro']) {
    const response = await request(path);
    assert.equal(response.status, 200); assert.match(response.body.toString(), /Private fixture/);
    assert.equal(response.headers['cache-control'], 'no-store'); assert.match(response.headers['x-robots-tag'], /noindex/);
  }
  const bodyCases = [
    ['POST', '/api/v1/books', 'multipart/form-data; boundary=x', 3145728, 200],
    ['PATCH', '/api/v1/books/fixture-id', 'multipart/form-data; boundary=x', 3145728, 200],
    ['POST', '/api/v1/books', 'multipart/form-data; boundary=x', 3145729, 413],
    ['PATCH', '/api/v1/books/fixture-id', 'multipart/form-data; boundary=x', 3145729, 413],
    ['POST', '/api/v1/books', 'application/json', 65536, 200],
    ['POST', '/api/v1/books', 'application/json', 65537, 413],
    ['POST', '/api/v1/sessions', 'multipart/form-data; boundary=x', 65537, 413],
    ['PUT', photo, 'image/jpeg', 1000000, 200],
    ['PUT', photo, 'image/jpeg', 1000001, 413],
    ['PUT', photo, 'application/pdf', 1000000, 200],
    ['POST', photo, 'image/jpeg', 65537, 413],
    ['PUT', '/api/v1/books/not-a-uuid/photo', 'image/jpeg', 65537, 413]
  ];
  for (const [method, path, type, bytes, expected] of bodyCases) {
    const response = await request(path, { method, headers: { 'Content-Type': type }, body: Buffer.alloc(bytes) });
    assert.equal(response.status, expected, `${method} ${path}: ${bytes} bytes`);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.headers['content-security-policy'], /img-src 'self' data: blob:/);
    if (expected === 200) assert.equal(JSON.parse(response.body).bytes, bytes);
  }
  const cacheCases = [
    ['GET', photo, 200, 'private, no-cache, max-age=0, must-revalidate'],
    ['GET', photo, 304, 'private, no-cache, max-age=0, must-revalidate'],
    ['GET', photo, 401, 'no-store'], ['GET', photo, 404, 'no-store'], ['GET', photo, 500, 'no-store'],
    ['HEAD', photo, 200, 'no-store'], ['GET', '/api/v1/me', 200, 'no-store']
  ];
  for (const [method, path, status, cache] of cacheCases) {
    const response = await request(path, { method, headers: { 'X-Fixture-Status': String(status) } });
    assert.equal(response.status, status); assert.equal(response.headers['cache-control'], cache);
    assert.equal(response.headers.etag, '"synthetic-photo-digest"');
  }
  console.log(`ok - NPM HTTP peer/Host/HTTPS/client IP boundaries; ${bodyCases.length} body and ${cacheCases.length} cache cases; private routes/admin404`);
} finally {
  spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore', timeout: 10000 });
  upstream.closeAllConnections(); await new Promise(ok => upstream.close(ok));
  await rm(scratch, { recursive: true, force: true });
}

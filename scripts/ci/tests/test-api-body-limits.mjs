#!/usr/bin/env node
// Actual Caddy boundary regression; the upstream counts synthetic bytes and
// returns explicit status/header fixtures. No identity or image decoding proof.
// This is not an authentication/provider fixture or an application E2E test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = await mkdtemp(join(tmpdir(), 'folhea-edge-body-'));
const name = `folhea-edge-body-${process.pid}`;
const image = process.env.CADDY_TEST_IMAGE ?? 'caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f';
const photo = '/api/v1/books/10000000-0000-0000-0000-000000000001/photo';
const upstream = createServer((req, res) => {
  let bytes = 0;
  req.on('data', (data) => { bytes += data.length; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers['x-fixture-status']) {
      res.statusCode = Number(req.headers['x-fixture-status']);
      res.setHeader('ETag', '"photo-fixture-digest"');
      // Deliberately conflicting cache header: the edge must decide by route
      // and status, without duplicating or leaking public cache directives.
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
    res.end(JSON.stringify({ bytes }));
  });
  req.on('error', () => { res.destroy(); });
});
const listen = (server) => new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
async function unusedPort() {
  const server = createServer(); await listen(server); const port = server.address().port;
  await new Promise((ok) => server.close(ok)); return port;
}
try {
  await listen(upstream);
  const port = await unusedPort();
  const httpPort = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const source = await readFile(join(root, 'infra/Caddyfile'), 'utf8');
  // Disable the test container's administrative listener on the host network.
  await writeFile(join(scratch, 'Caddyfile'), source.replace('{\n', '{\n\tadmin off\n'), { mode: 0o600 });
  // Pull/create is bounded and completes before readiness starts. A detached
  // CLI cannot start late after cleanup and leave an awaited run process alive.
  const launched = spawnSync('docker', ['run', '--detach', '--rm', '--name', name, '--label', `ao.session=${process.env.AO_SESSION_ID ?? 'manual'}`,
    '--memory=128m', '--cpus=0.5',
    '--network', 'host', '--volume', `${join(scratch, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`,
    '--env', `PUBLIC_DOMAIN=${base}`, '--env', `OIDC_PUBLIC_ORIGIN=${base}`, '--env', `HTTP_SITE_ADDRESS=http://127.0.0.1:${httpPort}`,
    '--env', `API_UPSTREAM=http://127.0.0.1:${upstream.address().port}`, '--env', 'STATIC_ROOT=/srv', image],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  assert.equal(launched.status, 0, `Caddy creation failed: ${launched.error?.message ?? launched.stderr}`);
  let ready = false;
  const readyDeadline = Date.now() + 60000;
  while (Date.now() < readyDeadline) {
    try { ready = (await fetch(`${base}/api/v1/body-limit-readiness`, { signal: AbortSignal.timeout(500) })).status === 200; } catch {}
    if (ready) break;
    await delay(100);
  }
  if (!ready) {
    const logs = spawnSync('docker', ['logs', '--tail', '30', name], { encoding: 'utf8', timeout: 10000 });
    assert.fail(`Caddy must become ready: ${(logs.stdout + logs.stderr).slice(-4000)}`);
  }
  const cases = [
    ['POST', '/api/v1/books', 'multipart/form-data; boundary=fixture', 128 * 1024, 200],
    ['PATCH', '/api/v1/books/fixture-id', 'multipart/form-data; boundary=fixture', 128 * 1024, 200],
    ['POST', '/api/v1/books', 'multipart/form-data; boundary=fixture', 3 * 1024 * 1024, 200],
    ['POST', '/api/v1/books', 'multipart/form-data; boundary=fixture', 3 * 1024 * 1024 + 1, 413],
    ['PATCH', '/api/v1/books/fixture-id', 'application/json', 128 * 1024, 413],
    ['POST', '/api/v1/books', 'application/json', 128 * 1024, 413],
    ['POST', '/api/v1/sessions', 'multipart/form-data; boundary=fixture', 128 * 1024, 413],
    ['POST', '/api/v1/books/fixture-id/finish', 'multipart/form-data; boundary=fixture', 128 * 1024, 413],
    ['PUT', '/api/v1/books/fixture-id', 'multipart/form-data; boundary=fixture', 128 * 1024, 413],
    ['POST', '/api/v1/books/fixture-id', 'multipart/form-data; boundary=fixture', 128 * 1024, 413],
    ['PATCH', '/api/v1/books', 'multipart/form-data; boundary=fixture', 128 * 1024, 413],
    ['POST', '/api/v1/sessions', 'application/json', 1024, 200],
    ['POST', '/api/v1/sessions', 'application/json', 65536, 200],
    ['POST', '/api/v1/sessions', 'application/json', 65537, 413],
    ['POST', '/api/v1/books', 'multipart/form-data-other; boundary=fixture', 128 * 1024, 413],
    ['POST', '/api/v1/books', 'Multipart/Form-Data; boundary=fixture', 128 * 1024, 200],
    ['PUT', photo, 'image/jpeg', 65537, 200],
    ['PUT', photo, 'image/jpeg', 1000000, 200],
    ['PUT', photo, 'image/jpeg', 1000001, 413],
    ['PUT', photo, 'image/png', 1000000, 200],
    ['PUT', photo, 'image/webp', 1000000, 200],
    // Unsupported formats reach the backend's 415 validation within the RAW
    // limit. The counting fixture does not validate formats or authentication.
    ['PUT', photo, 'application/pdf', 128 * 1024, 200],
    ['POST', photo, 'image/jpeg', 128 * 1024, 413],
    ['PATCH', photo, 'image/jpeg', 128 * 1024, 413],
    ['DELETE', photo, 'image/jpeg', 128 * 1024, 413],
    ['PUT', '/api/v1/books/not-a-uuid/photo', 'image/jpeg', 128 * 1024, 413],
    ['PUT', photo + '/extra', 'image/jpeg', 128 * 1024, 413],
    ['PUT', '/api/v1/books/10000000-0000-0000-0000-000000000001', 'image/jpeg', 128 * 1024, 413]
  ];
  for (const [method, path, contentType, size, expected] of cases) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': contentType }, body: Buffer.alloc(size), signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, expected, `${method} ${path} ${contentType} ${size} bytes`);
    assert.equal(response.headers.get('cache-control'), 'no-store', `${path} must remain private`);
    assert.ok(response.headers.get('content-security-policy')?.includes("img-src 'self' data: blob:"), 'same-origin cover/blob preview policy');
    if (expected === 200) assert.equal((await response.json()).bytes, size, 'upstream must receive the complete allowed body');
    else await response.arrayBuffer();
  }
  const cacheCases = [
    ['GET', photo, 200, 'private, no-cache, max-age=0, must-revalidate'],
    ['GET', photo, 304, 'private, no-cache, max-age=0, must-revalidate'],
    ['GET', photo, 401, 'no-store'],
    ['GET', photo, 404, 'no-store'],
    ['GET', photo, 500, 'no-store'],
    ['HEAD', photo, 200, 'no-store'],
    ['GET', '/api/v1/books/not-a-uuid/photo', 200, 'no-store'],
    ['GET', photo + '/extra', 200, 'no-store'],
    ['GET', '/api/v1/me', 200, 'no-store'],
    ['PUT', photo, 200, 'no-store']
  ];
  for (const [method, path, status, expected] of cacheCases) {
    const response = await fetch(base + path, { method,
      headers: { 'X-Fixture-Status': String(status) }, signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status, 'Proxy must preserve backend status');
    const cache = response.headers.get('cache-control');
    if (expected === 'no-store') assert.ok(cache?.split(',').every(value => value.trim() === 'no-store'), `${method} ${path} must forbid cache`);
    else assert.equal(cache, expected, `${method} ${path} cache/status boundary`);
    assert.equal(response.headers.get('etag'), '"photo-fixture-digest"', 'ETag must pass unchanged');
    await response.arrayBuffer();
  }
  console.log(`ok - ${cases.length} actual Caddy body limits and ${cacheCases.length} private photo cache/status cases`);
} finally {
  spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore', timeout: 10000 });
  upstream.closeAllConnections();
  await new Promise((ok) => upstream.close(ok));
  await rm(scratch, { recursive: true, force: true });
}

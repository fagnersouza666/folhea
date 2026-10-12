#!/usr/bin/env node
// Actual Caddy boundary regression; the upstream only counts synthetic bytes.
// This is not an authentication/provider fixture or an application E2E test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = await mkdtemp(join(tmpdir(), 'folhea-edge-body-'));
const name = `folhea-edge-body-${process.pid}`;
const image = process.env.CADDY_TEST_IMAGE ?? 'caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f';
const upstream = createServer((req, res) => {
  let bytes = 0;
  req.on('data', (data) => { bytes += data.length; });
  req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ bytes })); });
  req.on('error', () => { res.destroy(); });
});
const listen = (server) => new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
async function unusedPort() {
  const server = createServer(); await listen(server); const port = server.address().port;
  await new Promise((ok) => server.close(ok)); return port;
}
let child;
let startupError = "";
try {
  await listen(upstream);
  const port = await unusedPort();
  const httpPort = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const source = await readFile(join(root, 'infra/Caddyfile'), 'utf8');
  // Disable the test container's administrative listener on the host network.
  await writeFile(join(scratch, 'Caddyfile'), source.replace('{\n', '{\n\tadmin off\n'), { mode: 0o600 });
  child = spawn('docker', ['run', '--rm', '--name', name, '--label', `ao.session=${process.env.AO_SESSION_ID ?? 'manual'}`,
    '--network', 'host', '--volume', `${join(scratch, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`,
    '--env', `PUBLIC_DOMAIN=${base}`, '--env', `OIDC_PUBLIC_ORIGIN=${base}`, '--env', `HTTP_SITE_ADDRESS=http://127.0.0.1:${httpPort}`,
    '--env', `API_UPSTREAM=http://127.0.0.1:${upstream.address().port}`, '--env', 'STATIC_ROOT=/srv', image],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (part) => { startupError = (startupError + part.toString()).slice(-4000); });
  child.once('error', () => {});
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await fetch(`${base}/api/v1/body-limit-readiness`, { signal: AbortSignal.timeout(500) })).status === 200; } catch {}
    if (ready) break;
    if (child.exitCode !== null) throw new Error('Caddy test container exited before readiness');
    await delay(100);
  }
  assert.ok(ready, `Caddy must become ready: ${startupError}`);
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
    ['POST', '/api/v1/books', 'multipart/form-data-other; boundary=fixture', 128 * 1024, 413],
    ['POST', '/api/v1/books', 'Multipart/Form-Data; boundary=fixture', 128 * 1024, 200]
  ];
  for (const [method, path, contentType, size, expected] of cases) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': contentType }, body: Buffer.alloc(size), signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, expected, `${method} ${path} ${contentType} ${size} bytes`);
    assert.equal(response.headers.get('cache-control'), 'no-store', `${path} must remain private`);
    assert.ok(response.headers.get('content-security-policy')?.includes("img-src 'self' data: blob:"), 'same-origin cover/blob preview policy');
    if (expected === 200) assert.equal((await response.json()).bytes, size, 'upstream must receive the complete allowed body');
    else await response.arrayBuffer();
  }
  console.log(`ok - ${cases.length} actual Caddy body limits/private-header cases`);
} finally {
  spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
  if (child) await new Promise((ok) => { if (child.exitCode !== null) ok(); else child.once('exit', ok); });
  upstream.closeAllConnections();
  await new Promise((ok) => upstream.close(ok));
  await rm(scratch, { recursive: true, force: true });
}

#!/usr/bin/env node
// Actual standalone Caddy routes. No app build, provider, public TLS or network
// service is needed: the shipped site and :81 listener use loopback test ports.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const image = process.env.CADDY_TEST_IMAGE ?? 'caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f';
const name = `folhea-health-edge-${process.pid}`;
const scratch = await mkdtemp(join(tmpdir(), 'folhea-health-edge-'));
async function unusedPort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  await new Promise(ok => server.close(ok));
  return port;
}
function get(port, path) {
  return new Promise((ok, fail) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, signal: AbortSignal.timeout(3000) }, res => {
      const chunks = [];
      res.on('data', data => chunks.push(data));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', fail);
    });
    req.on('error', fail); req.end();
  });
}
try {
  const port = await unusedPort();
  const httpPort = await unusedPort();
  const source = await readFile(join(root, 'infra/Caddyfile'), 'utf8');
  // Admin must not bind another project's port when using the host network.
  await writeFile(join(scratch, 'Caddyfile'), source.replace('{\n', '{\n\tadmin off\n'), { mode: 0o600 });
  await mkdir(join(scratch, 'static'));
  for (const [file, body] of [['index.html', '<h1>Public fixture</h1>'], ['index.csr.html', '<h1>Private fixture</h1>'], ['404.html', '<h1>Not found fixture</h1>']]) {
    await writeFile(join(scratch, 'static', file), body);
  }
  const run = spawnSync('docker', ['run', '--pull=never', '--detach', '--rm', '--name', name,
    '--label', `ao.session=${process.env.AO_SESSION_ID ?? 'manual'}`, '--memory=128m', '--cpus=0.5', '--network=host',
    '--volume', `${join(scratch, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`, '--volume', `${join(scratch, 'static')}:/srv:ro`,
    '--env', `PUBLIC_DOMAIN=http://127.0.0.1:${port}`, '--env', `HTTP_SITE_ADDRESS=http://127.0.0.1:${httpPort}`,
    '--env', 'OIDC_PUBLIC_ORIGIN=https://folhea.app', '--env', 'STATIC_ROOT=/srv', '--env', 'API_UPSTREAM=http://127.0.0.1:9', image],
  { encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await get(port, '/')).status === 200; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, 'Caddy must serve the public fixture before checking the health route');
  const health = await get(port, '/healthz');
  assert.equal(health.status, 200, 'Domain /healthz must precede the static fallback');
  assert.equal(health.body, '', 'Health must not expose dependency or application details');
  assert.equal(health.headers.location, undefined, 'Health is a direct response');
  assert.match((await get(port, '/')).body, /Public fixture/);
  const deep = await get(port, '/app/unknown-own-route');
  assert.equal(deep.status, 200); assert.match(deep.body, /Private fixture/);
  assert.equal(deep.headers['cache-control'], 'no-store');
  assert.match(deep.headers['x-robots-tag'], /noindex/);
  for (const path of ['/unknown-own-route', '/healthz/extra', '/admin/', '/q/health/ready']) {
    const response = await get(port, path);
    assert.equal(response.status, 404, `${path}: preserve the real branded 404`);
    assert.match(response.body, /Not found fixture/);
  }
  const privateHealth = await get(httpPort, '/healthz');
  assert.equal(privateHealth.status, 200); assert.equal(privateHealth.body, '');
  const redirect = await get(httpPort, '/app/unknown-own-route');
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, 'https://folhea.app/app/unknown-own-route');
  console.log('ok - standalone health200 empty/direct, home200, deep CSR200/no-store, unknown/private404 and unchanged :81 health/redirect');
} finally {
  spawnSync('docker', ['rm', '--force', '--volumes', name], { stdio: 'ignore', timeout: 10000 });
  await rm(scratch, { recursive: true, force: true });
}

#!/usr/bin/env node
// Real Docker/Caddy regression: delay only the owned docker-run command to
// reproduce a cold-pull boundary. No API/provider responses are mocked.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const scratch = await mkdtemp(join(tmpdir(), 'folhea-caddy-startup-'));
const docker = spawnSync('which', ['docker'], { encoding: 'utf8' }).stdout.trim();
assert.ok(docker.startsWith('/'));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
let child;
let deadline;
try {
  await writeFile(join(scratch, 'docker'), `#!/bin/sh\nif [ "$1" = run ]; then sleep 9; fi\nexec ${quote(docker)} "$@"\n`, { mode: 0o700 });
  child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'test-api-body-limits.mjs')], {
    env: { ...process.env, PATH: `${scratch}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  let timedOut = false;
  deadline = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 20000);
  const result = await new Promise((ok, fail) => { child.once('error', fail); child.once('exit', (code, signal) => ok({ code, signal })); });
  assert.equal(timedOut, false, 'Late docker creation must not deadlock cleanup');
  assert.equal(result.code, 0, output);
  assert.match(output, /ok - 14 actual Caddy/);
  console.log('ok - delayed Docker startup completes all14 cases and cleanup within20s');
} finally {
  clearTimeout(deadline);
  if (child?.pid) spawnSync(docker, ['rm', '--force', `folhea-edge-body-${child.pid}`], { stdio: 'ignore', timeout: 10000 });
  await rm(scratch, { recursive: true, force: true });
}

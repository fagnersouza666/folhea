import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const gate = 'scripts/ci/validate-domain-surface.mjs';
const retired = [['folhea', 'com', 'br'], ['folhea', 'fagnersouza', 'tech']].map(parts => parts.join('.'));

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'folhea-domain-surface-'));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const write = (name, text) => {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), text);
    git('add', '--', name);
  };
  try {
    git('init', '--quiet');
    write('scripts/ci/placeholder', '');
    if (existsSync(join(root, gate))) copyFileSync(join(root, gate), join(directory, gate));
    const execute = () => spawnSync(process.execPath, [join(directory, gate)], { cwd: tmpdir(), encoding: 'utf8' });
    return run({ directory, write, git, execute });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('tracked canonical/generic fixtures pass and untracked scratch is outside the repository contract', () => fixture(({ directory, write, execute }) => {
  write('docs/spec.md', 'https://folhea.app and https://foreign.example/problema');
  writeFileSync(join(directory, 'untracked.txt'), retired[0]);
  const result = execute();
  assert.equal(result.status, 0, result.stderr);
}));

test('retired hosts in tracked docs, specs, fixtures and escaped literals fail without echoing their contents', () => {
  for (const host of retired) for (const [name, text] of [
    ['docs/specs/example.md', `historical host ${host}`],
    ['tests/fixture.ts', `new RegExp('${host.replaceAll('.', '\\.')}')`]
  ]) fixture(({ write, execute }) => {
    write(name, 'allowed\n' + text + '\n');
    const result = execute();
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(JSON.stringify(name) + ':2'), result.stderr);
    assert.ok(!result.stderr.includes(host), 'the gate reports locations only');
  });
});

test('tracked symlinks fail closed without reading their external target', () => fixture(({ directory, git, execute }) => {
  symlinkSync('/definitely/not/a/repository/file', join(directory, 'external'));
  git('add', '--', 'external');
  const result = execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /symlink/);
}));

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const generator = join(root, 'scripts/ci/generate-public-contract.mjs');
const java = 'backend/src/main/java/com/folhea/shared/ProblemTypes.java';
const typescript = 'frontend/src/app/core/api/problem-types.generated.ts';
const catalog = { publicOrigin: 'https://folhea.app', problemTypes: {
  RECENT_AUTHENTICATION_REQUIRED: '/problems/recent-authentication-required',
  CSRF_INVALID: '/problems/csrf-invalid', ACCOUNT_DELETION_PENDING: '/problems/account-deletion-pending'
} };

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'folhea-public-contract-'));
  try {
    mkdirSync(join(directory, 'scripts/ci'), { recursive: true });
    mkdirSync(join(directory, 'shared'));
    writeFileSync(join(directory, 'shared/public-contract.json'), JSON.stringify(catalog));
    if (existsSync(generator)) copyFileSync(generator, join(directory, 'scripts/ci/generate-public-contract.mjs'));
    return run(directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
function generate(directory, ...args) {
  return spawnSync(process.execPath, [join(directory, 'scripts/ci/generate-public-contract.mjs'), ...args], { encoding: 'utf8' });
}

test('generated TS consumer and Java declarations use the same relative IDs from the catalog', () => fixture(directory => {
  const result = generate(directory);
  assert.equal(result.status, 0, result.stderr);
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { PROBLEM_TYPES, PUBLIC_SITE_ORIGIN } from ${JSON.stringify(pathToFileURL(join(directory, typescript)).href)}; console.log(JSON.stringify({PROBLEM_TYPES,PUBLIC_SITE_ORIGIN}));`], { encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  const actual = JSON.parse(imported.stdout);
  assert.deepEqual(actual.PROBLEM_TYPES, catalog.problemTypes);
  assert.equal(actual.PUBLIC_SITE_ORIGIN, catalog.publicOrigin);
  const declarations = Object.fromEntries([...readFileSync(join(directory, java), 'utf8').matchAll(/public static final String ([A-Z_]+) = "([^"]+)";/g)].map(match => [match[1], match[2]]));
  assert.deepEqual(declarations, catalog.problemTypes);
}));

test('generation is deterministic and check never rewrites stale or absent outputs', () => fixture(directory => {
  assert.equal(generate(directory, '--check').status, 1);
  assert.equal(existsSync(join(directory, java)), false);
  assert.equal(generate(directory).status, 0);
  const first = [java, typescript].map(name => readFileSync(join(directory, name), 'utf8'));
  writeFileSync(join(directory, 'shared/public-contract.json'), JSON.stringify({ ...catalog, problemTypes: Object.fromEntries(Object.entries(catalog.problemTypes).reverse()) }, null, 2));
  assert.equal(generate(directory).status, 0);
  assert.deepEqual([java, typescript].map(name => readFileSync(join(directory, name), 'utf8')), first);
  assert.equal(generate(directory, '--check').status, 0);
  writeFileSync(join(directory, typescript), 'export const PROBLEM_TYPES = {};\n');
  assert.equal(generate(directory, '--check').status, 1);
  assert.equal(readFileSync(join(directory, typescript), 'utf8'), 'export const PROBLEM_TYPES = {};\n');
  assert.equal(generate(directory).status, 0);
  assert.equal(generate(directory, '--check').status, 0);
}));

test('invalid origins and absolute, foreign, malformed or ambiguous problem IDs fail before any output', () => fixture(directory => {
  const invalid = [
    { ...catalog, publicOrigin: 'http://folhea.app' },
    { ...catalog, publicOrigin: 'https://folhea.app/path' },
    { ...catalog, publicOrigin: 'https://folhea.app#fragment' },
    { ...catalog, problemTypes: { BAD: 'https://foreign.example/problems/bad' } },
    { ...catalog, problemTypes: { BAD: '//foreign.example/problems/bad' } },
    { ...catalog, problemTypes: { BAD: '/problems/../bad' } },
    { ...catalog, problemTypes: { WRONG_NAME: '/problems/different-name' } },
    { ...catalog, problemTypes: { 'unsafe-key': '/problems/unsafe-key' } },
    { ...catalog, problemTypes: {} },
    { ...catalog, problemTypes: [] }
  ];
  for (const input of invalid) {
    writeFileSync(join(directory, 'shared/public-contract.json'), JSON.stringify(input));
    const result = generate(directory);
    assert.equal(result.status, 1, JSON.stringify(input));
    assert.match(result.stderr, /Invalid public contract/);
    assert.equal(existsSync(join(directory, java)), false);
    assert.equal(existsSync(join(directory, typescript)), false);
  }
}));

test('unknown CLI flags fail without generating files', () => fixture(directory => {
  const result = generate(directory, '--ignore');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
  assert.equal(existsSync(join(directory, java)), false);
}));

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the CLI against actual source, then change one contract in a
// private fixture. No provider, runtime response, password or database is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const files = [
  'frontend/src/app/core/api/api-client.service.ts',
  'frontend/src/app/core/api/csrf.service.ts',
  'frontend/src/app/core/api/csrf.interceptor.ts',
  'frontend/src/app/core/auth/auth.service.ts',
  'frontend/src/app/features/auth/login.component.ts',
  'frontend/src/app/features/auth/registration.component.ts',
  'frontend/src/app/features/settings/settings.component.ts',
  'backend/src/main/java/com/folhea/user/UserResource.java',
  'backend/src/main/java/com/folhea/user/RegistrationResource.java',
  'backend/src/main/java/com/folhea/analytics/AnalyticsResource.java',
  'backend/src/main/java/com/folhea/book/BookResource.java',
  'backend/src/main/java/com/folhea/reading/ReadingSessionResource.java',
  'backend/src/main/java/com/folhea/statistics/StatisticsResource.java',
  'backend/src/main/java/com/folhea/auth/BffAuthResource.java',
  'backend/src/main/java/com/folhea/security/CsrfResource.java',
  'backend/src/main/java/com/folhea/security/CsrfCookiePolicy.java',
  'backend/src/main/java/com/folhea/security/SecurityBoundaryFilter.java'
];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'folhea-auth-contract-'));
fs.chmodSync(temp, 0o700);
let next = 0;
function fixture() {
  const dir = path.join(temp, String(next++));
  for (const file of files) {
    const source = path.join(root, file);
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(source)) fs.symlinkSync(source, target);
  }
  const script = path.join(dir, 'scripts/ci/validate-api-contract.mjs');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/ci/validate-api-contract.mjs'), script);
  return dir;
}
function change(dir, file, transform) {
  const target = path.join(dir, file);
  const source = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const replacement = transform(source);
  assert.notEqual(replacement, source, 'Mutation must change one real source contract');
  // Unlink our fixture symlink before writing; the real source stays read-only.
  if (fs.existsSync(target)) fs.unlinkSync(target);
  fs.writeFileSync(target, replacement, { mode: 0o600 });
}
function run(dir) {
  return spawnSync(process.execPath,
    [path.join(dir, 'scripts/ci/validate-api-contract.mjs'), path.join(dir, 'report.txt')],
    { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, OPENAPI_FILE: '', OPENAPI_URL: '' } });
}
const cases = [
  ['retired password POST', 'frontend/src/app/core/api/api-client.service.ts',
    source => source.replace(/\n}\s*$/, "\n  obsolete() { return this.http.post<void>('/api/v1/registration', {}, this.options()); }\n}\n"),
    'retired operation POST /api/v1/registration'],
  ['retired backend registration', 'backend/src/main/java/com/folhea/user/RegistrationResource.java',
    () => 'package com.folhea.user; import jakarta.ws.rs.*; @Path("/api/v1") public class RegistrationResource { @POST @Path("/registration") public void register() {} }',
    'password registration POSTs'],
  ['retired analytics', 'backend/src/main/java/com/folhea/analytics/AnalyticsResource.java',
    () => 'package com.folhea.analytics; import jakarta.ws.rs.*; @Path("/api/v1/analytics/events") public class AnalyticsResource { @POST public void event() {} }',
    'retired analytics events'],
  ['missing register GET', 'backend/src/main/java/com/folhea/auth/BffAuthResource.java',
    source => source.replace('@Path("/register")', '@Path("/obsolete")'),
    'missing GET /auth/register'],
  ['Angular password field', 'frontend/src/app/features/auth/registration.component.ts',
    source => source.replace('<a href="/auth/register"', '<input type="password"><a href="/auth/register"'),
    'Angular auth form still collects a password'],
  ['HttpOnly CSRF cookie', 'backend/src/main/java/com/folhea/security/CsrfCookiePolicy.java',
    source => source.replace('.httpOnly(false)', '.httpOnly(true)'),
    '.httpOnly(false)'],
  ['mismatched CSRF cookie name', 'frontend/src/app/core/api/csrf.service.ts',
    source => source.replaceAll('__Host-folhea_csrf=', '__Host-different_csrf='),
    'matching CSRF cookie'],
  ['missing server CSRF binding', 'backend/src/main/java/com/folhea/security/SecurityBoundaryFilter.java',
    source => source.replace('csrfTokens.isValid(ticket, token)', 'true'),
    'cookie/header equality and server binding']
];
try {
  const baseline = run(fixture());
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  console.log('ok - actual AUTH source passes the static API/browser/CSRF contract');
  for (const [label, file, transform, error] of cases) {
    const dir = fixture();
    change(dir, file, transform);
    const result = run(dir);
    assert.equal(result.status, 1, label + ': validator must reject the mutated contract');
    assert.ok(result.stdout.includes(error), label + ': expected rejection category');
    console.log('ok - rejects ' + label);
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

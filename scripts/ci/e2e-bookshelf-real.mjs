#!/usr/bin/env node
// Opt-in fresh-stack acceptance: Keycloak, BFF, API, Canvas and storage are real.
// No HTTP/provider responses, session cookies or authentication are fabricated.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { coverFixturePng } from './tests/cover-fixture.mjs';

export function assertBookProgress(book, pages, percent, average) {
  assert.equal(book.pagesRead, pages, 'Official top-level pagesRead');
  assert.equal(book.progressPercent, percent, 'Official floor/capped progressPercent');
  assert.equal(book.averagePagesPerReadingDay, average, 'Official average per page-reading date');
}
export function assertIsolatedOrigin(origin) {
  assert.equal(origin, 'https://127.0.0.3:9446', 'Use only the dedicated fresh FIX-02 stage');
}

async function runAcceptance() {
  const origin = process.env.E2E_REAL_URL ?? 'https://127.0.0.3:9446';
  assertIsolatedOrigin(origin);
  assert.equal(process.argv[2] ?? 'accept', 'accept', 'V7/V8 bootstrap modes are retired; use the current fresh stack');
  const privateFile = process.env.E2E_REAL_CREDENTIAL_FILE;
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  assert.ok(privateFile?.startsWith('/') && !resolve(privateFile).startsWith(repo), 'Use an absolute private fixture file outside Git');
  mkdirSync(dirname(privateFile), { recursive: true, mode: 0o700 });
  assert.equal(statSync(dirname(privateFile)).mode & 0o077, 0, 'Fixture directory must be private');
  if (existsSync(privateFile)) assert.equal(statSync(privateFile).mode & 0o077, 0, 'Fixture file must be private');
  const records = existsSync(privateFile) ? JSON.parse(readFileSync(privateFile, 'utf8')) : { origin, fixture: 'bookshelf-fix02', accounts: {} };
  assert.ok(records.origin === origin && records.fixture === 'bookshelf-fix02', 'Never consume user credentials or fixtures from another stage');
  const save = () => writeFileSync(privateFile, JSON.stringify(records), { mode: 0o600 });
  const pass = label => console.log(`PASS ${label}`);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
  const { chromium, expect } = require('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const contexts = [], failures = [];
  let step = 'Keycloak registration', lastMutation = 0;
  const pace = async () => { await delay(Math.max(0, lastMutation + 3500 - Date.now())); lastMutation = Date.now(); };
  async function account(key) {
    let stored = records.accounts[key];
    if (!stored) {
      stored = records.accounts[key] = { email: `fix02-${randomBytes(8).toString('hex')}@example.com`, password: randomBytes(24).toString('base64url'), bookIds: [] };
      save();
    }
    assert.ok(!stored.deleted, 'A completed fixture cannot be reused; provide a new private fixture-file path');
    const context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', () => failures.push('uncaught browser exception'));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('401')) failures.push('unexpected browser console error'); });
    if (!stored.registered) {
      await page.goto('/auth/register');
      assert.ok(new URL(page.url()).pathname.startsWith('/realms/folhea/'), 'Registration form belongs to the real IdP');
      await page.locator('#email').fill(stored.email);
      await page.locator('#password').fill(stored.password);
      await page.locator('#password-confirm').fill(stored.password);
      const registration = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/realms/folhea/login-actions/registration'));
      await page.locator('#kc-register').click();
      assert.ok((await registration).status() < 400, 'Only Keycloak receives the signup POST');
      await page.waitForURL('**/app/inicio', { timeout: 45000 });
      stored.registered = true; save();
    } else {
      await page.goto('/auth/login');
      await page.locator('#username').fill(stored.email);
      await page.locator('#password').fill(stored.password);
      await page.locator('#kc-login').click();
      await page.waitForURL('**/app/inicio', { timeout: 45000 });
    }
    const me = await context.request.get('/api/v1/me', { maxRedirects: 0 });
    assert.equal(me.status(), 200, 'Real authenticated BFF identity');
    const user = await me.json();
    stored.timezone = user.timezone; save();
    const csrf = await context.request.get('/api/v1/csrf', { maxRedirects: 0 });
    assert.equal(csrf.status(), 200);
    const token = (await csrf.json()).token;
    const cookies = await context.cookies();
    const session = cookies.find(c => c.name.startsWith('q_session'));
    const binding = cookies.find(c => c.name === '__Host-folhea_session');
    const csrfCookie = cookies.find(c => c.name === '__Host-folhea_csrf');
    assert.ok(session?.secure && session.httpOnly && binding?.secure && binding.httpOnly, 'Session and binding remain HttpOnly/Secure');
    assert.ok(csrfCookie?.secure && !csrfCookie.httpOnly && csrfCookie.sameSite === 'Lax' && csrfCookie.path === '/', 'AUTH CSRF cookie is readable/Secure/Lax/root');
    assert.ok(csrfCookie.value === token, 'Cookie and CSRF header token agree');
    return { page, context, token, stored };
  }
  async function api(a, method, path, data, status = 200, token = a.token, extra = {}) {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!['GET', 'HEAD'].includes(method)) await pace();
      response = await a.context.request.fetch(path, { method, maxRedirects: 0, headers: { Origin: origin, ...(token ? { 'X-CSRF-Token': token } : {}) }, ...(data === undefined ? {} : { data }), ...extra });
      if (response.status() !== 429) break;
      const seconds = Number(response.headers()['retry-after']);
      assert.ok(Number.isFinite(seconds) && seconds >= 0 && seconds <= 60, 'Bounded production rate-limit retry');
      await delay(seconds * 1000 + 150);
    }
    assert.equal(response.status(), status, `${method} ${path.replace(/[a-f\d-]{36}/g, '{id}')}`);
    return response;
  }
  async function metrics(a, id, pages, percent, average) {
    const book = await (await api(a, 'GET', `/api/v1/books/${id}`)).json();
    assertBookProgress(book, pages, percent, average);
    return book;
  }
  function date(a, offset) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: a.stored.timezone }).format(new Date());
    const day = new Date(`${today}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  }
  async function readingUi(a, id, pages, offset) {
    await a.page.goto(`/app/ler?bookId=${id}`);
    await expect(a.page.getByLabel('Livro', { exact: true })).toHaveValue(id);
    await a.page.getByLabel('Páginas', { exact: true }).fill(String(pages));
    await a.page.getByLabel('Data', { exact: false }).fill(date(a, offset));
    await pace();
    const created = a.page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/sessions');
    await a.page.getByRole('button', { name: /^registrar leitura/i }).click();
    assert.equal((await created).status(), 201);
    await expect(a.page.getByRole('heading', { name: /leitura registrada/i })).toBeVisible();
    const sessions = await (await api(a, 'GET', '/api/v1/sessions')).json();
    return sessions.find(s => s.bookId === id && s.pages === pages && s.readingDate === date(a, offset)).id;
  }
  async function deleteFixture(key) {
    const stored = records.accounts[key];
    if (!stored?.registered || stored.deleted) return;
    // New real login gives recent auth_time; never bypass the deletion guard.
    const fresh = await account(key);
    for (const id of stored.bookIds) {
      const current = await fresh.context.request.get(`/api/v1/books/${id}`, { maxRedirects: 0 });
      if (current.status() === 200) await api(fresh, 'DELETE', `/api/v1/books/${id}`, undefined, 204);
      else assert.equal(current.status(), 404);
      await api(fresh, 'GET', `/api/v1/books/${id}/photo`, undefined, 404);
    }
    await api(fresh, 'DELETE', '/api/v1/me', { confirm: true }, 204);
    assert.equal((await fresh.context.request.get('/api/v1/me', { maxRedirects: 0 })).status(), 401);
    stored.deleted = true; save();
  }
  let success = false;
  try {
    const a = await account('primary'), b = await account('secondary');
    pass('Keycloak signup/login and readable CSRF cookie with real BFF sessions');
    step = 'Book and photo UI';
    const page = a.page, title = 'Estante FIX-02 de aceite';
    await page.goto('/app/livros/novo');
    await page.getByRole('textbox', { name: 'Título', exact: true }).fill(title);
    await page.locator('#book-total-pages').fill('300');
    const noise = coverFixturePng(); assert.ok(noise.length > 65536 && noise.length <= 1000000);
    await page.locator('#book-cover-file').setInputFiles({ name: 'capa.png', mimeType: 'image/png', buffer: noise });
    await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible();
    await pace();
    const created = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/books');
    const uploaded = page.waitForResponse(r => r.request().method() === 'PUT' && /\/api\/v1\/books\/[^/]+\/photo$/.test(new URL(r.url()).pathname));
    await page.getByRole('button', { name: /adicionar livro/i }).click();
    assert.equal((await created).status(), 201); assert.equal((await uploaded).status(), 200);
    await page.waitForURL('**/app/livros');
    const books = await (await api(a, 'GET', '/api/v1/books')).json();
    const book = books.find(item => item.title === title); assert.ok(book?.hasPhoto);
    const id = book.id; a.stored.bookIds.push(id); save();
    const row = page.locator('.book-row').filter({ hasText: title });
    await expect(row.getByAltText(`Capa de ${title}`)).toBeVisible();
    await metrics(a, id, 0, 0, null);
    await expect(row.getByText(/Sem leituras com páginas/)).toBeVisible();
    await api(a, 'POST', '/api/v1/sessions', { bookId: id, readingDate: date(a, 0), minutes: 7 }, 201);
    await metrics(a, id, 0, 0, null);
    pass('Fresh book and minutes-only session have null reading-day average');
    step = 'Official reading-day progress';
    const firstId = await readingUi(a, id, 30, -2);
    const secondId = await readingUi(a, id, 45, -1);
    await metrics(a, id, 75, 25, 37.5);
    await page.goto('/app/livros');
    await expect(row.locator('.daily-average')).toContainText('37,5 páginas por dia de leitura');
    await expect(row.locator('.percent')).toHaveText('25%');
    const repeated = await (await api(a, 'POST', '/api/v1/sessions', { bookId: id, readingDate: date(a, -2), pages: 25 }, 201)).json();
    await metrics(a, id, 100, 33, 50);
    await api(a, 'DELETE', `/api/v1/sessions/${repeated.id}`, undefined, 204);
    await metrics(a, id, 75, 25, 37.5);
    await api(a, 'PATCH', `/api/v1/sessions/${secondId}`, { pages: 60 });
    await metrics(a, id, 90, 30, 45);
    await api(a, 'DELETE', `/api/v1/sessions/${firstId}`, undefined, 204);
    await metrics(a, id, 60, 20, 60);
    await api(a, 'PATCH', `/api/v1/books/${id}`, { totalPages: 61 });
    await metrics(a, id, 60, 98, 60);
    await api(a, 'PATCH', `/api/v1/books/${id}`, { totalPages: 59 });
    const capped = await metrics(a, id, 60, 100, 60);
    assert.equal(capped.status, 'READING'); assert.equal(capped.finishedOn, null);
    pass('75/2=37.5; distinct page-reading dates, edit/delete, floor/cap and no auto-finish');
    step = 'Private image and export';
    await api(b, 'GET', `/api/v1/books/${id}/photo`, undefined, 404);
    await api(b, 'DELETE', `/api/v1/books/${id}/photo`, undefined, 404);
    await api(a, 'DELETE', `/api/v1/books/${id}/photo`, undefined, 403, null);
    const image = await api(a, 'GET', `/api/v1/books/${id}/photo`);
    assert.equal(image.headers()['content-type'].split(';')[0], 'image/jpeg');
    assert.equal(image.headers()['cache-control'], 'private, no-cache, max-age=0, must-revalidate');
    const bytes = await image.body(); assert.ok(bytes.length > 65536 && bytes.length <= 1000000);
    const fresh = await account('primary');
    assert.equal(sha(await (await api(fresh, 'GET', `/api/v1/books/${id}/photo`)).body()), sha(bytes));
    const exported = await (await api(a, 'GET', '/api/v1/me/export')).body();
    const data = JSON.parse(exported), photo = data.photos.find(item => item.bookId === id);
    assert.ok(photo); assert.equal(sha(Buffer.from(photo.dataBase64, 'base64')), sha(bytes));
    const persisted = data.books.find(item => item.id === id);
    for (const field of ['stats', 'pagesRead', 'averagePagesPerReadingDay', 'progressPercent']) assert.equal(persisted[field], undefined, 'Export only persisted metadata');
    assert.equal(sha(await (await api(a, 'GET', '/api/v1/me/export')).body()), sha(exported));
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 }); await page.goto(`/app/livros/${id}`);
      await expect(page.getByAltText(`Capa de ${title}`)).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 30000 });
    assert.equal(await page.evaluate(async () => { for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) if (new URL(request.url).pathname.startsWith('/api/')) return true; return false; }), false);
    assert.equal(failures.length, 0, 'No unexpected page/console exceptions');
    pass('Private photo: owner404/CSRF403, new login, GET/export SHA, stable export, layout and no API service-worker cache');
    success = true;
  } catch (error) {
    // Never print provider URLs, API bodies, credentials, identifiers or traces.
    console.error(JSON.stringify({ failure: error.name, step, ...(typeof error.actual === 'number' ? { actual: error.actual } : {}), ...(typeof error.expected === 'number' ? { expected: error.expected } : {}) }));
    process.exitCode = 1;
  } finally {
    try { step = 'Own fixture cleanup'; await deleteFixture('secondary'); await deleteFixture('primary'); pass('Own books/photos/accounts cleaned; deleted sessions return401'); }
    catch (error) { console.error(JSON.stringify({ failure: error.name, step: 'Own fixture cleanup' })); process.exitCode = 1; }
    await Promise.all(contexts.map(context => context.close())); await browser.close();
  }
  if (success && !process.exitCode) pass('e2e-bookshelf-real.mjs completed with real Keycloak/BFF/storage');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runAcceptance().catch(error => { console.error(JSON.stringify({ failure: error.name, step: 'Acceptance setup' })); process.exitCode = 1; });
}

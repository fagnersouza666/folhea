#!/usr/bin/env node
// Real acceptance journey: no route interception, identity fixtures or mock DB.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'frontend/package.json'));
const { chromium, expect } = require('@playwright/test');
const origin = process.env.E2E_REAL_URL ?? 'https://localhost:9443';
const evidence = [];
const record = (text) => { evidence.push(text); console.log(`PASS ${text}`); };
const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
const accounts = [];
const sensitiveValues = [];
const authTrace = [];
let failed = false;
const checkStatus = (response, expected, action) => assert.equal(response.status(), expected, action);

async function newAccount(label) {
  const context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const email = `aceite-${label}-${randomBytes(6).toString('hex')}@example.com`;
  const password = randomBytes(24).toString('base64url');
  sensitiveValues.push(email, password);
  const page = await context.newPage();
  page.on('response', response => {
    if (!response.request().isNavigationRequest() || authTrace.length >= 30) return;
    const location = response.headers()['location'];
    authTrace.push({ path: new URL(response.url()).pathname, status: response.status(),
      location: location ? new URL(location, response.url()).pathname : null });
  });
  page.on('requestfailed', request => {
    if (request.isNavigationRequest() && authTrace.length < 30) {
      authTrace.push({ path: new URL(request.url()).pathname, failure: request.failure()?.errorText });
    }
  });
  let response;
  if (label === 'a') {
    await page.goto('/cadastro');
    await page.locator('#registration-email').fill(email);
    await page.locator('#registration-password').fill(password);
    [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/registration' && r.request().method() === 'POST'),
      page.getByRole('button', { name: /criar conta/i }).click()
    ]);
  } else {
    response = await context.request.post('/api/v1/registration', {
      headers: { Origin: origin }, data: { email, password }
    });
  }
  checkStatus(response, 201, 'New registration must provision Keycloak and the local user');
  // A page response forwarded by the production SW does not always expose its
  // body through Chromium's Network.getResponseBody. Assert the real UI 201,
  // then bind that unique email to the authenticated /me after browser login.
  // The independent REST registration also verifies the returned user ID.
  const created = label === 'a' ? null : await response.json();
  if (label === 'a') {
    await page.getByRole('link', { name: /continuar para entrar/i }).click();
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  } else {
    await page.goto('/auth/login');
  }
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  await page.waitForURL('**/app/inicio', { timeout: 30000 });
  const authenticatedRedirect = await context.request.get('/auth/login', { maxRedirects: 0, headers: { 'X-Forwarded-Host': 'other.invalid', 'X-Forwarded-Proto': 'http' } });
  checkStatus(authenticatedRedirect, 303, 'Authenticated BFF handoff');
  const destination = new URL(authenticatedRedirect.headers()['location'], origin);
  assert.equal(destination.origin, origin, 'Trusted edge must preserve the HTTPS origin in BFF redirects');
  assert.equal(destination.pathname, '/app/inicio');
  const meResponse = await context.request.get('/api/v1/me');
  checkStatus(meResponse, 200, 'BFF session after real browser login');
  const me = await meResponse.json();
  assert.equal(me.email, email, 'OIDC subject must bind the newly registered email');
  assert.ok(me.id);
  if (created) assert.equal(me.id, created.id, 'OIDC subject must bind the registered account');
  const csrfResponse = await context.request.get('/api/v1/csrf');
  checkStatus(csrfResponse, 200, 'Real synchronizer token');
  const { token } = await csrfResponse.json();
  assert.ok(token);
  const account = { context, page, token, created: created ?? me, email, password };
  accounts.push(account);
  return account;
}
async function call(account, method, path, data, expected = 200, csrf = account.token) {
  const options = {
    method, maxRedirects: 0, headers: { Origin: origin, 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    ...(data === undefined ? {} : { data })
  };
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await account.context.request.fetch(path, options);
    if (response.status() !== 429) break;
    // Exercise the real production limits instead of disabling them for acceptance.
    const seconds = Number(response.headers()['retry-after']);
    assert.ok(Number.isFinite(seconds) && seconds >= 0 && seconds <= 60, 'Bounded rate limit retry');
    await new Promise(resolve => setTimeout(resolve, seconds * 1000 + 150));
  }
  checkStatus(response, expected, `${method} ${path.replace(/[a-f0-9-]{36}/g, '{id}')}`);
  return response;
}
async function stats(account, pages, minutes, booksFinished) {
  const response = await call(account, 'GET', '/api/v1/stats');
  const value = await response.json();
  assert.equal(value.pages, pages); assert.equal(value.minutes, minutes);
  if (booksFinished !== undefined) assert.equal(value.booksFinished, booksFinished);
  return value;
}
try {
  const first = await newAccount('a');
  const second = await newAccount('b');
  record('Cadastro pela UI e REST provisionam duas contas no Keycloak, com login BFF real pelo navegador');
  const credentialFile = process.env.E2E_REAL_CREDENTIAL_FILE;
  if (credentialFile) {
    // Optional local operator-owned secret, never included in reports or console output.
    mkdirSync(dirname(credentialFile), { recursive: true, mode: 0o700 });
    writeFileSync(credentialFile, JSON.stringify({ email: first.email, password: first.password, id: first.created.id }), { mode: 0o600, flag: 'wx' });
  }
  const cookies = await first.context.cookies(origin);
  const sessionCookies = cookies.filter(c => c.name.startsWith('q_session') || c.name.includes('folhea'));
  assert.ok(sessionCookies.some(c => c.name.startsWith('q_session')));
  assert.ok(sessionCookies.length >= 2);
  assert.ok(sessionCookies.every(c => c.httpOnly && c.secure && ['Lax', 'Strict'].includes(c.sameSite)));
  const visibleCookies = await first.page.evaluate(() => document.cookie);
  assert.ok(sessionCookies.every(c => !visibleCookies.includes(c.name + '=')));
  record('Cookies de sessão e CSRF Secure, HttpOnly e SameSite; inacessíveis por document.cookie');

  await call(first, 'POST', '/api/v1/books', { title: 'Sem CSRF' }, 403, null);
  await call(first, 'POST', '/api/v1/books', { title: 'CSRF inválido' }, 403, 'invalid-token');
  await call(first, 'POST', '/api/v1/books', { title: 'Token de outra conta' }, 403, second.token);
  const foreignOrigin = await first.context.request.post('/api/v1/books', { headers: { Origin: 'https://other.invalid', 'X-CSRF-Token': first.token }, data: { title: 'Origem alheia' } });
  checkStatus(foreignOrigin, 403, 'Foreign origin even with a valid CSRF token');
  checkStatus(await first.context.request.get('/api/v1/me', { headers: { 'X-Forwarded-Host': 'other.invalid', 'X-Forwarded-Proto': 'http' } }), 200, 'Edge strips forged forwarding headers');
  record('CSRF ausente, inválido, de outra conta e origem alheia rejeitados; forwarding forjado removido');
  await call(first, 'POST', '/api/v1/analytics/events', {event:'stats_viewed',properties:{screen:'progress'}}, 202);
  await call(first, 'POST', '/api/v1/analytics/events', {event:'stats_viewed',properties:{title:'Conteúdo privado rejeitado'}}, 400);
  record('Coletor analytics real aceita evento seguro e rejeita conteúdo privado');
  const book = await (await call(first, 'POST', '/api/v1/books', { title: 'Leitura de aceite real', author: 'Folhea' }, 201)).json();
  for (const [method, suffix, data] of [
    ['GET', '', undefined], ['PATCH', '', { title: 'Tentativa alheia' }],
    ['DELETE', '', undefined], ['POST', '/finish', { finishedOn: '2026-10-10' }]
  ]) await call(second, method, `/api/v1/books/${book.id}${suffix}`, data, 404);
  await call(first, 'PATCH', '/api/v1/me', { timezone: 'America/Sao_Paulo' });
  record('GET/PATCH/DELETE/finalização de livro alheio respondem 404');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const session = await (await call(first, 'POST', '/api/v1/sessions', { bookId: book.id, readingDate: today, pages: 32, minutes: 25 }, 201)).json();
  await call(first, 'POST', '/api/v1/sessions', { bookId: book.id, readingDate: today, pages: 0, minutes: 0 }, 400);
  await call(first, 'GET', `/api/v1/sessions/${session.id}`);
  await call(second, 'GET', `/api/v1/sessions/${session.id}`, undefined, 404);
  await call(second, 'PATCH', `/api/v1/sessions/${session.id}`, { pages: 100 }, 404);
  await call(second, 'DELETE', `/api/v1/sessions/${session.id}`, undefined, 404);
  const initialStats = await stats(first, 32, 25, 0);
  assert.equal(initialStats.currentStreakDays, 1);
  await call(first, 'PATCH', `/api/v1/sessions/${session.id}`, { pages: 40, minutes: 30 });
  await stats(first, 40, 30, 0);
  await call(first, 'DELETE', `/api/v1/sessions/${session.id}`, undefined, 204);
  const emptyStats = await stats(first, 0, 0, 0);
  assert.equal(emptyStats.currentStreakDays, 0);
  record('Registro, validação zero, edição e exclusão recalculam páginas/minutos/streak reais');
  await call(first, 'POST', '/api/v1/sessions', { bookId: book.id, readingDate: today, minutes: 18 }, 201);
  await call(first, 'POST', '/api/v1/sessions', { bookId: book.id, readingDate: today, pages: 12 }, 201);
  await stats(first, 12, 18, 0);
  const shiftedDate = (days) => { const date = new Date(today + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
  await call(first, 'POST', '/api/v1/sessions', { bookId: book.id, readingDate: shiftedDate(1), pages: 1 }, 400);
  const historic = [];
  for (const [days, pages, minutes] of [[-1, 1, 1], [-2, 2, 2], [-8, 8, 0], [-30, 30, 0], [-400, 4, 0]]) {
    historic.push(await (await call(first, 'POST', '/api/v1/sessions', { bookId: book.id, readingDate: shiftedDate(days), pages, minutes }, 201)).json());
  }
  for (const [period, pages, minutes] of [['today', 12, 18], ['7', 15, 21], ['30', 23, 21], ['all', 57, 21]]) {
    const selected = await (await call(first, 'GET', '/api/v1/stats?period=' + period)).json();
    assert.equal(selected.pages, pages); assert.equal(selected.minutes, minutes); assert.equal(selected.currentStreakDays, 3);
  }
  const todayHistory = await (await call(first, 'GET', `/api/v1/sessions?from=${today}&to=${today}&limit=1&offset=0`)).json();
  const nextHistory = await (await call(first, 'GET', `/api/v1/sessions?from=${today}&to=${today}&limit=1&offset=1`)).json();
  assert.equal(todayHistory.length, 1); assert.equal(nextHistory.length, 1); assert.notEqual(todayHistory[0].id, nextHistory[0].id);
  const oldest = historic.at(-1);
  const allHistory = await (await call(first, 'GET', '/api/v1/sessions?limit=100&offset=0')).json();
  assert.ok(allHistory.some(item => item.id === oldest.id), 'Unfiltered history includes sessions older than 366 days');
  await call(second, 'GET', `/api/v1/sessions/${oldest.id}`, undefined, 404);
  await first.page.goto('/app/progresso');
  await first.page.getByRole('button', { name: 'Tudo', exact: true }).click();
  await expect(first.page.locator(`a[href="/app/sessoes/${oldest.id}/editar"]`)).toBeVisible();
  await first.page.locator(`a[href="/app/sessoes/${oldest.id}/editar"]`).click();
  await expect(first.page.getByLabel('Data', { exact: true })).toHaveValue(shiftedDate(-400));
  await first.page.reload();
  await expect(first.page.getByLabel('Data', { exact: true })).toHaveValue(shiftedDate(-400));
  record('Hoje/7/30/Tudo, streak global, paginação, futuro400 e histórico de 400 dias via UI/ID/reload com ownership404');
  for (const previous of historic) await call(first, 'DELETE', `/api/v1/sessions/${previous.id}`, undefined, 204);
  await stats(first, 12, 18, 0);
  await call(first, 'POST', `/api/v1/books/${book.id}/finish`, { finishedOn: today });
  await call(first, 'POST', `/api/v1/books/${book.id}/finish`, { finishedOn: today });
  await stats(first, 12, 18, 1);
  await call(first, 'DELETE', `/api/v1/books/${book.id}/finish`, undefined);
  await stats(first, 12, 18, 0);
  record('Páginas/minutos separados, finalização idempotente e reabertura reais');
  const exported = await (await call(first, 'GET', '/api/v1/me/export')).json();
  assert.equal(exported.user.id, first.created.id);
  assert.equal(exported.books.length, 1); assert.equal(exported.sessions.length, 2);
  record('Exportação contém somente usuário, livro e sessões da conta autenticada');

  // Render and download the real canvas through the app, never a backend card fixture.
  await first.page.goto('/app/cards');
  await first.page.getByRole('heading', { name: 'Seu card', exact: true }).waitFor();
  await expect(first.page.locator('.preview-metrics')).toContainText('12');
  await expect(first.page.locator('.preview-metrics')).toContainText('18min');
  assert.equal(await first.page.locator('.preview-metrics > span').count(), 4);
  await first.page.getByRole('button', { name: /salvar png|salvar imagem|baixar|download/i }).waitFor();
  const [download] = await Promise.all([
    first.page.waitForEvent('download'),
    first.page.getByRole('button', { name: /salvar png|salvar imagem|baixar|download/i }).click()
  ]);
  const stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const png = Buffer.concat(chunks);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1080); assert.equal(png.readUInt32BE(20), 1920);
  record('Card com quatro métricas reais gerado no browser e baixado como PNG 1080x1920');
  const uploads=[];
  first.page.on('request',request=>{ if (['POST','PUT','PATCH'].includes(request.method()) && /multipart|image\//i.test(request.headers()['content-type']??'')) uploads.push(request.url()); });
  await first.page.getByLabel('Foto de fundo', { exact: false }).setInputFiles(resolve(root,'frontend/public/icon-512.png'));
  await first.page.getByLabel('Enquadramento horizontal').fill('0.25');
  await first.page.getByLabel('Overlay', { exact: true }).fill('0.8');
  const [photoDownload]=await Promise.all([first.page.waitForEvent('download'),first.page.getByRole('button',{name:'Salvar PNG',exact:true}).click()]);
  assert.ok(await photoDownload.path()); assert.equal(uploads.length,0);
  record('Modelo Foto, crop e overlay geram PNG sem upload da imagem ao backend');
  if (!(await first.page.evaluate(() => typeof navigator.share === 'function' && typeof navigator.canShare === 'function'))) {
    const [sharedDownload] = await Promise.all([first.page.waitForEvent('download'), first.page.getByRole('button', { name: 'Compartilhar', exact: true }).click()]);
    assert.ok(await sharedDownload.path());
    record('Compartilhamento usa download real como fallback quando Web Share não está disponível');
  }
  mkdirSync(resolve(root,'frontend/test-results'),{recursive:true});
  await first.page.screenshot({path:resolve(root,'frontend/test-results/real-desktop.png'),fullPage:true});
  await first.page.setViewportSize({width:390,height:844});
  await first.page.screenshot({path:resolve(root,'frontend/test-results/real-mobile.png'),fullPage:true});

  // Service worker and offline behavior are exercised against the production build.
  await expect.poll(() => first.page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 45000 }).toBe(true);
  await expect.poll(() => first.page.evaluate(async () => {
    let count = 0;
    for (const key of await caches.keys()) {
      for (const request of await (await caches.open(key)).keys()) if (/\.js(?:\?|$)/.test(request.url)) count++;
    }
    return count;
  }), { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(() => first.page.evaluate(async () => {
    for (const key of await caches.keys()) {
      for (const request of await (await caches.open(key)).keys()) if (new URL(request.url).pathname === '/index.csr.html') return true;
    }
    return false;
  }), { timeout: 60000 }).toBe(true);
  const workerManifest = await (await first.context.request.get('/ngsw.json')).json();
  const prefetchedAssets = workerManifest.assetGroups.filter(group => group.installMode === 'prefetch').flatMap(group => group.urls);
  await expect.poll(() => first.page.evaluate(async (required) => {
    const cached = new Set();
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) cached.add(new URL(request.url).pathname);
    return required.every(url => cached.has(new URL(url, location.origin).pathname));
  }, prefetchedAssets), { timeout: 60000 }).toBe(true);
  const cachedUrls = await first.page.evaluate(async () => {
    const urls = []; for (const key of await caches.keys()) { for (const request of await (await caches.open(key)).keys()) urls.push(request.url); } return urls;
  });
  assert.ok(cachedUrls.some(url => /\.js(?:\?|$)/.test(url)));
  assert.ok(!cachedUrls.some(url => /^\/(api|auth|realms)\//.test(new URL(url).pathname)));
  await first.page.goto(`/app/ler?bookId=${book.id}`);
  const selectedBook = first.page.getByLabel('Livro', { exact: true });
  await expect(selectedBook).toHaveValue(book.id);
  await expect(selectedBook.locator('option:checked')).toHaveText(book.title);
  await first.page.getByLabel(/^Páginas(?: opcional)?$/).fill('1');
  await first.context.setOffline(true);
  await expect(first.page.getByRole('status').filter({ hasText: 'Você está sem conexão' })).toBeVisible();
  await first.page.getByRole('button', { name: /^registrar leitura/i }).click();
  await expect(first.page.getByRole('alert').filter({ hasText: 'Não foi possível registrar a leitura.' })).toBeVisible();
  await first.page.goto('/');
  await expect(first.page.getByRole('heading', { name: 'Cada página conta.', exact: true })).toBeVisible();
  await first.context.setOffline(false);
  await stats(first, 12, 18, 0);
  record('Service worker real controla a página, mantém assets em cache sem API/IdP, abre shell offline e informa falha sem sincronização');

  const secondBook = await (await call(second, 'POST', '/api/v1/books', { title: 'Dados descartáveis da segunda conta' }, 201)).json();
  await call(second, 'POST', '/api/v1/sessions', { bookId: secondBook.id, readingDate: today, pages: 7, minutes: 9 }, 201);
  const secondExport = await (await call(second, 'GET', '/api/v1/me/export')).json();
  assert.equal(secondExport.books.length, 1); assert.equal(secondExport.sessions.length, 1);
  assert.ok(secondExport.books.every(item => item.id !== book.id));
  const previousSecondCookies = await second.context.cookies();
  await second.page.goto('/app/configuracoes');
  const [privacyDownload] = await Promise.all([
    second.page.waitForEvent('download'),
    second.page.getByRole('button', { name: 'Baixar meus dados', exact: true }).click()
  ]);
  const downloadedExport = JSON.parse(readFileSync(await privacyDownload.path(), 'utf8'));
  assert.equal(downloadedExport.user.id, second.created.id);
  assert.equal(downloadedExport.books.length, 1);
  assert.equal(downloadedExport.sessions.length, 1);
  await second.page.getByRole('button', { name: 'Excluir minha conta', exact: true }).click();
  const confirmation = second.page.getByRole('dialog', { name: 'Excluir conta permanentemente?', exact: true });
  await confirmation.getByRole('checkbox').check();
  const [deletedAccount] = await Promise.all([
    second.page.waitForResponse(response => response.request().method() === 'DELETE' && new URL(response.url()).pathname === '/api/v1/me'),
    confirmation.getByRole('button', { name: 'Excluir conta', exact: true }).click()
  ]);
  checkStatus(deletedAccount, 204, 'UI account deletion must call the real protected REST endpoint');
  await second.page.waitForURL(origin + '/', { timeout: 30000 });
  await expect(second.page.getByRole('heading', { name: 'Cada página conta.', exact: true })).toBeVisible();
  assert.ok(!(await second.context.cookies(origin)).some(cookie => cookie.name.startsWith('q_session') || cookie.name === '__Host-folhea_session'),
    'DELETE must expire the actual tenant/suffix session and CSRF binding cookies');
  const replayDeleted = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  await replayDeleted.addCookies(previousSecondCookies);
  checkStatus(await replayDeleted.request.get('/api/v1/me', { maxRedirects: 0 }), 401, 'Server rejects a replay of deleted session cookies');
  await replayDeleted.close();
  const deletedMe = await second.context.request.get('/api/v1/me');
  checkStatus(deletedMe, 401, 'Deleted account cannot reuse the BFF session');
  await second.page.goto('/auth/login');
  await second.page.locator('#username').fill(second.email);
  await second.page.locator('#password').fill(second.password);
  await second.page.locator('#kc-login').click();
  await second.page.locator('#input-error, .kc-feedback-text, .alert-error').first().waitFor({ timeout: 15000 });
  assert.ok(!new URL(second.page.url()).pathname.startsWith('/app'));
  checkStatus(await second.context.request.get('/api/v1/me'), 401, 'Deleted account cannot log in and reprovision');
  record('Exportação e exclusão naturais pela UI usam REST real; removem identidade e dados, revogam sessão e impedem novo login/reprovisionamento');
  const previousFirstCookies = await first.context.cookies();
  const logoutResponses = [];
  const captureLogout = response => {
    if (['/auth/logout', '/auth/logged-out', '/realms/folhea/protocol/openid-connect/logout'].includes(new URL(response.url()).pathname)) {
      logoutResponses.push(response);
    }
  };
  first.context.on('response', captureLogout);
  await first.page.goto('/app/configuracoes');
  await first.page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await first.page.waitForURL(origin + '/', { timeout: 30000 });
  first.context.off('response', captureLogout);
  const initiation = logoutResponses.find(response => new URL(response.url()).pathname === '/auth/logout');
  assert.ok(initiation, 'Natural UI logout must initiate BFF RP logout');
  assert.ok([302, 303].includes(initiation.status()));
  assert.equal(new URL(initiation.headers()['location'], origin).pathname, '/realms/folhea/protocol/openid-connect/logout');
  // Production SW navigation responses hide Set-Cookie. Observe the native
  // network response on the browser context rather than fabricating a header.
  let postLogoutCookie;
  for (const response of logoutResponses.filter(response => new URL(response.url()).pathname === '/auth/logout')) {
    postLogoutCookie = (await response.headerValues('set-cookie')).find(header => header.startsWith('q_post_logout_Default_folhea='));
    if (postLogoutCookie) break;
  }
  assert.match(postLogoutCookie ?? '', /HttpOnly/i);
  assert.match(postLogoutCookie ?? '', /Secure/i);
  assert.ok(logoutResponses.some(response => new URL(response.url()).pathname === '/realms/folhea/protocol/openid-connect/logout'), 'Logout must reach the real provider');
  const completion = logoutResponses.find(response => new URL(response.url()).pathname === '/auth/logged-out');
  assert.ok(completion, 'Provider must return through the validated state completion');
  checkStatus(completion, 303, 'Successful post-logout state completion');
  assert.equal(new URL(completion.headers()['location'], origin).href, origin + '/', 'Landing must omit logout state');
  checkStatus(await first.context.request.get('/api/v1/me'), 401, 'Logged-out API request');
  assert.ok(!(await first.context.cookies(origin)).some(cookie => cookie.name.startsWith('q_session') || cookie.name === '__Host-folhea_session'),
    'Logout must expire the actual tenant/suffix session and CSRF binding cookies');
  const replayLogout = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  await replayLogout.addCookies(previousFirstCookies);
  checkStatus(await replayLogout.request.get('/api/v1/me', { maxRedirects: 0 }), 401, 'Server rejects a replay of logged-out session cookies');
  await replayLogout.close();
  await first.page.goto('/auth/login');
  await expect(first.page.locator('#username')).toBeVisible();
  checkStatus(await first.context.request.get('/api/v1/me'), 401, 'Provider session must not silently sign in after logout');
  record('Sair da conta pela UI passa pelo IdP/state HttpOnly, volta à Home sem state, revoga cookies/replay e encerra sessão IdP sem login silencioso');
} catch (error) {
  failed = true;
  console.error('FAIL auth transport=' + JSON.stringify(authTrace));
  mkdirSync(resolve(root,'frontend/test-results'),{recursive:true});
  for (const [index, context] of browser.contexts().entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      console.error('FAIL path=' + new URL(page.url()).pathname);
      await page.screenshot({path:resolve(root,'frontend/test-results',`real-failure-${index}-${pageIndex}.png`),fullPage:true,mask:[page.locator('input')]}).catch(() => {});
    }
  }
  let detail = error.message.replace(/https?:\/\/\S+\?\S+/g, '[URL com parâmetros ocultados]');
  for (const value of sensitiveValues) detail = detail.replaceAll(value, '[credencial ocultada]');
  console.error('FAIL ' + detail);
} finally {
  await browser.close();
  const report = process.env.E2E_REAL_REPORT;
  if (report) {
    mkdirSync(dirname(report), { recursive: true });
    writeFileSync(report, JSON.stringify({ status: failed ? 'failed' : 'passed', checks: evidence }, null, 2) + '\n');
  }
}
process.exitCode = failed ? 1 : 0;

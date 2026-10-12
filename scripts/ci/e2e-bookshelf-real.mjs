#!/usr/bin/env node
// Opt-in isolated-stack acceptance. Identity, API, PostgreSQL, Canvas and images
// are real; no routes/provider/domain responses are intercepted or fulfilled.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { coverFixturePng } from './tests/cover-fixture.mjs';
const require = createRequire(resolve('frontend/package.json'));
const { chromium, expect } = require('@playwright/test');
const origin = process.env.E2E_REAL_URL ?? 'https://127.0.0.1:9444';
assert.equal(origin, 'https://127.0.0.1:9444', 'This acceptance must never touch the canonical user stack');
const privateFile = process.env.E2E_REAL_CREDENTIAL_FILE;
assert.ok(privateFile?.startsWith('/'), 'Provide an absolute private credential-file path');
const mode = process.argv[2] ?? 'accept';
const records = (() => { try { return JSON.parse(readFileSync(privateFile, 'utf8')); } catch { return {}; } })();
const save = () => { mkdirSync(dirname(privateFile), { recursive: true, mode: 0o700 }); writeFileSync(privateFile, JSON.stringify(records), { mode: 0o600 }); };
const pass = (label) => console.log(`PASS ${label}`);
const sha = data => createHash('sha256').update(data).digest('hex');
const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
const contexts = [];
const failures = [];
const pg = sql => execFileSync('docker', ['exec', '-i', 'folhea-estante-postgres-1', 'psql', '-XqtA', '-v', 'ON_ERROR_STOP=1', '-U', 'folhea', '-d', 'folhea'], { input: sql, encoding: 'utf8' }).trim();
async function account(key, create = false) {
  if (create && !records[key]) { records[key] = { email: `estante-${randomBytes(8).toString('hex')}@example.com`, password: randomBytes(24).toString('base64url') }; save(); }
  const stored = records[key]; assert.ok(stored, 'Private test identity must exist');
  const context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } }); contexts.push(context);
  const page = await context.newPage();
  // Observe only sizes of the real File appended by production UI. Native
  // FormData serialization is unchanged; no response or request is mocked.
  await page.addInitScript(() => { window.__coverPayloadSizes = []; const append = FormData.prototype.append; FormData.prototype.append = function(name, value, ...rest) { if (name === 'cover' && value instanceof Blob) window.__coverPayloadSizes.push(value.size); return Reflect.apply(append, this, [name, value, ...rest]); }; });
  page.on('pageerror', () => failures.push('uncaught browser exception'));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('401')) failures.push('unexpected console error'); });
  if (create && !stored.registered) {
    await page.goto('/cadastro'); await page.locator('#registration-email').fill(stored.email); await page.locator('#registration-password').fill(stored.password);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/registration' && r.request().method() === 'POST');
    await page.getByRole('button', { name: /criar conta/i }).click(); assert.equal((await response).status(), 201); stored.registered = true; save();
    await page.getByRole('link', { name: /continuar para entrar/i }).click(); await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  } else await page.goto('/auth/login');
  await page.locator('#username').fill(stored.email); await page.locator('#password').fill(stored.password); await page.locator('#kc-login').click();
  await page.waitForURL('**/app/inicio', { timeout: 30000 });
  const me = await context.request.get('/api/v1/me', { maxRedirects: 0 }); assert.equal(me.status(), 200); stored.id = (await me.json()).id; save();
  const csrf = await context.request.get('/api/v1/csrf'); assert.equal(csrf.status(), 200);
  const token = (await csrf.json()).token;
  const cookies = (await context.cookies()).filter(c => c.name.startsWith('q_session') || c.name.includes('folhea'));
  assert.ok(cookies.some(c => c.name.startsWith('q_session'))); assert.ok(cookies.every(c => c.httpOnly && c.secure));
  return { page, context, token, stored };
}
async function api(a, method, path, data, status = 200, token = a.token) {
  let response; for (let attempt=0;attempt<3;attempt++) { response = await a.context.request.fetch(path, { method, maxRedirects: 0, headers: { Origin: origin, ...(token ? { 'X-CSRF-Token': token } : {}) }, ...(data === undefined ? {} : { data }) }); if (response.status() !== 429) break; const wait = Number(response.headers()['retry-after']); assert.ok(Number.isFinite(wait) && wait>=0 && wait<=60); await delay(wait*1000+150); }
  assert.equal(response.status(), status, `${method} ${path.replace(/[a-f\d-]{36}/g, '{id}')}`); return response;
}
async function multipart(a, method, path, metadata, bytes, status) {
  const response = await a.context.request.fetch(path, { method, maxRedirects: 0, headers: { Origin: origin, 'X-CSRF-Token': a.token }, multipart: { book: { name: 'book.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(metadata)) }, cover: { name: 'capa.png', mimeType: 'image/png', buffer: bytes } } });
  assert.equal(response.status(), status, 'Atomic multipart response'); return response;
}
async function stats(a, id, pages, percent, average, days) {
  const data = await (await api(a, 'GET', `/api/v1/books/${id}`)).json();
  assert.equal(data.stats.pagesRead, pages); assert.equal(data.stats.percent, percent); assert.equal(data.stats.averagePagesPerDay, average); if (days !== undefined) assert.equal(data.stats.elapsedDays, days); return data;
}
const today = () => new Date().toISOString().slice(0, 10);
const shifted = n => { const date = new Date(today() + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + n); return date.toISOString().slice(0, 10); };
try {
  if (mode === 'bootstrap') {
    assert.equal(pg("SELECT count(*) FROM flyway_schema_history WHERE version='007' AND success;"), '1');
    assert.equal(pg("SELECT count(*) FROM information_schema.tables WHERE table_name='book_cover';"), '0');
    const legacy = await account('legacy', true);
    const book = await (await api(legacy, 'POST', '/api/v1/books', { title: 'Legado V7 de aceite' }, 201)).json(); records.legacy.bookId = book.id; save();
    // Own fixture only: one transaction avoids hundreds of production-rate-limit requests.
    const sql = `BEGIN; INSERT INTO book(id,user_id,title,status,created_at,updated_at) SELECT gen_random_uuid(),'${legacy.stored.id}'::uuid,'Livro legado '||n,'READING',now(),now() FROM generate_series(1,110)n; INSERT INTO reading_session(id,user_id,book_id,reading_date,pages,minutes,created_at,updated_at) SELECT gen_random_uuid(),'${legacy.stored.id}'::uuid,'${book.id}'::uuid,current_date-n,1,0,now(),now() FROM generate_series(0,450)n; COMMIT;`;
    pg(sql);
    assert.equal(pg(`SELECT count(*) FROM book WHERE user_id='${legacy.stored.id}';`), '111');
    assert.equal(pg(`SELECT count(*)||'|'||sum(pages) FROM reading_session WHERE book_id='${book.id}';`), '451|451');
    records.legacy.before = pg(`SELECT md5(string_agg(row_to_json(r)::text,'' ORDER BY id)) FROM reading_session r WHERE book_id='${book.id}';`); save();
    pass('V7 real: cadastro/login BFF, 111 livros e 451 leituras/450 dias em dados próprios persistentes');
  } else if (mode === 'accept' || mode === 'covers' || mode === 'finish') {
    let a,b,page,id,noise,row;
    if (mode === 'accept') {
    assert.equal(pg("SELECT count(*) FROM flyway_schema_history WHERE version='008' AND success;"), '1');
    const legacy = await account('legacy');
    const legacyBook = await (await api(legacy, 'GET', `/api/v1/books/${legacy.stored.bookId}`)).json();
    assert.equal(legacyBook.title, 'Legado V7 de aceite'); assert.ok(legacyBook.totalPages === null || legacyBook.totalPages === 500); assert.equal(legacyBook.cover, null); assert.equal(legacyBook.stats.pagesRead, 451);
    assert.equal(pg(`SELECT md5(string_agg(row_to_json(r)::text,'' ORDER BY id)) FROM reading_session r WHERE book_id='${legacy.stored.bookId}';`), legacy.stored.before);
    assert.equal((await (await api(legacy, 'GET', '/api/v1/books?limit=100&offset=100')).json()).length, 11);
    assert.equal((await (await api(legacy, 'GET', '/api/v1/sessions?limit=100&offset=400')).json()).length, 51);
    await api(legacy, 'PATCH', `/api/v1/books/${legacy.stored.bookId}`, { totalPages: 500, edition: 'Metadados completos' });
    await stats(legacy, legacy.stored.bookId, 451, 90.2, 1, 451);
    pass('Migração V7→V8 preserva legado, metadados nullable e leituras além de100/366dias; agregado completo');
    a = await account('primary', true); b = await account('secondary', true);
    page = a.page;
    // Retry only own incomplete acceptance fixture after a helper assertion failure.
    for (const pending of await (await api(a, 'GET', '/api/v1/books')).json()) await api(a, 'DELETE', `/api/v1/books/${pending.id}`, undefined, 204);
    await page.getByRole('link', { name: 'Livros', exact: true }).click(); await page.getByRole('link', { name: /novo livro/i }).click();
    await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Estante privada de aceite'); await page.getByLabel('Autor').fill('Autora de teste'); await page.getByLabel('Edição').fill('2ª edição'); await page.getByLabel('Total de páginas').fill('3000');
    await page.locator('#book-cover-file').setInputFiles({ name: 'invalida.png', mimeType: 'image/png', buffer: Buffer.from('invalid PNG') });
    await expect(page.locator('folhea-cover-picker').getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: /adicionar livro/i }).click(); assert.equal((await (await api(a, 'GET', '/api/v1/books')).json()).length, 0);
    noise = coverFixturePng(); assert.ok(noise.length > 65536);
    await page.locator('#book-cover-file').setInputFiles({ name: 'capa.png', mimeType: 'image/png', buffer: noise }); await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible();
    // Do not fetch blob: previews: the production connect-src CSP remains strict.
    const created = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/books');
    await page.getByRole('button', { name: /adicionar livro/i }).click(); const createResponse = await created; assert.equal(createResponse.status(), 201); const createHeaders = await createResponse.request().allHeaders(); assert.ok(await page.evaluate(() => window.__coverPayloadSizes.at(-1)) > 65536, 'Actual normalized File in POST FormData exceeds64KiB'); assert.ok(createHeaders['content-type'].startsWith('multipart/form-data;'));
    await page.waitForURL('**/app/livros'); // Chromium omits file bytes/Content-Length in CDP for SW-forwarded requests; the native File size observer above measures the real UI payload.
    const books = await (await api(a, 'GET', '/api/v1/books')).json(); assert.equal(books.length, 1); id = books[0].id; a.stored.bookId = id; save();
    assert.ok(books[0].cover.byteSize > 65536); row = page.locator('.book-row').filter({ hasText: 'Estante privada de aceite' }); await expect(row.getByAltText('Capa de Estante privada de aceite')).toBeVisible();
    await row.getByRole('link', { name: 'Registrar leitura', exact: true }).click(); await expect(page.getByLabel('Livro', { exact: true })).toHaveValue(id);
    await page.getByLabel('Páginas').fill('2999'); await page.getByLabel('Data', { exact: false }).fill(shifted(-2)); await page.getByRole('button', { name: /^registrar leitura/i }).click();
    await expect(page.getByRole('heading', { name: /leitura registrada/i })).toBeVisible(); await page.getByRole('link', { name: 'Concluir', exact: true }).click(); await page.getByRole('link', { name: 'Livros', exact: true }).click();
    await expect(row.locator('.percent')).toHaveText('99,96%'); await expect(row.locator('.daily-average')).toContainText('999,67'); await stats(a, id, 2999, 99.96, 999.67, 3);
    pass('Cadastro UI com capa real >64KiB atômico→estante→leitura UI: 2999/3000=99.96%, média inclusiva 999.67/3dias');
    await page.getByRole('link', { name: 'Progresso', exact: true }).click(); await page.getByRole('link', { name: /editar leitura/i }).click(); await page.getByLabel('Páginas', { exact: true }).fill('3000'); await page.getByRole('button', { name: 'Salvar registro' }).click(); await page.getByRole('link', { name: 'Livros', exact: true }).click();
    await expect(row.locator('.percent')).toHaveText('100%'); await stats(a, id, 3000, 100, 1000, 3);
    await page.getByRole('link', { name: 'Progresso', exact: true }).click(); await page.getByRole('link', { name: /editar leitura/i }).click(); page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Excluir esta sessão' }).click(); await page.getByRole('link', { name: 'Livros', exact: true }).click(); await expect(row.locator('.percent')).toHaveText('0%'); await stats(a, id, 0, 0, 0, 0);
    // Leave meaningful, small baseline data for cover dump/restore/restart.
    await api(a, 'POST', '/api/v1/sessions', { bookId: id, readingDate: shifted(-2), pages: 12, minutes: 18 }, 201); await stats(a, id, 12, .4, 4, 3);
    await page.getByRole('link', { name: 'Abrir Estante privada de aceite' }).click(); await page.getByLabel('Data da finalização').fill(shifted(-1)); await page.getByRole('button', { name: 'Marcar como finalizado' }).click(); await expect(page.getByRole('button', { name: 'Reabrir livro' })).toBeVisible(); await stats(a, id, 12, .4, 6, 2);
    await page.getByRole('button', { name: 'Reabrir livro' }).click(); await expect(page.getByRole('button', { name: 'Marcar como finalizado' })).toBeVisible(); await stats(a, id, 12, .4, 4, 3);
    pass('Editar/excluir leitura recalcula UI/API; conclusão congela referência e reabrir retorna média corrente');
    } else { a = await account('primary'); b = await account('secondary'); page=a.page; id=a.stored.bookId; noise=coverFixturePng(); assert.ok(id); await page.goto(`/app/livros/${id}`); await stats(a,id,12,.4,4,3); }

    let covered, storedBytes;
    if(mode !== 'finish') {
    const oldVersion = (await (await api(a, 'GET', `/api/v1/books/${id}`)).json()).cover.version;
    await page.locator('#detail-book-cover-file').setInputFiles({ name: 'outra.png', mimeType: 'image/png', buffer: noise }); await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible(); const patched = page.waitForResponse(r => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/v1/books/${id}`); await page.getByRole('button', { name: 'Salvar alterações' }).click(); const patchResponse = await patched; assert.equal(patchResponse.status(), 200); assert.ok(await page.evaluate(() => window.__coverPayloadSizes.at(-1)) > 65536, 'Actual normalized File in PATCH FormData exceeds64KiB');
    covered = await (await api(a, 'GET', `/api/v1/books/${id}`)).json(); assert.notEqual(covered.cover.version, oldVersion);
    await api(b, 'GET', `/api/v1/books/${id}/cover`, undefined, 404); await api(b, 'DELETE', `/api/v1/books/${id}/cover`, undefined, 404); await api(a, 'DELETE', `/api/v1/books/${id}/cover`, undefined, 403, null);
    const getCover = await api(a, 'GET', `/api/v1/books/${id}/cover`); assert.ok(getCover.headers()['cache-control'].split(',').every(d => d.trim() === 'no-store'), 'Backend and edge both enforce no-store'); assert.equal(getCover.headers()['x-content-type-options'], 'nosniff'); storedBytes = await getCover.body(); assert.ok(storedBytes.length > 65536);
    const fresh = await account('primary'); const repeated = await api(fresh, 'GET', `/api/v1/books/${id}/cover`); assert.equal(sha(await repeated.body()), sha(storedBytes));
    const oldBooks = (await (await api(a, 'GET', '/api/v1/books')).json()).length;
    await multipart(a, 'POST', '/api/v1/books', { title: 'Imagem malformada', totalPages: 100 }, Buffer.from('not a PNG'), 400);
    assert.equal((await (await api(a, 'GET', '/api/v1/books')).json()).length, oldBooks);
    await multipart(a, 'PATCH', `/api/v1/books/${id}`, { title: 'Não deve salvar' }, Buffer.from('not a PNG'), 400); assert.equal((await (await api(a, 'GET', `/api/v1/books/${id}`)).json()).title, covered.title);
    pass('PATCH UI multipart real >64KiB/version; capa em outro contexto; owner404/CSRF403 e imagem inválida sem gravação parcial');
    } else { covered=await (await api(a,'GET',`/api/v1/books/${id}`)).json(); storedBytes=await (await api(a,'GET',`/api/v1/books/${id}/cover`)).body(); }
    await page.goto(`/app/livros/${id}`);
    for (const width of [390, 1440]) { await page.setViewportSize({ width, height: 1000 }); await expect(page.getByAltText('Capa de Estante privada de aceite')).toBeVisible(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.E2E_REAL_AXE_FILE) { await page.evaluate(readFileSync(process.env.E2E_REAL_AXE_FILE, 'utf8')); const axe = await page.evaluate(async () => { const result = await window.axe.run(document.querySelector('.detail-page'), { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } }); return result.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length })); }); assert.deepEqual(axe, [], 'Affected book detail WCAG AA'); }
      const output = process.env.E2E_REAL_SCREENSHOT_DIR; if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: resolve(output, `bookshelf-detail-${width}.png`), fullPage: true }); } }
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 30000 });
    const apiCached = await page.evaluate(async () => { for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) if (new URL(r.url).pathname.startsWith('/api/')) return true; return false; }); assert.equal(apiCached, false);
    const response = await a.context.request.get(`/app/livros/${id}`); assert.equal(response.headers()['x-robots-tag'], 'noindex, nofollow');
    const exported = await (await api(a, 'GET', '/api/v1/me/export')).body(); const exportData = JSON.parse(exported); const exportedCover = exportData.covers.find(c => c.bookId === id); assert.ok(exportedCover); assert.equal(sha(Buffer.from(exportedCover.dataBase64, 'base64')), sha(storedBytes)); assert.equal(exportData.books.find(book => book.id === id).stats, undefined);
    a.stored.exportHash = sha(exported); a.stored.coverHash = sha(storedBytes); save();
    pass('CSR privé390/1440 sem overflow; SW ativo não cacheia API; export inclui bytes normalizados iguais ao GET privado');
    // Book and account cascades are tested on a disposable owner; primary baseline remains.
    const disposable = await multipart(b, 'POST', '/api/v1/books', { title: 'Capa para cascade', totalPages: 100 }, noise, 201); const disposableId = (await disposable.json()).id;
    await api(b, 'DELETE', `/api/v1/books/${disposableId}`, undefined, 204); assert.equal(pg(`SELECT count(*) FROM book_cover WHERE book_id='${disposableId}';`), '0');
    const last = await multipart(b, 'POST', '/api/v1/books', { title: 'Conta para cascade', totalPages: 100 }, noise, 201); const lastId = (await last.json()).id;
    await api(b, 'DELETE', '/api/v1/me', { confirm: true }, 204); assert.equal(pg(`SELECT count(*) FROM book_cover WHERE book_id='${lastId}';`), '0');
    assert.equal((await b.context.request.get('/api/v1/me', { maxRedirects: 0 })).status(), 401);
    pass('Exclusão do livro e da conta cascata remove bytea; sessão da conta excluída retorna401');
    records.primary.exportHash = sha(await (await api(a, 'GET', '/api/v1/me/export')).body()); save();
    // Console failures are summarized, never raw provider or credential content.
    assert.equal(failures.length, 0, 'Affected journey has no unexpected console/page exception');
  } else if (mode === 'upload-failure') {
    const a=await account('primary'); const page=a.page; await page.goto(`/app/livros/${a.stored.bookId}`);
    const primed=page.waitForResponse(r=>r.request().method()==='PATCH' && new URL(r.url()).pathname===`/api/v1/books/${a.stored.bookId}`); await page.getByRole('button',{name:'Salvar alterações'}).click(); assert.equal((await primed).status(),200);
    await page.getByRole('link',{name:'Seus livros',exact:false}).click(); await page.getByRole('link',{name:/novo livro/i}).click(); await page.getByRole('textbox',{name:'Título',exact:true}).fill('Retry upload privado'); await page.getByLabel('Total de páginas').fill('100'); await page.locator('#book-cover-file').setInputFiles({name:'capa.png',mimeType:'image/png',buffer:coverFixturePng()}); await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible();
    let expectedFailure=0; page.on('requestfailed',r=>{if(r.method()==='POST' && new URL(r.url()).pathname==='/api/v1/books') expectedFailure++;}); await a.context.setOffline(true); await page.getByRole('button',{name:/adicionar livro/i}).click(); await expect(page.locator('form').getByRole('alert')).toBeVisible(); await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible(); assert.equal(await page.evaluate(()=>navigator.onLine),false,'Real browser transport is offline (SW may translate fetch failure into a504 response)'); await a.context.setOffline(false); assert.equal((await (await api(a,'GET','/api/v1/books')).json()).length,1);
    const retried=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname==='/api/v1/books'); await page.getByRole('button',{name:/adicionar livro/i}).click(); assert.equal((await retried).status(),201); await page.waitForURL('**/app/livros'); assert.equal((await (await api(a,'GET','/api/v1/books')).json()).length,2);
    await page.getByRole('link',{name:'Abrir Retry upload privado',exact:true}).click(); page.once('dialog',d=>d.accept()); await page.getByRole('button',{name:'Excluir livro',exact:true}).click(); await page.waitForURL('**/app/livros'); assert.equal((await (await api(a,'GET','/api/v1/books')).json()).length,1); pass('Falha real de rede no upload UI preserva foto/campos sem livro; retry único cria1 e cleanupUI preserva baseline');
  } else if (mode === 'legacy-ui') {
    const a=await account('legacy'); const page=a.page; await page.goto(`/app/livros/${a.stored.bookId}`); await expect(page.locator('.pages-read')).toContainText('451'); await expect(page.locator('.percent')).toHaveText('90,2%'); await expect(page.getByLabel('Total de páginas')).toHaveValue('500');
    await page.goto(`/app/ler?bookId=${a.stored.bookId}`); await expect(page.getByLabel('Livro',{exact:true})).toHaveValue(a.stored.bookId); await expect(page.locator('#reading-book option:checked')).toHaveText('Legado V7 de aceite'); await expect(page.locator('.pages-read')).toContainText('451'); await expect(page.locator('.daily-average')).toContainText('1 páginas/dia'); pass('UI detalhe e leitura resolvem livro legado fora dos primeiros100, com451leituras/450dias agregadas');
  } else if (mode === 'integrated-account') { await account('integrated',true); pass('Conta isolada criada por UI/BFF reais para suite integrada');
  } else if (mode === 'visual') {
    const a = await account('primary'); const page = a.page; const output=process.env.E2E_REAL_SCREENSHOT_DIR; assert.ok(output); mkdirSync(output,{recursive:true});
    for (const [label,path,scope] of [['detail',`/app/livros/${a.stored.bookId}`,'.detail-page'],['shelf','/app/livros','.books-page'],['create','/app/livros/novo','.form-page']]) {
      await page.goto(path); if(label==='create') { await page.getByRole('textbox',{name:'Título',exact:true}).fill('Cadastro de livro com capa'); await page.getByLabel('Total de páginas').fill('300'); await page.locator('#book-cover-file').setInputFiles({name:'capa.png',mimeType:'image/png',buffer:coverFixturePng()}); await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible(); } else await expect(page.getByAltText('Capa de Estante privada de aceite')).toBeVisible();
      for(const width of [390,1440]) { await page.setViewportSize({width,height:1000}); await page.screenshot({path:resolve(output,`bookshelf-${label}-${width}.png`),fullPage:true}); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); if(process.env.E2E_REAL_AXE_FILE){ await page.evaluate(readFileSync(process.env.E2E_REAL_AXE_FILE,'utf8')); const result=await page.evaluate(async scope=>{const r=await window.axe.run(document.querySelector(scope)||document.querySelector('main'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))}));},scope); console.log(JSON.stringify({screen:label,width,violations:result})); } }
    }
  } else if (mode === 'focus') {
    const a=await account('primary'); const page=a.page;await page.goto(`/app/livros/${a.stored.bookId}`);for(const width of [390,1440]){await page.setViewportSize({width,height:1000});const button=page.getByRole('button',{name:'Excluir livro',exact:true});await button.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');assert.ok(await button.evaluate(el=>el===document.activeElement));const style=await button.evaluate(el=>{const s=getComputedStyle(el);return{foreground:s.color,background:s.backgroundColor,outline:s.outlineColor,width:s.outlineWidth,kind:s.outlineStyle}});assert.equal(style.foreground,'rgb(126, 48, 48)');assert.equal(style.width,'3px');assert.equal(style.kind,'solid');console.log(JSON.stringify({screen:'detail-keyboard',width,style}));}pass('Foco por teclado chega ao botão de exclusão e ring3px visível em390/1440 na imagemCSSfinal');
  } else if (mode === 'baseline') {
    const a=await account('primary'); const id=a.stored.bookId; const one=await (await api(a,'GET','/api/v1/me/export')).body(); const two=await (await api(a,'GET','/api/v1/me/export')).body(); assert.equal(sha(one),sha(two),'Export must remain stable without writes'); const cover=await (await api(a,'GET',`/api/v1/books/${id}/cover`)).body(); const exp=JSON.parse(one).covers.find(c=>c.bookId===id); assert.equal(sha(Buffer.from(exp.dataBase64,'base64')),sha(cover)); assert.equal(pg(`SELECT encode(sha256(data),'hex') FROM book_cover WHERE book_id='${id}';`),sha(cover)); await stats(a,id,12,.4,4,3);
    a.stored.exportHash=sha(one);a.stored.coverHash=sha(cover);save(); const baseline={bookId:id,coverSha:sha(cover),exportSha:sha(one),coverBytes:cover.length,pages:12,minutes:18,source:process.env.E2E_REAL_SOURCE_HEAD??null}; assert.ok(process.env.E2E_REAL_BASELINE_FILE?.startsWith('/'));writeFileSync(process.env.E2E_REAL_BASELINE_FILE,JSON.stringify(baseline),{mode:0o600}); pass(`BASE FINAL: cover${cover.length}bytes SHA${baseline.coverSha}, exportSHA${baseline.exportSha}; PG/GET/export iguais,12p18m`);
  } else if (mode === 'persistence') {
    const a = await account('primary'); const bytes = await (await api(a, 'GET', '/api/v1/me/export')).body(); assert.equal(sha(bytes), records.primary.exportHash); const cover = await (await api(a, 'GET', `/api/v1/books/${records.primary.bookId}/cover`)).body(); assert.equal(sha(cover), records.primary.coverHash); await stats(a, records.primary.bookId, 12, .4, 4, 3); pass('Novo login após restart: hash export estável, capa idêntica e métricas persistentes');
  } else throw new Error('Unsupported isolated acceptance mode');
} catch (error) {
  // Assertions retain technical expected/actual values, never credentials/API bodies.
  let message = String(error.message); for (const value of Object.values(records)) for (const key of ['email','password','id']) if (value?.[key]) message = message.replaceAll(value[key], '[private]'); console.error(`FAIL ${error.name}: ${message.replace(/https?:\/\/\S+/g, '[URL]').replace(/[\w.+-]+@[\w.-]+/g, '[email]')}`); process.exitCode = 1;
} finally { await Promise.all(contexts.map(c => c.close())); await browser.close(); }

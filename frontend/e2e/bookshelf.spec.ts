import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transparentCover as cover } from './cover-fixture';
import { expect, signIn, test, TODAY } from './fixtures';

test.describe('estante e capas — API/BFF simulados, arquivo e Canvas reais', () => {
  test('cria JSON e foto RAW no mesmo livro, seleciona livro e recalcula após editar/excluir leitura', async ({ page, mockApi }) => {
    mockApi.books = []; await signIn(page);
    await page.getByRole('link', { name: /cadastrar livro/i }).click();
    await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Livro com capa');
    await page.getByLabel('Autor').fill('Autora'); await page.getByLabel('Edição').fill('2ª edição');
    await page.getByLabel('Total de páginas').fill('300');
    await page.locator('#book-cover-file').setInputFiles(cover);
    await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible();
    const created = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/books');
    await page.getByRole('button', { name: /adicionar livro/i }).click(); expect((await created).status()).toBe(201);
    await expect(page).toHaveURL(/\/app\/livros$/);
    await page.setViewportSize({ width: 390, height: 844 });
    const row = page.locator('.book-row'); await expect(row).toContainText('2ª edição'); await expect(row.locator('.percent')).toHaveText('0%');
    expect(mockApi.books).toHaveLength(1); expect(mockApi.covers?.get(mockApi.books[0].id)?.subarray(0,2)).toEqual(Buffer.from([255,216]));
    const pixel = await row.locator('img').evaluate(async (element: HTMLImageElement) => {
      await element.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!; context.drawImage(element, 0, 0, 1, 1); return [...context.getImageData(0,0,1,1).data];
    }); expect(pixel).toEqual([255,255,255,255]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/bookshelf-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: 'test-results/bookshelf-desktop.png', fullPage: true });
    await row.getByRole('link', { name: 'Registrar leitura', exact: true }).click();
    await expect(page.getByLabel('Livro', { exact: true })).toHaveValue(mockApi.books[0].id);
    await page.getByLabel('Páginas').fill('10'); await page.getByLabel('Data', { exact: false }).fill('2026-09-05');
    await page.getByRole('button', { name: /^registrar leitura/i }).click();
    await page.getByRole('link', { name: 'Concluir', exact: true }).click();
    await page.getByRole('link', { name: 'Livros', exact: true }).click();
    await expect(row.locator('.percent')).toHaveText('3,33%'); await expect(row.locator('.daily-average')).toContainText('5 páginas/dia');
    await page.getByRole('link', { name: 'Progresso', exact: true }).click();
    await page.getByRole('link', { name: /editar leitura/i }).click(); await page.getByLabel('Páginas').fill('20');
    await page.getByRole('button', { name: 'Salvar registro' }).click(); await page.getByRole('link', { name: 'Livros', exact: true }).click();
    await expect(row.locator('.percent')).toHaveText('6,66%'); await expect(row.locator('.daily-average')).toContainText('10 páginas/dia');
    await page.getByRole('link', { name: 'Progresso', exact: true }).click(); await page.getByRole('link', { name: /editar leitura/i }).click();
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Excluir esta sessão' }).click();
    await page.getByRole('link', { name: 'Livros', exact: true }).click(); await expect(row.locator('.percent')).toHaveText('0%');
    await expect(row.locator('.daily-average')).toContainText('0 páginas/dia');
  });

  test('mantém legado e histórico completo, precisão menor que100 e média até a finalização manual', async ({ page, mockApi }) => {
    mockApi.sessions = Array.from({ length: 150 }, (_, i) => ({ id: 's-' + i, bookId: 'hobbit', userId: 'demo-user', readingDate: '2026-09-01', pages: 20, minutes: 0 }));
    mockApi.sessions[0].pages = 19;
    await signIn(page); await page.getByRole('link', { name: 'Livros', exact: true }).click();
    const row = page.locator('.book-row'); await expect(row.locator('.pages-read')).toContainText('2.999');
    await expect(row.locator('[role="progressbar"]')).toHaveCount(0); await row.getByRole('link', { name: /informe o total/i }).click();
    await expect(page.getByLabel('Total de páginas')).toHaveValue(''); await page.getByLabel('Total de páginas').fill('3000');
    await page.getByLabel('Edição').fill('Legado completo'); await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.locator('.percent')).toHaveText('99,96%'); await expect(page.locator('.daily-average')).toContainText('499,83');
    await page.getByLabel('Data da finalização').fill('2026-09-03'); await page.getByRole('button', { name: 'Marcar como finalizado' }).click();
    await expect(page.locator('.daily-average')).toContainText('999,67'); await expect(page.getByRole('button', { name: 'Reabrir livro' })).toBeVisible();
    await page.getByRole('button', { name: 'Reabrir livro' }).click(); await expect(page.locator('.daily-average')).toContainText('499,83');
    expect(mockApi.sessions).toHaveLength(150);
  });

  test('falha do POST conserva prévia e campos; retry cria somente um livro', async ({ page, mockApi }) => {
    mockApi.books = []; await signIn(page); await page.getByRole('link', { name: /cadastrar livro/i }).click();
    await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Retry privado'); await page.getByLabel('Total de páginas').fill('200');
    await page.locator('#book-cover-file').setInputFiles(cover); await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible();
    await page.route('**/api/v1/books', async route => {
      if (route.request().method() === 'POST') return route.fulfill({ status: 413, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Imagem recusada. Tente novamente.' }) });
      return route.fallback();
    });
    await page.getByRole('button', { name: /adicionar livro/i }).click();
    await expect(page.locator('form').getByRole('alert').filter({ hasText: 'Imagem recusada' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Título', exact: true })).toHaveValue('Retry privado'); await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible();
    expect(mockApi.books).toHaveLength(0); await page.unroute('**/api/v1/books');
    await page.getByRole('button', { name: /adicionar livro/i }).click(); await expect(page).toHaveURL(/\/app\/livros$/); expect(mockApi.books).toHaveLength(1);
  });

  test('substitui e remove a capa privada, com fallback e retry quando o GET falha', async ({ page, mockApi }) => {
    await signIn(page); await page.getByRole('link', { name: 'Livros', exact: true }).click(); await page.getByRole('link', { name: 'Abrir O Hobbit' }).click();
    await page.locator('#detail-book-cover-file').setInputFiles(cover); await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible();
    await page.getByRole('button', { name: 'Enviar foto' }).click(); await expect(page.getByAltText('Capa de O Hobbit')).toBeVisible();
    const firstVersion = mockApi.books[0].cover?.version;
    const replacement = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 24; canvas.height = 32;
      const context = canvas.getContext('2d')!; context.fillStyle = '#315945'; context.fillRect(0,0,24,32);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('#detail-book-cover-camera').setInputFiles({ name: 'outra-capa.png', mimeType: 'image/png', buffer: Buffer.from(replacement, 'base64') }); await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible();
    await page.getByRole('button', { name: 'Enviar foto' }).click();
    await expect.poll(() => mockApi.books[0].cover?.version).not.toBe(firstVersion);
    await page.route('**/api/v1/books/hobbit/photo?*', route => route.fulfill({ status: 404 })); await page.reload();
    await expect(page.getByText('Capa indisponível', { exact: true })).toBeVisible();
    await page.unroute('**/api/v1/books/hobbit/photo?*'); await page.getByRole('button', { name: 'Tentar capa novamente' }).click();
    await expect(page.getByAltText('Capa de O Hobbit')).toBeVisible();
    await page.getByRole('button', { name: 'Remover capa salva' }).click(); await expect(page.getByText('Capa removida.', { exact: true })).toBeVisible();
    await expect(page.getByAltText('Capa de O Hobbit')).toHaveCount(0); expect(mockApi.books[0].cover).toBeNull();
  });

  test('erro de métricas após leitura não restaura total antigo ao Fechar e permite retry sem novo POST', async ({ page, mockApi }) => {
    mockApi.books[0].totalPages = 100; await signIn(page); await page.getByRole('link', { name: 'Registrar leitura', exact: false }).first().click();
    await page.route('**/api/v1/books/hobbit', route => route.fulfill({ status: 503 }));
    await page.route('**/api/v1/dashboard', route => route.fulfill({ status: 503 }));
    await page.getByLabel('Páginas').fill('10'); await page.getByLabel('Data', { exact: false }).fill(TODAY);
    await page.getByRole('button', { name: /^registrar leitura/i }).click();
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('link', { name: 'Concluir', exact: true }).click();
    await page.getByRole('link', { name: 'Livros', exact: true }).click(); await expect(page.locator('.pages-read')).toHaveCount(0);
    await expect(page.getByText('Progresso indisponível.', { exact: true })).toBeVisible();
    await page.unroute('**/api/v1/books/hobbit'); await page.locator('.book-progress').getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.locator('.pages-read')).toContainText('10 de 100'); expect(mockApi.sessions).toHaveLength(1);
  });
});


test.describe('LIVRO-02 — API/BFF simulados, WebP e Canvas reais', () => {
  test('total opcional não vira zero nem impede criar e abrir o livro', async ({ page, mockApi }) => {
    mockApi.books = []; await signIn(page);
    await page.getByRole('link', { name: /cadastrar livro/i }).click();
    await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Sem total conhecido');
    await page.getByRole('button', { name: /adicionar livro/i }).click();
    await expect(page).toHaveURL(/\/app\/livros$/);
    expect(mockApi.books).toHaveLength(1); expect(mockApi.books[0].totalPages).toBeNull();
    await expect(page.locator('[role="progressbar"]')).toHaveCount(0);
    await page.getByRole('link', { name: 'Abrir Sem total conhecido' }).click();
    await expect(page.getByLabel('Total de páginas')).toHaveValue('');
    await page.getByLabel('Total de páginas').fill('300'); await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect.poll(() => mockApi.books[0].totalPages).toBe(300);
    await page.getByLabel('Total de páginas').fill(''); await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect.poll(() => mockApi.books[0].totalPages).toBeNull();
    await expect(page.locator('[role="progressbar"]')).toHaveCount(0);
  });

  test('falha PUT da foto preserva livro salvo e prévia; retry usa mesmo id sem segundo POST', async ({ page, mockApi }) => {
    mockApi.books = []; await signIn(page); await page.getByRole('link', { name: /cadastrar livro/i }).click();
    await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Foto pendente');
    const webp = readFileSync(resolve(process.cwd(), '../backend/src/test/resources/book-photo/synthetic-metadata.webp'));
    await page.locator('#book-cover-file').setInputFiles({ name: 'sintetica.webp', mimeType: 'image/webp', buffer: webp });
    await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible();
    let creates = 0;
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/books') creates++; });
    await page.route('**/api/v1/books/*/photo', route => route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ status: 503 }) }) : route.fallback());
    await page.getByRole('button', { name: /adicionar livro/i }).click();
    await expect(page.locator('form').getByRole('alert')).toContainText('Livro salvo');
    expect(mockApi.books).toHaveLength(1); expect(creates).toBe(1);
    const id = mockApi.books[0].id; await expect(page.getByAltText('Prévia da capa escolhida')).toBeVisible();
    await page.unroute('**/api/v1/books/*/photo');
    const uploaded = page.waitForRequest(request => request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v1/books/' + id + '/photo');
    await page.getByRole('button', { name: 'Tentar enviar foto novamente' }).click();
    const request = await uploaded; expect(request.headers()['content-type']).toBe('image/jpeg');
    expect(request.postDataBuffer()!.length).toBeLessThanOrEqual(1_000_000);
    expect(request.postDataBuffer()!.subarray(0,2)).toEqual(Buffer.from([255,216]));
    expect(request.postDataBuffer()!.toString('latin1')).not.toContain('Exif');
    expect(request.postDataBuffer()!.toString('latin1')).not.toContain('SYNTHETIC_GPS_REMOVAL_SENTINEL');
    await expect(page).toHaveURL(/\/app\/livros$/); expect(mockApi.books).toHaveLength(1); expect(creates).toBe(1);
    const pixel = await page.locator('.book-row img').evaluate(async (image: HTMLImageElement) => {
      await image.decode(); const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
      const context = canvas.getContext('2d')!; context.drawImage(image,0,0,32,24); return [...context.getImageData(30,22,1,1).data];
    });
    expect(pixel.slice(0,3).every(channel => channel > 240)).toBe(true); expect(pixel[3]).toBe(255);
    await page.reload(); await expect(page.locator('.book-row img')).toBeVisible();
  });
});

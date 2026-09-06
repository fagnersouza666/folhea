import { signIn, test, expect } from './fixtures';

test.describe('critical reading journey', () => {
  test('landing page and login', async ({ page, mockApi }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Folhea/);
    await expect(page.getByRole('heading', { name: 'Cada página conta.' })).toBeVisible();
    await signIn(page);
    expect(mockApi.books).toHaveLength(1);
  });

  test('book registration and reading session', async ({ page, mockApi }) => {
    void mockApi;
    await signIn(page);
    await page.getByRole('link', { name: 'Livros' }).click();
    await page.getByRole('link', { name: /novo livro/i }).click();
    await page.getByLabel('Título').fill('O Nome do Vento');
    await page.getByLabel('Autor').fill('Patrick Rothfuss');
    await page.getByRole('button', { name: /adicionar livro/i }).click();
    await expect(page).toHaveURL(/\/app\/ler$/);
    await page.getByLabel('Livro').selectOption({ label: 'O Hobbit' });
    await page.getByLabel('Páginas').fill('32');
    await page.getByLabel('Minutos').fill('25');
    await page.getByRole('button', { name: /registrar leitura/i }).click();
    await expect(page.getByRole('heading', { name: /leitura registrada/i })).toBeVisible();
    await expect(page.getByText('32', { exact: true })).toBeVisible();
  });

  test('stats and card creation', async ({ page, mockApi }) => {
    void mockApi;
    await signIn(page);
    await page.getByRole('link', { name: 'Ver progresso' }).click();
    await expect(page.getByRole('heading', { name: 'Seu progresso' })).toBeVisible();
    await page.getByRole('button', { name: /criar card/i }).click();
    await expect(page.getByRole('button', { name: /card criado/i })).toBeVisible();
  });

  test('reading edit/delete, finish/reopen, and card share/download contracts', async ({ page, mockApi }) => {
    void mockApi;
    await signIn(page);
    const result = await page.evaluate(async () => {
      const json = (body: unknown) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const call = async (url: string, init: RequestInit = {}) => {
        const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
        return response.status;
      };
      const session = await fetch('/api/v1/sessions', { method: 'POST', ...json({ bookId: 'hobbit', readingDate: '2026-09-06', pages: 10, minutes: 8 }) }).then((response) => response.json());
      return {
        sessionCreated: session.id,
        sessionUpdated: await call(`/api/v1/sessions/${session.id}`, { method: 'PATCH', ...json({ pages: 12 }) }),
        sessionDeleted: await call(`/api/v1/sessions/${session.id}`, { method: 'DELETE' }),
        bookFinished: await call('/api/v1/books/hobbit/finish', { method: 'POST', ...json({ finishedOn: '2026-09-06' }) }),
        bookReopened: await call('/api/v1/books/hobbit/finish', { method: 'DELETE' }),
        bookUpdated: await call('/api/v1/books/hobbit', { method: 'PATCH', ...json({ author: 'J. R. R. Tolkien' }) }),
        cardCreated: await call('/api/v1/cards', { method: 'POST', ...json({}) }),
        cardShared: await call('/api/v1/cards/card-1/share', { method: 'POST', ...json({}) }),
        cardDownloaded: await call('/api/v1/cards/card-1/download')
      };
    });
    expect(result).toMatchObject({ sessionUpdated: 200, sessionDeleted: 204, bookFinished: 200, bookReopened: 200, bookUpdated: 200, cardCreated: 201, cardShared: 200, cardDownloaded: 200 });
    expect(result.sessionCreated).toBeTruthy();
  });
});

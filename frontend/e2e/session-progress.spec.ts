import { signIn, test, expect, TODAY } from './fixtures';
import type { Page } from '@playwright/test';

// The UI is real; API/BFF aggregates and session persistence are simulated here.
async function reading(page: Page, bookId: string, date: string, pages: number, minutes = 0): Promise<void> {
  await page.goto('/app/ler?bookId=' + bookId);
  await expect(page.getByLabel('Livro', { exact: true })).toHaveValue(bookId);
  await page.getByLabel('Data', { exact: true }).fill(date);
  await page.locator('#reading-pages').fill(String(pages));
  await page.locator('#reading-minutes').fill(String(minutes));
  await page.getByRole('button', { name: /^registrar leitura/i }).click();
  await expect(page.getByRole('heading', { name: /leitura registrada/i })).toBeVisible();
  await page.getByRole('link', { name: 'Concluir', exact: true }).click();
  await page.getByRole('link', { name: 'Livros', exact: true }).click();
}

test.describe('SESSAO-01 — UI com API/BFF simulados', () => {
  test('média por datas com páginas, minutos-only, edição e exclusão recalculam progresso', async ({ page, mockApi }) => {
    mockApi.books[0].totalPages = 300;
    await signIn(page);
    await reading(page, 'hobbit', '2026-09-04', 30);
    await reading(page, 'hobbit', '2026-09-05', 45);
    const row = page.locator('.book-row');
    await expect(row.locator('.pages-read')).toContainText('75 de 300');
    await expect(row.locator('.daily-average')).toContainText('37,5 páginas por dia de leitura');
    await expect(row.locator('.percent')).toHaveText('25%');
    await reading(page, 'hobbit', TODAY, 0, 25);
    await expect(row.locator('.daily-average')).toContainText('37,5 páginas por dia de leitura');
    await expect(row.locator('.pages-read')).toContainText('75 de 300');
    await page.getByRole('link', { name: 'Progresso', exact: true }).click();
    const session = page.locator('.session-row').filter({ hasText: '45 pág.' });
    await session.getByRole('link', { name: /editar leitura/i }).click();
    await page.getByLabel('Páginas', { exact: true }).fill('60');
    await page.getByRole('button', { name: 'Salvar registro' }).click();
    await page.getByRole('link', { name: 'Livros', exact: true }).click();
    await expect(row.locator('.daily-average')).toContainText('45 páginas por dia de leitura');
    await expect(row.locator('.percent')).toHaveText('30%');
    await page.getByRole('link', { name: 'Progresso', exact: true }).click();
    await page.locator('.session-row').filter({ hasText: '60 pág.' }).getByRole('link', { name: /editar leitura/i }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Excluir esta sessão' }).click();
    await page.getByRole('link', { name: 'Livros', exact: true }).click();
    await expect(row.locator('.daily-average')).toContainText('30 páginas por dia de leitura');
    await expect(row.locator('.percent')).toHaveText('10%');
    expect(mockApi.sessions).toHaveLength(2);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('transferência atualiza origem e destino e conta apenas uma data repetida', async ({ page, mockApi }) => {
    mockApi.books[0].totalPages = 300;
    mockApi.books.push({ ...mockApi.books[0], id: 'destino', title: 'Livro destino', totalPages: 200 });
    mockApi.sessions = [
      { id: 's-source', userId: 'demo-user', bookId: 'hobbit', readingDate: '2026-09-04', pages: 30, minutes: 0 },
      { id: 's-move', userId: 'demo-user', bookId: 'hobbit', readingDate: '2026-09-05', pages: 45, minutes: 0 },
      { id: 's-dest', userId: 'demo-user', bookId: 'destino', readingDate: '2026-09-04', pages: 20, minutes: 0 }
    ];
    await signIn(page);
    await page.getByRole('link', { name: 'Progresso', exact: true }).click();
    await page.locator('.session-row').filter({ hasText: '45 pág.' }).getByRole('link', { name: /editar leitura/i }).click();
    await page.getByLabel('Livro', { exact: true }).selectOption('destino');
    await page.getByRole('button', { name: 'Salvar registro' }).click();
    await page.getByRole('link', { name: 'Livros', exact: true }).click();
    const source = page.locator('.book-row').filter({ hasText: 'O Hobbit' });
    const destination = page.locator('.book-row').filter({ hasText: 'Livro destino' });
    await expect(source.locator('.pages-read')).toContainText('30 de 300');
    await expect(source.locator('.daily-average')).toContainText('30 páginas por dia de leitura');
    await expect(destination.locator('.pages-read')).toContainText('65 de 200');
    await expect(destination.locator('.daily-average')).toContainText('32,5 páginas por dia de leitura');
    await expect(destination.locator('.percent')).toHaveText('32%');
    await page.getByRole('link', { name: 'Progresso', exact: true }).click();
    await page.locator('.session-row').filter({ hasText: '45 pág.' }).getByRole('link', { name: /editar leitura/i }).click();
    await page.getByLabel('Data', { exact: true }).fill('2026-09-04');
    await page.getByRole('button', { name: 'Salvar registro' }).click();
    await page.getByRole('link', { name: 'Livros', exact: true }).click();
    await expect(destination.locator('.daily-average')).toContainText('65 páginas por dia de leitura');
    await expect(source.locator('.percent')).toHaveText('10%');
  });
});

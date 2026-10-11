import { test, expect } from '@playwright/test';

// These credentials must belong to an isolated test account on the local stack.
const email = process.env['FOLHEA_E2E_EMAIL'];
const password = process.env['FOLHEA_E2E_PASSWORD'];

test('jornada com BFF, Keycloak e banco reais pela UI', async ({ page }) => {
  test.skip(!email || !password, 'Defina credenciais da conta de teste local.');
  await page.goto('/entrar');
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.locator('#username').fill(email!);
  await page.locator('#password').fill(password!);
  await page.locator('#kc-login').click();
  await expect(page).toHaveURL(/\/app\/inicio$/, { timeout: 30_000 });
  await page.getByRole('link', { name: 'Livros', exact: true }).click();
  await page.getByRole('link', { name: /novo livro/i }).click();
  const title = `Jornada Folhea ${Date.now()}`;
  await page.getByLabel('Título').fill(title);
  await page.getByRole('button', { name: /adicionar livro/i }).click();
  await expect(page).toHaveURL(/\/app\/ler\?bookId=/);
  const bookId = new URL(page.url()).searchParams.get('bookId');
  expect(bookId).toBeTruthy();
  await expect(page.getByLabel('Livro', { exact: true })).toHaveValue(bookId!);
  await expect(page.locator('#reading-book option:checked')).toHaveText(title);
  await page.getByLabel('Páginas').fill('12');
  await page.getByLabel('Minutos').fill('8');
  await page.getByRole('button', { name: /^registrar leitura/i }).click();
  await expect(page.getByRole('heading', { name: /leitura registrada/i })).toBeVisible();
  await page.getByRole('link', { name: 'Ver meu progresso' }).click();
  const row = page.locator('.session-row').filter({ hasText: title }).first();
  await row.getByRole('link', { name: /editar leitura/i }).click();
  await page.getByLabel('Páginas', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Salvar registro' }).click();
  await expect(page.locator('.session-row').filter({ hasText: title }).first()).toContainText('15 pág.');
  await page.getByRole('link', { name: 'Criar card', exact: false }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Salvar PNG' }).click();
  expect((await download).suggestedFilename()).toBe('folhea-card.png');
  await page.getByRole('link', { name: 'Livros', exact: true }).click();
  await page.getByRole('link', { name: `Abrir ${title}` }).click();
  await page.getByRole('button', { name: 'Marcar como finalizado' }).click();
  await expect(page.getByRole('button', { name: 'Reabrir livro' })).toBeVisible();
  await page.getByRole('button', { name: 'Reabrir livro' }).click();
  await expect(page.getByRole('button', { name: 'Marcar como finalizado' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Excluir livro' }).click();
  await expect(page).toHaveURL(/\/app\/livros$/);
  await expect(page.getByRole('link', { name: `Abrir ${title}` })).toHaveCount(0);
});

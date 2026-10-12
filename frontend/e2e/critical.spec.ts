import { signIn, test, expect, TODAY } from './fixtures';

test.describe('jornadas pela interface — API e login BFF simulados', () => {
  test('landing e cadastro navegam ao IdP sem coletar senha no Folhea', async ({ page, mockApi }) => {
    void mockApi;
    const passwordPosts: string[] = [];
    page.on('request', request => { if (request.method() === 'POST' && /\/api\/v1\/(registration|auth\/register|register)$/.test(new URL(request.url()).pathname)) passwordPosts.push(request.url()); });
    await page.route('**/auth/register', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Cadastro do provedor simulado</h1>' }));
    await page.goto('/cadastro');
    await expect(page.locator('input[type="password"], #registration-email')).toHaveCount(0);
    await page.getByRole('link', { name: /criar conta/i }).click();
    await expect(page).toHaveURL(/\/auth\/register$/);
    await expect(page.getByRole('heading', { name: 'Cadastro do provedor simulado' })).toBeVisible();
    expect(passwordPosts).toEqual([]);
    await signIn(page);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  });

  test('primeiro livro, leitura, edição, exclusão e métricas confirmadas', async ({ page, mockApi }) => {
    mockApi.books = [];
    await signIn(page);
    await page.getByRole('link', { name: /cadastrar livro/i }).click();
    await page.getByLabel('Título').fill('O Nome do Vento');
    await page.getByLabel('Autor').fill('Patrick Rothfuss');
    await page.getByLabel('Total de páginas').fill('600');
    await page.getByRole('button', { name: /adicionar livro/i }).click();
    await expect(page).toHaveURL(/\/app\/livros$/);
    await page.locator('.book-row').last().getByRole('link', { name: 'Registrar leitura', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/ler\?bookId=/);
    await expect(page.getByLabel('Livro', { exact: true })).toHaveValue(mockApi.books[0].id);
    await page.getByRole('button', { name: /^registrar leitura/i }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Informe páginas ou minutos' })).toBeVisible();
    expect(mockApi.sessions).toHaveLength(0);
    await page.getByLabel('Páginas').fill('32');
    await page.getByLabel('Minutos').fill('');
    await page.getByLabel('Data', { exact: false }).fill(TODAY);
    await page.getByRole('button', { name: /^registrar leitura/i }).click();
    await expect(page.getByRole('heading', { name: /leitura registrada/i })).toBeVisible();
    await expect(page.locator('.weekly')).toContainText('32 páginas');
    await page.getByRole('link', { name: 'Ver meu progresso' }).click();
    await expect(page.locator('.metric-grid')).toContainText('32');
    await page.getByRole('link', { name: /editar leitura/i }).click();
    await page.getByLabel('Páginas', { exact: true }).fill('0');
    await page.getByLabel('Minutos', { exact: true }).fill('15');
    await page.getByLabel('Data', { exact: true }).fill('2026-09-05');
    await page.getByRole('button', { name: 'Salvar registro' }).click();
    await expect(page).toHaveURL(/\/app\/progresso$/);
    await expect(page.locator('.metric-grid')).toContainText('15min');
    await expect(page.locator('.hero-stat strong')).toContainText('1');
    await page.getByRole('link', { name: /editar leitura/i }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Excluir esta sessão' }).click();
    await expect(page).toHaveURL(/\/app\/progresso$/);
    await expect(page.locator('.empty')).toContainText('Seu primeiro registro');
    await expect(page.locator('.hero-stat strong')).toContainText('0');
    expect(mockApi.sessions).toHaveLength(0);
  });

  test('livro editar, finalizar em data passada, reabrir e excluir', async ({ page, mockApi }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Livros', exact: true }).click();
    await page.getByRole('link', { name: 'Abrir O Hobbit' }).click();
    await page.getByLabel('Título', { exact: true }).fill('O Hobbit revisado');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('status')).toContainText('Alterações salvas');
    await expect(page.getByRole('heading', { name: 'O Hobbit revisado' })).toBeVisible();
    await page.getByLabel('Data da finalização').fill('2026-08-01');
    await page.getByRole('button', { name: 'Marcar como finalizado' }).click();
    await expect(page.getByRole('button', { name: 'Reabrir livro' })).toBeVisible();
    expect(mockApi.books[0].finishedOn).toBe('2026-08-01');
    await page.getByRole('button', { name: 'Reabrir livro' }).click();
    await expect(page.getByRole('button', { name: 'Marcar como finalizado' })).toBeVisible();
    expect(mockApi.books[0].finishedOn).toBeUndefined();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Excluir livro' }).click();
    await expect(page).toHaveURL(/\/app\/livros$/);
    await expect(page.getByRole('heading', { name: 'Sua biblioteca começa aqui.' })).toBeVisible();
  });

  test('livro recém-cadastrado permanece selecionado após reload com outro em andamento', async ({ page, mockApi }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Livros', exact: true }).click();
    await page.getByRole('link', { name: /novo livro/i }).click();
    const title = 'A Cidade e a Cidade';
    await page.getByLabel('Título').fill(title);
    await page.getByLabel('Total de páginas').fill('300');
    await page.getByRole('button', { name: /adicionar livro/i }).click();
    await expect(page).toHaveURL(/\/app\/livros$/);
    await page.locator('.book-row').last().getByRole('link', { name: 'Registrar leitura', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/ler\?bookId=/);
    const bookId = new URL(page.url()).searchParams.get('bookId');
    expect(bookId).toBeTruthy();
    expect(bookId).not.toBe('hobbit');
    await expect(page.getByLabel('Livro', { exact: true })).toHaveValue(bookId!);
    await expect(page.locator('#reading-book option:checked')).toHaveText(title);
    await page.reload();
    await expect(page.getByLabel('Livro', { exact: true })).toHaveValue(bookId!);
    await expect(page.locator('#reading-book option:checked')).toHaveText(title);
    await page.getByLabel('Minutos').fill('10');
    await page.getByRole('button', { name: /^registrar leitura/i }).click();
    await expect(page.getByRole('heading', { name: /leitura registrada/i })).toBeVisible();
    expect(mockApi.sessions).toHaveLength(1);
    expect(mockApi.sessions[0].bookId).toBe(bookId);
  });

  test('histórico antigo, segunda página e edição por link direto após reload', async ({ page, mockApi }) => {
    mockApi.sessions = Array.from({ length: 101 }, (_, index) => ({ id: `old-${index}`, userId: 'demo-user', bookId: 'hobbit', readingDate: '2025-01-01', pages: 1, minutes: 1 }));
    await signIn(page);
    await page.getByRole('link', { name: 'Ver progresso', exact: false }).click();
    await expect(page.locator('.session-row')).toHaveCount(100);
    await page.getByRole('button', { name: 'Carregar mais registros' }).click();
    await expect(page.locator('.session-row')).toHaveCount(101);
    await page.getByRole('link', { name: /Editar leitura de/ }).last().click();
    await expect(page).toHaveURL(/\/app\/sessoes\/old-100\/editar$/);
    await expect(page.getByLabel('Data', { exact: true })).toHaveValue('2025-01-01');
    await page.reload();
    await expect(page.getByLabel('Data', { exact: true })).toHaveValue('2025-01-01');
    await page.getByLabel('Páginas', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Salvar registro' }).click();
    await expect(page).toHaveURL(/\/app\/progresso$/);
  });

  test('todos os períodos, streak independente e PNG 1080x1920 local', async ({ page, mockApi }) => {
    mockApi.sessions = ['2026-09-06', '2026-09-05', '2026-08-25', '2025-01-01'].map((readingDate, index) => ({ id: `s-${index}`, userId: 'demo-user', bookId: 'hobbit', readingDate, pages: 10, minutes: 5 }));
    await signIn(page);
    await page.getByRole('link', { name: 'Ver progresso', exact: false }).click();
    for (const [label, pages] of [['Hoje', '10'], ['7 dias', '20'], ['30 dias', '30'], ['Tudo', '40']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator('.metric-card').first().locator('strong')).toHaveText(pages);
      await expect(page.locator('.hero-stat strong')).toContainText('2');
    }
    await page.getByRole('link', { name: 'Criar card', exact: false }).click();
    await expect(page).toHaveURL(/\/app\/cards$/);
    for (const [label, pages] of [['Hoje', '10'], ['7 dias', '20'], ['30 dias', '30'], ['Tudo', '40']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator('.preview-metrics span').nth(1).locator('b')).toHaveText(pages);
      await expect(page.locator('.preview-metrics span').first().locator('b')).toHaveText('2');
    }
    await expect(page.locator('.card-preview')).toContainText('Minha jornada de leitura');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Salvar PNG' }).click();
    const download = await downloadEvent;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk);
    const png = Buffer.concat(chunks);
    expect(png.subarray(1,4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1920);
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.locator('.card-preview')).toHaveClass(/dark/);
    const darkDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Salvar PNG' }).click();
    const darkStream = await (await darkDownload).createReadStream();
    const darkChunks: Buffer[] = []; for await (const chunk of darkStream!) darkChunks.push(chunk);
    const darkPng = Buffer.concat(darkChunks);
    expect(darkPng.readUInt32BE(16)).toBe(1080);
    expect(darkPng.readUInt32BE(20)).toBe(1920);
    expect(darkPng.equals(png)).toBe(false);
  });

  test('foto privada, crop atualizado, Web Share simulado e fallback download', async ({ page, mockApi }) => {
    void mockApi;
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', { value: async (data: ShareData) => { document.documentElement.dataset['shared'] = data.files?.[0]?.type ?? ''; }, configurable: true });
    });
    await signIn(page);
    await page.getByRole('link', { name: /criar um card com/i }).click();
    const photo = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0,0,200,200); ctx.fillStyle = '#f00'; ctx.fillRect(200,0,200,200);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const uploads: string[] = [];
    page.on('request', (request) => { if (request.method() !== 'GET' && /image|multipart|photo/i.test(request.headers()['content-type'] ?? '')) uploads.push(request.url()); });
    await page.getByLabel('Foto de fundo', { exact: false }).setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(photo,'base64') });
    await expect(page.locator('.card-preview')).toHaveClass(/photo/);
    const firstDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Salvar PNG' }).click();
    const first = await (await firstDownload).createReadStream(); const firstChunks: Buffer[] = []; for await (const c of first!) firstChunks.push(c);
    const photoPng = Buffer.concat(firstChunks);
    expect(photoPng.readUInt32BE(16)).toBe(1080);
    expect(photoPng.readUInt32BE(20)).toBe(1920);
    await page.getByLabel('Enquadramento horizontal').fill('1');
    await expect(page.locator('.card-preview')).toHaveCSS('background-position', '100% 50%');
    const secondDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Salvar PNG' }).click();
    const second = await (await secondDownload).createReadStream(); const secondChunks: Buffer[] = []; for await (const c of second!) secondChunks.push(c);
    expect(Buffer.concat(firstChunks).equals(Buffer.concat(secondChunks))).toBe(false);
    await page.getByLabel('Overlay', { exact: true }).fill('0.85');
    await expect(page.locator('.preview-overlay')).toHaveCSS('opacity', '0.85');
    const overlayDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Salvar PNG' }).click();
    const overlayStream = await (await overlayDownload).createReadStream();
    const overlayChunks: Buffer[] = []; for await (const chunk of overlayStream!) overlayChunks.push(chunk);
    expect(Buffer.concat(overlayChunks).equals(Buffer.concat(secondChunks))).toBe(false);
    await page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-shared', 'image/png');
    await page.evaluate(() => Object.defineProperty(navigator, 'canShare', { value: () => false }));
    const fallback = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Compartilhar', exact: true }).click();
    expect((await fallback).suggestedFilename()).toBe('folhea-card.png');
    expect(uploads).toEqual([]);
  });

  test('leitura salva mantém confirmação se o resumo semanal falha e permite nova tentativa', async ({ page, mockApi }) => {
    let unavailable = false;
    await page.route('**/api/v1/dashboard', route => unavailable
      ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Resumo indisponível.' }) })
      : route.fallback());
    await signIn(page);
    await page.getByRole('link', { name: /registrar leitura/i }).click();
    await page.getByLabel('Páginas').fill('12');
    await page.getByLabel('Minutos').fill('8');
    unavailable = true;
    await page.getByRole('button', { name: /^registrar leitura/i }).click();
    await expect(page.getByRole('heading', { name: /leitura registrada/i })).toBeVisible();
    await expect(page.locator('.weekly').getByRole('alert')).toContainText('Seu registro foi salvo');
    await expect(page.locator('.weekly')).not.toContainText('0 páginas');
    await expect(page.locator('.weekly')).not.toContainText('0min');
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(page.locator('.weekly').getByRole('alert')).toContainText('Seu registro foi salvo');
    await expect(page.locator('.recap div').last().locator('strong')).not.toHaveText('0');
    expect(mockApi.sessions).toHaveLength(1);
    unavailable = false;
    await page.locator('.weekly').getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.locator('.weekly')).toContainText('12 páginas');
    await expect(page.locator('.weekly')).toContainText('8min');
    await expect(page.locator('.recap div').last().locator('strong')).toHaveText('1');
    expect(mockApi.sessions).toHaveLength(1);
  });

  test('leitura salva, falha de resumo, Fechar e Concluir não restauram métricas antigas na Home', async ({ page, mockApi }) => {
    let unavailable = false;
    let posts = 0;
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/sessions') posts++; });
    await page.route('**/api/v1/dashboard', route => unavailable
      ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Resumo indisponível.' }) })
      : route.fallback());
    await signIn(page);
    await page.getByRole('link', { name: /registrar leitura/i }).click();
    await page.getByLabel('Páginas').fill('12');
    await page.getByLabel('Minutos').fill('8');
    unavailable = true;
    await page.getByRole('button', { name: /^registrar leitura/i }).click();
    await expect(page.getByRole('heading', { name: /leitura registrada/i })).toBeVisible();
    await expect(page.locator('.weekly').getByRole('alert')).toContainText('Seu registro foi salvo');
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('link', { name: 'Concluir', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/inicio$/);
    await expect(page.locator('.stats-grid')).toHaveCount(0);
    await expect(page.locator('.streak-card')).toHaveCount(0);
    await expect(page.locator('.unavailable')).toContainText('Seu resumo está indisponível');
    unavailable = false;
    await page.locator('.unavailable').getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.locator('.stat-card').first().locator('strong')).toHaveText('12');
    await expect(page.locator('.stat-card').nth(1).locator('strong')).toHaveText('8min');
    await expect(page.locator('.streak-card strong')).toContainText('1');
    expect(mockApi.sessions).toHaveLength(1);
    expect(posts).toBe(1);
  });

  test('sessão em cache carrega livro fora da primeira página e permite retry do livro', async ({ page, mockApi }) => {
    const original = mockApi.books[0];
    mockApi.books = [original, ...Array.from({ length: 100 }, (_, index) => ({ ...original, id: `book-${index}`, title: `Livro ${index}` }))];
    const older = mockApi.books[100];
    mockApi.sessions = [{ id: 'cached', userId: 'demo-user', bookId: older.id, readingDate: TODAY, pages: 4, minutes: 3 }];
    let unavailable = true;
    await page.route(`**/api/v1/books/${older.id}`, route => unavailable
      ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Livro indisponível.' }) })
      : route.fallback());
    await signIn(page);
    await page.getByRole('link', { name: 'Ver progresso', exact: false }).click();
    await expect(page.locator('.session-row')).toHaveCount(1);
    await page.getByRole('link', { name: /Editar leitura de/ }).click();
    await expect(page.getByRole('heading', { name: 'Editar leitura' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Livro indisponível.' })).toBeVisible();
    unavailable = false;
    await page.getByRole('alert').filter({ hasText: 'Livro indisponível.' }).getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByLabel('Livro', { exact: true })).toHaveValue(older.id);
    await expect(page.locator('#edit-book option:checked')).toHaveText(older.title);
    await page.getByLabel('Páginas', { exact: true }).fill('5');
    await page.getByRole('button', { name: 'Salvar registro' }).click();
    await expect(page).toHaveURL(/\/app\/progresso$/);
    expect(mockApi.sessions[0].pages).toBe(5);
  });

  test('falha de rede mantém o formulário e informa que a leitura não foi salva', async ({ page, mockApi }) => {
    let summaryUnavailable = true;
    await page.route('**/api/v1/dashboard', (route) => summaryUnavailable
      ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Resumo indisponível.' }) })
      : route.fallback());
    await signIn(page);
    await expect(page.locator('.unavailable')).toContainText('Seu resumo está indisponível');
    await expect(page.locator('.stats-grid')).toHaveCount(0);
    summaryUnavailable = false;
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await expect(page.locator('.stat-card')).toHaveCount(3);
    await page.getByRole('link', { name: 'Registrar leitura', exact: false }).first().click();
    await page.getByLabel('Páginas').fill('10');
    await page.route('**/api/v1/sessions', (route) => route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback());
    await page.context().setOffline(true);
    await page.getByRole('button', { name: /^registrar leitura/i }).click();
    await expect(page.getByText('Você está sem conexão.', { exact: false })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Sem conexão' })).toBeVisible();
    await expect(page.getByLabel('Páginas')).toHaveValue('10');
    await expect(page.getByRole('button', { name: /^registrar leitura/i })).toBeEnabled();
    expect(mockApi.sessions).toHaveLength(0);
    await page.context().setOffline(false);
  });
  test('timezone, data futura e erro de exclusão preservando conta', async ({ page, mockApi }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Configurações', exact: true }).click();
    await page.getByLabel('Escolher fuso horário').selectOption('Pacific/Auckland');
    await page.getByRole('button', { name: 'Salvar fuso horário' }).click();
    await expect(page.getByRole('status')).toContainText('Fuso horário atualizado');
    expect(mockApi.timezone).toBe('Pacific/Auckland');
    await page.getByRole('link', { name: 'Início', exact: true }).click();
    await expect(page.locator('.date-label')).toContainText('07');
    await page.getByRole('link', { name: 'Registrar', exact: true }).click();
    await expect(page.getByLabel('Data', { exact: false })).toHaveValue('2026-09-07');
    await page.getByLabel('Páginas').fill('10');
    await page.getByLabel('Data', { exact: false }).fill('2026-09-08');
    await page.getByRole('button', { name: /^registrar leitura/i }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Informe uma data válida até hoje' })).toBeVisible();
    expect(mockApi.sessions).toHaveLength(0);
    await page.getByRole('link', { name: 'Configurações', exact: true }).click();
    await page.route('**/api/v1/me', (route) => route.request().method() === 'DELETE'
      ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: 'Não foi possível concluir a exclusão.' }) })
      : route.fallback());
    await page.getByRole('button', { name: 'Excluir minha conta', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Excluir conta', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('A exclusão não foi confirmada');
    await expect(dialog.getByRole('button', { name: 'Excluir conta', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/app\/configuracoes$/);
  });

  test('exclusão confirmada volta à Home sem iniciar outro login', async ({ page, mockApi }) => {
    let deleted = false;
    let logoutRequests = 0;
    await page.route('**/api/v1/me', async route => {
      if (route.request().method() === 'DELETE') {
        deleted = true;
        mockApi.books = [];
        mockApi.sessions = [];
        await route.fulfill({ status: 204 });
      } else if (deleted) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      } else {
        await route.fallback();
      }
    });
    // The authenticated BFF logout route challenges an already deleted session.
    await page.route('**/auth/logout', route => {
      logoutRequests++;
      return route.fulfill({ status: 302, headers: { location: '/entrar' } });
    });
    await signIn(page);
    await page.getByRole('link', { name: 'Configurações', exact: true }).click();
    await page.getByRole('button', { name: 'Excluir minha conta', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox').check();
    const deletion = page.waitForResponse(response => response.url().endsWith('/api/v1/me') && response.request().method() === 'DELETE');
    await dialog.getByRole('button', { name: 'Excluir conta', exact: true }).click();
    expect((await deletion).status()).toBe(204);
    await expect(page).toHaveURL('http://127.0.0.1:4202/');
    await expect(page.getByRole('heading', { name: 'Cada página conta.' })).toBeVisible();
    expect(logoutRequests).toBe(0);
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('Sair da conta mantém o redirecionamento OIDC normal', async ({ page, mockApi }) => {
    void mockApi;
    let signedOut = false;
    let logoutRequests = 0;
    await page.route('**/api/v1/me', route => signedOut
      ? route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
      : route.fallback());
    await page.route('**/auth/logout', route => {
      logoutRequests++;
      signedOut = true;
      return route.fulfill({ status: 302, headers: { location: '/' } });
    });
    await signIn(page);
    await page.getByRole('link', { name: 'Configurações', exact: true }).click();
    await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:4202/');
    await expect(page.getByRole('heading', { name: 'Cada página conta.' })).toBeVisible();
    expect(logoutRequests).toBe(1);
  });

});

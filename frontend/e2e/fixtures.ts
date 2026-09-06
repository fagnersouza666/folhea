import { test as base, expect, type Page, type Route } from '@playwright/test';

type Book = {
  id: string;
  userId: string;
  title: string;
  author?: string;
  status: 'READING' | 'FINISHED';
  finishedOn?: string;
  createdAt: string;
  updatedAt: string;
};

type Session = {
  id: string;
  userId: string;
  bookId: string;
  readingDate: string;
  pages: number;
  minutes: number;
};

type MockState = { books: Book[]; sessions: Session[] };

const now = '2026-09-06T00:00:00.000Z';

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function responseBook(state: MockState, body: Partial<Book> & Pick<Book, 'title'>): Book {
  const book: Book = {
    id: body.id ?? `book-${state.books.length + 1}`,
    userId: 'demo-user',
    title: body.title,
    author: body.author,
    status: body.status ?? 'READING',
    finishedOn: body.finishedOn,
    createdAt: body.createdAt ?? now,
    updatedAt: body.updatedAt ?? now
  };
  state.books.push(book);
  return book;
}

async function handleApi(route: Route, state: MockState): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();

  if (method === 'GET' && path === '/api/v1/me') {
    return json(route, 200, { id: 'demo-user', email: 'reader@example.com', timezone: 'America/Sao_Paulo' });
  }
  if (method === 'GET' && path === '/api/v1/csrf') return json(route, 200, { token: 'e2e-csrf-token' });
  if (method === 'GET' && path === '/api/v1/dashboard') {
    const current = state.books.find((book) => book.status === 'READING');
    return json(route, 200, {
      currentStreakDays: state.sessions.length ? 3 : 0,
      currentBook: current ? { id: current.id, title: current.title } : null,
      week: {
        pages: state.sessions.reduce((sum, session) => sum + session.pages, 0),
        minutes: state.sessions.reduce((sum, session) => sum + session.minutes, 0),
        booksFinished: state.books.filter((book) => book.status === 'FINISHED').length
      }
    });
  }
  if (method === 'GET' && path === '/api/v1/books') return json(route, 200, state.books);
  if (method === 'GET' && path === '/api/v1/sessions') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = Number(url.searchParams.get('limit') ?? state.sessions.length);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const filtered = state.sessions.filter((session) => {
      if (from && session.readingDate < from) return false;
      if (to && session.readingDate > to) return false;
      return true;
    });
    return json(route, 200, filtered.slice(offset, offset + limit));
  }
  if (method === 'GET' && path === '/api/v1/stats') {
    return json(route, 200, {
      period: { from: '2026-08-31', to: '2026-09-06' },
      currentStreakDays: state.sessions.length ? 3 : 0,
      pages: state.sessions.reduce((sum, session) => sum + session.pages, 0),
      minutes: state.sessions.reduce((sum, session) => sum + session.minutes, 0),
      booksFinished: state.books.filter((book) => book.status === 'FINISHED').length
    });
  }

  const bookMatch = path.match(/^\/api\/v1\/books\/([^/]+)(\/finish)?$/);
  if (bookMatch) {
    const book = state.books.find((item) => item.id === bookMatch[1]);
    if (!book) return json(route, 404, { title: 'Livro não encontrado', status: 404 });
    if (method === 'PATCH' && !bookMatch[2]) {
      Object.assign(book, JSON.parse(request.postData() ?? '{}'), { updatedAt: now });
      return json(route, 200, book);
    }
    if (method === 'DELETE' && !bookMatch[2]) {
      state.books = state.books.filter((item) => item.id !== book.id);
      return route.fulfill({ status: 204 });
    }
    if (method === 'POST' && bookMatch[2]) {
      book.status = 'FINISHED';
      book.finishedOn = JSON.parse(request.postData() ?? '{}').finishedOn ?? '2026-09-06';
      return json(route, 200, book);
    }
    if (method === 'DELETE' && bookMatch[2]) {
      book.status = 'READING';
      delete book.finishedOn;
      return json(route, 200, book);
    }
  }

  if (method === 'POST' && path === '/api/v1/books') {
    const body = JSON.parse(request.postData() ?? '{}') as Pick<Book, 'title' | 'author'>;
    return json(route, 201, responseBook(state, body));
  }

  const sessionMatch = path.match(/^\/api\/v1\/sessions\/([^/]+)$/);
  if (sessionMatch) {
    const session = state.sessions.find((item) => item.id === sessionMatch[1]);
    if (!session) return json(route, 404, { title: 'Sessão não encontrada', status: 404 });
    if (method === 'PATCH') {
      Object.assign(session, JSON.parse(request.postData() ?? '{}'));
      return json(route, 200, session);
    }
    if (method === 'DELETE') {
      state.sessions = state.sessions.filter((item) => item.id !== session.id);
      return route.fulfill({ status: 204 });
    }
  }

  if (method === 'POST' && path === '/api/v1/sessions') {
    const body = JSON.parse(request.postData() ?? '{}') as Omit<Session, 'id' | 'userId'>;
    const session = { ...body, id: `session-${state.sessions.length + 1}`, userId: 'demo-user' };
    state.sessions.push(session);
    return json(route, 201, session);
  }

  if (method === 'POST' && path === '/api/v1/cards') return json(route, 201, { id: 'card-1', createdAt: now });
  if (path === '/api/v1/cards/card-1/share' && method === 'POST') return json(route, 200, { shared: true });
  if (path === '/api/v1/cards/card-1/download' && method === 'GET') return json(route, 200, { downloaded: true });

  return json(route, 404, { title: 'Not found', status: 404 });
}

export const test = base.extend<{ mockApi: MockState }>({
  mockApi: async ({ page }, use) => {
    const state: MockState = {
      books: [responseBook({ books: [], sessions: [] }, { id: 'hobbit', title: 'O Hobbit', author: 'J. R. R. Tolkien' })],
      sessions: []
    };
    await page.route('**/api/v1/**', (route) => handleApi(route, state));
    await use(state);
    await page.unroute('**/api/v1/**');
  }
});

export async function signIn(page: Page): Promise<void> {
  await page.route('**/auth/login', (route) => route.fulfill({ status: 302, headers: { location: '/app/inicio' } }));
  await page.goto('/');
  await page.getByRole('link', { name: /começar agora/i }).click();
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/app\/inicio$/);
  await expect(page.getByText('Olá, leitor.')).toBeVisible();
}

export { expect };

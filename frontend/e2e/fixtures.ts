import { addDays, currentStreak, periodStats } from '../src/app/core/state/reading-statistics';
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

type MockState = { books: Book[]; sessions: Session[]; timezone?: string };

export const TODAY = '2026-09-06';
const now = '2026-09-06T15:00:00.000Z';

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
    return json(route, 200, { id: 'demo-user', email: 'reader@example.com', timezone: state.timezone ?? 'America/Sao_Paulo' });
  }
  if (method === 'PATCH' && path === '/api/v1/me') { state.timezone = JSON.parse(request.postData() ?? '{}').timezone; return json(route, 200, { id: 'demo-user', email: 'reader@example.com', timezone: state.timezone }); }
  if (method === 'GET' && path === '/api/v1/csrf') return json(route, 200, { token: 'e2e-csrf-token' });
  if (method === 'POST' && path === '/api/v1/analytics/events') return route.fulfill({ status: 202 });
  if (method === 'POST' && path === '/api/v1/registration') return json(route, 201, { id: 'created-user', email: 'new@example.test' });
  if (method === 'GET' && path === '/api/v1/dashboard') {
    const current = state.books.find((book) => book.status === 'READING');
    return json(route, 200, {
      currentStreakDays: currentStreak(state.sessions, TODAY),
      currentBook: current ? { id: current.id, title: current.title } : null,
      week: periodStats(state.sessions, state.books, addDays(TODAY, -6), TODAY, 0)
    });
  }
  if (method === 'GET' && path === '/api/v1/books') {
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return json(route, 200, state.books.slice(offset, offset + limit));
  }
  if (method === 'GET' && path === '/api/v1/sessions') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const filtered = state.sessions.filter((session) => (!from || session.readingDate >= from) && (!to || session.readingDate <= to));
    return json(route, 200, filtered.sort((a,b) => b.readingDate.localeCompare(a.readingDate)).slice(offset, offset + limit));
  }
  if (method === 'GET' && path === '/api/v1/stats') {
    const from = url.searchParams.get('period') === 'all' ? '2000-01-01' : url.searchParams.get('from') ?? TODAY;
    const to = url.searchParams.get('to') ?? TODAY;
    return json(route, 200, periodStats(state.sessions, state.books, from, to, currentStreak(state.sessions, TODAY)));
  }

  const bookMatch = path.match(/^\/api\/v1\/books\/([^/]+)(\/finish)?$/);
  if (bookMatch) {
    const book = state.books.find((item) => item.id === bookMatch[1]);
    if (!book) return json(route, 404, { title: 'Livro não encontrado', status: 404 });
    if (method === 'GET' && !bookMatch[2]) return json(route, 200, book);
    if (method === 'PATCH' && !bookMatch[2]) {
      Object.assign(book, JSON.parse(request.postData() ?? '{}'), { updatedAt: now });
      return json(route, 200, book);
    }
    if (method === 'DELETE' && !bookMatch[2]) {
      state.books = state.books.filter((item) => item.id !== book.id);
      state.sessions = state.sessions.filter((item) => item.bookId !== book.id);
      return route.fulfill({ status: 204 });
    }
    if (method === 'POST' && bookMatch[2]) {
      if (book.status === 'FINISHED') return json(route, 200, book);
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
    if (method === 'GET') return json(route, 200, session);
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
    state.sessions.unshift(session);
    return json(route, 201, session);
  }

  return json(route, 404, { title: 'Not found', status: 404 });
}

export const test = base.extend<{ mockApi: MockState }>({
  mockApi: async ({ page }, use) => {
    const state: MockState = {
      books: [responseBook({ books: [], sessions: [] }, { id: 'hobbit', title: 'O Hobbit', author: 'J. R. R. Tolkien' })],
      sessions: []
    };
    await page.clock.setFixedTime(new Date(now));
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

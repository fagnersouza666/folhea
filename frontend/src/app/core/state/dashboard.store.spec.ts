import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { Book, BookStats, ReadingSession } from '../models/models';
import { DashboardStore } from './dashboard.store';

const BOOK_ID = '550e8400-e29b-41d4-a716-446655440000';

const readingBook: Book = {
  id: BOOK_ID,
  title: 'Livro atual',
  status: 'READING',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z'
};

const readingSession: ReadingSession = {
  id: '660e8400-e29b-41d4-a716-446655440001',
  bookId: BOOK_ID,
  readingDate: '2026-09-06',
  pages: 12,
  minutes: 25,
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z'
};

const officialBookStats: BookStats = {
  pagesRead: 500, totalPages: 1000, percent: 50, averagePagesPerDay: 25,
  firstDate: '2026-08-18', referenceDate: '2026-09-06', elapsedDays: 20
};

function flushServerError(httpMock: HttpTestingController, url: string): void {
  httpMock.expectOne(url).flush('error', { status: 500, statusText: 'Server Error' });
}

describe('DashboardStore', () => {
  let store: DashboardStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            user: signal({ id: 'user-1', email: 'reader@example.test', timezone: 'America/Sao_Paulo' })
          }
        }
      ]
    });
    store = TestBed.inject(DashboardStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try { httpMock.verify(); } finally { TestBed.resetTestingModule(); }
  });

  function expectSessionsRequest(sessions: ReadingSession[] = []) {
    const request = httpMock.expectOne((req) => req.url === '/api/v1/sessions' && !req.params.has('from') && !req.params.has('to'));
    expect(request.request.params.get('limit')).toBe('100');
    expect(request.request.params.get('offset')).toBe('0');
    request.flush(sessions);
    return request;
  }

  function seedBooks(books: Book[]): void {
    store.loadBooks();
    httpMock.expectOne('/api/v1/books?limit=100&offset=0').flush(books);
  }

  function seedSessions(sessions: ReadingSession[]): void {
    store.loadSessions();
    expectSessionsRequest(sessions);
  }

  it('excludes optimistic books from selectableBooks', () => {
    store.addBook('Livro local').subscribe();
    expect(store.selectableBooks().length).toBe(0);
    const create = httpMock.expectOne('/api/v1/books');
    create.flush({
      id: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Livro local',
      status: 'READING',
      createdAt: '2026-09-06T00:00:00.000Z',
      updatedAt: '2026-09-06T00:00:00.000Z'
    });
    httpMock.expectNone('/api/v1/analytics/events');
    expect(store.selectableBooks().length).toBe(1);
    httpMock.expectOne('/api/v1/books?limit=100&offset=0').flush(store.books());
  });

  it('allows dashboard retry after a failed load', () => {
    const statsResponse = {
      period: { from: '2026-01-01', to: '2026-01-01' },
      currentStreakDays: 0,
      pages: 0,
      minutes: 0,
      booksFinished: 0
    };

    store.load();
    httpMock.expectOne('/api/v1/dashboard').flush({
      currentStreakDays: 0,
      currentBook: null,
      week: { pages: 0, minutes: 0, booksFinished: 0 }
    });
    httpMock.expectOne('/api/v1/books?limit=100&offset=0').flush([]);
    expectSessionsRequest();
    httpMock.match((request) => request.url.startsWith('/api/v1/stats')).forEach((request) => request.flush(statsResponse));

    store.reload();
    httpMock.expectOne('/api/v1/dashboard').flush('error', { status: 500, statusText: 'Server Error' });
    httpMock.expectOne('/api/v1/books?limit=100&offset=0').flush([]);
    expectSessionsRequest();
    httpMock.match((request) => request.url.startsWith('/api/v1/stats')).forEach((request) => request.flush(statsResponse));

    store.load();
    httpMock.expectOne('/api/v1/dashboard').flush({
      currentStreakDays: 1,
      currentBook: null,
      week: { pages: 1, minutes: 1, booksFinished: 0 }
    });
    httpMock.expectOne('/api/v1/books?limit=100&offset=0').flush([]);
    expectSessionsRequest();
    httpMock.match((request) => request.url.startsWith('/api/v1/stats')).forEach((request) => request.flush(statsResponse));
  });

  it('loads all-time stats from the backend period endpoint', () => {
    store.loadStats('all');
    const request = httpMock.expectOne('/api/v1/stats?period=all');
    request.flush({
      period: { from: '2024-01-01', to: '2026-09-06' },
      currentStreakDays: 5,
      pages: 42,
      minutes: 30,
      booksFinished: 2
    });
    expect(store.stats()?.pages).toBe(42);
    expect(store.stats()?.currentStreakDays).toBe(5);
  });

  it('rolls back addBook and surfaces the mutation error when create fails', () => {
    store.addBook('Livro falho').subscribe({ error: () => undefined });
    expect(store.books().some((book) => book.id.startsWith('local-book-') && book.title === 'Livro falho')).toBe(true);

    flushServerError(httpMock, '/api/v1/books');

    expect(store.books()).toEqual([]);
    expect(store.error()).toBe('Não foi possível cadastrar o livro.');
  });

  it('rolls back finishBook and surfaces the mutation error when finish fails', () => {
    seedBooks([readingBook]);
    const previousBooks = structuredClone(store.books());

    store.finishBook(BOOK_ID).subscribe({ error: () => undefined });
    expect(store.books()[0]?.status).toBe('READING');

    flushServerError(httpMock, `/api/v1/books/${BOOK_ID}/finish`);

    expect(store.books()).toEqual(previousBooks);
    expect(store.error()).toBe('Não foi possível finalizar o livro.');
  });

  it('rolls back deleteBook books and sessions and surfaces the mutation error when delete fails', () => {
    seedBooks([readingBook]);
    seedSessions([readingSession]);
    const previousBooks = structuredClone(store.books());
    const previousSessions = structuredClone(store.sessions());

    store.deleteBook(BOOK_ID).subscribe({ error: () => undefined });
    expect(store.books()).toEqual([]);
    expect(store.sessions()).toEqual([]);

    flushServerError(httpMock, `/api/v1/books/${BOOK_ID}`);

    expect(store.books()).toEqual(previousBooks);
    expect(store.sessions()).toEqual(previousSessions);
    expect(store.error()).toBe('Não foi possível excluir o livro.');
  });

  it('rolls back addSession and surfaces the mutation error when create fails', () => {
    seedBooks([readingBook]);
    const previousSessions = structuredClone(store.sessions());
    const draft = { bookId: BOOK_ID, readingDate: '2026-09-06', pages: 8, minutes: 15 };

    store.addSession(draft).subscribe({ error: () => undefined });
    expect(store.sessions().some((session) => session.id.startsWith('local-session-'))).toBe(true);

    flushServerError(httpMock, '/api/v1/sessions');

    expect(store.sessions()).toEqual(previousSessions);
    expect(store.error()).toBe('Não foi possível registrar a leitura.');
  });
  it('keeps authoritative week/streak when only the first historical page is loaded', () => {
    store.loadDashboard();
    const official = { currentStreakDays: 150, currentBook: null, week: { pages: 999, minutes: 555, booksFinished: 8 } };
    httpMock.expectOne('/api/v1/dashboard').flush(official);
    seedSessions(Array.from({ length: 100 }, (_, i) => ({ ...readingSession, id: `session-${i}`, pages: 1 })));
    expect(store.dashboard()).toEqual(official);
    expect(store.sessionsHasMore()).toBe(true);
    store.loadMoreSessions();
    const next = httpMock.expectOne('/api/v1/sessions?limit=100&offset=100');
    next.flush([{ ...readingSession, id: 'older', readingDate: '2020-01-01' }]);
    expect(store.sessions()).toHaveLength(101);
    expect(store.sessionsHasMore()).toBe(false);
    expect(store.dashboard()).toEqual(official);
  });

  it('ignores obsolete statistics responses after rapidly changing periods', () => {
    store.loadStats('30');
    const older = httpMock.expectOne((req) => req.url === '/api/v1/stats');
    store.loadStats('today');
    const latest = httpMock.expectOne((req) => req.url === '/api/v1/stats');
    const stats = { period: { from: store.today(), to: store.today() }, pages: 8, minutes: 4, booksFinished: 0, currentStreakDays: 42 };
    latest.flush(stats);
    older.flush({ ...stats, pages: 1000 });
    expect(store.stats()).toEqual(stats);
    expect(store.period()).toBe('today');
  });

  it('never presents an incomplete all-time total after a statistics failure', () => {
    seedSessions([readingSession]);
    store.loadStats('all');
    flushServerError(httpMock, '/api/v1/stats?period=all');
    expect(store.stats()).toBeNull();
    expect(store.statsError()).toContain('Não foi possível');
    store.clearError();
    expect(store.statsError()).toContain('Não foi possível');
  });

  it('refreshes metrics only after the session has been persisted', () => {
    store.addSession({ bookId: BOOK_ID, readingDate: store.today(), pages: 12, minutes: 25 }).subscribe();
    httpMock.expectNone('/api/v1/dashboard');
    httpMock.expectNone((req) => req.url === '/api/v1/stats');
    httpMock.expectOne('/api/v1/sessions').flush(readingSession);
    httpMock.expectOne(`/api/v1/books/${BOOK_ID}`).flush({ ...readingBook, stats: officialBookStats });
    httpMock.expectOne('/api/v1/dashboard').flush({ currentStreakDays: 101, currentBook: null, week: { pages: 500, minutes: 200, booksFinished: 2 } });
    httpMock.expectOne((req) => req.url === '/api/v1/stats').flush({ currentStreakDays: 101, period: { from: store.today(), to: store.today() }, pages: 500, minutes: 200, booksFinished: 2 });
    expectSessionsRequest([readingSession]);
    httpMock.expectNone('/api/v1/analytics/events');
    expect(store.stats()?.currentStreakDays).toBe(101);
    expect(store.dashboard()?.week.pages).toBe(500);
  });

  it('keeps a direct session detail available while a concurrent first page loads', () => {
    store.loadSessions();
    store.loadSession('old');
    httpMock.expectOne('/api/v1/sessions/old').flush({ ...readingSession, id: 'old' });
    httpMock.expectOne(`/api/v1/books/${BOOK_ID}`).flush(readingBook);
    expectSessionsRequest([]);
    expect(store.getSession('old')?.bookId).toBe(BOOK_ID);
    expect(store.getBook(BOOK_ID)?.title).toBe(readingBook.title);
  });

  it('keeps the latest books and sessions page when older requests arrive late', () => {
    store.loadBooks();
    const oldBooks = httpMock.expectOne('/api/v1/books?limit=100&offset=0');
    store.loadBooks();
    const newBooks = httpMock.expectOne('/api/v1/books?limit=100&offset=0');
    newBooks.flush([readingBook]);
    oldBooks.flush([]);
    expect(store.books()).toEqual([readingBook]);
    store.loadSessions();
    const oldSessions = httpMock.expectOne('/api/v1/sessions?limit=100&offset=0');
    store.loadSessions();
    const newSessions = httpMock.expectOne('/api/v1/sessions?limit=100&offset=0');
    newSessions.flush([readingSession]);
    oldSessions.flush([]);
    expect(store.sessions()).toEqual([readingSession]);
    expect(store.booksLoading()).toBe(false);
    expect(store.sessionsLoading()).toBe(false);
  });

  it('loads the current book even when it is outside the first books page', () => {
    store.loadBooks();
    store.loadDashboard();
    httpMock.expectOne('/api/v1/dashboard').flush({ currentStreakDays: 1, currentBook: { id: BOOK_ID, title: readingBook.title }, week: { pages: 1, minutes: 1, booksFinished: 0 } });
    httpMock.expectOne(`/api/v1/books/${BOOK_ID}`).flush(readingBook);
    httpMock.expectOne('/api/v1/books?limit=100&offset=0').flush([{ ...readingBook, id: 'other' }]);
    expect(store.getBook(BOOK_ID)).toEqual(readingBook);
    expect(store.selectableBooks().some((book) => book.id === BOOK_ID)).toBe(true);
    expect(store.currentBook()?.id).toBe(BOOK_ID);
  });

  it('loads the associated book of a cached session outside the first 100 books', () => {
    seedBooks(Array.from({ length: 100 }, (_, index) => ({ ...readingBook, id: `other-${index}` })));
    seedSessions([readingSession]);
    store.loadSession(readingSession.id);
    httpMock.expectNone(`/api/v1/sessions/${readingSession.id}`);
    httpMock.expectOne(`/api/v1/books/${BOOK_ID}`).flush(readingBook);
    expect(store.selectableBooks().find((book) => book.id === BOOK_ID)).toEqual(readingBook);
  });

  it('retries the associated book after a direct session has been cached and its book failed', () => {
    store.loadSession(readingSession.id);
    httpMock.expectOne(`/api/v1/sessions/${readingSession.id}`).flush(readingSession);
    flushServerError(httpMock, `/api/v1/books/${BOOK_ID}`);
    expect(store.booksError()).toContain('Não foi possível abrir o livro');
    store.loadSession(readingSession.id);
    httpMock.expectNone(`/api/v1/sessions/${readingSession.id}`);
    httpMock.expectOne(`/api/v1/books/${BOOK_ID}`).flush(readingBook);
    expect(store.booksError()).toBeNull();
    expect(store.selectableBooks().find((book) => book.id === BOOK_ID)).toEqual(readingBook);
  });

  it('keeps complete official book metrics independent of the first 100 sessions', () => {
    seedBooks([{ ...readingBook, totalPages: 1000, stats: officialBookStats }]);
    seedSessions(Array.from({ length: 100 }, (_, index) => ({ ...readingSession, id: `page-${index}`, pages: 1 })));
    expect(store.bookStats?.(BOOK_ID)).toEqual(officialBookStats);
    expect(store.sessionsHasMore()).toBe(true);
  });

  it('hides old book metrics on refresh and keeps their error after dismissing the global alert', () => {
    seedBooks([{ ...readingBook, stats: officialBookStats }]);
    store.loadBookStats?.(BOOK_ID);
    expect(store.bookStats?.(BOOK_ID)).toBeNull();
    expect(store.bookStatsLoading?.(BOOK_ID)).toBe(true);
    flushServerError(httpMock, `/api/v1/books/${BOOK_ID}`);
    expect(store.bookStats?.(BOOK_ID)).toBeNull();
    expect(store.bookStatsError?.(BOOK_ID)).toContain('Não foi possível');
    store.clearError();
    expect(store.bookStatsError?.(BOOK_ID)).toContain('Não foi possível');
    store.loadBookStats?.(BOOK_ID);
    httpMock.expectOne(`/api/v1/books/${BOOK_ID}`).flush({ ...readingBook, stats: { ...officialBookStats, pagesRead: 600, percent: 60, averagePagesPerDay: 30 } });
    expect(store.bookStats?.(BOOK_ID)?.pagesRead).toBe(600);
  });

  it('ignores an older book response after a newer metrics request completes', () => {
    seedBooks([{ ...readingBook, stats: officialBookStats }]);
    store.loadBookStats?.(BOOK_ID);
    const older = httpMock.expectOne(`/api/v1/books/${BOOK_ID}`);
    store.loadBookStats?.(BOOK_ID);
    const latest = httpMock.expectOne(`/api/v1/books/${BOOK_ID}`);
    latest.flush({ ...readingBook, stats: { ...officialBookStats, pagesRead: 700, percent: 70, averagePagesPerDay: 35 } });
    older.flush({ ...readingBook, stats: officialBookStats });
    expect(store.bookStats?.(BOOK_ID)?.pagesRead).toBe(700);
    expect(store.bookStatsLoading?.(BOOK_ID)).toBe(false);
  });

  function flushGlobalRefresh(): void {
    httpMock.expectOne('/api/v1/dashboard').flush({ currentStreakDays: 1, currentBook: null, week: { pages: 512, minutes: 25, booksFinished: 0 } });
    httpMock.expectOne(request => request.url === '/api/v1/stats').flush({ period: { from: store.today(), to: store.today() }, pages: 512, minutes: 25, booksFinished: 0, currentStreakDays: 1 });
    expectSessionsRequest([readingSession]);
    httpMock.expectNone('/api/v1/analytics/events');
  }

  it('refreshes the saved book from the server after POST and keeps the reading if metrics fail', () => {
    seedBooks([{ ...readingBook, stats: officialBookStats }]);
    store.addSession({ bookId: BOOK_ID, readingDate: '2026-09-06', pages: 12, minutes: 25 }).subscribe();
    httpMock.expectNone(`/api/v1/books/${BOOK_ID}`);
    httpMock.expectOne('/api/v1/sessions').flush(readingSession);
    expect(store.bookStats(BOOK_ID)).toBeNull();
    const refresh = httpMock.expectOne(`/api/v1/books/${BOOK_ID}`);
    refresh.flush(null, { status: 503, statusText: 'Unavailable' });
    flushGlobalRefresh();
    store.clearError();
    expect(store.getSession(readingSession.id)).toEqual(readingSession);
    expect(store.bookStatsError(BOOK_ID)).toContain('Não foi possível');
    store.loadBookStats(BOOK_ID);
    httpMock.expectOne(`/api/v1/books/${BOOK_ID}`).flush({ ...readingBook, stats: { ...officialBookStats, pagesRead: 512 } });
    expect(store.bookStats(BOOK_ID)?.pagesRead).toBe(512);
    httpMock.expectNone(request => request.method === 'POST');
  });

  it('refreshes both original and destination books when a reading moves between books', () => {
    const destination = 'other-book';
    seedBooks([{ ...readingBook, stats: officialBookStats }, { ...readingBook, id: destination, stats: officialBookStats }]);
    seedSessions([readingSession]);
    store.updateSession(readingSession.id, { bookId: destination, pages: 20 }).subscribe();
    httpMock.expectOne(`/api/v1/sessions/${readingSession.id}`).flush({ ...readingSession, bookId: destination, pages: 20 });
    expect(store.bookStats(BOOK_ID)).toBeNull(); expect(store.bookStats(destination)).toBeNull();
    httpMock.expectOne(`/api/v1/books/${BOOK_ID}`).flush({ ...readingBook, stats: { ...officialBookStats, pagesRead: 488 } });
    httpMock.expectOne(`/api/v1/books/${destination}`).flush({ ...readingBook, id: destination, stats: { ...officialBookStats, pagesRead: 520 } });
    flushGlobalRefresh();
    expect(store.bookStats(BOOK_ID)?.pagesRead).toBe(488);
    expect(store.bookStats(destination)?.pagesRead).toBe(520);
  });

  it('refreshes official book metrics after deleting a reading', () => {
    seedBooks([{ ...readingBook, stats: officialBookStats }]); seedSessions([readingSession]);
    store.deleteSession(readingSession.id).subscribe();
    httpMock.expectOne(`/api/v1/sessions/${readingSession.id}`).flush(null, { status: 204, statusText: 'No Content' });
    httpMock.expectOne(`/api/v1/books/${BOOK_ID}`).flush({ ...readingBook, stats: { ...officialBookStats, pagesRead: 488 } });
    flushGlobalRefresh();
    expect(store.bookStats(BOOK_ID)?.pagesRead).toBe(488);
  });

  it('does not restore old metadata or totals from a GET started before a successful PATCH', () => {
    seedBooks([{ ...readingBook, totalPages: 1000, stats: officialBookStats }]);
    store.loadBookStats(BOOK_ID); const outdated = httpMock.expectOne(`/api/v1/books/${BOOK_ID}`);
    store.updateBook(BOOK_ID, { totalPages: 2000, edition: '2ª' }).subscribe();
    const confirmed = { ...readingBook, totalPages: 2000, edition: '2ª', stats: { ...officialBookStats, totalPages: 2000, percent: 25 } };
    httpMock.expectOne(`/api/v1/books/${BOOK_ID}`).flush(confirmed);
    outdated.flush({ ...readingBook, totalPages: 1000, stats: officialBookStats });
    expect(store.getBook(BOOK_ID)?.totalPages).toBe(2000);
    expect(store.bookStats(BOOK_ID)?.percent).toBe(25);
    httpMock.expectOne('/api/v1/books?limit=100&offset=0').flush([confirmed]);
    httpMock.expectOne('/api/v1/dashboard').flush({ currentStreakDays: 0, currentBook: null, week: { pages: 500, minutes: 0, booksFinished: 0 } });
    httpMock.expectOne(request => request.url === '/api/v1/stats').flush({ pages: 500 });
  });

  it('does not resurrect a deleted book from an earlier direct GET', () => {
    store.loadBook(BOOK_ID); const old = httpMock.expectOne(`/api/v1/books/${BOOK_ID}`);
    store.deleteBook(BOOK_ID).subscribe();
    httpMock.expectOne(`/api/v1/books/${BOOK_ID}`).flush(null, { status: 204, statusText: 'No Content' });
    httpMock.expectOne('/api/v1/books?limit=100&offset=0').flush([]);
    httpMock.expectOne('/api/v1/dashboard').flush({ currentStreakDays: 0, currentBook: null, week: { pages: 0, minutes: 0, booksFinished: 0 } });
    httpMock.expectOne(request => request.url === '/api/v1/stats').flush({ pages: 0 }); expectSessionsRequest([]);
    old.flush({ ...readingBook, stats: officialBookStats });
    expect(store.getBook(BOOK_ID)).toBeUndefined(); expect(store.bookStats(BOOK_ID)).toBeNull();
  });

});

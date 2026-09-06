import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { ANALYTICS_ENDPOINT } from '../analytics/analytics.service';
import { AuthService } from '../auth/auth.service';
import { Book, ReadingSession } from '../models/models';
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
        { provide: ANALYTICS_ENDPOINT, useValue: '/api/v1/analytics/events' },
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
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  function expectSessionsRequest(sessions: ReadingSession[] = []) {
    const request = httpMock.expectOne((req) => req.url === '/api/v1/sessions' && req.params.has('from') && req.params.has('to'));
    expect(request.request.params.get('limit')).toBe('100');
    expect(request.request.params.get('offset')).toBe('0');
    request.flush(sessions);
    return request;
  }

  function seedBooks(books: Book[]): void {
    store.loadBooks();
    httpMock.expectOne('/api/v1/books').flush(books);
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
    httpMock.expectOne('/api/v1/analytics/events').flush(null, { status: 202, statusText: 'Accepted' });
    expect(store.selectableBooks().length).toBe(1);
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
    httpMock.expectOne('/api/v1/books').flush([]);
    expectSessionsRequest();
    httpMock.match((request) => request.url.startsWith('/api/v1/stats')).forEach((request) => request.flush(statsResponse));

    store.reload();
    httpMock.expectOne('/api/v1/dashboard').flush('error', { status: 500, statusText: 'Server Error' });
    httpMock.expectOne('/api/v1/books').flush([]);
    expectSessionsRequest();
    httpMock.match((request) => request.url.startsWith('/api/v1/stats')).forEach((request) => request.flush(statsResponse));

    store.load();
    httpMock.expectOne('/api/v1/dashboard').flush({
      currentStreakDays: 1,
      currentBook: null,
      week: { pages: 1, minutes: 1, booksFinished: 0 }
    });
    httpMock.expectOne('/api/v1/books').flush([]);
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

    store.finishBook(BOOK_ID);
    expect(store.books()[0]?.status).toBe('FINISHED');

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
});

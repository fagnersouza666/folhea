import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { Book, ReadingSession } from '../models/models';
import { NewBookComponent } from '../../features/books/new-book.component';
import { DashboardStore } from './dashboard.store';

const book: Book = { id: 'book-a', title: 'Livro A', status: 'READING', totalPages: 100, pagesRead: 0, averagePagesPerReadingDay: null, progressPercent: 0 };
const otherBook: Book = { ...book, id: 'book-b', title: 'Livro B' };
const session: ReadingSession = { id: 'session-a', bookId: book.id, readingDate: '2026-09-01', pages: 10, minutes: 0 };
const otherSession: ReadingSession = { ...session, id: 'session-b', bookId: otherBook.id };
const dashboard = { currentStreakDays: 0, currentBook: null, week: { pages: 0, minutes: 0, booksFinished: 0 } };
const stats = { ...dashboard.week, currentStreakDays: 0, period: { from: '2026-09-01', to: '2026-09-07' } };

// Keep components, store, client and RxJS real; control only the HTTP/account boundary.
describe('store mutations across navigation and concurrent responses', () => {
  let http: HttpTestingController;
  let store: DashboardStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide: AuthService, useValue: { user: () => ({ timezone: 'UTC' }) } }] });
    http = TestBed.inject(HttpTestingController); store = TestBed.inject(DashboardStore);
  });
  afterEach(() => { try { http.verify({ ignoreCancelled: true }); } finally { TestBed.resetTestingModule(); } });

  function books(items: Book[]): void {
    store.loadBooks(); http.expectOne('/api/v1/books?limit=100&offset=0').flush(items);
  }
  function sessions(items: ReadingSession[]): void {
    store.loadSessions(); http.expectOne('/api/v1/sessions?limit=100&offset=0').flush(items);
  }
  function globalRefresh(items: ReadingSession[] = []): void {
    http.expectOne('/api/v1/dashboard').flush(dashboard);
    http.expectOne(request => request.url === '/api/v1/stats').flush(stats);
    http.expectOne('/api/v1/sessions?limit=100&offset=0').flush(items);
  }
  function pendingCreation() {
    const fixture = TestBed.createComponent(NewBookComponent); fixture.detectChanges();
    fixture.componentInstance.form.controls.title.setValue('Livro A');
    fixture.componentInstance.submit();
    const request = http.expectOne('/api/v1/books');
    fixture.destroy();
    return request;
  }

  it('reconciles a confirmed creation after its form is destroyed without leaving a local book', () => {
    const request = pendingCreation();
    expect(request.cancelled).toBe(false);
    request.flush(book);
    http.expectOne('/api/v1/books?limit=100&offset=0').flush([book]);
    expect(store.books().map(item => item.id)).toEqual(['book-a']);
    expect(store.selectableBooks().map(item => item.id)).toEqual(['book-a']);
  });

  it('removes the temporary book when creation fails after leaving the form', () => {
    const request = pendingCreation();
    expect(request.cancelled).toBe(false);
    request.flush({ detail: 'Cadastro indisponível.' }, { status: 503, statusText: 'Unavailable' });
    expect(store.books()).toEqual([]);
    expect(store.error()).toContain('Cadastro indisponível');
  });

  it('reconciles an already submitted photo when its observer leaves', () => {
    books([book]);
    const upload = store.uploadBookPhoto(book.id, new File(['jpeg'], 'capa.jpg', { type: 'image/jpeg' })).subscribe();
    const request = http.expectOne('/api/v1/books/book-a/photo');
    upload.unsubscribe();
    expect(request.cancelled).toBe(false);
    request.flush({ ...book, hasPhoto: true });
    http.expectOne('/api/v1/books?limit=100&offset=0').flush([{ ...book, hasPhoto: true }]);
    expect(store.getBook(book.id)?.hasPhoto).toBe(true);
  });

  it('does not restore an independently deleted book after another delete fails late', () => {
    books([book, otherBook]);
    store.deleteBook(book.id).subscribe({ error: () => undefined });
    const first = http.expectOne('/api/v1/books/book-a');
    store.deleteBook(otherBook.id).subscribe();
    http.expectOne('/api/v1/books/book-b').flush(null, { status: 204, statusText: 'No Content' });
    globalRefresh(); http.expectOne('/api/v1/books?limit=100&offset=0').flush([book]);
    first.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(store.books().map(item => item.id)).toEqual(['book-a']);
  });

  it.each(['update', 'delete'] as const)('preserves another confirmed session when a concurrent %s fails', operation => {
    books([book, otherBook]); sessions([session, otherSession]);
    const firstAction = operation === 'update' ? store.updateSession(session.id, { pages: 40 }) : store.deleteSession(session.id);
    firstAction.subscribe({ error: () => undefined });
    const first = http.expectOne('/api/v1/sessions/session-a');
    store.updateSession(otherSession.id, { pages: 25 }).subscribe();
    http.expectOne('/api/v1/sessions/session-b').flush({ ...otherSession, pages: 25 });
    http.expectOne('/api/v1/books/book-b').flush({ ...otherBook, pagesRead: 25, averagePagesPerReadingDay: 25, progressPercent: 25 });
    globalRefresh([session, { ...otherSession, pages: 25 }]);
    first.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(store.getSession(session.id)?.pages).toBe(10);
    expect(store.getSession(otherSession.id)?.pages).toBe(25);
  });

  it('accepts metrics for unaffected books when a new page arrives after a saved reading', () => {
    books(Array.from({ length: 100 }, (_, index) => ({ ...book, id: index === 0 ? book.id : `book-${index}` })));
    store.loadMoreBooks(); const page = http.expectOne('/api/v1/books?limit=100&offset=100');
    store.addSession({ bookId: book.id, readingDate: '2026-09-01', pages: 10, minutes: 0 }).subscribe();
    http.expectOne('/api/v1/sessions').flush(session);
    http.expectOne('/api/v1/books/book-a').flush({ ...book, pagesRead: 10, averagePagesPerReadingDay: 10, progressPercent: 10 });
    globalRefresh([session]);
    page.flush([otherBook]);
    expect(store.bookStats(otherBook.id)).toEqual({ pagesRead: 0, totalPages: 100, averagePagesPerReadingDay: null, progressPercent: 0 });
    expect(store.bookStats(book.id)?.pagesRead).toBe(10);
  });

  it('rejects a late session detail belonging to a successfully deleted book', () => {
    books([book]);
    store.loadSession(session.id); const detail = http.expectOne('/api/v1/sessions/session-a');
    store.deleteBook(book.id).subscribe();
    http.expectOne('/api/v1/books/book-a').flush(null, { status: 204, statusText: 'No Content' });
    globalRefresh(); http.expectOne('/api/v1/books?limit=100&offset=0').flush([]);
    detail.flush(session);
    expect(store.getSession(session.id)).toBeUndefined();
    expect(store.sessionDetailLoading()).toBe(false);
    http.expectNone('/api/v1/books/book-a');
  });

  it('does not restore a deleted book from an earlier metadata mutation response', () => {
    books([book]);
    store.updateBook(book.id, { title: 'Novo título' }).subscribe();
    const update = http.expectOne('/api/v1/books/book-a');
    store.deleteBook(book.id).subscribe();
    http.expectOne('/api/v1/books/book-a').flush(null, { status: 204, statusText: 'No Content' });
    globalRefresh(); http.expectOne('/api/v1/books?limit=100&offset=0').flush([]);
    update.flush({ ...book, title: 'Novo título' });
    http.expectOne('/api/v1/books?limit=100&offset=0').flush([]);
    http.expectOne('/api/v1/dashboard').flush(dashboard);
    http.expectOne(request => request.url === '/api/v1/stats').flush(stats);
    expect(store.getBook(book.id)).toBeUndefined();
    expect(store.selectableBooks()).toEqual([]);
  });

  it('does not restore a deleted book session from an earlier update response', () => {
    books([book]); sessions([session]);
    store.updateSession(session.id, { pages: 30 }).subscribe();
    const update = http.expectOne('/api/v1/sessions/session-a');
    store.deleteBook(book.id).subscribe();
    http.expectOne('/api/v1/books/book-a').flush(null, { status: 204, statusText: 'No Content' });
    globalRefresh(); http.expectOne('/api/v1/books?limit=100&offset=0').flush([]);
    update.flush({ ...session, pages: 30 });
    http.expectNone('/api/v1/books/book-a');
    globalRefresh();
    expect(store.getSession(session.id)).toBeUndefined();
    expect(store.sessions()).toEqual([]);
  });
});

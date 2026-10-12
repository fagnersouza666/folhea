import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { DashboardStore } from '../../core/state/dashboard.store';
import { HomeComponent } from './home.component';

describe('Home after a persisted reading mutation', () => {
  let store: DashboardStore;
  let http: HttpTestingController;
  const oldSummary = { currentStreakDays: 12, currentBook: null, week: { pages: 143, minutes: 130, booksFinished: 1 } };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal({ id: 'reader', email: 'reader@example.test', timezone: 'America/Sao_Paulo' }) } }]
    });
    store = TestBed.inject(DashboardStore);
    http = TestBed.inject(HttpTestingController);
    store.loadDashboard();
    http.expectOne('/api/v1/dashboard').flush(oldSummary);
  });

  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  it.each(['create', 'update', 'delete'] as const)('hides stale metrics after %s, dismissed error and return, with GET-only retry', (operation) => {
    const session = { id: 'saved', bookId: 'book', readingDate: store.today(), pages: 12, minutes: 8, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
    const mutation = operation === 'create' ? store.addSession(session)
      : operation === 'update' ? store.updateSession(session.id, session) : store.deleteSession(session.id);
    mutation.subscribe();
    const persisted = operation === 'create' ? [session] : operation === 'update' ? [{ ...session, pages: 20 }] : [];
    http.expectOne(operation === 'create' ? '/api/v1/sessions' : '/api/v1/sessions/saved').flush(operation === 'delete' ? null : persisted[0]);
    if (operation !== 'delete') http.expectOne('/api/v1/books/book').flush({ id: 'book', title: 'Livro', status: 'READING', stats: { pagesRead: 12, totalPages: null, percent: null, averagePagesPerDay: 12, firstDate: store.today(), referenceDate: store.today(), elapsedDays: 1 } });
    http.expectOne('/api/v1/dashboard').flush({}, { status: 503, statusText: 'Unavailable' });
    http.expectOne((req) => req.url === '/api/v1/stats').flush({ ...oldSummary.week, currentStreakDays: 12, period: { from: store.today(), to: store.today() } });
    http.expectOne('/api/v1/sessions?limit=100&offset=0').flush(persisted);
    http.expectOne('/api/v1/analytics/events').flush(null, { status: 202, statusText: 'Accepted' });
    store.clearError(); // Fechar in the shell, before Concluir/return to Home.
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.stats-grid')).toBeNull();
    expect(root.querySelector('.streak-card')).toBeNull();
    expect(root.querySelector('.unavailable')?.textContent).toContain('Seu resumo está indisponível');
    const retry = root.querySelector('.unavailable button') as HTMLButtonElement;
    retry.click();
    fixture.detectChanges();
    expect(root.querySelector('.stats-grid')).toBeNull();
    const refreshed = { ...oldSummary, currentStreakDays: 13, week: { pages: 155, minutes: 138, booksFinished: 1 } };
    http.expectOne('/api/v1/dashboard').flush(refreshed);
    fixture.detectChanges();
    expect(root.querySelector('.stats-grid')?.textContent).toContain('155');
    expect(root.querySelector('.streak-card strong')?.textContent).toContain('13');
    expect(store.sessions()).toEqual(persisted);
    http.expectNone((req) => req.method !== 'GET');
  });
});

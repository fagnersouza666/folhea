import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { ApiClient } from '../api/api-client.service';
import { Dashboard } from '../models/models';
import { DashboardStore } from './dashboard.store';

const dashboard: Dashboard = {
  currentStreakDays: 2,
  currentBook: null,
  week: { pages: 20, minutes: 30, booksFinished: 0 }
};

const stats = {
  currentStreakDays: 2,
  pages: 20,
  minutes: 30,
  booksFinished: 0,
  period: { from: '2026-09-01', to: '2026-09-06' }
};

describe('DashboardStore resilient states', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('keeps the dashboard error observable when its API request fails', () => {
    const getDashboard = vi.fn(() => throwError(() => new TypeError('offline')));
    const api = {
      getDashboard,
      getBooks: () => of([]),
      getSessions: () => of([]),
      getStats: () => of(stats)
    } as unknown as ApiClient;
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }, DashboardStore] });

    const store = TestBed.inject(DashboardStore);
    store.load();

    expect(store.error()).toBe('Sem conexão. Conecte-se para sincronizar suas alterações.');
    expect(store.loading()).toBe(false);
    expect(getDashboard).toHaveBeenCalledOnce();
  });

  it('keeps independent books, sessions, and stats failures visible', () => {
    const api = {
      getDashboard: () => of(dashboard),
      getBooks: () => throwError(() => new Error('books down')),
      getSessions: () => throwError(() => new Error('sessions down')),
      getStats: () => throwError(() => new Error('stats down'))
    } as unknown as ApiClient;
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }, DashboardStore] });

    const store = TestBed.inject(DashboardStore);
    store.load();

    expect(store.booksError()).toBe('Não foi possível carregar seus livros.');
    expect(store.sessionsError()).toBe('Não foi possível carregar suas sessões.');
    expect(store.statsError()).toBe('Não foi possível atualizar as estatísticas.');
    expect(store.dashboard()).toEqual(dashboard);
  });

  it('rolls back optimistic reading when the API rejects it', () => {
    const api = {
      getDashboard: () => of(dashboard),
      getBooks: () => of([]),
      getSessions: () => of([]),
      getStats: () => of(stats),
      createSession: () => throwError(() => new HttpErrorResponse({ status: 503 }))
    } as unknown as ApiClient;
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }, DashboardStore] });

    const store = TestBed.inject(DashboardStore);
    const optimistic = store.addSession({ bookId: 'book-1', readingDate: '2026-09-06', pages: 12, minutes: 10 });

    expect(optimistic.id).toContain('local-session-');
    expect(store.sessions()).toEqual([]);
    expect(store.error()).toBe('Não foi possível registrar a leitura.');
  });
});

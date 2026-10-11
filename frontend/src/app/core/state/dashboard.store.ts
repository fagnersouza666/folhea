import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { ApiClient } from '../api/api-client.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuthService } from '../auth/auth.service';
import { Book, BookPatch, Dashboard, ReadingDraft, ReadingSession, ReadingSessionPatch, Stats, StatsPeriod } from '../models/models';
import { calendarDate, startOfPeriod } from './reading-statistics';

@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private static readonly SESSIONS_PAGE_SIZE = 100;

  private readonly api = inject(ApiClient);
  private readonly analytics = inject(AnalyticsService);
  private readonly auth = inject(AuthService);
  private readonly dashboardState = signal<Dashboard | null>(null);
  private readonly booksState = signal<Book[]>([]);
  private readonly sessionsState = signal<ReadingSession[]>([]);
  private readonly bookDetails = signal<Book[]>([]);
  private readonly sessionDetails = signal<ReadingSession[]>([]);
  private readonly bookDetailLoadingState = signal(false);
  private readonly sessionDetailLoadingState = signal(false);
  private readonly statsState = signal<Stats | null>(null);
  private readonly periodState = signal<StatsPeriod>('7');
  private readonly loadingState = signal(false);
  private readonly booksLoadingState = signal(false);
  private readonly sessionsLoadingState = signal(false);
  private readonly statsLoadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly dashboardErrorState = signal<string | null>(null);
  private readonly booksErrorState = signal<string | null>(null);
  private readonly sessionsErrorState = signal<string | null>(null);
  private readonly statsErrorState = signal<string | null>(null);
  private readonly sessionsHasMoreState = signal(false);
  private hasLoaded = false;
  private statsRequest = 0;
  private dashboardRequest = 0;
  private booksRequest = 0;
  private sessionsRequest = 0;
  private booksOffset = 0;
  private readonly booksHasMoreState = signal(false);
  private sessionsOffset = 0;

  readonly dashboard = this.dashboardState.asReadonly();
  readonly books = this.booksState.asReadonly();
  readonly selectableBooks = computed(() => this.mergeById(this.booksState(), this.bookDetails()).filter((book) => !book.id.startsWith('local-')));
  readonly sessions = this.sessionsState.asReadonly();
  readonly stats = this.statsState.asReadonly();
  readonly period = this.periodState.asReadonly();
  readonly loading = computed(() => this.loadingState() || this.booksLoadingState() || this.sessionsLoadingState());
  readonly bookDetailLoading = this.bookDetailLoadingState.asReadonly();
  readonly sessionDetailLoading = this.sessionDetailLoadingState.asReadonly();
  readonly booksLoading = this.booksLoadingState.asReadonly();
  readonly sessionsLoading = this.sessionsLoadingState.asReadonly();
  readonly statsLoading = this.statsLoadingState.asReadonly();
  readonly booksHasMore = this.booksHasMoreState.asReadonly();
  readonly sessionsHasMore = this.sessionsHasMoreState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly dashboardError = this.dashboardErrorState.asReadonly();
  readonly booksError = this.booksErrorState.asReadonly();
  readonly sessionsError = this.sessionsErrorState.asReadonly();
  readonly statsError = this.statsErrorState.asReadonly();
  readonly currentBook = computed(() => this.dashboardState()?.currentBook
    ?? this.booksState().find((book) => book.status === 'READING' && !book.id.startsWith('local-'))
    ?? null);

  load(): void {
    if (this.hasLoaded || this.loadingState()) return;
    this.loadDashboard();
    this.loadBooks();
    this.loadSessions();
    this.loadStats(this.periodState());
  }

  reload(): void {
    this.hasLoaded = false;
    this.errorState.set(null);
    this.load();
  }

  loadDashboard(): void {
    const request = ++this.dashboardRequest;
    this.errorState.set(null);
    this.dashboardErrorState.set(null);
    this.loadingState.set(true);
    this.api.getDashboard().subscribe({
      next: (dashboard) => {
        if (request !== this.dashboardRequest) return;
        this.dashboardState.set(dashboard);
        if (dashboard.currentBook) this.loadBook(dashboard.currentBook.id);
        this.loadingState.set(false);
        this.hasLoaded = true;
      },
      error: (error: unknown) => {
        if (request !== this.dashboardRequest) return;
        this.loadingState.set(false);
        this.hasLoaded = false;
        const message = this.errorMessage(error, 'Não foi possível carregar seu resumo.');
        this.dashboardErrorState.set(message);
        this.errorState.set(message);
      }
    });
  }

  loadBooks(): void { this.fetchBooks(0, false); }

  loadMoreBooks(): void {
    if (this.booksHasMoreState() && !this.booksLoadingState()) this.fetchBooks(this.booksOffset, true);
  }

  private fetchBooks(offset: number, append: boolean): void {
    const request = ++this.booksRequest;
    this.booksLoadingState.set(true);
    this.booksErrorState.set(null);
    this.api.getBooks(100, offset).subscribe({
      next: (books) => {
        if (request !== this.booksRequest) return;
        this.booksState.set(append ? this.mergeById(this.booksState(), books) : books);
        this.booksOffset = offset + books.length;
        this.booksHasMoreState.set(books.length === 100);
        this.booksLoadingState.set(false);
      },
      error: (error: unknown) => {
        if (request !== this.booksRequest) return;
        this.booksLoadingState.set(false);
        this.booksErrorState.set(this.errorMessage(error, 'Não foi possível carregar seus livros.'));
      }
    });
  }

  loadSessions(): void { this.fetchSessions(0, false); }

  loadMoreSessions(): void {
    if (!this.sessionsHasMoreState() || this.sessionsLoadingState()) return;
    this.fetchSessions(this.sessionsOffset, true);
  }

  loadBook(id: string): void {
    if (this.getBook(id)) return;
    this.bookDetailLoadingState.set(true);
    this.booksErrorState.set(null);
    this.api.getBook(id).subscribe({
      next: (book) => { this.bookDetails.update((books) => this.mergeById(books, [book])); this.bookDetailLoadingState.set(false); },
      error: (error: unknown) => { this.bookDetailLoadingState.set(false); this.booksErrorState.set(this.errorMessage(error, 'Não foi possível abrir o livro.')); }
    });
  }

  loadSession(id: string): void {
    const cached = this.getSession(id);
    if (cached) { this.loadBook(cached.bookId); return; }
    this.sessionDetailLoadingState.set(true);
    this.sessionsErrorState.set(null);
    this.api.getSession(id).subscribe({
      next: (session) => { this.sessionDetails.update((sessions) => this.mergeById(sessions, [session])); this.sessionDetailLoadingState.set(false); this.loadBook(session.bookId); },
      error: (error: unknown) => { this.sessionDetailLoadingState.set(false); this.sessionsErrorState.set(this.errorMessage(error, 'Não foi possível abrir a sessão.')); }
    });
  }

  selectPeriod(period: StatsPeriod): void { this.periodState.set(period); this.loadStats(period); }

  loadStats(period: StatsPeriod = this.periodState()): void {
    const request = ++this.statsRequest;
    this.periodState.set(period);
    this.statsState.set(null);
    this.statsLoadingState.set(true);
    this.statsErrorState.set(null);
    const today = this.today();
    const response = period === 'all'
      ? this.api.getStats(undefined, undefined, 'all')
      : this.api.getStats(startOfPeriod(period, today), today);
    response.subscribe({
      next: (stats) => {
        if (request !== this.statsRequest) return;
        this.statsState.set(stats);
        this.statsLoadingState.set(false);
      },
      error: (error: unknown) => {
        if (request !== this.statsRequest) return;
        this.statsLoadingState.set(false);
        this.statsErrorState.set(this.errorMessage(error, 'Não foi possível atualizar as estatísticas.'));
      }
    });
  }

  private fetchSessions(offset: number, append: boolean): void {
    const request = ++this.sessionsRequest;
    this.sessionsLoadingState.set(true);
    this.sessionsErrorState.set(null);
    this.api.getSessions(undefined, undefined, DashboardStore.SESSIONS_PAGE_SIZE, offset).subscribe({
      next: (sessions) => {
        if (request !== this.sessionsRequest) return;
        if (append) {
          this.sessionsState.update((existing) => this.mergeById(existing, sessions));
        } else {
          this.sessionsState.set(sessions);
        }
        this.sessionsOffset = offset + sessions.length;
        this.sessionsHasMoreState.set(sessions.length === DashboardStore.SESSIONS_PAGE_SIZE);
        this.sessionsLoadingState.set(false);
      },
      error: (error: unknown) => {
        if (request !== this.sessionsRequest) return;
        this.sessionsLoadingState.set(false);
        this.sessionsErrorState.set(this.errorMessage(error, 'Não foi possível carregar suas sessões.'));
      }
    });
  }

  addBook(title: string, author = ''): Observable<Book> {
    this.clearError();
    const now = new Date().toISOString();
    const optimisticId = `local-book-${Date.now()}`;
    const optimistic: Book = { id: optimisticId, title, author: author || undefined, status: 'READING', createdAt: now, updatedAt: now };
    this.booksState.update((books) => [optimistic, ...books]);
    this.syncCurrentBook();
    return this.api.createBook({ title, author: author || undefined }).pipe(
      tap((book) => {
        this.booksState.update((books) => books.map((item) => item.id === optimisticId ? book : item));
        this.syncCurrentBook();
        this.analytics.track('book_created');
        this.loadBooks();
      }),
      catchError((error: unknown) => {
        this.booksState.update((books) => books.filter((item) => item.id !== optimisticId));
        this.syncCurrentBook();
        this.setMutationError(error, 'Não foi possível cadastrar o livro.');
        return throwError(() => error);
      })
    );
  }

  updateBook(id: string, patch: BookPatch): Observable<Book> {
    this.clearError();
    return this.api.updateBook(id, patch).pipe(
      tap((book) => { this.booksState.update((books) => this.mergeById(books, [book]));
        this.bookDetails.update((books) => books.filter((item) => item.id !== book.id)); this.loadBooks(); this.refreshMetrics(); }),
      catchError((error: unknown) => { this.setMutationError(error, 'Não foi possível editar o livro.'); return throwError(() => error); })
    );
  }

  finishBook(id: string, finishedOn = this.today()): Observable<Book> {
    this.clearError();
    return this.api.finishBook(id, finishedOn).pipe(
      tap((book) => {
        this.booksState.update((books) => this.mergeById(books, [book]));
        this.bookDetails.update((books) => books.filter((item) => item.id !== book.id));
        this.loadBooks();
        this.refreshMetrics();
        this.analytics.track('book_finished');
      }),
      catchError((error: unknown) => { this.setMutationError(error, 'Não foi possível finalizar o livro.'); return throwError(() => error); })
    );
  }

  reopenBook(id: string): Observable<Book> {
    this.clearError();
    return this.api.reopenBook(id).pipe(
      tap((book) => {
        this.booksState.update((books) => this.mergeById(books, [book]));
        this.bookDetails.update((books) => books.filter((item) => item.id !== book.id));
        this.loadBooks();
        this.refreshMetrics();
        this.analytics.track('book_reopened');
      }),
      catchError((error: unknown) => { this.setMutationError(error, 'Não foi possível reabrir o livro.'); return throwError(() => error); })
    );
  }

  deleteBook(id: string): Observable<void> {
    const previousBooks = this.booksState();
    const previousSessions = this.sessionsState();
    this.booksState.update((books) => books.filter((book) => book.id !== id));
    this.sessionsState.update((sessions) => sessions.filter((session) => session.bookId !== id));
    this.syncCurrentBook();
    return this.api.deleteBook(id).pipe(
      tap(() => { this.bookDetails.update((books) => books.filter((item) => item.id !== id)); this.sessionDetails.update((sessions) => sessions.filter((session) => session.bookId !== id)); this.refreshMetrics(); this.loadSessions(); this.loadBooks(); }),
      catchError((error: unknown) => {
        this.booksState.set(previousBooks);
        this.sessionsState.set(previousSessions);
        this.syncCurrentBook();
        this.setMutationError(error, 'Não foi possível excluir o livro.');
        return throwError(() => error);
      })
    );
  }

  addSession(draft: ReadingDraft): Observable<ReadingSession> {
    this.clearError();
    const now = new Date().toISOString();
    const optimisticId = `local-session-${Date.now()}`;
    const optimistic: ReadingSession = { id: optimisticId, ...draft, createdAt: now, updatedAt: now };
    this.sessionsState.update((sessions) => [optimistic, ...sessions]);
    return this.api.createSession(draft).pipe(
      tap((session) => {
        this.sessionsState.update((sessions) => sessions.map((item) => item.id === optimisticId ? session : item));
        this.refreshMetrics();
        this.loadSessions();
        this.analytics.track('reading_session_created', { pages: draft.pages, minutes: draft.minutes });
      }),
      catchError((error: unknown) => {
        this.sessionsState.update((sessions) => sessions.filter((item) => item.id !== optimisticId));
        this.setMutationError(error, 'Não foi possível registrar a leitura.');
        return throwError(() => error);
      })
    );
  }

  updateSession(id: string, patch: ReadingSessionPatch): Observable<ReadingSession> {
    this.clearError();
    const previous = this.sessionsState();
    this.sessionsState.update((sessions) => sessions.map((session) => session.id === id ? { ...session, ...patch } : session));
    return this.api.updateSession(id, patch).pipe(
      tap((session) => {
        this.sessionsState.update((sessions) => this.mergeById(sessions, [session]));
        this.sessionDetails.update((sessions) => sessions.filter((item) => item.id !== id));
        this.refreshMetrics();
        this.loadSessions();
        this.analytics.track('reading_session_updated', { pages: patch.pages, minutes: patch.minutes });
      }),
      catchError((error: unknown) => {
        this.sessionsState.set(previous);
        this.setMutationError(error, 'Não foi possível editar a sessão.');
        return throwError(() => error);
      })
    );
  }

  deleteSession(id: string): Observable<void> {
    const previous = this.sessionsState();
    this.sessionsState.update((sessions) => sessions.filter((session) => session.id !== id));
    return this.api.deleteSession(id).pipe(
      tap(() => {
        this.refreshMetrics();
        this.sessionDetails.update((sessions) => sessions.filter((item) => item.id !== id));
        this.loadSessions();
        this.analytics.track('reading_session_deleted');
      }),
      catchError((error: unknown) => {
        this.sessionsState.set(previous);
        this.setMutationError(error, 'Não foi possível excluir a sessão.');
        return throwError(() => error);
      })
    );
  }

  getBook(id: string | null | undefined): Book | undefined { return id ? this.booksState().find((book) => book.id === id) ?? this.bookDetails().find((book) => book.id === id) : undefined; }
  getSession(id: string | null | undefined): ReadingSession | undefined { return id ? this.sessionsState().find((session) => session.id === id) ?? this.sessionDetails().find((session) => session.id === id) : undefined; }
  clearError(): void { this.errorState.set(null); }

  today(): string {
    const timezone = this.auth.user()?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return calendarDate(new Date(), timezone);
  }

  private syncCurrentBook(): void {
    const current = this.booksState().find((book) => book.status === 'READING' && !book.id.startsWith('local-'));
    this.dashboardState.update((dashboard) => dashboard
      ? { ...dashboard, currentBook: current ? { id: current.id, title: current.title } : null }
      : null);
  }

  private refreshMetrics(): void {
    this.loadDashboard();
    this.loadStats();
  }

  private mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
    const items = new Map(existing.map((item) => [item.id, item]));
    incoming.forEach((item) => items.set(item.id, item));
    return [...items.values()];
  }

  private setMutationError(error: unknown, fallback: string): void { this.errorState.set(this.errorMessage(error, fallback)); }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'detail' in error.error) {
      const detail = (error.error as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail.trim()) return detail;
    }
    if (error instanceof TypeError || (error instanceof HttpErrorResponse && error.status === 0)) return 'Sem conexão. Conecte-se para sincronizar suas alterações.';
    return fallback;
  }
}

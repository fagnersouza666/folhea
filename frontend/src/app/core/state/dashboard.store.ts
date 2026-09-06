import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiClient } from '../api/api-client.service';
import { Book, BookPatch, Dashboard, ReadingDraft, ReadingSession, ReadingSessionPatch, Stats, StatsPeriod } from '../models/models';
import { addDays, currentStreak, periodStats, startOfPeriod } from './reading-statistics';

@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly api = inject(ApiClient);
  private readonly dashboardState = signal<Dashboard | null>(null);
  private readonly booksState = signal<Book[]>([]);
  private readonly sessionsState = signal<ReadingSession[]>([]);
  private readonly statsState = signal<Stats | null>(null);
  private readonly periodState = signal<StatsPeriod>('7');
  private readonly loadingState = signal(false);
  private readonly booksLoadingState = signal(false);
  private readonly sessionsLoadingState = signal(false);
  private readonly statsLoadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly booksErrorState = signal<string | null>(null);
  private readonly sessionsErrorState = signal<string | null>(null);
  private readonly statsErrorState = signal<string | null>(null);
  private hasLoaded = false;
  private sessionsLoaded = false;

  readonly dashboard = this.dashboardState.asReadonly();
  readonly books = this.booksState.asReadonly();
  readonly sessions = this.sessionsState.asReadonly();
  readonly stats = this.statsState.asReadonly();
  readonly period = this.periodState.asReadonly();
  readonly loading = computed(() => this.loadingState() || this.booksLoadingState() || this.sessionsLoadingState());
  readonly booksLoading = this.booksLoadingState.asReadonly();
  readonly sessionsLoading = this.sessionsLoadingState.asReadonly();
  readonly statsLoading = this.statsLoadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly booksError = this.booksErrorState.asReadonly();
  readonly sessionsError = this.sessionsErrorState.asReadonly();
  readonly statsError = this.statsErrorState.asReadonly();
  readonly currentBook = computed(() => this.dashboardState()?.currentBook
    ?? this.booksState().find((book) => book.status === 'READING')
    ?? null);

  load(): void {
    if (this.hasLoaded) return;
    this.hasLoaded = true;
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
    this.loadingState.set(true);
    this.api.getDashboard().subscribe({
      next: (dashboard) => { this.dashboardState.set(dashboard); this.loadingState.set(false); },
      error: (error: unknown) => { this.loadingState.set(false); this.errorState.set(this.errorMessage(error, 'Não foi possível carregar seu resumo.')); }
    });
  }

  loadBooks(): void {
    this.booksLoadingState.set(true);
    this.booksErrorState.set(null);
    this.api.getBooks().subscribe({
      next: (books) => { this.booksState.set(books); this.booksLoadingState.set(false); this.recalculateDashboard(); this.calculateVisibleStats(); },
      error: (error: unknown) => { this.booksLoadingState.set(false); this.booksErrorState.set(this.errorMessage(error, 'Não foi possível carregar seus livros.')); }
    });
  }

  loadSessions(): void {
    this.sessionsLoadingState.set(true);
    this.sessionsErrorState.set(null);
    this.api.getSessions().subscribe({
      next: (sessions) => { this.sessionsState.set(sessions); this.sessionsLoaded = true; this.sessionsLoadingState.set(false); this.recalculateDashboard(); this.calculateVisibleStats(); if (this.periodState() === 'all') this.loadStats('all'); },
      error: (error: unknown) => { this.sessionsLoadingState.set(false); this.sessionsErrorState.set(this.errorMessage(error, 'Não foi possível carregar suas sessões.')); }
    });
  }

  selectPeriod(period: StatsPeriod): void { this.periodState.set(period); this.loadStats(period); }

  loadStats(period: StatsPeriod = this.periodState()): void {
    this.periodState.set(period);
    this.statsLoadingState.set(true);
    this.statsErrorState.set(null);
    const today = this.today();
    if (period === 'all') {
      const first = this.sessionsState().map((session) => session.readingDate).sort()[0];
      if (!first) {
        this.statsState.set(periodStats([], this.booksState(), today, today, this.currentStreak()));
        this.statsLoadingState.set(false);
        return;
      }
      this.requestStats(first, today);
      return;
    }
    this.requestStats(startOfPeriod(period, today), today);
  }

  private requestStats(from: string, to: string): void {
    this.api.getStats(from, to).subscribe({
      next: (stats) => { this.statsState.set({ ...stats, currentStreakDays: this.sessionsLoaded ? this.currentStreak() : stats.currentStreakDays }); this.statsLoadingState.set(false); },
      error: (error: unknown) => {
        this.statsState.set(periodStats(this.sessionsState(), this.booksState(), from, to, this.currentStreak()));
        this.statsLoadingState.set(false);
        this.statsErrorState.set(this.errorMessage(error, 'Não foi possível atualizar as estatísticas.'));
      }
    });
  }

  addBook(title: string, author = ''): Book {
    const now = new Date().toISOString();
    const optimistic: Book = { id: `local-book-${Date.now()}`, title, author: author || undefined, status: 'READING', createdAt: now, updatedAt: now };
    this.booksState.update((books) => [optimistic, ...books]);
    this.recalculateDashboard();
    this.api.createBook({ title, author: author || undefined }).subscribe({
      next: (book) => this.booksState.update((books) => books.map((item) => item.id === optimistic.id ? { ...optimistic, ...book } : item)),
      error: (error: unknown) => { this.booksState.update((books) => books.filter((item) => item.id !== optimistic.id)); this.setMutationError(error, 'Não foi possível cadastrar o livro.'); }
    });
    return optimistic;
  }

  updateBook(id: string, patch: BookPatch): void {
    const previous = this.booksState();
    this.booksState.update((books) => books.map((book) => book.id === id ? { ...book, ...patch, author: patch.author === '' ? undefined : patch.author } : book));
    this.api.updateBook(id, patch).subscribe({
      next: (book) => this.booksState.update((books) => books.map((item) => item.id === id ? { ...item, ...book } : item)),
      error: (error: unknown) => { this.booksState.set(previous); this.setMutationError(error, 'Não foi possível editar o livro.'); }
    });
  }

  finishBook(id: string, finishedOn = this.today()): void {
    const previous = this.booksState();
    this.booksState.update((books) => books.map((book) => book.id === id ? { ...book, status: 'FINISHED', finishedOn } : book));
    this.recalculateDashboard();
    this.api.finishBook(id, finishedOn).subscribe({
      next: (book) => { this.booksState.update((books) => books.map((item) => item.id === id ? { ...item, ...book } : item)); this.recalculateDashboard(); },
      error: (error: unknown) => { this.booksState.set(previous); this.recalculateDashboard(); this.setMutationError(error, 'Não foi possível finalizar o livro.'); }
    });
  }

  reopenBook(id: string): void {
    const previous = this.booksState();
    this.booksState.update((books) => books.map((book) => book.id === id ? { ...book, status: 'READING', finishedOn: undefined } : book));
    this.recalculateDashboard();
    this.api.reopenBook(id).subscribe({
      next: (book) => { this.booksState.update((books) => books.map((item) => item.id === id ? { ...item, ...book } : item)); this.recalculateDashboard(); },
      error: (error: unknown) => { this.booksState.set(previous); this.recalculateDashboard(); this.setMutationError(error, 'Não foi possível reabrir o livro.'); }
    });
  }

  deleteBook(id: string): void {
    const previousBooks = this.booksState();
    const previousSessions = this.sessionsState();
    this.booksState.update((books) => books.filter((book) => book.id !== id));
    this.sessionsState.update((sessions) => sessions.filter((session) => session.bookId !== id));
    this.recalculateDashboard();
    this.api.deleteBook(id).subscribe({
      error: (error: unknown) => { this.booksState.set(previousBooks); this.sessionsState.set(previousSessions); this.recalculateDashboard(); this.setMutationError(error, 'Não foi possível excluir o livro.'); }
    });
  }

  addSession(draft: ReadingDraft): ReadingSession {
    const now = new Date().toISOString();
    const optimistic: ReadingSession = { id: `local-session-${Date.now()}`, ...draft, createdAt: now, updatedAt: now };
    this.sessionsState.update((sessions) => [optimistic, ...sessions]);
    this.recalculateDashboard();
    this.calculateVisibleStats();
    this.api.createSession(draft).subscribe({
      next: (session) => this.sessionsState.update((sessions) => sessions.map((item) => item.id === optimistic.id ? { ...optimistic, ...session } : item)),
      error: (error: unknown) => { this.sessionsState.update((sessions) => sessions.filter((item) => item.id !== optimistic.id)); this.recalculateDashboard(); this.calculateVisibleStats(); this.setMutationError(error, 'Não foi possível registrar a leitura.'); }
    });
    return optimistic;
  }

  updateSession(id: string, patch: ReadingSessionPatch): void {
    const previous = this.sessionsState();
    this.sessionsState.update((sessions) => sessions.map((session) => session.id === id ? { ...session, ...patch } : session));
    this.recalculateDashboard();
    this.calculateVisibleStats();
    this.api.updateSession(id, patch).subscribe({
      next: (session) => this.sessionsState.update((sessions) => sessions.map((item) => item.id === id ? { ...item, ...session } : item)),
      error: (error: unknown) => { this.sessionsState.set(previous); this.recalculateDashboard(); this.calculateVisibleStats(); this.setMutationError(error, 'Não foi possível editar a sessão.'); }
    });
  }

  deleteSession(id: string): void {
    const previous = this.sessionsState();
    this.sessionsState.update((sessions) => sessions.filter((session) => session.id !== id));
    this.recalculateDashboard();
    this.calculateVisibleStats();
    this.api.deleteSession(id).subscribe({
      error: (error: unknown) => { this.sessionsState.set(previous); this.recalculateDashboard(); this.calculateVisibleStats(); this.setMutationError(error, 'Não foi possível excluir a sessão.'); }
    });
  }

  getBook(id: string | null | undefined): Book | undefined { return id ? this.booksState().find((book) => book.id === id) : undefined; }
  getSession(id: string | null | undefined): ReadingSession | undefined { return id ? this.sessionsState().find((session) => session.id === id) : undefined; }
  clearError(): void { this.errorState.set(null); this.booksErrorState.set(null); this.sessionsErrorState.set(null); this.statsErrorState.set(null); }
  today(): string { return new Intl.DateTimeFormat('en-CA').format(new Date()); }

  private currentStreak(): number { return currentStreak(this.sessionsState(), this.today()); }

  private recalculateDashboard(): void {
    const today = this.today();
    const from = addDays(today, -6);
    const period = this.sessionsState().filter((session) => session.readingDate >= from && session.readingDate <= today);
    const current = this.booksState().find((book) => book.status === 'READING');
    this.dashboardState.set({
      currentStreakDays: this.currentStreak(),
      currentBook: current ? { id: current.id, title: current.title } : null,
      week: {
        pages: period.reduce((total, session) => total + session.pages, 0),
        minutes: period.reduce((total, session) => total + session.minutes, 0),
        booksFinished: this.booksState().filter((book) => book.status === 'FINISHED' && Boolean(book.finishedOn) && book.finishedOn! >= from && book.finishedOn! <= today).length
      }
    });
  }

  private calculateVisibleStats(): void {
    const current = this.statsState();
    if (!current) return;
    this.statsState.set(periodStats(this.sessionsState(), this.booksState(), current.period.from, current.period.to, this.currentStreak()));
  }

  private setMutationError(error: unknown, fallback: string): void { this.errorState.set(this.errorMessage(error, fallback)); }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object' && 'detail' in error.error) {
      const detail = (error.error as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail.trim()) return detail;
    }
    if (error instanceof TypeError) return 'Sem conexão. Conecte-se para sincronizar suas alterações.';
    return fallback;
  }
}

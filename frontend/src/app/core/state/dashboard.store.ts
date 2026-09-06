import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient } from '../api/api-client.service';
import { Book, Dashboard, ReadingSession, Stats } from '../models/models';
import { AnalyticsService } from '../analytics/analytics.service';

const demoBooks: Book[] = [{ id: 'hobbit', userId: 'demo-user', title: 'O Hobbit', author: 'J. R. R. Tolkien', status: 'READING', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z' }];
const demoDashboard: Dashboard = { currentStreakDays: 17, currentBook: { id: 'hobbit', title: 'O Hobbit' }, week: { pages: 134, minutes: 138, booksFinished: 1 } };

@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly api = inject(ApiClient);
  private readonly analytics = inject(AnalyticsService);
  private readonly dashboardState = signal<Dashboard | null>(null);
  private readonly booksState = signal<Book[]>([]);
  private readonly statsState = signal<Stats | null>(null);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly dashboard = this.dashboardState.asReadonly();
  readonly books = this.booksState.asReadonly();
  readonly stats = this.statsState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly currentBook = computed(() => this.dashboardState()?.currentBook ?? this.booksState().find((book) => book.status === 'READING') ?? null);

  load(): void {
    this.loadingState.set(true);
    this.errorState.set(null);
    this.api.getDashboard().subscribe({
      next: (dashboard) => { this.dashboardState.set(dashboard); this.loadingState.set(false); },
      error: () => { this.dashboardState.set(demoDashboard); this.booksState.set(demoBooks); this.loadingState.set(false); }
    });
    this.api.getBooks().subscribe({ next: (books) => this.booksState.set(books), error: () => this.booksState.set(demoBooks) });
  }

  addBook(title: string, author: string): Book {
    const fallback: Book = { id: `book-${Date.now()}`, userId: 'demo-user', title, author: author || undefined, status: 'READING', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.booksState.update((books) => [...books, fallback]);
    this.dashboardState.update((dashboard) => dashboard ? { ...dashboard, currentBook: { id: fallback.id, title: fallback.title } } : { ...demoDashboard, currentBook: { id: fallback.id, title: fallback.title } });
    this.analytics.track('book_created');
    this.api.createBook({ title, author: author || undefined }).subscribe({ next: (book) => this.booksState.update((books) => books.map((item) => item.id === fallback.id ? book : item)), error: () => undefined });
    return fallback;
  }

  addSession(session: Omit<ReadingSession, 'id' | 'userId'>): void {
    this.dashboardState.update((dashboard) => {
      const current = dashboard ?? demoDashboard;
      return { ...current, currentStreakDays: current.currentStreakDays + (session.readingDate === this.today() ? 1 : 0), week: { ...current.week, pages: current.week.pages + session.pages, minutes: current.week.minutes + session.minutes } };
    });
    this.analytics.track('reading_session_created', { pages: session.pages, minutes: session.minutes });
    this.api.createSession({ ...session }).subscribe({ error: () => undefined });
  }

  setStats(stats: Stats): void { this.statsState.set(stats); }
  clearError(): void { this.errorState.set(null); }
  today(): string { return new Intl.DateTimeFormat('en-CA').format(new Date()); }
}

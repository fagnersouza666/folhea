import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { LoginComponent } from './auth/login.component';
import { NewBookComponent } from './books/new-book.component';
import { ReadingComponent } from './reading/reading.component';
import { BooksComponent } from './books/books.component';
import { HomeComponent } from './home/home.component';
import { AppShellComponent } from '../layout/app-shell.component';
import { AuthService } from '../core/auth/auth.service';
import { DashboardStore } from '../core/state/dashboard.store';
import { PwaService } from '../core/services/pwa.service';
import { AnalyticsService } from '../core/analytics/analytics.service';
import { Book } from '../core/models/models';

const book: Book = {
  id: 'book-1',
  title: 'O Hobbit',
  author: 'J. R. R. Tolkien',
  status: 'READING'
};

const createStore = (overrides: Record<string, unknown> = {}) => {
  const booksSignal = (overrides.books as ReturnType<typeof signal<Book[]>>) ?? signal<Book[]>([book]);
  const rest = { ...overrides };
  delete rest.books;
  delete rest.selectableBooks;
  return {
    books: booksSignal,
    selectableBooks: () => booksSignal().filter((item) => !item.id.startsWith('local-')),
    booksLoading: signal(false),
    booksError: signal<string | null>(null),
    sessionsError: signal<string | null>(null),
    today: () => '2026-09-06',
    addBook: vi.fn(),
    addSession: vi.fn(),
    loadSessions: vi.fn(),
    reload: vi.fn(),
    ...rest
  };
};

describe('critical form DOM states', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('keeps the BFF sign-in hand-off keyboard reachable', () => {
    const auth = { signIn: vi.fn() };
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }]
    });

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const submit = fixture.nativeElement.querySelector('.submit-button') as HTMLButtonElement;
    expect(submit.type).toBe('button');
    expect(submit.tabIndex).toBeGreaterThanOrEqual(0);
    expect(fixture.nativeElement.querySelector('.auth-intro')?.textContent).toContain('servidor');
    submit.click();
    expect(auth.signIn).toHaveBeenCalledOnce();
  });

  it('keeps a blank book submission on the form and exposes its error', () => {
    const store = createStore();
    TestBed.configureTestingModule({
      imports: [NewBookComponent],
      providers: [provideRouter([]), { provide: DashboardStore, useValue: store }]
    });

    const fixture = TestBed.createComponent(NewBookComponent);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('#book-title') as HTMLInputElement;
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(title.getAttribute('aria-describedby')).toBe('book-title-error');
    expect(fixture.nativeElement.querySelector('#book-title-error')?.textContent).toContain('título');
    expect(store.addBook).not.toHaveBeenCalled();
  });

  it('reports an empty reading without hiding the critical form fields', () => {
    const store = createStore();
    TestBed.configureTestingModule({
      imports: [ReadingComponent],
      providers: [provideRouter([]), { provide: DashboardStore, useValue: store }]
    });

    const fixture = TestBed.createComponent(ReadingComponent);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#reading-book')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#reading-pages')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#reading-minutes')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#reading-empty-error')?.getAttribute('role')).toBe('alert');
    expect(fixture.nativeElement.querySelector('#reading-book-error')).not.toBeNull();
    expect(store.addSession).not.toHaveBeenCalled();
  });

  it('offers a real retry action when the books API fails', () => {
    const store = createStore({ books: signal<Book[]>([]), booksError: signal('Não foi possível carregar seus livros.') });
    TestBed.configureTestingModule({
      imports: [BooksComponent],
      providers: [provideRouter([]), { provide: DashboardStore, useValue: store }]
    });

    const fixture = TestBed.createComponent(BooksComponent);
    fixture.detectChanges();
    const retry = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((button) => button.textContent?.includes('Tentar')) as HTMLButtonElement;
    retry.click();

    expect(store.reload).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível');
  });

  it('keeps the reading form available while sessions are offline', () => {
    const store = createStore({ sessionsError: signal('Não foi possível carregar suas sessões.') });
    TestBed.configureTestingModule({
      imports: [ReadingComponent],
      providers: [provideRouter([]), { provide: DashboardStore, useValue: store }]
    });

    const fixture = TestBed.createComponent(ReadingComponent);
    fixture.detectChanges();
    const retry = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((button) => button.textContent?.includes('Tentar')) as HTMLButtonElement;
    retry.click();

    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    expect(store.loadSessions).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('conexão');
  });

  it('distinguishes loading and empty library states without losing the next action', () => {
    const booksLoading = signal(true);
    const store = createStore({ books: signal<Book[]>([]), booksLoading });
    TestBed.configureTestingModule({
      imports: [BooksComponent],
      providers: [provideRouter([]), { provide: DashboardStore, useValue: store }]
    });

    const fixture = TestBed.createComponent(BooksComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain('Carregando');
    expect(fixture.nativeElement.querySelector('.empty')).toBeNull();

    booksLoading.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.empty h2')?.textContent).toContain('biblioteca');
    expect(fixture.nativeElement.querySelector('.empty a')).not.toBeNull();
  });

  it('does not replace a dashboard failure with silent zero-value content', () => {
    const store = createStore({
      loading: signal(false),
      dashboard: signal(null),
      currentBook: signal(null),
      error: signal('Não foi possível carregar seu resumo.'),
      reload: vi.fn()
    });
    const auth = { user: signal(null) };
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [provideRouter([]), { provide: DashboardStore, useValue: store }, { provide: AuthService, useValue: auth }]
    });

    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível carregar');
    expect(fixture.nativeElement.querySelector('[role="alert"] button')?.textContent).toContain('Tentar novamente');
  });

  it('keeps the skip link and primary navigation keyboard reachable', () => {
    const store = createStore({ load: vi.fn(), error: signal(null) });
    const auth = { user: signal({ email: 'reader@example.com' }), signOut: vi.fn() };
    const pwa = { online: signal(true), updateAvailable: signal(false), activateUpdate: vi.fn() };
    const analytics = { track: vi.fn() };
    TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([]),
        { provide: DashboardStore, useValue: store },
        { provide: AuthService, useValue: auth },
        { provide: PwaService, useValue: pwa },
        { provide: AnalyticsService, useValue: analytics }
      ]
    });

    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    const skip = fixture.nativeElement.querySelector('.skip-link') as HTMLAnchorElement;
    const nav = fixture.nativeElement.querySelector('nav[aria-label="Navegação principal"]') as HTMLElement;

    expect(skip.getAttribute('href')).toBe('#main-content');
    expect(fixture.nativeElement.querySelector('#main-content')).not.toBeNull();
    expect(nav.querySelectorAll('a')).toHaveLength(4);
    expect(Array.from(nav.querySelectorAll('a')).every((link) => (link as HTMLAnchorElement).tabIndex >= 0)).toBe(true);
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { DashboardStore } from '../../core/state/dashboard.store';
import { EditSessionComponent } from './edit-session.component';
import { ReadingComponent } from './reading.component';

const book = { id: 'book-a', title: 'Livro A', status: 'READING', totalPages: 300, pagesRead: 75, averagePagesPerReadingDay: 37.5, progressPercent: 25 };
const destination = { ...book, id: 'book-b', title: 'Livro B', pagesRead: 50, averagePagesPerReadingDay: 50, progressPercent: 16 };
const session = { id: 'session-a', bookId: book.id, readingDate: '2026-09-05', pages: 30, minutes: 18 };

describe('SESSAO-01 reading forms and official progress', () => {
  let http: HttpTestingController;
  let store: DashboardStore;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ReadingComponent, EditSessionComponent], providers: [
      provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: AuthService, useValue: { user: () => ({ timezone: 'UTC' }) } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ bookId: book.id }), paramMap: convertToParamMap({ id: session.id }) } } }
    ] });
    http = TestBed.inject(HttpTestingController); store = TestBed.inject(DashboardStore);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    store.loadBooks(); http.expectOne('/api/v1/books?limit=100&offset=0').flush([book, destination]);
    store.loadSessions(); http.expectOne('/api/v1/sessions?limit=100&offset=0').flush([session]);
  });
  afterEach(() => { try { http.verify(); } finally { vi.restoreAllMocks(); TestBed.resetTestingModule(); } });

  function refresh(bookId = book.id): void {
    http.expectOne(`/api/v1/books/${bookId}`).flush(bookId === book.id ? book : destination);
    http.expectOne('/api/v1/dashboard').flush({ currentStreakDays: 1, currentBook: null, week: { pages: 75, minutes: 18, booksFinished: 0 } });
    http.expectOne(request => request.url === '/api/v1/stats').flush({ pages: 75, minutes: 18, booksFinished: 0, currentStreakDays: 1 });
    http.expectOne('/api/v1/sessions?limit=100&offset=0').flush([session]);
  }

  it('submits minutes only with an omitted pages input normalized to zero', () => {
    const fixture = TestBed.createComponent(ReadingComponent); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const pages = root.querySelector<HTMLInputElement>('#reading-pages')!;
    const minutes = root.querySelector<HTMLInputElement>('#reading-minutes')!;
    pages.value = ''; pages.dispatchEvent(new Event('input'));
    minutes.value = '18'; minutes.dispatchEvent(new Event('input'));
    fixture.componentInstance.form.controls.readingDate.setValue('2026-09-05');
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const request = http.expectOne('/api/v1/sessions');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ bookId: book.id, readingDate: '2026-09-05', pages: 0, minutes: 18 });
    request.flush({ ...session, pages: 0 }); refresh();
    expect(store.getSession(session.id)?.minutes).toBe(18);
    http.expectNone(request => request.method === 'POST');
  });

  it.each([{ pages: 0, minutes: 0 }, { pages: -1, minutes: 18 }, { pages: 1.5, minutes: 18 }, { pages: 10_001, minutes: 18 }, { pages: 1, minutes: 1441 }])('blocks invalid quantities $pages pages / $minutes minutes', values => {
    const fixture = TestBed.createComponent(ReadingComponent); fixture.detectChanges();
    fixture.componentInstance.form.patchValue({ ...values, readingDate: '2026-09-05' });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.form.invalid).toBe(true);
    expect(fixture.componentInstance.busy()).toBe(false);
    http.expectNone(request => request.method === 'POST');
  });

  it('shows canonical progress for the selected book in the session editor', () => {
    const fixture = TestBed.createComponent(EditSessionComponent); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.daily-average')?.textContent).toContain('37,5');
    const select = root.querySelector<HTMLSelectElement>('#edit-book')!;
    select.value = destination.id; select.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(root.querySelector('.daily-average')?.textContent).toContain('50');
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('16');
  });

  it('keeps a dirty session draft through progress failure and retry without PATCH', () => {
    const fixture = TestBed.createComponent(EditSessionComponent); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const pages = root.querySelector<HTMLInputElement>('#edit-pages')!;
    pages.value = '41'; pages.dispatchEvent(new Event('input'));
    store.loadBookStats(book.id); fixture.detectChanges();
    expect(root.querySelector('.pages-read')).toBeNull();
    http.expectOne(`/api/v1/books/${book.id}`).flush(null, { status: 503, statusText: 'Unavailable' });
    store.clearError(); fixture.detectChanges();
    const retry = root.querySelector<HTMLButtonElement>('.book-progress .retry');
    expect(retry).not.toBeNull(); retry!.click();
    http.expectOne(`/api/v1/books/${book.id}`).flush({ ...book, pagesRead: 90, averagePagesPerReadingDay: 45, progressPercent: 30 });
    fixture.detectChanges();
    expect(pages.value).toBe('41');
    expect(root.querySelector('.daily-average')?.textContent).toContain('45');
    http.expectNone(request => request.method !== 'GET');
  });

  it('allows editing to minutes only and retains the form when PATCH is rejected', () => {
    const fixture = TestBed.createComponent(EditSessionComponent); fixture.detectChanges();
    const component = fixture.componentInstance;
    component.form.patchValue({ pages: 0, minutes: 18 }); component.form.markAsDirty(); component.save();
    const request = http.expectOne(`/api/v1/sessions/${session.id}`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ bookId: book.id, readingDate: '2026-09-05', pages: 0, minutes: 18 });
    request.flush({ detail: 'Não foi possível salvar.' }, { status: 503, statusText: 'Unavailable' });
    expect(component.busy()).toBe(false);
    expect(component.form.controls.minutes.value).toBe(18);
    expect(store.getSession(session.id)?.pages).toBe(30);
    http.expectNone(request => request.method === 'POST');
  });
});

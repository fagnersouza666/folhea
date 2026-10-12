import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from '../../core/analytics/analytics.service';
import { csrfInterceptor } from '../../core/api/csrf.interceptor';
import { AuthService } from '../../core/auth/auth.service';
import { Book } from '../../core/models/models';
import { BooksComponent } from './books.component';
import { CoverPickerComponent } from './cover-picker.component';
import { NewBookComponent } from './new-book.component';

const saved: Book & { hasPhoto: boolean } = {
  id: 'photo-book', title: 'Exemplar próprio', author: null, edition: null, totalPages: null,
  status: 'READING', hasPhoto: false, cover: null,
  stats: { pagesRead: 0, totalPages: null, percent: null, firstDate: null, referenceDate: '2026-10-12' }
};

/** Real form/store/client/interceptor; only HTTP, authentication and prepared-file boundaries are doubled. */
describe('LIVRO-02 optional total and photo retry', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<NewBookComponent>;
  let root: HTMLElement;
  let csrfCookie: string;
  beforeEach(() => {
    csrfCookie = '';
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => csrfCookie);
    TestBed.configureTestingModule({ imports: [NewBookComponent], providers: [
      provideRouter([{ path: 'app/livros', component: BooksComponent }]),
      provideHttpClient(withInterceptors([csrfInterceptor])), provideHttpClientTesting(),
      { provide: AuthService, useValue: { user: () => ({ timezone: 'UTC' }), initialized: () => true, isAuthenticated: () => true, signOut: () => undefined } },
      { provide: AnalyticsService, useValue: { track: () => undefined } }
    ] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(NewBookComponent); fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
    input('#book-title', 'Exemplar próprio');
  });
  afterEach(() => { try { http.verify(); } finally { TestBed.resetTestingModule(); vi.restoreAllMocks(); } });
  function input(selector: string, value: string) {
    const field = root.querySelector<HTMLInputElement>(selector)!;
    field.value = value; field.dispatchEvent(new Event('input')); fixture.detectChanges();
  }
  function submit() { root.querySelector('form')!.dispatchEvent(new Event('submit')); fixture.detectChanges(); }
  function issueCsrf() {
    csrfCookie = '__Host-folhea_csrf=synthetic-csrf-value';
    http.expectOne('/api/v1/csrf').flush({ token: 'synthetic-csrf-value' });
  }
  function selectedPhoto(): File {
    const file = new File(['normalized-synthetic-jpeg'], 'capa.jpg', { type: 'image/jpeg' });
    fixture.debugElement.query(By.directive(CoverPickerComponent)).componentInstance.selectionChange.emit({ file, preparing: false, error: null });
    fixture.detectChanges(); return file;
  }
  function finishCreate(book = saved) {
    const request = http.expectOne('/api/v1/books');
    expect(request.request.method).toBe('POST'); expect(request.request.body).not.toBeInstanceOf(FormData);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('synthetic-csrf-value');
    expect(request.request.withCredentials).toBe(true);
    request.flush(book);
    http.expectOne('/api/v1/books?limit=100&offset=0').flush([book]);
    return request.request.body;
  }
  function retryButton() {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => /Tentar enviar foto novamente/i.test(button.textContent ?? ''));
  }

  it('creates a book with a blank optional total without uploading a nonexistent photo', async () => {
    expect(fixture.componentInstance.totalPages.valid).toBe(true);
    submit(); issueCsrf();
    expect(finishCreate()).toEqual({ title: 'Exemplar próprio', author: null, edition: null, totalPages: null });
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/app/livros');
    http.expectNone(request => request.method === 'PUT' || request.method === 'POST');
  });
  it('accepts a positive whole total beyond the old artificial million-page limit', async () => {
    input('#book-total-pages', '1000001'); expect(fixture.componentInstance.totalPages.valid).toBe(true);
    submit(); issueCsrf();
    expect(finishCreate({ ...saved, totalPages: 1000001 })).toMatchObject({ totalPages: 1000001 });
    await fixture.whenStable(); expect(TestBed.inject(Router).url).toBe('/app/livros');
  });
  it('uploads RAW JPEG after saving once and retries the same book when the photo request fails', async () => {
    input('#book-total-pages', '300');
    const photo = selectedPhoto(); submit(); submit(); issueCsrf(); finishCreate();
    const upload = http.expectOne('/api/v1/books/photo-book/photo');
    expect(upload.request.method).toBe('PUT'); expect(upload.request.body).toBe(photo);
    expect(upload.request.headers.get('Content-Type')).toBe('image/jpeg');
    expect(upload.request.headers.get('X-CSRF-Token')).toBe('synthetic-csrf-value'); expect(upload.request.withCredentials).toBe(true);
    upload.flush({ title: 'Foto indisponível' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')?.textContent).toMatch(/livro.*salvo/i);
    expect(fixture.componentInstance.cover().file).toBe(photo);
    expect(TestBed.inject(Router).url).not.toBe('/app/livros');
    const retry = retryButton(); expect(retry).toBeDefined(); retry!.click(); retry!.click();
    const retried = http.expectOne('/api/v1/books/photo-book/photo');
    expect(retried.request.method).toBe('PUT'); expect(retried.request.body).toBe(photo);
    http.expectNone(request => request.method === 'POST'); http.expectNone('/api/v1/csrf');
    retried.flush({ ...saved, hasPhoto: true });
    // Photo mutations may reload the book/list; preserve observable results rather than coupling to refresh ordering.
    for (const refresh of http.match(request => request.method === 'GET' && (request.url === '/api/v1/books' || request.url === '/api/v1/books/photo-book'))) {
      refresh.flush(refresh.request.url === '/api/v1/books' ? [{ ...saved, hasPhoto: true }] : { ...saved, hasPhoto: true });
    }
    await fixture.whenStable(); expect(TestBed.inject(Router).url).toBe('/app/livros');
    http.expectNone(request => request.method === 'POST');
  });
  it('can keep the already saved book without a photo after an upload failure', async () => {
    input('#book-total-pages', '300');
    selectedPhoto(); submit(); issueCsrf(); finishCreate();
    http.expectOne('/api/v1/books/photo-book/photo').flush(null, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    const keep = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(button => /Continuar sem foto/i.test(button.textContent ?? ''));
    expect(keep).toBeDefined(); keep!.click();
    await fixture.whenStable(); expect(TestBed.inject(Router).url).toBe('/app/livros');
    http.expectNone(request => request.method === 'POST' || request.method === 'PUT');
  });
});

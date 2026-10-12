import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NewBookComponent } from './new-book.component';
import { BooksComponent } from './books.component';
import { AuthService } from '../../core/auth/auth.service';
import { AnalyticsService } from '../../core/analytics/analytics.service';

describe('new book metadata validation', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NewBookComponent], providers: [
      provideRouter([{ path: 'app/livros', component: BooksComponent }]), provideHttpClient(), provideHttpClientTesting(),
      { provide: AuthService, useValue: { user: () => ({ timezone: 'UTC' }) } },
      { provide: AnalyticsService, useValue: { track: () => undefined } }
    ] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  it('rejects a zero or fractional total before creating a book and exposes the field error', () => {
    const fixture = TestBed.createComponent(NewBookComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const title = root.querySelector<HTMLInputElement>('#book-title')!;
    title.value = 'Um livro'; title.dispatchEvent(new Event('input'));
    const total = root.querySelector<HTMLInputElement>('#book-total-pages');
    expect(total, 'a new book needs a total-pages field').not.toBeNull();
    for (const invalid of ['0', '1.5']) {
      total!.value = invalid; total!.dispatchEvent(new Event('input'));
      root.querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      expect(total!.getAttribute('aria-invalid')).toBe('true');
      expect(total!.getAttribute('aria-describedby')).toContain('book-total-pages-error');
      expect(root.querySelector('#book-total-pages-error')).not.toBeNull();
      http.expectNone((request) => request.method === 'POST');
    }
  });

  it('keeps an unsupported cover on the form with an accessible error instead of creating a book', async () => {
    const fixture = TestBed.createComponent(NewBookComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    for (const [selector, value] of [['#book-title', 'Um livro'], ['#book-total-pages', '150']]) {
      const field = root.querySelector<HTMLInputElement>(selector)!;
      field.value = value; field.dispatchEvent(new Event('input'));
    }
    const cover = root.querySelector<HTMLInputElement>('#book-cover-file');
    expect(cover, 'cover selection must be reachable from the book form').not.toBeNull();
    Object.defineProperty(cover!, 'files', { configurable: true, value: [new File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' })] });
    cover!.dispatchEvent(new Event('change'));
    await fixture.whenStable(); fixture.detectChanges();
    root.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')?.textContent).toMatch(/JPEG.*PNG/);
    http.expectNone((request) => request.method === 'POST');
  });

  it('creates the selected metadata once and enters the private bookshelf', async () => {
    const fixture = TestBed.createComponent(NewBookComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const edition = root.querySelector<HTMLInputElement>('#book-edition');
    expect(edition, 'edition is editable book metadata').not.toBeNull();
    for (const [selector, value] of [['#book-title', '  Um livro  '], ['#book-author', '  Uma autora  '], ['#book-edition', '  2ª edição  '], ['#book-total-pages', '300']]) {
      const field = root.querySelector<HTMLInputElement>(selector)!;
      field.value = value; field.dispatchEvent(new Event('input'));
    }
    root.querySelector('form')!.dispatchEvent(new Event('submit'));
    root.querySelector('form')!.dispatchEvent(new Event('submit'));
    const request = http.expectOne('/api/v1/books');
    expect(request.request.body).toEqual({ title: 'Um livro', author: 'Uma autora', edition: '2ª edição', totalPages: 300 });
    const book = { id: 'new-book', ...request.request.body, status: 'READING', cover: null, stats: { pagesRead: 0, totalPages: 300, percent: 0, firstDate: null, referenceDate: '2026-09-06' } };
    request.flush(book);
    http.expectOne('/api/v1/books?limit=100&offset=0').flush([book]);
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/app/livros');
    http.expectNone(request => request.method === 'POST');
  });
});

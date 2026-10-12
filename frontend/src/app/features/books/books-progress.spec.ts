import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BooksComponent } from './books.component';
import { DashboardStore } from '../../core/state/dashboard.store';
import { AuthService } from '../../core/auth/auth.service';
import { Book, BookStats } from '../../core/models/models';

const stats: BookStats = { pagesRead: 2999, totalPages: 3000, percent: 99.96, averagePagesPerDay: 99.97, firstDate: '2026-08-01', referenceDate: '2026-08-30', elapsedDays: 30 };
const book: Book = { id: 'book-1', title: 'Um livro', author: 'Autora', edition: '2ª edição', totalPages: 3000, status: 'READING', cover: null, stats };

describe('private bookshelf official progress', () => {
  let http: HttpTestingController;
  let store: DashboardStore;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BooksComponent], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { user: () => ({ timezone: 'UTC' }) } }] });
    http = TestBed.inject(HttpTestingController); store = TestBed.inject(DashboardStore);
  });
  afterEach(() => { try { http.verify(); } finally { TestBed.resetTestingModule(); } });
  function render(item: Book) {
    store.loadBooks(); http.expectOne('/api/v1/books?limit=100&offset=0').flush([item]);
    const fixture = TestBed.createComponent(BooksComponent); fixture.detectChanges(); return fixture;
  }
  it('shows canonical pages, edition and precise incomplete percentage with a book-specific reading link', () => {
    const fixture = render(book); const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('2ª edição');
    expect(root.querySelector('.pages-read')?.textContent).toContain('2.999');
    expect(root.querySelector('.percent')?.textContent).toContain('99,96%');
    const bar = root.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('99.96');
    expect(root.querySelector('.daily-average')?.textContent).toContain('99,97');
    const read = Array.from(root.querySelectorAll('a')).find(a => a.textContent?.includes('Registrar leitura'));
    expect(read?.getAttribute('href')).toBe('/app/ler?bookId=book-1');
  });
  it('preserves pages read and average for legacy books without fabricating a percentage', () => {
    const fixture = render({ ...book, totalPages: null, stats: { ...stats, totalPages: null, percent: null } });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.pages-read')?.textContent).toContain('2.999');
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
    expect(root.textContent).toContain('Informe o total de páginas');
    expect(root.querySelector('a.complete-metadata')?.getAttribute('href')).toBe('/app/livros/book-1');
  });
  it('retries official metrics after a failure without restoring old values or posting a reading', () => {
    const fixture = render(book);
    store.loadBookStats(book.id); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pages-read')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Atualizando progresso');
    http.expectOne('/api/v1/books/book-1').flush(null, { status: 503, statusText: 'Unavailable' });
    store.clearError(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pages-read')).toBeNull();
    const retry = fixture.nativeElement.querySelector('.book-progress button') as HTMLButtonElement;
    expect(retry?.textContent).toContain('Tentar novamente'); retry.click();
    http.expectOne('/api/v1/books/book-1').flush({ ...book, stats: { ...stats, pagesRead: 3000, percent: 100, averagePagesPerDay: 100 } });
    fixture.detectChanges(); expect(fixture.nativeElement.querySelector('.percent')?.textContent).toContain('100%');
    http.expectNone(request => request.method === 'POST');
  });
  it('uses an authenticated lazy cover URL and offers a readable fallback when the image fails', () => {
    const fixture = render({ ...book, cover: { mediaType: 'image/jpeg', byteSize: 50, width: 100, height: 150, version: 'cover-v1' } });
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(image?.getAttribute('src')).toBe('/api/v1/books/book-1/cover?v=cover-v1');
    expect(image?.getAttribute('loading')).toBe('lazy');
    image.dispatchEvent(new Event('error')); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Capa indisponível');
    const retry = fixture.nativeElement.querySelector('.cover-retry') as HTMLButtonElement;
    expect(retry).not.toBeNull(); retry.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).not.toBeNull();
  });
});

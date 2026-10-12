import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BooksComponent } from './books.component';
import { DashboardStore } from '../../core/state/dashboard.store';
import { AuthService } from '../../core/auth/auth.service';
import { Book, BookStats } from '../../core/models/models';

const stats: BookStats = {
  pagesRead: 2999, totalPages: 3000, percent: 99.96, averagePagesPerDay: 99.97,
  firstDate: '2026-08-01', referenceDate: '2026-08-30', elapsedDays: 30
};
const book: Book & { pagesRead: number; averagePagesPerReadingDay: number | null; progressPercent: number | null } = { id: 'book-1', title: 'Um livro', author: 'Autora', edition: '2ª edição', totalPages: 3000, status: 'READING', cover: null, stats, pagesRead: 2999, averagePagesPerReadingDay: 1499.5, progressPercent: 99 };

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
  it('uses official reading-day average and floored progress instead of legacy calendar metrics', () => {
    const fixture = render(book); const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('2ª edição');
    expect(root.querySelector('.pages-read')?.textContent).toContain('2.999');
    expect(root.querySelector('.percent')?.textContent).toContain('99%');
    const bar = root.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('99');
    expect(root.querySelector('.daily-average')?.textContent).toContain('1.499,5');
    expect(root.querySelector('.daily-average')?.textContent).toContain('páginas por dia de leitura');
    expect(root.textContent).not.toContain('incluindo dias sem leitura');
    const read = Array.from(root.querySelectorAll('a')).find(a => a.textContent?.includes('Registrar leitura'));
    expect(read?.getAttribute('href')).toBe('/app/ler?bookId=book-1');
  });
  it('preserves pages read and average for legacy books without fabricating a percentage', () => {
    const fixture = render({ ...book, totalPages: null, progressPercent: null, stats: { ...stats, totalPages: null, percent: null } });
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
    http.expectOne('/api/v1/books/book-1').flush({ ...book, pagesRead: 3000, progressPercent: 100, averagePagesPerReadingDay: 1500, stats: { ...stats, pagesRead: 3000, percent: 100, averagePagesPerDay: 100 } });
    fixture.detectChanges(); expect(fixture.nativeElement.querySelector('.percent')?.textContent).toContain('100%');
    http.expectNone(request => request.method === 'POST');
  });
  it('does not invent a zero average for a book with no pages recorded', () => {
    const fixture = render({ ...book, pagesRead: 0, progressPercent: 0, averagePagesPerReadingDay: null, stats: { ...stats, pagesRead: 0, percent: 0, averagePagesPerDay: 0, firstDate: null, elapsedDays: 0 } });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.pages-read')?.textContent).toContain('0');
    expect(root.querySelector('.daily-average strong')).toBeNull();
    expect(root.textContent).toContain('Registre páginas');
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0');
  });
  it('shows the official one-decimal average independently of elapsed calendar days', () => {
    const fixture = render({ ...book, totalPages: 300, pagesRead: 75, progressPercent: 25, averagePagesPerReadingDay: 37.5, stats: { ...stats, pagesRead: 75, totalPages: 300, percent: 25, averagePagesPerDay: 2.5 } });
    expect(fixture.nativeElement.querySelector('.daily-average')?.textContent).toContain('37,5');
    expect(fixture.nativeElement.querySelector('.percent')?.textContent).toContain('25%');
  });
  it('keeps the real sum beyond the total without automatically finishing the book', () => {
    const fixture = render({ ...book, totalPages: 300, pagesRead: 375, progressPercent: 100, averagePagesPerReadingDay: 187.5, stats: { ...stats, pagesRead: 375, totalPages: 300, percent: 100 } });
    expect(fixture.nativeElement.querySelector('.pages-read')?.textContent).toContain('375');
    expect(fixture.nativeElement.querySelector('.percent')?.textContent).toContain('100%');
    expect(store.getBook(book.id)?.status).toBe('READING');
    http.expectNone(request => request.method !== 'GET');
  });
  it('does not fall back to calendar metrics when the official reading fields are absent', () => {
    const fixture = render({ id: book.id, title: book.title, status: 'READING', totalPages: 3000, stats });
    expect(fixture.nativeElement.querySelector('.pages-read')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Progresso indisponível');
    expect(fixture.nativeElement.querySelector('.book-progress .retry')).not.toBeNull();
  });
  it('uses an authenticated lazy cover URL and offers a readable fallback when the image fails', () => {
    const fixture = render({ ...book, cover: { mediaType: 'image/jpeg', byteSize: 50, width: 100, height: 150, version: 'cover-v1' } });
    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(image?.getAttribute('src')).toBe('/api/v1/books/book-1/photo?v=cover-v1');
    expect(image?.getAttribute('loading')).toBe('lazy');
    image.dispatchEvent(new Event('error')); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Capa indisponível');
    const retry = fixture.nativeElement.querySelector('.cover-retry') as HTMLButtonElement;
    expect(retry).not.toBeNull(); retry.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).not.toBeNull();
  });
});

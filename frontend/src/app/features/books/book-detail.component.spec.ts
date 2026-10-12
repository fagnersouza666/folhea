import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BookDetailComponent } from './book-detail.component';
import { CoverPickerComponent } from './cover-picker.component';
import { DashboardStore } from '../../core/state/dashboard.store';
import { AuthService } from '../../core/auth/auth.service';
import { Book } from '../../core/models/models';

const legacy: Book = { id: 'old-book', title: 'Antigo', author: null, edition: null, totalPages: null, cover: null, status: 'READING', pagesRead: 45, averagePagesPerReadingDay: 22.5, progressPercent: null, stats: { pagesRead: 45, totalPages: null, percent: null, averagePagesPerDay: 5, firstDate: '2026-09-01', referenceDate: '2026-09-09', elapsedDays: 9 } };

describe('book metadata and private cover editing', () => {
  let http: HttpTestingController; let store: DashboardStore;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BookDetailComponent], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { user: () => ({ timezone: 'UTC' }) } }, { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: legacy.id }) } } }] });
    http = TestBed.inject(HttpTestingController); store = TestBed.inject(DashboardStore);
  });
  afterEach(() => { try { http.verify(); } finally { TestBed.resetTestingModule(); } });
  function render(book: Book = legacy) {
    store.loadBooks(); http.expectOne('/api/v1/books?limit=100&offset=0').flush([book]);
    const fixture = TestBed.createComponent(BookDetailComponent); fixture.detectChanges(); return fixture;
  }
  function flushRefresh(book: Book) {
    http.expectOne('/api/v1/books?limit=100&offset=0').flush([book]);
    http.expectOne('/api/v1/dashboard').flush({ currentStreakDays: 0, currentBook: null, week: { pages: 45, minutes: 0, booksFinished: 0 } });
    http.expectOne(request => request.url === '/api/v1/stats').flush({ pages: 45 });
  }
  it('keeps legacy totals blank and lets the reader complete metadata without changing readings', () => {
    const fixture = render(); const root = fixture.nativeElement as HTMLElement;
    const total = root.querySelector<HTMLInputElement>('#detail-book-total-pages');
    expect(total, 'legacy book totals must remain editable').not.toBeNull(); expect(total!.value).toBe('');
    const edition = root.querySelector<HTMLInputElement>('#detail-book-edition')!;
    total!.value = '200'; total!.dispatchEvent(new Event('input')); edition.value = '3ª edição'; edition.dispatchEvent(new Event('input'));
    root.querySelector('form')!.dispatchEvent(new Event('submit'));
    const patch = http.expectOne('/api/v1/books/old-book');
    expect(patch.request.method).toBe('PATCH'); expect(patch.request.body).toEqual({ title: 'Antigo', author: null, edition: '3ª edição', totalPages: 200 });
    const book = { ...legacy, edition: '3ª edição', totalPages: 200, progressPercent: 22, stats: { ...legacy.stats!, totalPages: 200, percent: 22.5 } };
    patch.flush(book); flushRefresh(book); fixture.detectChanges();
    expect(root.querySelector('.percent')?.textContent).toContain('22%');
    http.expectNone(request => request.url.includes('/sessions'));
  });
  it('sends a RAW replacement independently and preserves the old photo and unsaved metadata after failure', () => {
    const cover = { mediaType: 'image/jpeg' as const, byteSize: 200, width: 80, height: 120, version: 'old-cover' };
    const fixture = render({ ...legacy, cover }); const root = fixture.nativeElement as HTMLElement;
    const picker = fixture.debugElement.query(By.directive(CoverPickerComponent)); expect(picker).not.toBeNull();
    picker.componentInstance.selectionChange.emit({ file: new File(['jpeg'], 'capa.jpg', { type: 'image/jpeg' }), preparing: false, error: null });
    const title = root.querySelector<HTMLInputElement>('#detail-book-title')!; title.value = 'Título editado'; title.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const upload = Array.from(root.querySelectorAll('button')).find(button => button.textContent?.includes('Enviar foto'));
    expect(upload).not.toBeUndefined(); upload!.click();
    const put = http.expectOne('/api/v1/books/old-book/photo'); expect(put.request.method).toBe('PUT'); expect(put.request.body).toBeInstanceOf(File);
    put.flush(null, { status: 413, statusText: 'Too Large' }); fixture.detectChanges();
    expect(title.value).toBe('Título editado'); expect(root.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível');
    expect(store.getBook(legacy.id)?.cover?.version).toBe('old-cover');
    expect(fixture.componentInstance.cover().file).not.toBeNull(); http.expectNone(request => request.method === 'POST' || request.method === 'PATCH');
  });
  it('removes a saved private cover with DELETE and refreshes its versioned metadata', () => {
    const fixture = render({ ...legacy, cover: { mediaType: 'image/jpeg', byteSize: 200, width: 80, height: 120, version: 'old-cover' } });
    const remove = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(button => button.textContent?.includes('Remover capa salva'));
    expect(remove).not.toBeUndefined(); remove!.click();
    const request = http.expectOne('/api/v1/books/old-book/photo'); expect(request.request.method).toBe('DELETE'); request.flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne('/api/v1/books/old-book').flush(legacy); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('folhea-book-cover img')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Capa removida');
  });
});

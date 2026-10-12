import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { Book } from '../../core/models/models';
import { DashboardStore } from '../../core/state/dashboard.store';
import { BookDetailComponent } from './book-detail.component';
import { BooksComponent } from './books.component';
import { CoverPickerComponent } from './cover-picker.component';

const saved: Book & { hasPhoto: boolean } = {
  id: 'owned-photo', title: 'Exemplar privado', author: 'Autora', edition: '2ª', totalPages: 300,
  status: 'READING', hasPhoto: true, cover: null,
  stats: { pagesRead: 75, totalPages: 300, percent: 25, firstDate: '2026-09-01', referenceDate: '2026-09-15' }
};

describe('LIVRO-02 private photo presentation', () => {
  let http: HttpTestingController;
  let store: DashboardStore;
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BooksComponent, BookDetailComponent], providers: [
      provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: AuthService, useValue: { user: () => ({ timezone: 'UTC' }) } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: saved.id }) } } }
    ] });
    http = TestBed.inject(HttpTestingController); store = TestBed.inject(DashboardStore);
  });
  afterEach(() => { try { http.verify(); } finally { TestBed.resetTestingModule(); } });
  function load(book = saved) {
    store.loadBooks(); http.expectOne('/api/v1/books?limit=100&offset=0').flush([book]);
  }

  it('shows hasPhoto through the authenticated photo path without requiring legacy cover metadata', () => {
    load();
    const fixture = TestBed.createComponent(BooksComponent); fixture.detectChanges();
    const image = fixture.nativeElement.querySelector('folhea-book-cover img') as HTMLImageElement;
    expect(image).not.toBeNull(); expect(image.getAttribute('src')).toMatch(/^\/api\/v1\/books\/owned-photo\/photo(?:\?.*)?$/);
    expect(image.getAttribute('loading')).toBe('lazy');
    image.dispatchEvent(new Event('error')); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toMatch(/(?:capa|foto) indisponível/i);
    const retry = fixture.nativeElement.querySelector('.cover-retry') as HTMLButtonElement;
    expect(retry).not.toBeNull(); retry.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('folhea-book-cover img')).not.toBeNull();
  });
  it('renders a readable fallback without requesting a missing photo for a legacy book', () => {
    load({ ...saved, totalPages: null, hasPhoto: false, stats: { ...saved.stats!, totalPages: null, percent: null } });
    const fixture = TestBed.createComponent(BooksComponent); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('folhea-book-cover img')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Exemplar privado');
    expect(fixture.nativeElement.querySelector('[role="progressbar"]')).toBeNull();
  });
  it('removes the saved photo through DELETE photo and updates the detail without posting another book', () => {
    load();
    const fixture = TestBed.createComponent(BookDetailComponent); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const remove = Array.from(root.querySelectorAll('button')).find(button => /Remover (?:capa|foto) salva/i.test(button.textContent ?? ''));
    expect(remove).toBeDefined(); remove!.click();
    const request = http.expectOne('/api/v1/books/owned-photo/photo'); expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    for (const refresh of http.match(request => request.method === 'GET' && (request.url === '/api/v1/books/owned-photo' || request.url === '/api/v1/books'))) {
      refresh.flush(refresh.request.url === '/api/v1/books' ? [{ ...saved, hasPhoto: false }] : { ...saved, hasPhoto: false });
    }
    fixture.detectChanges(); expect(root.querySelector('folhea-book-cover img')).toBeNull();
    expect(root.textContent).toMatch(/(?:capa|foto) removida/i); http.expectNone(request => request.method === 'POST');
  });
  it('preserves unsaved metadata while uploading a photo independently', () => {
    load();
    const fixture = TestBed.createComponent(BookDetailComponent); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const title = root.querySelector<HTMLInputElement>('#detail-book-title')!;
    title.value = 'Rascunho ainda não salvo'; title.dispatchEvent(new Event('input')); fixture.detectChanges();
    fixture.debugElement.query(By.directive(CoverPickerComponent)).componentInstance.selectionChange.emit({ file: new File(['jpeg'], 'capa.jpg', { type: 'image/jpeg' }), preparing: false, error: null });
    fixture.detectChanges();
    const upload = Array.from(root.querySelectorAll('button')).find(button => /Enviar foto/i.test(button.textContent ?? ''));
    expect(upload).toBeDefined(); upload!.click();
    const uploaded = { ...saved, updatedAt: '2026-10-12T18:00:00Z', cover: { mediaType: 'image/jpeg', byteSize: 100, width: 24, height: 32, version: 'new-photo-hash' } };
    http.expectOne('/api/v1/books/owned-photo/photo').flush(uploaded);
    http.expectOne('/api/v1/books?limit=100&offset=0').flush([uploaded]);
    fixture.detectChanges();
    expect(title.value).toBe('Rascunho ainda não salvo');
    http.expectNone(request => request.method === 'PATCH' || request.method === 'POST');
  });
});

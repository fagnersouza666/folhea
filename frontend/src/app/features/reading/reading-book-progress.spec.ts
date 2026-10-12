import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { ReadingComponent } from './reading.component';
import { DashboardStore } from '../../core/state/dashboard.store';
import { AuthService } from '../../core/auth/auth.service';

describe('selected book outside the first bookshelf page', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('loads the book from the shelf link and shows its canonical metrics without selecting another book', () => {
    TestBed.configureTestingModule({ imports: [ReadingComponent], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { user: () => ({ timezone: 'UTC' }) } }, { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ bookId: 'old-book' }) } } }] });
    const http = TestBed.inject(HttpTestingController); const store = TestBed.inject(DashboardStore);
    store.loadBooks(); http.expectOne('/api/v1/books?limit=100&offset=0').flush(Array.from({ length: 100 }, (_, i) => ({ id: 'other-' + i, title: 'Outro ' + i, status: 'READING' })));
    const fixture = TestBed.createComponent(ReadingComponent); fixture.detectChanges();
    expect(fixture.componentInstance.form.controls.bookId.value).toBe('');
    http.expectOne('/api/v1/books/old-book').flush({ id: 'old-book', title: 'Livro antigo', status: 'READING', totalPages: 100, pagesRead: 40, averagePagesPerReadingDay: 20, progressPercent: 40, stats: { pagesRead: 40, totalPages: 100, percent: 40, firstDate: '2026-09-01', referenceDate: '2026-09-10' } });
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('#reading-book') as HTMLSelectElement;
    expect(select.value).toBe('old-book'); expect(select.selectedOptions[0].textContent).toContain('Livro antigo');
    expect(fixture.nativeElement.querySelector('.percent')?.textContent).toContain('40%');
    http.expectNone(request => request.method !== 'GET'); http.verify();
  });
});

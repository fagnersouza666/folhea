import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { DashboardStore } from '../../core/state/dashboard.store';
import { FeedbackComponent } from './feedback.component';

const summary = {
  currentStreakDays: 12,
  currentBook: null,
  week: { pages: 143, minutes: 130, booksFinished: 1 }
};

describe('feedback after a confirmed reading', () => {
  let store: DashboardStore;
  let http: HttpTestingController;

  beforeEach(() => {
    history.replaceState({ pages: 12, minutes: 8 }, '');
    TestBed.configureTestingModule({
      imports: [FeedbackComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { user: signal({ id: 'reader', email: 'reader@example.test', timezone: 'America/Sao_Paulo' }) } }
      ]
    });
    store = TestBed.inject(DashboardStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    history.replaceState({}, '');
  });

  it('preserves the saved reading without inventing zero totals when the summary fails, and retries', () => {
    store.loadDashboard();
    http.expectOne('/api/v1/dashboard').flush({}, { status: 503, statusText: 'Unavailable' });
    store.clearError();
    const fixture = TestBed.createComponent(FeedbackComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent).toContain('Leitura registrada');
    expect(root.querySelector('.recap')?.textContent).toContain('12');
    expect(root.querySelector('.recap')?.textContent).toContain('8');
    expect(root.querySelector('.weekly [role="alert"]')).not.toBeNull();
    expect(root.querySelector('.weekly')?.textContent).not.toContain('0 páginas');
    expect(root.querySelector('.weekly')?.textContent).not.toContain('0min');
    const retry = root.querySelector('.weekly button') as HTMLButtonElement;
    retry.click();
    http.expectOne('/api/v1/dashboard').flush(summary);
    fixture.detectChanges();
    expect(root.querySelector('.weekly')?.textContent).toContain('143 páginas');
    expect(root.querySelector('.weekly')?.textContent).toContain('2h 10min');
    expect(root.querySelector('.weekly [role="alert"]')).toBeNull();
  });

  it('shows pending streak and weekly metrics while the summary loads', () => {
    store.loadDashboard();
    const pending = http.expectOne('/api/v1/dashboard');
    const fixture = TestBed.createComponent(FeedbackComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const streak = root.querySelector('.recap div:last-child strong')?.textContent?.trim();
    const loading = root.querySelector('.weekly [role="status"]')?.textContent;
    pending.flush(summary);
    expect(streak).not.toBe('0');
    expect(loading).toContain('Atualizando');
  });

  it('does not restore old weekly metrics when the global alert for a failed refresh is dismissed', () => {
    store.loadDashboard();
    http.expectOne('/api/v1/dashboard').flush(summary);
    store.loadDashboard();
    http.expectOne('/api/v1/dashboard').flush({}, { status: 503, statusText: 'Unavailable' });
    store.clearError();
    const fixture = TestBed.createComponent(FeedbackComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.weekly [role="alert"]')).not.toBeNull();
    expect(root.querySelector('.weekly')?.textContent).not.toContain('143 páginas');
    expect(root.querySelector('.recap div:last-child strong')?.textContent?.trim()).not.toBe('12');
  });

  it('keeps legitimate zero metrics from an authoritative summary', () => {
    store.loadDashboard();
    http.expectOne('/api/v1/dashboard').flush({ currentStreakDays: 0, currentBook: null, week: { pages: 0, minutes: 0, booksFinished: 0 } });
    const fixture = TestBed.createComponent(FeedbackComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.weekly')?.textContent).toContain('0 páginas');
    expect(root.querySelector('.weekly')?.textContent).toContain('0min');
    expect(root.querySelector('.recap div:last-child strong')?.textContent?.trim()).toBe('0');
    expect(root.querySelector('.weekly [role="alert"]')).toBeNull();
  });
});

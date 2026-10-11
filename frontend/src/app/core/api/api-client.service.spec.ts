import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from './api-client.service';
import { csrfInterceptor } from './csrf.interceptor';
import { AuthService } from '../auth/auth.service';

describe('public and private API contracts', () => {
  let api: ApiClient;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([csrfInterceptor])), provideHttpClientTesting(),
      { provide: AuthService, useValue: { initialized: () => true, isAuthenticated: () => false, signOut: () => undefined } }
    ] });
    api = TestBed.inject(ApiClient); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });
  it('uses the canonical public registration path and exact payload', () => {
    api.getMe().subscribe({ error: () => undefined });
    http.expectOne('/api/v1/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    api.register({ email: 'reader@example.test', password: 'test-only' }).subscribe();
    http.expectNone('/api/v1/csrf');
    const req = http.expectOne('/api/v1/registration');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.has('X-CSRF-Token')).toBe(false);
    expect(req.request.body).toEqual({ email: 'reader@example.test', password: 'test-only' });
    req.flush({ id: 'id', email: 'reader@example.test' });
  });
  it('loads one session by id with credentials and no-store', () => {
    api.getSession('old-id').subscribe();
    const req = http.expectOne('/api/v1/sessions/old-id');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.get('Cache-Control')).toBe('no-store');
    req.flush({ id: 'old-id', bookId: 'book', readingDate: '2020-01-01', pages: 1, minutes: 0 });
  });
  it('updates only the account IANA timezone', () => {
    api.updateMe('Pacific/Auckland').subscribe();
    http.expectOne('/api/v1/csrf').flush({ token: 'test-csrf' });
    const req = http.expectOne('/api/v1/me');
    expect(req.request.headers.get('X-CSRF-Token')).toBe('test-csrf');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ timezone: 'Pacific/Auckland' });
    req.flush({ id: 'id', email: 'reader@example.test', timezone: 'Pacific/Auckland' });
  });
  it('sends the explicit account deletion confirmation and surfaces 503', () => {
    let failed = false;
    api.deleteAccount().subscribe({ error: (error) => failed = error.status === 503 });
    http.expectOne('/api/v1/csrf').flush({ token: 'test-csrf' });
    const req = http.expectOne('/api/v1/me');
    expect(req.request.method).toBe('DELETE'); expect(req.request.body).toEqual({ confirm: true });
    req.flush({ detail: 'Provider unavailable' }, { status: 503, statusText: 'Unavailable' });
    expect(failed).toBe(true);
  });
});

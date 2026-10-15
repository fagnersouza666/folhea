import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { csrfInterceptor } from './csrf.interceptor';

describe('csrfInterceptor AUTH-01', () => {
  let http: HttpClient; let control: HttpTestingController; let expired: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    expired = vi.fn();
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([csrfInterceptor])), provideHttpClientTesting(),
      { provide: AuthService, useValue: { initialized: () => true, isAuthenticated: () => true, sessionExpired: expired } }] });
    http = TestBed.inject(HttpClient); control = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { control.verify(); vi.restoreAllMocks(); TestBed.resetTestingModule(); });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('requires the current CSRF value for %s', method => {
    http.request(method, '/api/v1/books', { body: {} }).subscribe();
    control.expectOne('/api/v1/csrf').flush({ token: 'current-csrf' });
    const request = control.expectOne('/api/v1/books');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('current-csrf'); request.flush({});
  });
  it.each(['/api/v1/registration', '/api/v1/auth/register', '/api/v1/register'])('has no public password mutation exception for %s', path => {
    http.post(path, {}).subscribe({ error: () => undefined });
    control.expectOne('/api/v1/csrf').flush({ token: 'current-csrf' });
    const request = control.expectOne(path); expect(request.request.headers.get('X-CSRF-Token')).toBe('current-csrf');
    request.flush({}, { status: 404, statusText: 'Not Found' });
  });
  it('sends the readable cookie value and observes a new value after rotation', () => {
    const cookie = vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-folhea_csrf=first');
    http.post('/api/v1/books', {}).subscribe(); control.expectOne('/api/v1/books').flush({});
    cookie.mockReturnValue('__Host-folhea_csrf=rotated');
    http.patch('/api/v1/books/book', {}).subscribe();
    const request = control.expectOne('/api/v1/books/book');
    expect(request.request.headers.get('X-CSRF-Token')).toBe('rotated'); request.flush({});
    control.expectNone('/api/v1/csrf');
  });
  it('does not navigate on an anonymous /me restore', () => {
    http.get('/api/v1/me').subscribe({ error: () => undefined });
    control.expectOne('/api/v1/me').flush({}, { status: 401, statusText: 'Unauthorized' }); expect(expired).not.toHaveBeenCalled();
  });
  it('returns a private 401 to the entry page without initiating logout', () => {
    http.get('/api/v1/books').subscribe({ error: () => undefined });
    control.expectOne('/api/v1/books').flush({}, { status: 401, statusText: 'Unauthorized' }); expect(expired).toHaveBeenCalledOnce();
  });
  it('preserves the current session when deletion needs recent authentication', () => {
    http.delete('/api/v1/me', { body: { confirm: true } }).subscribe({ error: () => undefined });
    control.expectOne('/api/v1/csrf').flush({ token: 'current-csrf' });
    control.expectOne('/api/v1/me').flush({ type: '/problems/recent-authentication-required' }, { status: 401, statusText: 'Unauthorized' });
    expect(expired).not.toHaveBeenCalled();
  });
  it('expires the session for a foreign problem URI instead of treating its suffix as reauthentication', () => {
    http.delete('/api/v1/me', { headers: { 'X-CSRF-Token': 'current-csrf' } }).subscribe({ error: () => undefined });
    control.expectOne('/api/v1/me').flush({ type: 'https://foreign.example/problems/recent-authentication-required' }, { status: 401, statusText: 'Unauthorized' });
    expect(expired).toHaveBeenCalledOnce();
  });
  it('preserves a validation problem response and the authenticated session', () => {
    let failure: unknown;
    http.patch('/api/v1/me', { timezone: 'invalid' }, { headers: { 'X-CSRF-Token': 'current-csrf' } }).subscribe({ error: error => { failure = error; } });
    control.expectOne('/api/v1/me').flush({ type: '/problems/invalid-timezone', detail: 'Fuso inválido' }, { status: 400, statusText: 'Bad Request' });
    expect(failure).toMatchObject({ status: 400, error: { type: '/problems/invalid-timezone', detail: 'Fuso inválido' } });
    expect(expired).not.toHaveBeenCalled();
  });
});

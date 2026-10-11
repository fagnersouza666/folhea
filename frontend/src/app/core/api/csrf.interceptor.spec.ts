import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { csrfInterceptor } from './csrf.interceptor';

describe('csrfInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let signOutSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signOutSpy = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([csrfInterceptor])),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            initialized: () => true,
            isAuthenticated: () => true,
            signOut: signOutSpy
          }
        }
      ]
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('does not sign out on 401 from /api/v1/me during restore', () => {
    http.get('/api/v1/me', { withCredentials: true }).subscribe({ error: () => undefined });
    httpMock.expectOne('/api/v1/me').flush('unauthorized', { status: 401, statusText: 'Unauthorized' });
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('signs out on 401 from authenticated API calls', () => {
    http.get('/api/v1/books', { withCredentials: true }).subscribe({ error: () => undefined });
    httpMock.expectOne('/api/v1/books').flush('unauthorized', { status: 401, statusText: 'Unauthorized' });
    expect(signOutSpy).toHaveBeenCalled();
  });

  it.each(['/api/v1/registration', '/api/v1/auth/register', '/api/v1/register'])('allows only public POST registration at %s without fetching CSRF', (path) => {
    http.post(path, { email: 'reader@example.test', password: 'test-only' }).subscribe();
    httpMock.expectNone('/api/v1/csrf');
    const request = httpMock.expectOne(path);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.has('X-CSRF-Token')).toBe(false);
    request.flush({ id: 'created' }, { status: 201, statusText: 'Created' });
  });

  it.each(['/api/v1/books', '/api/v1/sessions', '/api/v1/me', '/api/v1/analytics/events', '/api/v1/registration/other'])('keeps CSRF protection on private mutation %s', (path) => {
    http.post(path, {}).subscribe();
    httpMock.expectNone(path);
    httpMock.expectOne('/api/v1/csrf').flush({ token: 'test-csrf' });
    const request = httpMock.expectOne(path);
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('test-csrf');
    request.flush({});
  });

  it('does not exempt a different mutation method on a registration path', () => {
    http.patch('/api/v1/registration', {}).subscribe();
    httpMock.expectOne('/api/v1/csrf').flush({ token: 'test-csrf' });
    const request = httpMock.expectOne('/api/v1/registration');
    expect(request.request.headers.get('X-CSRF-Token')).toBe('test-csrf');
    request.flush({});
  });

  it('surfaces public registration errors without requesting CSRF or signing out', () => {
    let status = 0;
    http.post('/api/v1/registration', {}).subscribe({ error: error => status = error.status });
    httpMock.expectOne('/api/v1/registration').flush({}, { status: 403, statusText: 'Forbidden' });
    httpMock.expectNone('/api/v1/csrf');
    expect(status).toBe(403);
    expect(signOutSpy).not.toHaveBeenCalled();
  });
});

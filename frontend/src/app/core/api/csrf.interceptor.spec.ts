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
});

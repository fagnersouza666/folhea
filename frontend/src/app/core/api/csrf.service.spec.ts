import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from './csrf.service';

describe('CsrfService', () => {
  let service: CsrfService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(CsrfService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
  });

  it('retries after a failed token request', () => {
    let firstError = false;
    service.getToken().subscribe({ error: () => { firstError = true; } });
    httpMock.expectOne('/api/v1/csrf').flush('error', { status: 500, statusText: 'Server Error' });
    expect(firstError).toBe(true);

    let token: string | undefined;
    service.getToken().subscribe({ next: (value) => { token = value; } });
    httpMock.expectOne('/api/v1/csrf').flush({ token: 'csrf-token' });
    expect(token).toBe('csrf-token');
  });

  it('reads the emitted cookie rather than retaining the JSON value in memory', () => {
    let cookie = '';
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie);
    service.getToken().subscribe();
    cookie = '__Host-folhea_csrf=cached-token';
    httpMock.expectOne('/api/v1/csrf').flush({ token: 'cached-token' });

    let token: string | undefined;
    service.getToken().subscribe({ next: (value) => { token = value; } });
    httpMock.expectNone('/api/v1/csrf');
    expect(token).toBe('cached-token');
  });
  it('uses the readable cookie and observes rotation without retaining an old token', () => {
    const cookie = vi.spyOn(document, 'cookie', 'get').mockReturnValue('__Host-folhea_csrf=first-value');
    let token: string | undefined;
    service.getToken().subscribe(value => token = value);
    expect(token).toBe('first-value');
    cookie.mockReturnValue('__Host-folhea_csrf=rotated-value');
    service.getToken().subscribe(value => token = value);
    expect(token).toBe('rotated-value');
    httpMock.expectNone('/api/v1/csrf');
  });
});

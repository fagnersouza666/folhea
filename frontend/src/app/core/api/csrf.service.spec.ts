import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('reuses the cached token', () => {
    service.getToken().subscribe();
    httpMock.expectOne('/api/v1/csrf').flush({ token: 'cached-token' });

    let token: string | undefined;
    service.getToken().subscribe({ next: (value) => { token = value; } });
    httpMock.expectNone('/api/v1/csrf');
    expect(token).toBe('cached-token');
  });
});

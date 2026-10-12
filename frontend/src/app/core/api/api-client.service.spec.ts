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

  it('creates metadata and a private cover atomically with CSRF and a browser multipart boundary', async () => {
    const cover = new File(['test-image'], 'capa.png', { type: 'image/png' });
    api.createBook({ title: 'Um livro', author: null, edition: '3ª edição', totalPages: 150 }, cover).subscribe();
    http.expectOne('/api/v1/csrf').flush({ token: 'test-csrf' });
    const request = http.expectOne('/api/v1/books');
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('test-csrf');
    expect(request.request.headers.has('Content-Type')).toBe(false);
    expect(request.request.body).toBeInstanceOf(FormData);
    const data = request.request.body as FormData;
    expect((data.get('book') as Blob).type).toBe('application/json');
    const metadata = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(data.get('book') as Blob); });
    expect(JSON.parse(metadata)).toEqual({ title: 'Um livro', author: null, edition: '3ª edição', totalPages: 150 });
    expect((data.get('cover') as File).type).toBe('image/png');
    request.flush({ id: 'book', title: 'Um livro', status: 'READING' });
    http.expectNone((req) => req.url.endsWith('/cover') && req.method !== 'GET');
  });

  it('keeps a cover replacement atomic with metadata and does not fall back to a second mutation on failure', () => {
    let failed = false;
    api.updateBook('book', { totalPages: 200 }, new File(['image'], 'capa.jpg', { type: 'image/jpeg' })).subscribe({ error: error => failed = error.status === 413 });
    http.expectOne('/api/v1/csrf').flush({ token: 'test-csrf' });
    const request = http.expectOne('/api/v1/books/book');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toBeInstanceOf(FormData);
    expect(request.request.headers.get('X-CSRF-Token')).toBe('test-csrf');
    expect(request.request.headers.has('Content-Type')).toBe(false);
    request.flush({ detail: 'Capa muito grande.' }, { status: 413, statusText: 'Payload Too Large' });
    expect(failed).toBe(true);
    http.expectNone(req => req.method === 'PUT' || req.url.endsWith('/cover'));
  });

  it('preserves optional legacy metadata and uses a plain JSON request without a selected cover', () => {
    api.createBook({ title: 'Livro legado', edition: null, totalPages: null }).subscribe();
    http.expectOne('/api/v1/csrf').flush({ token: 'test-csrf' });
    const request = http.expectOne('/api/v1/books');
    expect(request.request.body).toEqual({ title: 'Livro legado', edition: null, totalPages: null });
    request.flush({ id: 'book', title: 'Livro legado', status: 'READING', totalPages: null, edition: null, cover: null });
  });
});

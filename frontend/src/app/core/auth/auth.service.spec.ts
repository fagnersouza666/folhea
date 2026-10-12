import { PLATFORM_ID } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CsrfService } from '../api/csrf.service';
import { AuthService } from './auth.service';

describe('AuthService account deletion state', () => {
  let auth: AuthService;
  let csrf: CsrfService;
  let http: HttpTestingController;
  const user = { id: 'reader', email: 'reader@example.test', timezone: 'UTC' };

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(), { provide: PLATFORM_ID, useValue: 'server' }
    ] });
    auth = TestBed.inject(AuthService);
    csrf = TestBed.inject(CsrfService);
    http = TestBed.inject(HttpTestingController);
    const restore = auth.restoreSession();
    http.expectOne('/api/v1/me').flush(user);
    await restore;
    csrf.getToken().subscribe();
    http.expectOne('/api/v1/csrf').flush({ token: 'current-session-token' });
  });

  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  it('preserves the session while pending and clears it only after confirmed deletion', async () => {
    const deletion = auth.deleteAccount();
    const request = http.expectOne('/api/v1/me');
    expect(request.request.method).toBe('DELETE');
    expect(auth.user()).toEqual(user);
    expect(auth.isAuthenticated()).toBe(true);
    request.flush(null, { status: 204, statusText: 'No Content' });
    await deletion;
    expect(auth.user()).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.initialized()).toBe(true);
    expect(auth.error()).toBeNull();
    csrf.getToken().subscribe();
    http.expectOne('/api/v1/csrf').flush({ token: 'new-session-token' });
  });

  it('preserves the user after an unconfirmed 503 and obtains the current CSRF value', async () => {
    const deletion = auth.deleteAccount();
    const failure = expect(deletion).rejects.toMatchObject({ status: 503 });
    http.expectOne('/api/v1/me').flush({ detail: 'Identidade indisponível' }, { status: 503, statusText: 'Service Unavailable' });
    await failure;
    expect(auth.user()).toEqual(user);
    expect(auth.isAuthenticated()).toBe(true);
    let token: string | undefined;
    csrf.getToken().subscribe(value => { token = value; });
    http.expectOne('/api/v1/csrf').flush({ token: 'current-session-token' });
    expect(token).toBe('current-session-token');
  });
  it('clears the local identity after a durably accepted pending deletion', async () => {
    const deletion = auth.deleteAccount(); const failure = expect(deletion).rejects.toMatchObject({ status: 503 });
    http.expectOne('/api/v1/me').flush({ type: 'https://folhea.com.br/problems/account-deletion-pending' }, { status: 503, statusText: 'Pending' });
    await failure; expect(auth.user()).toBeNull(); expect(auth.isAuthenticated()).toBe(false);
  });
});

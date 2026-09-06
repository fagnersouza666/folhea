import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ApiClient } from './api-client.service';

describe('ApiClient private-data boundary', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('marks every private API request as credentialed and non-cacheable', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(ApiClient);
    const http = TestBed.inject(HttpTestingController);

    api.getMe().subscribe();
    api.getDashboard().subscribe();
    api.getBooks().subscribe();
    api.getSessions('2026-09-01', '2026-09-06').subscribe();
    api.getStats('2026-09-01', '2026-09-06').subscribe();

    const requests = http.match((request) => request.url.startsWith('/api/v1/'));
    expect(requests).toHaveLength(5);
    for (const request of requests) {
      expect(request.request.withCredentials).toBe(true);
      expect(request.request.headers.get('Accept')).toBe('application/json');
      expect(request.request.headers.get('Cache-Control')).toBe('no-store');
    }
    for (const request of requests) request.flush([]);
    http.verify();
  });

  it('keeps the service worker limited to shell/assets and out of private API data', () => {
    const config = JSON.parse(readFileSync('ngsw-config.json', 'utf8')) as { assetGroups?: { resources?: { files?: string[] } }[]; dataGroups?: unknown[] };
    expect(config.dataGroups ?? []).toHaveLength(0);
    const cachedFiles = config.assetGroups?.flatMap((group) => group.resources?.files ?? []) ?? [];
    expect(cachedFiles.some((file) => file.includes('/api/'))).toBe(false);
  });
});

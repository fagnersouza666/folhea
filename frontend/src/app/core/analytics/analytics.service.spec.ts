import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnalyticsService, safeAnalyticsProperties } from './analytics.service';

describe('safeAnalyticsProperties', () => {
  it('keeps only anonymous product dimensions', () => {
    expect(safeAnalyticsProperties({ screen: 'progress', pages: 12, source: 'cta', title: 'The Hobbit', author: 'J. R. R. Tolkien' }))
      .toEqual({ screen: 'progress', pages: 12, source: 'cta' });
  });

  it('does not leak private identifiers or media', () => {
    expect(safeAnalyticsProperties({ email: 'reader@example.com', photo: 'data:image/png;base64,secret', token: 'secret', book_id: 'book-1' }))
      .toEqual({});
  });
});

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(AnalyticsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('never sends product events while analytics is paused by AUTH-01', () => {
    for (const event of ['book_created', 'stats_viewed', 'account_created'] as const) service.track(event);
    const requests = httpMock.match('/api/v1/analytics/events');
    for (const request of requests) request.flush(null, { status: 202, statusText: 'Accepted' });
    expect(requests).toHaveLength(0);
  });
});

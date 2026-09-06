import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANALYTICS_ENDPOINT, AnalyticsService, safeAnalyticsProperties } from './analytics.service';

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
        provideHttpClientTesting(),
        { provide: ANALYTICS_ENDPOINT, useValue: '/api/v1/analytics/events' }
      ]
    });
    service = TestBed.inject(AnalyticsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('posts sanitized analytics events with credentials', () => {
    service.track('book_created', { screen: 'books', pages: 12, title: 'secret' });

    const request = httpMock.expectOne('/api/v1/analytics/events');
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toMatchObject({
      event: 'book_created',
      properties: { screen: 'books', pages: 12 }
    });
    expect(request.request.body.occurredAt).toBeTypeOf('string');
    request.flush(null, { status: 202, statusText: 'Accepted' });
  });

  it('swallows HTTP errors without throwing', () => {
    service.track('stats_viewed');
    const request = httpMock.expectOne('/api/v1/analytics/events');
    request.flush('forbidden', { status: 403, statusText: 'Forbidden' });
  });
});

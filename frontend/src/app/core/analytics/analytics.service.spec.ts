import { safeAnalyticsProperties } from './analytics.service';
import { describe, expect, it } from 'vitest';

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

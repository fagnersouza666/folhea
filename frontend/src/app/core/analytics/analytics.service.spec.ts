import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  AnalyticsService,
  safeAnalyticsProperties
} from './analytics.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('safeAnalyticsProperties', () => {
  it('keeps only anonymous product dimensions', () => {
    expect(safeAnalyticsProperties({ screen: 'progress', pages: 12, source: 'cta', title: 'The Hobbit', author: 'J. R. R. Tolkien' }))
      .toEqual({ screen: 'progress', pages: 12, source: 'cta' });
  });

  it('does not leak private identifiers or media', () => {
    expect(safeAnalyticsProperties({ email: 'reader@example.com', photo: 'data:image/png;base64,secret', token: 'secret', book_id: 'book-1' }))
      .toEqual({});
  });

  it('rejects private values hidden behind an allowed property name', () => {
    expect(safeAnalyticsProperties({ screen: 'O Hobbit', pages: -1, minutes: Number.NaN, source: { title: 'private' } as unknown as string }))
      .toEqual({});
  });
});

describe('AnalyticsService', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const service = (): AnalyticsService => new AnalyticsService('/api/v1/analytics/events', storage);

  it('requires explicit consent before sending an event', () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { onLine: true, sendBeacon });
    const analytics = service();

    analytics.track('stats_viewed', { screen: 'progress' });
    expect(sendBeacon).not.toHaveBeenCalled();

    analytics.setConsent(true);
    expect(analytics.hasConsent()).toBe(true);
    analytics.track('stats_viewed', { screen: 'progress' });
    expect(sendBeacon).toHaveBeenCalledOnce();
  });

  it('does not enqueue telemetry while offline', () => {
    const sendBeacon = vi.fn(() => true);
    const fetchSpy = vi.fn();
    vi.stubGlobal('navigator', { onLine: false, sendBeacon });
    vi.stubGlobal('fetch', fetchSpy);
    storage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'granted');

    service().track('reading_session_created', { pages: 12 });

    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends only the validated anonymous payload', async () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { onLine: true, sendBeacon });
    storage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'granted');

    service().track('book_created', {
      source: 'progress',
      title: 'O Hobbit',
      author: 'J. R. R. Tolkien'
    } as unknown as Record<string, string>);

    const [, body] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    await expect(body.text()).resolves.toMatch(/"event":"book_created"/);
    const payload = JSON.parse(await body.text()) as { properties: Record<string, unknown> };
    expect(payload.properties).toEqual({ source: 'progress' });
    expect(JSON.stringify(payload)).not.toContain('O Hobbit');
    expect(JSON.stringify(payload)).not.toContain('Tolkien');
  });
});

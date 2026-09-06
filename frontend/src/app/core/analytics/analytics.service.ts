import { Inject, Injectable, InjectionToken } from '@angular/core';

export const ANALYTICS_ENDPOINT = new InjectionToken<string>('ANALYTICS_ENDPOINT', {
  providedIn: 'root',
  factory: () => '/api/v1/analytics/events'
});

export const ANALYTICS_CONSENT_STORAGE_KEY = 'folhea.analytics.consent';
export type AnalyticsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const ANALYTICS_STORAGE = new InjectionToken<AnalyticsStorage | null>('ANALYTICS_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  }
});

export const PRODUCT_EVENTS = [
  'account_created',
  'book_created',
  'reading_session_created',
  'reading_session_updated',
  'reading_session_deleted',
  'book_finished',
  'book_reopened',
  'stats_viewed',
  'card_created',
  'card_shared',
  'card_downloaded',
  'pwa_installed'
] as const;

export type ProductEvent = (typeof PRODUCT_EVENTS)[number];
export type AnalyticsValue = string | number | boolean;
export type AnalyticsProperties = Record<string, AnalyticsValue | undefined>;

const SAFE_PROPERTY_NAMES = new Set([
  'source',
  'screen',
  'method',
  'days',
  'pages',
  'minutes',
  'session_count',
  'book_count',
  'card_count'
]);
const SAFE_TEXT = /^[a-z0-9_-]{1,64}$/;

function isSafeAnalyticsValue(value: AnalyticsValue): boolean {
  if (typeof value === 'string') return SAFE_TEXT.test(value);
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 1_000_000;
  return typeof value === 'boolean';
}

/** Keep event payloads anonymous: book content and account data stay in the app. */
export function safeAnalyticsProperties(properties: AnalyticsProperties = {}): Record<string, AnalyticsValue> {
  if (!properties || typeof properties !== 'object') return {};
  return Object.entries(properties).reduce<Record<string, AnalyticsValue>>((safe, [name, value]) => {
    if (SAFE_PROPERTY_NAMES.has(name) && value !== undefined && isSafeAnalyticsValue(value)) safe[name] = value;
    return safe;
  }, {});
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  constructor(
    @Inject(ANALYTICS_ENDPOINT) private readonly endpoint: string,
    @Inject(ANALYTICS_STORAGE) private readonly storage: AnalyticsStorage | null
  ) {}

  hasConsent(): boolean {
    try {
      return this.storage?.getItem(ANALYTICS_CONSENT_STORAGE_KEY) === 'granted';
    } catch {
      return false;
    }
  }

  setConsent(granted: boolean): void {
    try {
      if (granted) this.storage?.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'granted');
      else this.storage?.removeItem(ANALYTICS_CONSENT_STORAGE_KEY);
    } catch {
      // A blocked storage provider must fail closed without affecting the product flow.
    }
  }

  track(event: ProductEvent, properties: AnalyticsProperties = {}): void {
    if (!PRODUCT_EVENTS.includes(event) || !this.hasConsent()) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const payload = JSON.stringify({
      event,
      occurredAt: new Date().toISOString(),
      properties: safeAnalyticsProperties(properties)
    });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        if (navigator.sendBeacon(this.endpoint, new Blob([payload], { type: 'application/json' }))) return;
      } catch {
        // Fall back to fetch when Beacon is unavailable or rejects the request.
      }
    }

    if (typeof fetch === 'function') {
      void fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        credentials: 'include',
        keepalive: true
      }).catch(() => undefined);
    }
  }
}

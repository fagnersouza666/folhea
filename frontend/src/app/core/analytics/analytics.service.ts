import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { EMPTY, catchError } from 'rxjs';

export const ANALYTICS_ENDPOINT = new InjectionToken<string>('ANALYTICS_ENDPOINT', {
  providedIn: 'root',
  factory: () => '/api/v1/analytics/events'
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

/** Keep event payloads anonymous: book content and account data stay in the app. */
export function safeAnalyticsProperties(properties: AnalyticsProperties = {}): Record<string, AnalyticsValue> {
  return Object.entries(properties).reduce<Record<string, AnalyticsValue>>((safe, [name, value]) => {
    if (SAFE_PROPERTY_NAMES.has(name) && value !== undefined) safe[name] = value;
    return safe;
  }, {});
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = inject(ANALYTICS_ENDPOINT);

  track(event: ProductEvent, properties: AnalyticsProperties = {}): void {
    if (typeof window === 'undefined') return;

    this.http.post(this.endpoint, {
      event,
      occurredAt: new Date().toISOString(),
      properties: safeAnalyticsProperties(properties)
    }, {
      withCredentials: true,
      headers: { Accept: 'application/json' }
    }).pipe(catchError(() => EMPTY)).subscribe();
  }
}

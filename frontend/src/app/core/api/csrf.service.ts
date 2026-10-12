import { DOCUMENT, Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, finalize, map, of, shareReplay } from 'rxjs';

interface CsrfResponse { token: string; }

/** Read the current CSRF cookie on each mutation; session cookies remain HttpOnly. */
@Injectable({ providedIn: 'root' })
export class CsrfService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private request$: Observable<string> | null = null;
  getToken(): Observable<string> {
    const cookie = this.readCookie();
    if (cookie) return of(cookie);
    if (!this.request$) {
      this.request$ = this.http.get<CsrfResponse>('/api/v1/csrf', { withCredentials: true }).pipe(
        map(({ token }) => this.readCookie() ?? token),
        finalize(() => { this.request$ = null; }),
        shareReplay({ bufferSize: 1, refCount: true })
      );
    }
    return this.request$;
  }
  clear(): void {
    this.request$ = null;
    if (typeof this.document.cookie === 'string') this.document.cookie = '__Host-folhea_csrf=; Max-Age=0; Path=/; Secure; SameSite=Lax';
  }
  private readCookie(): string | null {
    const value = (this.document.cookie ?? '').split(';').map(item => item.trim())
      .find(item => item.startsWith('__Host-folhea_csrf='))?.slice('__Host-folhea_csrf='.length);
    return value && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
  }
}

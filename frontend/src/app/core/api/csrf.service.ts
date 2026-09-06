import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, shareReplay, tap } from 'rxjs';

interface CsrfResponse {
  token: string;
}

/** Keeps the public CSRF value in memory only; the HttpOnly session ticket is never read. */
@Injectable({ providedIn: 'root' })
export class CsrfService {
  private readonly http = inject(HttpClient);
  private token: string | null = null;
  private request$: Observable<string> | null = null;

  getToken(): Observable<string> {
    if (this.token) return of(this.token);
    if (!this.request$) {
      const request$ = this.http.get<CsrfResponse>('/api/v1/csrf', { withCredentials: true }).pipe(
        map(({ token }) => token),
        tap((token) => { this.token = token; this.request$ = null; }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
      this.request$ = request$;
      return request$;
    }
    return this.request$!;
  }

  clear(): void {
    this.token = null;
    this.request$ = null;
  }
}

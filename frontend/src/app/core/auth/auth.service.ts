import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { catchError, map, Observable, of, tap } from 'rxjs';
import { User } from '../models/models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly userState = signal<User | null>(null);

  readonly user = this.userState.asReadonly();
  readonly isAuthenticated = computed(() => this.userState() !== null);

  signIn(): void {
    if (isPlatformBrowser(this.platformId)) window.location.assign('/auth/login');
  }

  signOut(): void {
    this.userState.set(null);
    if (isPlatformBrowser(this.platformId)) window.location.assign('/auth/logout');
  }

  restore(): Observable<boolean> {
    return this.http.get<User>('/api/v1/me', { withCredentials: true }).pipe(
      tap((user) => this.userState.set(user)),
      map(() => true),
      catchError(() => { this.userState.set(null); return of(false); })
    );
  }
}

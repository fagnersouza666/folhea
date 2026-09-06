import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { firstValueFrom, catchError, map, Observable, of, tap } from 'rxjs';
import { CsrfService } from '../api/csrf.service';
import { ApiClient } from '../api/api-client.service';
import { User } from '../models/models';

/**
 * The browser never owns an access token. Authentication is represented by
 * the HttpOnly session cookie managed by the BFF; this service only mirrors
 * the safe `/me` response in memory.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly csrf = inject(CsrfService);
  private readonly userState = signal<User | null>(null);
  private readonly loadingState = signal(false);
  private readonly initializedState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly user = this.userState.asReadonly();
  readonly isAuthenticated = computed(() => this.userState() !== null);
  readonly loading = this.loadingState.asReadonly();
  readonly initialized = this.initializedState.asReadonly();
  readonly error = this.errorState.asReadonly();

  async restoreSession(): Promise<void> {
    if (this.loadingState()) return;
    this.loadingState.set(true);
    try {
      await firstValueFrom(this.restore());
      this.errorState.set(null);
    } catch {
      this.userState.set(null);
    } finally {
      this.loadingState.set(false);
      this.initializedState.set(true);
    }
  }

  signIn(): void {
    if (isPlatformBrowser(this.platformId)) window.location.assign('/auth/login');
  }

  signOut(): void {
    this.userState.set(null);
    this.initializedState.set(true);
    this.csrf.clear();
    if (isPlatformBrowser(this.platformId)) window.location.assign('/auth/logout');
  }

  async deleteAccount(): Promise<void> {
    await firstValueFrom(this.api.deleteAccount());
    this.signOut();
  }

  restore(): Observable<boolean> {
    return this.api.getMe().pipe(
      tap((user) => this.userState.set(user)),
      map(() => true),
      catchError(() => { this.userState.set(null); return of(false); })
    );
  }
}

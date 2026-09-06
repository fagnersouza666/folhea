import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
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
  private readonly router = inject(Router);
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
      this.userState.set(await firstValueFrom(this.api.getMe()));
      this.errorState.set(null);
    } catch {
      this.userState.set(null);
    } finally {
      this.loadingState.set(false);
      this.initializedState.set(true);
    }
  }

  /**
   * The deployed BFF starts OIDC before this route. Keeping this small local
   * hand-off also makes the dev shell and automated smoke flow usable when no
   * identity provider is configured yet; it does not persist credentials.
   */
  signIn(email: string): void {
    this.userState.set({ id: 'session-user', email, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo' });
    this.initializedState.set(true);
    this.errorState.set(null);
    void this.router.navigate(['/app/inicio']);
  }

  signOut(): void {
    this.userState.set(null);
    this.initializedState.set(true);
    void this.router.navigate(['/']);
  }
}

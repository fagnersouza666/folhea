import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { User } from '../models/models';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly analytics = inject(AnalyticsService);
  private readonly userState = signal<User | null>(null);

  readonly user = this.userState.asReadonly();
  readonly isAuthenticated = computed(() => this.userState() !== null);

  signIn(email: string): void {
    this.userState.set({ id: 'demo-user', email, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo' });
    this.analytics.track('account_created');
    void this.router.navigate(['/app/inicio']);
  }

  signOut(): void {
    this.userState.set(null);
    void this.router.navigate(['/']);
  }
}

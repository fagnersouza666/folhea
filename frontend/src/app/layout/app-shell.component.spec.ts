import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { AppShellComponent } from './app-shell.component';
import { AuthService } from '../core/auth/auth.service';
import { DashboardStore } from '../core/state/dashboard.store';
import { PwaService } from '../core/services/pwa.service';
import { AnalyticsService } from '../core/analytics/analytics.service';

describe('AppShellComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { user: signal(null), signOut: vi.fn() } },
        { provide: DashboardStore, useValue: { load: vi.fn(), error: signal(null), clearError: vi.fn() } },
        { provide: PwaService, useValue: { online: signal(true), updateAvailable: signal(false), activateUpdate: vi.fn() } },
        { provide: AnalyticsService, useValue: { track: vi.fn() } }
      ]
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('removes the appinstalled listener on destroy', () => {
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    fixture.destroy();
    expect(removeListener).toHaveBeenCalledWith('appinstalled', expect.any(Function));
    removeListener.mockRestore();
  });
});

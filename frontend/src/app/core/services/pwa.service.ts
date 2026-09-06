import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly updates = inject(SwUpdate);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly availableState = signal(false);
  private readonly onlineState = signal(true);

  readonly updateAvailable = this.availableState.asReadonly();
  readonly online = this.onlineState.asReadonly();

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    this.onlineState.set(navigator.onLine);
    window.addEventListener('online', () => this.onlineState.set(true));
    window.addEventListener('offline', () => this.onlineState.set(false));
    this.updates.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') this.availableState.set(true);
    });
  }

  async activateUpdate(): Promise<void> {
    if (this.updates.isEnabled) await this.updates.activateUpdate();
    window.location.reload();
  }
}

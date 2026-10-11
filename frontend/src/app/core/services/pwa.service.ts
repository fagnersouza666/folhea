import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';

@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly updates = inject(SwUpdate);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly availableState = signal(false);
  private readonly onlineState = signal(true);

  readonly updateAvailable = this.availableState.asReadonly();
  readonly online = this.onlineState.asReadonly();

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    this.onlineState.set(navigator.onLine);
    const online = () => this.onlineState.set(true);
    const offline = () => this.onlineState.set(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    this.destroyRef.onDestroy(() => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); });
    this.updates.versionUpdates.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event.type === 'VERSION_READY') this.availableState.set(true);
    });
  }

  async activateUpdate(): Promise<void> {
    if (this.updates.isEnabled) await this.updates.activateUpdate();
    window.location.reload();
  }
}

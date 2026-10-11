import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PwaService } from './pwa.service';

describe('PWA browser states', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('reacts to network loss/recovery and a ready service worker version', () => {
    const events = new Subject<VersionEvent>();
    TestBed.configureTestingModule({ providers: [{ provide: SwUpdate, useValue: { versionUpdates: events, isEnabled: true } }] });
    const service = TestBed.inject(PwaService);
    window.dispatchEvent(new Event('offline'));
    expect(service.online()).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(service.online()).toBe(true);
    events.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
    expect(service.updateAvailable()).toBe(true);
  });
});

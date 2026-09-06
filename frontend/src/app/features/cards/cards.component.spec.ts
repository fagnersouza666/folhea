import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardsComponent } from './cards.component';
import { CardGeneratorService } from '../../core/services/card-generator.service';
import { DashboardStore } from '../../core/state/dashboard.store';

const createStore = () => ({
  stats: signal(null),
  dashboard: signal({ currentStreakDays: 3, currentBook: null, week: { pages: 20, minutes: 30, booksFinished: 1 } }),
  period: signal<'today' | '7' | '30' | 'all'>('7'),
  selectPeriod: vi.fn()
});

describe('CardsComponent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('exposes native buttons with pressed state for keyboard navigation', () => {
    const store = createStore();
    TestBed.configureTestingModule({
      imports: [CardsComponent],
      providers: [
        provideRouter([]),
        { provide: DashboardStore, useValue: store },
        { provide: CardGeneratorService, useValue: { render: vi.fn() } }
      ]
    });

    const fixture = TestBed.createComponent(CardsComponent);
    fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('fieldset button')) as HTMLButtonElement[];

    expect(buttons).toHaveLength(7);
    expect(buttons.every((button) => button.type === 'button' && button.getAttribute('aria-pressed') !== null)).toBe(true);
    const dark = buttons.find((button) => button.textContent.includes('Dark')) as HTMLButtonElement;
    dark.click();
    fixture.detectChanges();
    expect(dark.getAttribute('aria-pressed')).toBe('true');
  });

  it('falls back to download when file sharing is unavailable', async () => {
    const store = createStore();
    const generator = { render: vi.fn().mockResolvedValue(new Blob(['card'], { type: 'image/png' })) };
    TestBed.configureTestingModule({
      imports: [CardsComponent],
      providers: [provideRouter([]), { provide: DashboardStore, useValue: store }, { provide: CardGeneratorService, useValue: generator }]
    });

    const fixture = TestBed.createComponent(CardsComponent);
    const component = fixture.componentInstance;
    const download = vi.spyOn(component, 'download').mockResolvedValue();
    await component.share();

    expect(generator.render).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
  });

  it('uses the Web Share API when it supports files', async () => {
    const store = createStore();
    const generator = { render: vi.fn().mockResolvedValue(new Blob(['card'], { type: 'image/png' })) };
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    TestBed.configureTestingModule({
      imports: [CardsComponent],
      providers: [provideRouter([]), { provide: DashboardStore, useValue: store }, { provide: CardGeneratorService, useValue: generator }]
    });

    const component = TestBed.createComponent(CardsComponent).componentInstance;
    await component.share();

    expect(share).toHaveBeenCalledOnce();
    const details = share.mock.calls[0][0] as ShareData;
    expect(details.title).toBe('Meu progresso no Folhea');
    expect(details.files?.[0]).toBeInstanceOf(File);
    expect(details.files?.[0].name).toBe('folhea-card.png');
  });

  it('exposes a useful error when card generation fails', async () => {
    const store = createStore();
    const generator = { render: vi.fn().mockRejectedValue(new Error('canvas unavailable')) };
    TestBed.configureTestingModule({
      imports: [CardsComponent],
      providers: [provideRouter([]), { provide: DashboardStore, useValue: store }, { provide: CardGeneratorService, useValue: generator }]
    });

    const component = TestBed.createComponent(CardsComponent).componentInstance;
    await component.download();

    expect(component.error).toBe('Não foi possível gerar o card neste dispositivo.');
    expect(component.busy).toBe(false);
  });
});

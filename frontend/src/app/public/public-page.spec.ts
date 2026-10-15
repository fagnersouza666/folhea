import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { PublicPageComponent, publicPages } from './public-page.component';

describe('public pages', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('keeps the V1 public URL set complete', () => {
    expect(Object.keys(publicPages)).toEqual(['como-funciona', 'recursos', 'sobre', 'privacidade', 'termos']);
  });

  it('gives every public page indexable, substantive metadata and content', () => {
    const pages = Object.values(publicPages);
    const titles = pages.map((page) => page.title);
    const descriptions = pages.map((page) => page.description);

    expect(new Set(titles).size).toBe(pages.length);
    expect(new Set(descriptions).size).toBe(pages.length);
    for (const page of pages) {
      expect(page.heading).toBeTruthy();
      expect(page.description.length).toBeGreaterThan(50);
      expect(page.blocks.length).toBeGreaterThan(0);
      expect(page.blocks.every((block) => block.title && block.text)).toBe(true);
    }
  });

  it.each(['privacidade', 'termos', 'sobre'])('offers the approved contact and mailto on %s', async (page) => {
    await TestBed.configureTestingModule({
      imports: [PublicPageComponent],
      providers: [provideRouter([{ path: page, component: PublicPageComponent, data: { page } }])]
    }).compileComponents();
    const harness = await RouterTestingHarness.create(`/${page}`);

    const element = harness.routeNativeElement;
    const contact = element?.querySelector<HTMLAnchorElement>('main a[href^="mailto:"]');
    expect(contact?.textContent?.trim()).toBe('contato@folhea.app');
    expect(contact?.getAttribute('href')).toBe('mailto:contato@folhea.app');
    expect(contact?.parentElement?.textContent).toContain(' contato@folhea.app.');
    expect(element?.textContent).not.toContain(['oi', 'folhea.com.br'].join('@'));
  });
});

import { describe, expect, it } from 'vitest';
import { publicPages } from './public-page.component';

describe('public pages', () => {
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
});

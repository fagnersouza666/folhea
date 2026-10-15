import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SeoService } from './seo.service';

describe('SeoService public origin', () => {
  let document: Document;
  let seo: SeoService;
  beforeEach(() => {
    document = window.document.implementation.createHTMLDocument('');
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: document }] });
    seo = TestBed.inject(SeoService);
  });
  afterEach(() => TestBed.resetTestingModule());

  it('uses the product origin for canonical and social URLs regardless of the browser host', () => {
    seo.update('Sobre o Folhea', 'Descrição pública', 'sobre/?ref=example#contato');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://folhea.app/sobre');
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://folhea.app/sobre');
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      expect(document.querySelector(selector)?.getAttribute('content')).toBe('https://folhea.app/folhea-social.png');
    }
  });

  it('replaces previous metadata without leaving stale canonical or social tags', () => {
    seo.update('Sobre', 'Sobre', '/sobre');
    seo.update('Termos', 'Termos de uso', '/termos/');
    expect(document.title).toBe('Termos');
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://folhea.app/termos');
    expect(document.querySelectorAll('meta[property="og:url"]')).toHaveLength(1);
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://folhea.app/termos');
  });

  it('keeps private and missing pages unindexed and removes a previous canonical for a missing page', () => {
    seo.update('Início', 'Início', '/');
    seo.update('Área privada', 'Área privada', '/app/inicio', false);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow');
    seo.update('Não encontrado', 'Página não encontrada', '/ausente', false, null);
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow');
  });
});

import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly document = inject(DOCUMENT);

  update(title: string, description: string, path: string, indexable = true): void {
    this.document.title = title;
    this.meta('description', description);
    this.meta('robots', indexable ? 'index, follow' : 'noindex, nofollow');
    this.metaProperty('og:title', title);
    this.metaProperty('og:description', description);
    this.metaProperty('og:type', 'website');
    this.metaProperty('og:image', 'https://folhea.com.br/icon-512.svg');
    this.metaProperty('og:url', `https://folhea.com.br${path}`);
    this.meta('twitter:card', 'summary');
    this.meta('twitter:title', title);
    this.meta('twitter:description', description);
    let canonical = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) { canonical = this.document.createElement('link'); canonical.rel = 'canonical'; this.document.head.appendChild(canonical); }
    canonical.href = `https://folhea.com.br${path}`;
  }

  private meta(name: string, content: string): void { let tag = this.document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`); if (!tag) { tag = this.document.createElement('meta'); tag.name = name; this.document.head.appendChild(tag); } tag.content = content; }
  private metaProperty(property: string, content: string): void { let tag = this.document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`); if (!tag) { tag = this.document.createElement('meta'); tag.setAttribute('property', property); this.document.head.appendChild(tag); } tag.content = content; }
}

import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly document = inject(DOCUMENT);

  update(title: string, description: string, path: string, indexable = true, canonicalPath: string | null = path): void {
    this.document.title = title;
    this.meta('description', description);
    this.meta('robots', indexable ? 'index, follow' : 'noindex, nofollow');
    this.metaProperty('og:type', 'website');
    this.metaProperty('og:site_name', 'Folhea');
    this.metaProperty('og:locale', 'pt_BR');
    this.metaProperty('og:title', title);
    this.metaProperty('og:description', description);
    this.metaProperty('og:url', this.absoluteUrl(path));
    this.metaProperty('og:image', this.absoluteUrl('/folhea-social.svg'));
    this.metaProperty('og:image:width', '1200');
    this.metaProperty('og:image:height', '630');
    this.metaName('twitter:card', 'summary_large_image');
    this.metaName('twitter:title', title);
    this.metaName('twitter:description', description);
    this.metaName('twitter:image', this.absoluteUrl('/folhea-social.svg'));

    const canonical = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonicalPath === null) {
      canonical?.remove();
    } else {
      const canonicalLink = canonical ?? this.document.createElement('link');
      canonicalLink.rel = 'canonical';
      canonicalLink.href = this.absoluteUrl(canonicalPath);
      if (!canonical) this.document.head.appendChild(canonicalLink);
    }
  }

  private absoluteUrl(path: string): string { return `https://folhea.com.br${this.normalizePath(path)}`; }

  private normalizePath(path: string): string {
    const cleanPath = path.split(/[?#]/, 1)[0] || '/';
    const withLeadingSlash = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
    return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') : withLeadingSlash;
  }

  private meta(name: string, content: string): void { this.metaName(name, content); }

  private metaName(name: string, content: string): void {
    let tag = this.document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!tag) { tag = this.document.createElement('meta'); tag.name = name; this.document.head.appendChild(tag); }
    tag.content = content;
  }

  private metaProperty(property: string, content: string): void { let tag = this.document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`); if (!tag) { tag = this.document.createElement('meta'); tag.setAttribute('property', property); this.document.head.appendChild(tag); } tag.content = content; }
}

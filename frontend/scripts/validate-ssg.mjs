import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const root = new URL('../dist/folhea/browser/', import.meta.url);
const { publicOrigin } = JSON.parse(readFileSync(new URL('../../shared/public-contract.json', import.meta.url), 'utf8'));
const routes = ['', 'como-funciona', 'recursos', 'sobre', 'privacidade', 'termos'];
const titles = new Set();
const descriptions = new Set();
for (const route of routes) {
  const html = readFileSync(new URL(`${route ? route + '/' : ''}index.html`, root), 'utf8');
  const document = new JSDOM(html).window.document;
  const title = document.title;
  const description = document.querySelector('meta[name="description"]')?.content;
  assert(title && !titles.has(title), `Title ausente/duplicado: ${route}`);
  assert(description && !descriptions.has(description), `Description ausente/duplicada: ${route}`);
  titles.add(title); descriptions.add(description);
  assert.equal(document.documentElement.lang, 'pt-BR');
  assert(document.querySelector('h1')?.textContent?.trim());
  assert.equal(document.querySelector('link[rel="canonical"]')?.href, `${publicOrigin}/${route}`);
  assert(!document.querySelector('meta[name="robots"]')?.content.includes('noindex'));
  for (const property of ['og:title', 'og:description', 'og:url', 'og:type', 'og:image']) assert(document.querySelector(`meta[property="${property}"]`)?.content, `${property} ${route}`);
  assert.equal(document.querySelector('meta[property="og:url"]')?.content, `${publicOrigin}/${route}`);
  assert.equal(document.querySelector('meta[property="og:image"]')?.content, `${publicOrigin}/folhea-social.png`);
  assert.equal(document.querySelector('meta[name="twitter:image"]')?.content, `${publicOrigin}/folhea-social.png`);
  assert(document.querySelector('meta[property="og:image"]')?.content.endsWith('.png'));
  assert(!document.querySelector('[onload]'), `Handler inline incompatível com CSP: ${route}`);
}
for (const route of ['entrar', 'cadastro']) {
  const document = new JSDOM(readFileSync(new URL(`${route}/index.html`, root), 'utf8')).window.document;
  assert(document.querySelector('meta[name="robots"]')?.content.includes('noindex'));
}
const sitemap = readFileSync(new URL('sitemap.xml', root), 'utf8');
for (const route of routes) assert(sitemap.includes(`${publicOrigin}/${route}`));
assert(!/\/app|\/entrar|\/cadastro/.test(sitemap));
assert(readFileSync(new URL('robots.txt', root), 'utf8').includes('Disallow: /app/'));
assert(readFileSync(new URL('robots.txt', root), 'utf8').includes(`Sitemap: ${publicOrigin}/sitemap.xml`));
const sw = JSON.parse(readFileSync(new URL('ngsw.json', root), 'utf8'));
assert.equal(sw.dataGroups.length, 0, 'Service worker não pode armazenar domínio privado.');
assert(sw.assetGroups.some((group) => group.installMode === 'prefetch' && group.urls.includes(sw.index)), `Shell de navegação ${sw.index} ausente dos assets prefetch.`);
assert.equal(typeof sw.hashTable[sw.index], 'string', `Shell de navegação ${sw.index} ausente do hashTable.`);
for (const [file, width, height] of [['icon-192.png',192,192],['icon-512.png',512,512],['folhea-social.png',1200,630]]) {
  const png = readFileSync(new URL(file, root));
  assert.equal(png.subarray(1,4).toString(), 'PNG'); assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
}
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, '/app/inicio');
assert(manifest.icons.some((icon) => icon.type === 'image/png' && icon.sizes === '192x192'));
assert(manifest.icons.some((icon) => icon.type === 'image/png' && icon.sizes === '512x512'));
console.log('SSG: 6 páginas públicas + entrar/cadastro, SEO, CSP estática, PWA com shell prefetch e PNG verificados. HTTP 404/redirect e Core Web Vitals são verificados na stack.');

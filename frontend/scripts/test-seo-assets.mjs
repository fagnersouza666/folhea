import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { generateSeoAssets } from './generate-seo.mjs';

function fixture(t, publicOrigin = 'https://product.example') {
  const root = mkdtempSync(join(tmpdir(), 'folhea-seo-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const frontend = join(root, 'frontend');
  for (const directory of ['shared', 'frontend/scripts/seo', 'frontend/src', 'frontend/public']) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, 'shared/public-contract.json'), JSON.stringify({ publicOrigin }));
  for (const file of ['index.html', 'robots.txt', 'sitemap.xml']) {
    copyFileSync(fileURLToPath(new URL(`seo/${file}.template`, import.meta.url)), join(frontend, 'scripts/seo', `${file}.template`));
  }
  return frontend;
}

test('one configured origin reaches canonical, social metadata, robots and every sitemap URL', t => {
  const root = fixture(t);
  generateSeoAssets(root);
  const index = readFileSync(join(root, 'src/index.html'), 'utf8');
  assert(index.includes('rel="canonical" href="https://product.example/"'));
  assert(index.includes('property="og:url" content="https://product.example/"'));
  assert(index.includes('property="og:image" content="https://product.example/folhea-social.png"'));
  assert(index.includes('name="twitter:image" content="https://product.example/folhea-social.png"'));
  assert(index.includes('href="/manifest.webmanifest"'));
  assert(index.includes('<title>Folhea — Cada página conta</title>'));
  const robots = readFileSync(join(root, 'public/robots.txt'), 'utf8');
  assert(robots.includes('Sitemap: https://product.example/sitemap.xml'));
  assert(robots.includes('Disallow: /app/'));
  const locations = [...readFileSync(join(root, 'public/sitemap.xml'), 'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(locations, ['', 'como-funciona', 'recursos', 'sobre', 'privacidade', 'termos'].map(path => `https://product.example/${path}`));
  for (const output of [index, robots, locations.join(' ')]) assert(!output.includes('__PUBLIC_SITE_ORIGIN__'));
});

test('check rejects stale artifacts without modifying them and regeneration restores the contract', t => {
  const root = fixture(t);
  generateSeoAssets(root);
  generateSeoAssets(root, true);
  const file = join(root, 'src/index.html');
  const stale = readFileSync(file, 'utf8').replace('href="https://product.example/"', 'href="https://foreign.example/"');
  writeFileSync(file, stale);
  assert.throws(() => generateSeoAssets(root, true), /src\/index.html/);
  assert.equal(readFileSync(file, 'utf8'), stale);
  generateSeoAssets(root);
  generateSeoAssets(root, true);
  assert.notEqual(readFileSync(file, 'utf8'), stale);
});

test('a changed shared origin invalidates all generated artifacts until regeneration', t => {
  const root = fixture(t);
  generateSeoAssets(root);
  writeFileSync(join(root, '../shared/public-contract.json'), JSON.stringify({ publicOrigin: 'https://next.example' }));
  assert.throws(() => generateSeoAssets(root, true), /desatualizado/);
  generateSeoAssets(root);
  for (const file of ['src/index.html', 'public/robots.txt', 'public/sitemap.xml']) {
    const output = readFileSync(join(root, file), 'utf8');
    assert(output.includes('https://next.example/'));
    assert(!output.includes('https://product.example/'));
  }
});

test('an invalid canonical origin is rejected before overwriting generated files', t => {
  for (const origin of ['http://product.example', 'https://product.example/path', 'https://product.example?x=y', 'https://userinfo@product.example', 'https://product.example/']) {
    const root = fixture(t, origin);
    const file = join(root, 'src/index.html');
    writeFileSync(file, 'preserved');
    assert.throws(() => generateSeoAssets(root), /publicOrigin/);
    assert.equal(readFileSync(file, 'utf8'), 'preserved');
  }
});

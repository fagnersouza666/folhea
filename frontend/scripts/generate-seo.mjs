import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const frontendRoot = fileURLToPath(new URL('../', import.meta.url));
const assets = [
  ['index.html', 'src/index.html'],
  ['robots.txt', 'public/robots.txt'],
  ['sitemap.xml', 'public/sitemap.xml']
];

export function generateSeoAssets(root = frontendRoot, check = false) {
  const { publicOrigin } = JSON.parse(readFileSync(resolve(root, '../shared/public-contract.json'), 'utf8'));
  const url = new URL(publicOrigin);
  assert(url.protocol === 'https:' && url.origin === publicOrigin, 'publicOrigin deve ser uma origem HTTPS sem credenciais, path, query ou barra final.');
  const rendered = assets.map(([template, output]) => {
    const source = readFileSync(resolve(root, 'scripts/seo', `${template}.template`), 'utf8');
    assert(source.includes('__PUBLIC_SITE_ORIGIN__'), `Template sem origem: ${template}`);
    return [output, source.replaceAll('__PUBLIC_SITE_ORIGIN__', publicOrigin)];
  });
  for (const [output, content] of rendered) {
    const target = resolve(root, output);
    if (check) {
      assert.equal(readFileSync(target, 'utf8'), content, `SEO desatualizado: ${output}; execute npm run generate:seo.`);
    } else {
      writeFileSync(target, content);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert(process.argv.slice(2).every(argument => argument === '--check'), 'Uso: node scripts/generate-seo.mjs [--check]');
  generateSeoAssets(frontendRoot, process.argv.includes('--check'));
  console.log(process.argv.includes('--check') ? 'SEO gerado sincronizado com o contrato público.' : 'SEO gerado a partir do contrato público.');
}

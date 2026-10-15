import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const catalog = JSON.parse(readFileSync(join(root, 'shared/public-contract.json'), 'utf8'));
const routes = [
  ['/', 'Folhea — Cada página conta', 'Acompanhe seu hábito de leitura, registre páginas e veja sua evolução com o Folhea.', 'Cada página conta.'],
  ['/como-funciona', 'Como funciona — Folhea', 'Entenda como o Folhea transforma leitura física em progresso visível.', 'Seu hábito em três movimentos.'],
  ['/recursos', 'Recursos — Folhea', 'Conheça os recursos do Folhea para registrar leituras e acompanhar seu progresso.', 'Tudo o que ajuda você a continuar.'],
  ['/sobre', 'Sobre — Folhea', 'Conheça o propósito do Folhea, um companheiro simples para hábitos de leitura.', 'Leitura física merece progresso visível.'],
  ['/privacidade', 'Privacidade — Folhea', 'Saiba quais dados o Folhea coleta, como os utiliza e quais são seus direitos.', 'Privacidade é parte do produto.'],
  ['/termos', 'Termos — Folhea', 'Leia os termos de uso do Folhea e as responsabilidades ao utilizar o serviço.', 'Termos de uso.']
];

function fixture(run, origin = catalog.publicOrigin) {
  const directory = mkdtempSync(join(tmpdir(), 'folhea-seo-validator-'));
  function write(name, content) {
    const target = join(directory, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  try {
    write('shared/public-contract.json', JSON.stringify({ ...catalog, publicOrigin: origin }));
    write('scripts/ci/placeholder', '');
    copyFileSync(join(root, 'scripts/ci/validate-seo.mjs'), join(directory, 'scripts/ci/validate-seo.mjs'));
    for (const [path, title, description, h1] of routes) {
      const url = origin + path;
      write(`site${path === '/' ? '' : path}/index.html`, `<html lang="pt-BR"><head><title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${url}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${url}"></head><body><h1>${h1}</h1></body></html>`);
    }
    write('site/404.html', '<html lang="pt-BR"><head><title>Página não encontrada — Folhea</title><meta name="description" content="Endereço inexistente."><meta name="robots" content="noindex,nofollow"></head><body><h1>Página não encontrada</h1></body></html>');
    write('site/robots.txt', `User-agent: *\nDisallow: /app/\nSitemap: ${origin}/sitemap.xml\n`);
    write('site/sitemap.xml', `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routes.map(([path]) => `<url><loc>${origin}${path}</loc></url>`).join('')}</urlset>`);
    const execute = () => {
      const env = { ...process.env };
      for (const name of Object.keys(env)) if (name.startsWith('SEO_')) delete env[name];
      return spawnSync(process.execPath, [join(directory, 'scripts/ci/validate-seo.mjs'), join(directory, 'site'), join(directory, 'report.txt')], { cwd: tmpdir(), env, encoding: 'utf8' });
    };
    return run({ directory, write, execute });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('static CLI validates generated pages using the shared origin without an environment override', () => fixture(({ execute }) => {
  const result = execute();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}));

test('a different catalog origin is consumed from the script root, independently of cwd', () => fixture(({ execute }) => {
  const result = execute();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}, 'https://public.example'));

test('foreign canonical, Open Graph, sitemap and robots URLs are rejected by the real CLI', () => {
  for (const name of ['site/index.html', 'site/sitemap.xml', 'site/robots.txt']) {
    fixture(({ directory, write, execute }) => {
      write(name, readFileSync(join(directory, name), 'utf8').replaceAll(catalog.publicOrigin, 'https://foreign.example'));
      const result = execute();
      assert.equal(result.status, 1, name + result.stdout + result.stderr);
      assert.match(result.stdout, /canonical|og:url|public URL|Sitemap/);
    });
  }
});

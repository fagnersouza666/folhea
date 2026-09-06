#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const dist = process.argv[2] ?? 'frontend/dist';
const reportPath = process.argv[3] ?? 'seo-report/seo-validation.txt';
const canonicalOrigin = (process.env.SEO_CANONICAL_ORIGIN ?? 'https://folhea.com.br').replace(/\/+$/, '');
const failures = [];

const publicRoutes = [
  { path: '/', title: 'Folhea — Cada página conta', description: 'Acompanhe seu hábito de leitura, registre páginas e veja sua evolução com o Folhea.', h1: 'Cada página conta.' },
  { path: '/como-funciona', title: 'Como funciona — Folhea', description: 'Entenda como o Folhea transforma leitura física em progresso visível.', h1: 'Seu hábito em três movimentos.' },
  { path: '/recursos', title: 'Recursos — Folhea', description: 'Conheça os recursos do Folhea para registrar leituras e acompanhar seu progresso.', h1: 'Tudo o que ajuda você a continuar.' },
  { path: '/sobre', title: 'Sobre — Folhea', description: 'Conheça o propósito do Folhea, um companheiro simples para hábitos de leitura.', h1: 'Leitura física merece progresso visível.' },
  { path: '/privacidade', title: 'Privacidade — Folhea', description: 'Saiba quais dados o Folhea coleta, como os utiliza e quais são seus direitos.', h1: 'Privacidade é parte do produto.' },
  { path: '/termos', title: 'Termos — Folhea', description: 'Leia os termos de uso do Folhea e as responsabilidades ao utilizar o serviço.', h1: 'Termos de uso.' }
];

const privateRoutes = ['/app', '/app/inicio'];
const missingRoute = process.env.SEO_MISSING_PATH ?? '/__seo-missing-route__';

function requireFile(path, description) {
  if (!existsSync(path)) failures.push(`missing ${description}: ${path}`);
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function tagsMatching(content, expression) {
  return content.match(/<[^>]+>/g)?.filter((tag) => expression.test(tag)) ?? [];
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))?.[2]?.trim();
}

function metaValue(content, attributeName, expectedValue) {
  const tag = tagsMatching(content, /<meta\b/i).find((candidate) => attribute(candidate, attributeName)?.toLowerCase() === expectedValue.toLowerCase());
  return tag ? attribute(tag, 'content') : undefined;
}

function metaContent(content, name) {
  return metaValue(content, 'name', name);
}

function metaProperty(content, property) {
  return metaValue(content, 'property', property);
}

function canonical(content) {
  const tag = tagsMatching(content, /<link\b/i).find((candidate) => attribute(candidate, 'rel')?.toLowerCase().split(/\s+/).includes('canonical'));
  return tag ? attribute(tag, 'href') : undefined;
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function elementText(content, element) {
  const value = content.match(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)</${element}>`, 'i'))?.[1];
  return value ? decodeHtml(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() : undefined;
}

function normalizedRobots(value) {
  return value?.toLowerCase().replace(/\s+/g, '') ?? '';
}

function routeCanonical(path) {
  return `${canonicalOrigin}${path === '/' ? '/' : path}`;
}

function validatePublicDocument(content, expected, source) {
  const htmlTag = content.match(/<html\b[^>]*>/i)?.[0];
  const lang = htmlTag ? attribute(htmlTag, 'lang') : undefined;
  const title = content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = metaContent(content, 'description');
  const pageCanonical = canonical(content);
  const h1 = elementText(content, 'h1');
  const ogType = metaProperty(content, 'og:type');
  const ogTitle = metaProperty(content, 'og:title');
  const ogDescription = metaProperty(content, 'og:description');
  const ogUrl = metaProperty(content, 'og:url');
  const robots = normalizedRobots(metaContent(content, 'robots'));

  if (lang !== 'pt-BR') failures.push(`${source}: expected html lang=pt-BR, got ${lang ?? 'missing'}`);
  if (!title) failures.push(`${source}: missing title`);
  else if (title !== expected.title) failures.push(`${source}: expected title "${expected.title}", got "${title}"`);
  if (!description) failures.push(`${source}: missing meta description`);
  else if (description !== expected.description) failures.push(`${source}: expected meta description "${expected.description}", got "${description}"`);
  if (pageCanonical !== routeCanonical(expected.path)) failures.push(`${source}: expected canonical ${routeCanonical(expected.path)}, got ${pageCanonical ?? 'missing'}`);
  if (h1 !== expected.h1) failures.push(`${source}: expected h1 "${expected.h1}", got "${h1 ?? 'missing'}"`);
  if (ogType !== 'website') failures.push(`${source}: expected og:type website, got ${ogType ?? 'missing'}`);
  if (ogTitle !== expected.title) failures.push(`${source}: expected og:title "${expected.title}", got "${ogTitle ?? 'missing'}"`);
  if (ogDescription !== expected.description) failures.push(`${source}: expected og:description "${expected.description}", got "${ogDescription ?? 'missing'}"`);
  if (ogUrl !== routeCanonical(expected.path)) failures.push(`${source}: expected og:url ${routeCanonical(expected.path)}, got ${ogUrl ?? 'missing'}`);
  if (robots.includes('noindex')) failures.push(`${source}: public page has noindex`);
}

function validateNotFoundDocument(content, source) {
  const htmlTag = content.match(/<html\b[^>]*>/i)?.[0];
  const lang = htmlTag ? attribute(htmlTag, 'lang') : undefined;
  const title = content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const h1 = elementText(content, 'h1');
  const robots = normalizedRobots(metaContent(content, 'robots'));
  if (lang !== 'pt-BR') failures.push(`${source}: expected html lang=pt-BR, got ${lang ?? 'missing'}`);
  if (title !== 'Página não encontrada — Folhea') failures.push(`${source}: unexpected 404 title: ${title ?? 'missing'}`);
  if (h1 !== 'Página não encontrada') failures.push(`${source}: unexpected 404 h1: ${h1 ?? 'missing'}`);
  if (robots !== 'noindex,nofollow') failures.push(`${source}: 404 is missing noindex,nofollow`);
}

function routeFromHtmlPath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized === 'index.html') return '/';
  const route = normalized.match(/^(.+)\/index\.html$/)?.[1];
  return route ? `/${route}` : undefined;
}

function fileForRoute(siteRoot, path) {
  return path === '/' ? join(siteRoot, 'index.html') : join(siteRoot, path.slice(1), 'index.html');
}

function validateSitemapUrls(content, source) {
  const actual = new Set([...content.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1]));
  const expected = new Set(publicRoutes.map(({ path }) => routeCanonical(path)));
  for (const url of expected) if (!actual.has(url)) failures.push(`${source}: missing public URL ${url}`);
  for (const url of actual) if (!expected.has(url)) failures.push(`${source}: unexpected non-public URL ${url}`);
}

function validateStaticSite() {
  if (!existsSync(dist)) {
    failures.push(`missing SSG output directory: ${dist}`);
    return;
  }

  const siteRoot = findSiteRoot(dist);
  const htmlFiles = filesUnder(siteRoot)
    .filter((path) => path.endsWith('.html'))
    .filter((path) => basename(path) !== 'index.csr.html');
  if (htmlFiles.length === 0) failures.push(`no generated HTML pages found in: ${siteRoot}`);

  const titles = new Map();
  const descriptions = new Map();
  const expectedByRoute = new Map(publicRoutes.map((route) => [route.path, route]));

  for (const route of publicRoutes) {
    const path = fileForRoute(siteRoot, route.path);
    requireFile(path, `generated public route ${route.path}`);
  }

  for (const path of htmlFiles) {
    const content = readFileSync(path, 'utf8');
    const relativePath = relative(siteRoot, path);
    const isNotFound = basename(path) === '404.html';
    const isPrivate = /(^|[/\\])(app|entrar|login|callback)([/\\]|$)/.test(relativePath);
    const route = routeFromHtmlPath(relativePath);
    const title = content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    const description = metaContent(content, 'description');
    const robots = normalizedRobots(metaContent(content, 'robots'));

    if (!title) failures.push(`missing title: ${path}`);
    if (!description) failures.push(`missing meta description: ${path}`);
    if (title && titles.has(title)) failures.push(`duplicate title "${title}": ${path} and ${titles.get(title)}`);
    if (description && descriptions.has(description)) failures.push(`duplicate meta description: ${path} and ${descriptions.get(description)}`);
    if (title) titles.set(title, path);
    if (description) descriptions.set(description, path);

    if (route && expectedByRoute.has(route)) {
      validatePublicDocument(content, expectedByRoute.get(route), path);
    } else if (isNotFound) {
      validateNotFoundDocument(content, path);
    } else if (isPrivate && robots !== 'noindex,nofollow') {
      failures.push(`private page is missing noindex,nofollow: ${path}`);
    }
  }

  const robotsFile = join(siteRoot, 'robots.txt');
  requireFile(robotsFile, 'robots.txt');
  if (existsSync(robotsFile)) {
    const robotsContent = readFileSync(robotsFile, 'utf8');
    if (!/user-agent\s*:/i.test(robotsContent)) failures.push(`robots.txt has no User-agent directive: ${robotsFile}`);
    if (!/sitemap\s*:/i.test(robotsContent)) failures.push(`robots.txt has no Sitemap directive: ${robotsFile}`);
  }

  requireFile(join(siteRoot, '404.html'), '404 page');
  const sitemap = join(siteRoot, 'sitemap.xml');
  requireFile(sitemap, 'sitemap.xml');
  if (existsSync(sitemap)) {
    const sitemapContent = readFileSync(sitemap, 'utf8');
    if (!/<urlset[\s>]/i.test(sitemapContent)) failures.push(`invalid sitemap root: ${sitemap}`);
    if (/\/(?:app|entrar|login|callback)(?:[/<]|$)/i.test(sitemapContent)) failures.push(`private URL found in sitemap: ${sitemap}`);
    validateSitemapUrls(sitemapContent, sitemap);
  }
}

function findSiteRoot(outputDirectory) {
  const robotsFiles = filesUnder(outputDirectory).filter((path) => basename(path) === 'robots.txt');
  if (robotsFiles.length === 0) return outputDirectory;

  // Angular's application builder commonly emits dist/<project>/browser.
  // Validate the generated site root, not the workspace-level dist directory.
  const candidateDirectories = [...new Set(robotsFiles.map((path) => dirname(path)))];
  return candidateDirectories.sort((left, right) => {
    const required = (directory) => ['robots.txt', 'sitemap.xml', '404.html']
      .filter((file) => existsSync(join(directory, file))).length;
    return required(right) - required(left) || left.length - right.length;
  })[0];
}

function responseContentType(response) {
  return response.headers.get('content-type')?.toLowerCase() ?? '';
}

async function request(baseUrl, path, options = {}) {
  const timeout = Number(process.env.SEO_HTTP_TIMEOUT_MS ?? 5000);
  const response = await fetch(new URL(path, baseUrl), {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeout),
    ...options
  });
  return { response, body: await response.text() };
}

async function validateHttp() {
  const configuredBaseUrl = process.env.SEO_BASE_URL;
  if (!configuredBaseUrl) return;

  let baseUrl;
  try {
    baseUrl = new URL(configuredBaseUrl);
  } catch (error) {
    failures.push(`SEO_BASE_URL is invalid: ${error.message}`);
    return;
  }

  for (const route of publicRoutes) {
    try {
      const { response, body } = await request(baseUrl, route.path);
      const source = `HTTP ${route.path}`;
      if (response.status !== 200) {
        failures.push(`${source}: expected 200, got ${response.status}`);
        continue;
      }
      if (!responseContentType(response).includes('text/html')) failures.push(`${source}: expected HTML content type, got ${responseContentType(response) || 'missing'}`);
      validatePublicDocument(body, route, source);
    } catch (error) {
      failures.push(`HTTP ${route.path}: request failed (${error.message})`);
    }
  }

  for (const path of privateRoutes) {
    try {
      const { response, body } = await request(baseUrl, path);
      const source = `HTTP ${path}`;
      if (response.status !== 200) {
        failures.push(`${source}: expected private app shell status 200, got ${response.status}`);
        continue;
      }
      if (!responseContentType(response).includes('text/html')) failures.push(`${source}: expected HTML content type, got ${responseContentType(response) || 'missing'}`);
      const headerRobots = normalizedRobots(response.headers.get('x-robots-tag'));
      const bodyRobots = normalizedRobots(metaContent(body, 'robots'));
      if (!headerRobots.includes('noindex') && !bodyRobots.includes('noindex')) failures.push(`${source}: missing noindex protection`);
      if (!headerRobots.includes('nofollow') && !bodyRobots.includes('nofollow')) failures.push(`${source}: missing nofollow protection`);
      if (/Página não encontrada/i.test(elementText(body, 'h1') ?? '')) failures.push(`${source}: private route served the 404 document`);
    } catch (error) {
      failures.push(`HTTP ${path}: request failed (${error.message})`);
    }
  }

  try {
    const { response, body } = await request(baseUrl, missingRoute);
    const source = `HTTP ${missingRoute}`;
    if (response.status !== 404) failures.push(`${source}: expected real 404, got ${response.status}`);
    if (!responseContentType(response).includes('text/html')) failures.push(`${source}: expected HTML content type, got ${responseContentType(response) || 'missing'}`);
    validateNotFoundDocument(body, source);
    if (publicRoutes.some((route) => elementText(body, 'h1') === route.h1)) failures.push(`${source}: wildcard is a soft 404 serving public content`);
  } catch (error) {
    failures.push(`HTTP ${missingRoute}: request failed (${error.message})`);
  }

  for (const [path, contentType, validator] of [
    ['/robots.txt', 'text/plain', (body) => {
      if (!/user-agent\s*:/i.test(body)) failures.push('HTTP /robots.txt: missing User-agent directive');
      if (!/sitemap\s*:/i.test(body)) failures.push('HTTP /robots.txt: missing Sitemap directive');
    }],
    ['/sitemap.xml', 'xml', (body) => {
      if (!/<urlset[\s>]/i.test(body)) failures.push('HTTP /sitemap.xml: invalid sitemap root');
      if (/\/(?:app|entrar|login|callback)(?:[/<]|$)/i.test(body)) failures.push('HTTP /sitemap.xml: private URL found');
      validateSitemapUrls(body, 'HTTP /sitemap.xml');
    }]
  ]) {
    try {
      const { response, body } = await request(baseUrl, path);
      if (response.status !== 200) failures.push(`HTTP ${path}: expected 200, got ${response.status}`);
      if (!responseContentType(response).includes(contentType)) failures.push(`HTTP ${path}: expected ${contentType} content type, got ${responseContentType(response) || 'missing'}`);
      validator(body);
    } catch (error) {
      failures.push(`HTTP ${path}: request failed (${error.message})`);
    }
  }

  const redirectPath = process.env.SEO_REDIRECT_PATH;
  const redirectTarget = process.env.SEO_REDIRECT_TARGET;
  if (redirectPath || redirectTarget) {
    if (!redirectPath || !redirectTarget) {
      failures.push('SEO_REDIRECT_PATH and SEO_REDIRECT_TARGET must be configured together');
    } else {
      try {
        const { response } = await request(baseUrl, redirectPath);
        const location = response.headers.get('location');
        if (![301, 308].includes(response.status) || location !== redirectTarget) {
          failures.push(`redirect ${redirectPath}: expected permanent redirect to ${redirectTarget}, got ${response.status} ${location ?? ''}`);
        }
      } catch (error) {
        failures.push(`redirect ${redirectPath}: request failed (${error.message})`);
      }
    }
  }
}

validateStaticSite();
await validateHttp();

const report = failures.length === 0
  ? `SEO validation passed for ${dist}\n`
  : `SEO validation failed for ${dist}\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`;
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, report);
const exitCode = failures.length === 0 ? 0 : 1;
// Node's fetch keeps an undici connection pool alive. Exit after the report is
// written so the CI step cannot remain alive waiting for an idle HTTP socket.
process.stdout.write(report, () => process.exit(exitCode));

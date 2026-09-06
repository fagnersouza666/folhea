#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const dist = process.argv[2] ?? 'frontend/dist';
const reportPath = process.argv[3] ?? 'seo-report/seo-validation.txt';
const failures = [];

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

function metaContent(content, name) {
  return tagsMatching(content, /<meta\b/i).find((tag) => {
    const nameMatch = tag.match(/\bname=["']([^"']+)["']/i);
    const contentMatch = tag.match(/\bcontent=["']([^"']+)["']/i);
    return nameMatch?.[1].toLowerCase() === name && contentMatch?.[1].trim();
  })?.match(/\bcontent=["']([^"']+)["']/i)?.[1]?.trim();
}

function hasMeta(content, name) {
  return Boolean(metaContent(content, name));
}

function hasCanonical(content) {
  return tagsMatching(content, /<link\b/i).some((tag) => {
    const relMatch = tag.match(/\brel=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
    return relMatch?.[1].toLowerCase().split(/\s+/).includes('canonical')
      && Boolean(hrefMatch?.[1].trim());
  });
}

function findSiteRoot(outputDirectory) {
  if (!existsSync(outputDirectory)) return outputDirectory;

  const robotsFiles = filesUnder(outputDirectory)
    .filter((path) => basename(path) === 'robots.txt');
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

if (!existsSync(dist)) {
  failures.push(`missing SSG output directory: ${dist}`);
} else {
  const siteRoot = findSiteRoot(dist);
  const htmlFiles = filesUnder(siteRoot).filter((path) => path.endsWith('.html'));
  if (htmlFiles.length === 0) failures.push(`no generated HTML pages found in: ${siteRoot}`);

  const titles = new Map();
  const descriptions = new Map();

  for (const path of htmlFiles) {
    const content = readFileSync(path, 'utf8');
    const relativePath = relative(siteRoot, path);
    const isPrivate = /(^|[/\\])app([/\\]|$)/.test(relativePath);
    const title = content.match(/<title>\s*([^<]+?)\s*<\/title>/i)?.[1]?.trim();
    const description = metaContent(content, 'description');
    const robots = metaContent(content, 'robots')?.toLowerCase().replace(/\s+/g, '');

    if (!title) failures.push(`missing title: ${path}`);
    if (!hasMeta(content, 'description')) failures.push(`missing meta description: ${path}`);
    if (!hasCanonical(content)) failures.push(`missing canonical: ${path}`);
    if (title && titles.has(title)) failures.push(`duplicate title "${title}": ${path} and ${titles.get(title)}`);
    if (description && descriptions.has(description)) {
      failures.push(`duplicate meta description: ${path} and ${descriptions.get(description)}`);
    }
    if (title) titles.set(title, path);
    if (description) descriptions.set(description, path);
    if (!isPrivate && robots?.includes('noindex')) {
      failures.push(`public page has noindex: ${path}`);
    }
    if (isPrivate && robots !== 'noindex,nofollow') {
      failures.push(`private page is missing noindex,nofollow: ${path}`);
    }
  }

  const robotsFile = join(siteRoot, 'robots.txt');
  requireFile(robotsFile, 'robots.txt');
  if (existsSync(robotsFile) && !/user-agent\s*:/i.test(readFileSync(robotsFile, 'utf8'))) {
    failures.push(`robots.txt has no User-agent directive: ${robotsFile}`);
  }
  requireFile(join(siteRoot, 'sitemap.xml'), 'sitemap.xml');
  requireFile(join(siteRoot, '404.html'), '404 page');

  const sitemap = join(siteRoot, 'sitemap.xml');
  if (existsSync(sitemap)) {
    const sitemapContent = readFileSync(sitemap, 'utf8');
    if (!/<urlset[\s>]/i.test(sitemapContent)) failures.push(`invalid sitemap root: ${sitemap}`);
    if (/\/(?:app|login|callback)(?:[/<]|$)/i.test(sitemapContent)) {
      failures.push(`private URL found in sitemap: ${sitemap}`);
    }
  }
}

async function validateHttp() {
  const baseUrl = process.env.SEO_BASE_URL;
  if (!baseUrl) return;

  const checks = [
    { path: '/', expected: 200, description: 'public landing status' },
    { path: '/__seo-missing-route__', expected: 404, description: '404 status' },
  ];
  for (const check of checks) {
    try {
      const response = await fetch(new URL(check.path, baseUrl));
      if (response.status !== check.expected) {
        failures.push(`${check.description}: expected ${check.expected}, got ${response.status}`);
      }
    } catch (error) {
      failures.push(`${check.description}: request failed (${error.message})`);
    }
  }

  const redirectPath = process.env.SEO_REDIRECT_PATH;
  const redirectTarget = process.env.SEO_REDIRECT_TARGET;
  if (redirectPath || redirectTarget) {
    if (!redirectPath || !redirectTarget) {
      failures.push('SEO_REDIRECT_PATH and SEO_REDIRECT_TARGET must be configured together');
    } else {
      try {
        const response = await fetch(new URL(redirectPath, baseUrl), { redirect: 'manual' });
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

await validateHttp();

const report = failures.length === 0
  ? `SEO validation passed for ${dist}\n`
  : `SEO validation failed for ${dist}\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`;
mkdirSync(join(reportPath, '..'), { recursive: true });
writeFileSync(reportPath, report);
const exitCode = failures.length === 0 ? 0 : 1;
// Node's fetch keeps an undici connection pool alive. Exit after the report is
// written so the CI step cannot remain alive waiting for an idle HTTP socket.
process.stdout.write(report, () => process.exit(exitCode));

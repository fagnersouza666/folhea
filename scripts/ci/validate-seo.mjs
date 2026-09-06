#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

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

function requireMatch(content, expression, description, path) {
  if (!expression.test(content)) failures.push(`missing ${description}: ${path}`);
}

if (!existsSync(dist)) {
  failures.push(`missing SSG output directory: ${dist}`);
} else {
  const htmlFiles = filesUnder(dist).filter((path) => path.endsWith('.html'));
  if (htmlFiles.length === 0) failures.push(`no generated HTML pages found in: ${dist}`);

  for (const path of htmlFiles) {
    const content = readFileSync(path, 'utf8');
    const isPrivate = /(^|[/\\])app([/\\]|$)/.test(relative(dist, path));
    requireMatch(content, /<title>\s*[^<]+<\/title>/i, 'title', path);
    requireMatch(content, /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+['"]/i, 'meta description', path);
    requireMatch(content, /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']+['"]/i, 'canonical', path);
    if (!isPrivate && /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(content)) {
      failures.push(`public page has noindex: ${path}`);
    }
    if (isPrivate && !/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']noindex,nofollow["']/i.test(content)) {
      failures.push(`private page is missing noindex,nofollow: ${path}`);
    }
  }

  requireFile(join(dist, 'robots.txt'), 'robots.txt');
  requireFile(join(dist, 'sitemap.xml'), 'sitemap.xml');
  requireFile(join(dist, '404.html'), '404 page');

  const sitemap = join(dist, 'sitemap.xml');
  if (existsSync(sitemap)) {
    const sitemapContent = readFileSync(sitemap, 'utf8');
    if (!/<urlset[\s>]/i.test(sitemapContent)) failures.push(`invalid sitemap root: ${sitemap}`);
    if (/\/app(?:[/<]|$)/i.test(sitemapContent)) failures.push(`private URL found in sitemap: ${sitemap}`);
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
process.stdout.write(report);
process.exitCode = failures.length === 0 ? 0 : 1;

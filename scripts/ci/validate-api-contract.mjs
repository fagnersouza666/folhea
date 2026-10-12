#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reportPath = resolve(process.cwd(), process.argv[2] ?? 'contract-report.txt');
const failures = [];

const operations = [
  ['GET', '/api/v1/csrf', 'CsrfResource.java', '@Path("/api/v1/csrf")'],
  ['GET', '/api/v1/me', 'UserResource.java', '@Path("/api/v1/me")'],
  ['PATCH', '/api/v1/me', 'UserResource.java', '@Path("/api/v1/me")'],
  ['GET', '/api/v1/me/export', 'UserResource.java', '@Path("/export")'],
  ['DELETE', '/api/v1/me', 'UserResource.java', '@Path("/api/v1/me")'],
  ['GET', '/api/v1/dashboard', 'StatisticsResource.java', '@Path("/api/v1")'],
  ['GET', '/api/v1/stats', 'StatisticsResource.java', '@Path("/api/v1")'],
  ['GET', '/api/v1/books', 'BookResource.java', '@Path("/api/v1/books")'],
  ['POST', '/api/v1/books', 'BookResource.java', '@Path("/api/v1/books")'],
  ['GET', '/api/v1/books/{id}', 'BookResource.java', '@Path("/{id}")'],
  ['GET', '/api/v1/books/{id}/cover', 'BookResource.java', '@Path("/{id}/cover")'],
  ['DELETE', '/api/v1/books/{id}/cover', 'BookResource.java', '@Path("/{id}/cover")'],
  ['GET', '/api/v1/books/{id}/photo', 'BookResource.java', '@Path("/{id}/photo")'],
  ['PUT', '/api/v1/books/{id}/photo', 'BookResource.java', '@Path("/{id}/photo")'],
  ['DELETE', '/api/v1/books/{id}/photo', 'BookResource.java', '@Path("/{id}/photo")'],
  ['PATCH', '/api/v1/books/{id}', 'BookResource.java', '@Path("/{id}")'],
  ['DELETE', '/api/v1/books/{id}', 'BookResource.java', '@Path("/{id}")'],
  ['POST', '/api/v1/books/{id}/finish', 'BookResource.java', '@Path("/{id}/finish")'],
  ['DELETE', '/api/v1/books/{id}/finish', 'BookResource.java', '@Path("/{id}/finish")'],
  ['GET', '/api/v1/sessions', 'ReadingSessionResource.java', '@Path("/api/v1/sessions")'],
  ['GET', '/api/v1/sessions/{id}', 'ReadingSessionResource.java', '@Path("/{id}")'],
  ['POST', '/api/v1/sessions', 'ReadingSessionResource.java', '@Path("/api/v1/sessions")'],
  ['PATCH', '/api/v1/sessions/{id}', 'ReadingSessionResource.java', '@Path("/{id}")'],
  ['DELETE', '/api/v1/sessions/{id}', 'ReadingSessionResource.java', '@Path("/{id}")']
];

const frontendClient = readFileSafe(resolve(repoRoot, 'frontend/src/app/core/api/api-client.service.ts'));
const frontendCsrf = readFileSafe(resolve(repoRoot, 'frontend/src/app/core/api/csrf.service.ts'));
const backendSources = new Map();
for (const [, , resource] of operations) {
  const folder = resource === 'UserResource.java' ? 'user' : resource === 'CsrfResource.java' ? 'security'
    : resource === 'StatisticsResource.java' ? 'statistics' : resource === 'BookResource.java' ? 'book' : 'reading';
  if (!backendSources.has(resource)) backendSources.set(resource, readFileSafe(resolve(repoRoot, 'backend/src/main/java/com/folhea', folder, resource)));
}

function readFileSafe(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

// Pair HTTP methods with their actual URL argument instead of allowing a GET
// anywhere in the file to accidentally satisfy a missing POST on another path.
const clientOperations = new Set([...(frontendClient + '\n' + frontendCsrf).matchAll(/this\.http\.(get|post|put|patch|delete)\s*<[^\n]+?>\s*\(\s*(?:`([^`]+)`|\x27([^\x27]+)\x27|"([^"]+)")/g)].map((match) => {
  const url = (match[2] ?? match[3] ?? match[4]).replace('${this.baseUrl}', '/api/v1')
    .replaceAll('${encodeURIComponent(id)}', '{id}').replaceAll('${id}', '{id}');
  return `${match[1].toUpperCase()} ${url}`;
}));
// Media GETs deliberately use browser <img src>, without HttpClient Blob.
// Accept only each dedicated same-origin URL builder (ignoring its query).
// An unrelated GET must not satisfy a missing photo/cover endpoint.
for (const [builder, expectedPath] of [
  ['bookCoverUrl', '/api/v1/books/{id}/cover'],
  ['bookPhotoUrl', '/api/v1/books/{id}/photo']
]) {
  const url = frontendClient.match(new RegExp(builder + '\\([^)]*\\)[\\s\\S]*?\\breturn\\s*`([^`]+)`'))?.[1];
  if (!url) continue;
  const path = url.split('?')[0].replace('${this.baseUrl}', '/api/v1')
    .replaceAll('${encodeURIComponent(id)}', '{id}').replaceAll('${id}', '{id}');
  if (path === expectedPath) clientOperations.add(`GET ${path}`);
}
for (const [method, path, resource, backendMarker] of operations) {
  if (!clientOperations.has(`${method} ${path}`)) failures.push(`frontend client is missing ${method} ${path}`);
  const source = backendSources.get(resource) ?? '';
  // Photo has GET/PUT/DELETE on the same path; pair its method annotation
  // rather than letting the legacy cover's GET hide a missing photo GET.
  const photoMethod = !path.endsWith('/photo')
    || new RegExp('@' + method + '\\s*@Path\\(\\s*"/\\{id\\}/photo"\\s*\\)').test(source);
  if (!source || !source.includes(`@${method}`) || !source.includes(backendMarker) || !photoMethod) {
    failures.push(`backend resource is missing ${method} ${path}`);
  }
}

// AUTH-01 uses browser navigation. These are source contract checks, not proof
// that an IdP accepted credentials or that runtime cookies have the right flags.
const authResource = readFileSafe(resolve(repoRoot, 'backend/src/main/java/com/folhea/auth/BffAuthResource.java'));
const authNavigation = ['core/auth/auth.service.ts', 'features/auth/login.component.ts',
  'features/auth/registration.component.ts', 'features/settings/settings.component.ts']
  .map(file => readFileSafe(resolve(repoRoot, 'frontend/src/app', file))).join('\n');
for (const route of ['login', 'register', 'reauthenticate']) {
  const path = '/auth/' + route;
  if (!authNavigation.includes("'" + path + "'") && !authNavigation.includes('href="' + path + '"')) {
    failures.push('frontend browser navigation is missing ' + path);
  }
  const getPath = new RegExp('@GET\\s*@Path\\(\\s*"/' + route + '"\\s*\\)');
  if (!authResource.includes('@Path("/auth")') || !getPath.test(authResource)) {
    failures.push('backend browser resource is missing GET ' + path);
  }
}
const retiredPaths = ['/api/v1/registration', '/api/v1/auth/register', '/api/v1/register', '/api/v1/analytics/events'];
for (const operation of clientOperations) {
  if (retiredPaths.includes(operation.slice(operation.indexOf(' ') + 1))) {
    failures.push('frontend client exposes retired operation ' + operation);
  }
}
const registrationResource = readFileSafe(resolve(repoRoot, 'backend/src/main/java/com/folhea/user/RegistrationResource.java'));
if (registrationResource.includes('@POST')) failures.push('backend still exposes password registration POSTs');
if (backendSources.get('StatisticsResource.java')?.includes('@Path("/analytics/events")')
    || readFileSafe(resolve(repoRoot, 'backend/src/main/java/com/folhea/analytics/AnalyticsResource.java')).includes('@Path(')) {
  failures.push('backend still exposes retired analytics events');
}
const authForms = ['login.component.ts', 'registration.component.ts']
  .map(file => readFileSafe(resolve(repoRoot, 'frontend/src/app/features/auth', file))).join('\n');
if (/\btype\s*=\s*["']password["']/.test(authForms)) failures.push('Angular auth form still collects a password');

const csrfCookie = readFileSafe(resolve(repoRoot, 'backend/src/main/java/com/folhea/security/CsrfCookiePolicy.java'));
for (const marker of ['"__Host-folhea_csrf"', '.path("/")', '.secure(true)', '.httpOnly(false)', '.sameSite(NewCookie.SameSite.LAX)']) {
  if (!csrfCookie.includes(marker)) failures.push('backend CSRF cookie contract is missing ' + marker);
}
if (!frontendCsrf.includes('document.cookie') || !frontendCsrf.includes('__Host-folhea_csrf=')) {
  failures.push('frontend must read the matching CSRF cookie');
}
if (!backendSources.get('CsrfResource.java')?.includes('CsrfCookiePolicy.issue(')) {
  failures.push('GET /api/v1/csrf must issue the readable cookie');
}
const interceptor = readFileSafe(resolve(repoRoot, 'frontend/src/app/core/api/csrf.interceptor.ts'));
if (!interceptor.includes("'X-CSRF-Token'") || !interceptor.includes('withCredentials: true')) {
  failures.push('frontend mutations must send CSRF headers and cookies');
}
const boundary = readFileSafe(resolve(repoRoot, 'backend/src/main/java/com/folhea/security/SecurityBoundaryFilter.java'));
for (const marker of ['getCookies().get(CsrfCookiePolicy.NAME)', 'MessageDigest.isEqual(', 'csrfTokens.isValid(ticket, token)']) {
  if (!boundary.includes(marker)) failures.push('backend must verify cookie/header equality and server binding: ' + marker);
}

async function validateOpenApi() {
  const source = process.env.OPENAPI_FILE;
  const url = process.env.OPENAPI_URL;
  // Production disables OpenAPI at Quarkus (%prod) and on the Caddy edge; CI
  // must not depend on a public OPENAPI_URL. Use OPENAPI_FILE from a dev/test
  // build artifact when cross-checking paths against the spec.
  if (!source && !url) return;
  try {
    const content = source ? readFileSafe(resolve(process.cwd(), source)) : await fetch(url).then((response) => response.text());
    const document = JSON.parse(content);
    for (const [method, path] of operations) {
      const openApiPath = path.replace('{id}', '{id}');
      if (!document.paths?.[openApiPath]?.[method.toLowerCase()]) failures.push(`OpenAPI document is missing ${method} ${openApiPath}`);
    }
    for (const path of retiredPaths) {
      if (document.paths?.[path]) failures.push('OpenAPI still exposes retired path ' + path);
    }
  } catch (error) {
    failures.push(`OpenAPI document could not be read as JSON: ${error.message}`);
  }
}

await validateOpenApi();
const report = failures.length === 0
  ? 'API contract validation passed: frontend methods and backend resources are aligned.\n'
  : `API contract validation failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`;
writeFileSync(reportPath, report);
process.stdout.write(report);
process.exitCode = failures.length === 0 ? 0 : 1;

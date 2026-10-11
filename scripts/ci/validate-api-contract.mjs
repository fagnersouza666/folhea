#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reportPath = resolve(process.cwd(), process.argv[2] ?? 'contract-report.txt');
const failures = [];

const operations = [
  ['POST', '/api/v1/registration', 'RegistrationResource.java', '@Path("/registration")'],
  ['GET', '/api/v1/me', 'UserResource.java', '@Path("/api/v1/me")'],
  ['PATCH', '/api/v1/me', 'UserResource.java', '@Path("/api/v1/me")'],
  ['GET', '/api/v1/me/export', 'UserResource.java', '@Path("/export")'],
  ['DELETE', '/api/v1/me', 'UserResource.java', '@Path("/api/v1/me")'],
  ['GET', '/api/v1/dashboard', 'StatisticsResource.java', '@Path("/api/v1")'],
  ['GET', '/api/v1/stats', 'StatisticsResource.java', '@Path("/api/v1")'],
  ['GET', '/api/v1/books', 'BookResource.java', '@Path("/api/v1/books")'],
  ['POST', '/api/v1/books', 'BookResource.java', '@Path("/api/v1/books")'],
  ['GET', '/api/v1/books/{id}', 'BookResource.java', '@Path("/{id}")'],
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
const backendSources = new Map();
for (const [, , resource] of operations) {
  if (!backendSources.has(resource)) backendSources.set(resource, readFileSafe(resolve(repoRoot, 'backend/src/main/java/com/folhea', ['UserResource.java', 'RegistrationResource.java'].includes(resource) ? 'user' : resource === 'StatisticsResource.java' ? 'statistics' : resource === 'BookResource.java' ? 'book' : 'reading', resource)));
}

function readFileSafe(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

// Pair HTTP methods with their actual URL argument instead of allowing a GET
// anywhere in the file to accidentally satisfy a missing POST on another path.
const clientOperations = new Set([...frontendClient.matchAll(/this\.http\.(get|post|patch|delete)\s*<[^\n]+?>\s*\(\s*`([^`]+)`/g)].map((match) => {
  const url = match[2].replace('${this.baseUrl}', '/api/v1')
    .replaceAll('${encodeURIComponent(id)}', '{id}').replaceAll('${id}', '{id}');
  return `${match[1].toUpperCase()} ${url}`;
}));
for (const [method, path, resource, backendMarker] of operations) {
  if (!clientOperations.has(`${method} ${path}`)) failures.push(`frontend client is missing ${method} ${path}`);
  const source = backendSources.get(resource) ?? '';
  if (!source || !source.includes(`@${method}`) || !source.includes(backendMarker)) {
    failures.push(`backend resource is missing ${method} ${path}`);
  }
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

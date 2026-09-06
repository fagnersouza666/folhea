#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reportPath = resolve(process.cwd(), process.argv[2] ?? 'contract-report.txt');
const failures = [];

const operations = [
  ['GET', '/api/v1/me', 'UserResource.java', '@Path("/api/v1/me")'],
  ['GET', '/api/v1/dashboard', 'StatisticsResource.java', '@Path("/api/v1")'],
  ['GET', '/api/v1/stats', 'StatisticsResource.java', '@Path("/api/v1")'],
  ['GET', '/api/v1/books', 'BookResource.java', '@Path("/api/v1/books")'],
  ['POST', '/api/v1/books', 'BookResource.java', '@Path("/api/v1/books")'],
  ['PATCH', '/api/v1/books/{id}', 'BookResource.java', '@Path("/{id}")'],
  ['DELETE', '/api/v1/books/{id}', 'BookResource.java', '@Path("/{id}")'],
  ['POST', '/api/v1/books/{id}/finish', 'BookResource.java', '@Path("/{id}/finish")'],
  ['DELETE', '/api/v1/books/{id}/finish', 'BookResource.java', '@Path("/{id}/finish")'],
  ['GET', '/api/v1/sessions', 'ReadingSessionResource.java', '@Path("/api/v1/sessions")'],
  ['POST', '/api/v1/sessions', 'ReadingSessionResource.java', '@Path("/api/v1/sessions")'],
  ['PATCH', '/api/v1/sessions/{id}', 'ReadingSessionResource.java', '@Path("/{id}")'],
  ['DELETE', '/api/v1/sessions/{id}', 'ReadingSessionResource.java', '@Path("/{id}")']
];

const frontendClient = readFileSafe(resolve(repoRoot, 'frontend/src/app/core/api/api-client.service.ts'));
const backendSources = new Map();
for (const [, , resource] of operations) {
  if (!backendSources.has(resource)) backendSources.set(resource, readFileSafe(resolve(repoRoot, 'backend/src/main/java/com/folhea', resource === 'UserResource.java' ? 'user' : resource === 'StatisticsResource.java' ? 'statistics' : resource === 'BookResource.java' ? 'book' : 'reading', resource)));
}

function readFileSafe(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function clientPath(path) {
  return path.replace('/api/v1', '').replaceAll('{id}', '${id}');
}

for (const [method, path, resource, backendMarker] of operations) {
  const clientNeedle = `this.http.${method.toLowerCase()}<`;
  const normalizedPath = clientPath(path);
  if (!frontendClient.includes(normalizedPath) || !frontendClient.includes(clientNeedle)) {
    failures.push(`frontend client is missing ${method} ${path}`);
  }
  const source = backendSources.get(resource) ?? '';
  if (!source || !source.includes(`@${method}`) || !source.includes(backendMarker)) {
    failures.push(`backend resource is missing ${method} ${path}`);
  }
}

async function validateOpenApi() {
  const source = process.env.OPENAPI_FILE;
  const url = process.env.OPENAPI_URL;
  if (!source && !url) return;
  try {
    const content = source ? readFileSafe(resolve(process.cwd(), source)) : await fetch(url).then((response) => response.text());
    const document = JSON.parse(content);
    for (const [, path] of operations) {
      const openApiPath = path.replace('{id}', '{id}');
      if (!document.paths?.[openApiPath]) failures.push(`OpenAPI document is missing ${openApiPath}`);
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

#!/usr/bin/env node

import { access, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';

const siteRoot = resolve(process.argv[2] ?? 'frontend/dist');
const port = Number(process.argv[3] ?? process.env.SEO_PORT ?? 4173);
const privateRoute = /^\/app(?:\/|$)/;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

function isWithinSiteRoot(path) {
  const pathFromRoot = relative(siteRoot, path);
  return pathFromRoot === '' || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !pathFromRoot.includes(`${sep}..${sep}`));
}

function requestedPath(requestUrl) {
  const pathname = new URL(requestUrl, 'http://localhost').pathname;
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes('\0')) throw new Error('invalid path');
  return decoded;
}

async function existingFile(path) {
  if (!isWithinSiteRoot(path)) return undefined;
  try {
    const details = await stat(path);
    return details.isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

async function staticFile(pathname) {
  const path = resolve(siteRoot, `.${pathname}`);
  const direct = await existingFile(path);
  if (direct) return direct;
  return existingFile(resolve(path, 'index.html'));
}

async function sendFile(response, requestMethod, path, status = 200, extraHeaders = {}) {
  const contentType = contentTypes[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const body = await readFile(path);
  response.writeHead(status, { 'Content-Length': body.byteLength, 'Content-Type': contentType, ...extraHeaders });
  response.end(requestMethod === 'HEAD' ? undefined : body);
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  try {
    const pathname = requestedPath(request.url ?? '/');
    if (privateRoute.test(pathname)) {
      const shell = await existingFile(resolve(siteRoot, 'index.html'));
      if (!shell) throw new Error('missing private application shell');
      await sendFile(response, request.method, shell, 200, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
      return;
    }

    const file = await staticFile(pathname);
    if (file) {
      await sendFile(response, request.method, file);
      return;
    }

    const notFound = await existingFile(resolve(siteRoot, '404.html'));
    if (notFound) {
      await sendFile(response, request.method, notFound, 404);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : 'Not found\n');
  } catch (error) {
    const status = error instanceof URIError ? 400 : 500;
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`${error.message}\n`);
  }
});

await access(siteRoot);
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`SEO static server listening on http://127.0.0.1:${port}\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

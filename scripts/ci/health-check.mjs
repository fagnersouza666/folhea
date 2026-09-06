#!/usr/bin/env node

const baseUrl = process.env.HEALTHCHECK_URL;
const paths = (process.env.HEALTHCHECK_PATHS ?? '/q/health/live,/q/health/ready').split(',').map((path) => path.trim()).filter(Boolean);
const attempts = Number(process.env.HEALTHCHECK_ATTEMPTS ?? 12);
const delayMs = Number(process.env.HEALTHCHECK_DELAY_MS ?? 5_000);

if (!baseUrl) throw new Error('HEALTHCHECK_URL is required');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let lastError = 'no response';

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const checks = await Promise.all(paths.map(async (path) => {
      const response = await fetch(new URL(path, baseUrl));
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      const body = await response.json().catch(() => ({}));
      if (body.status && body.status !== 'UP') throw new Error(`${path} reported ${body.status}`);
      return path;
    }));
    console.log(`health check passed on attempt ${attempt}: ${checks.join(', ')}`);
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    if (attempt < attempts) await wait(delayMs);
  }
}

console.error(`health check failed after ${attempts} attempts: ${lastError}`);
process.exit(1);

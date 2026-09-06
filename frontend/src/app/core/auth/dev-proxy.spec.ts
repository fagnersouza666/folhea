import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendRoot = resolve(import.meta.dirname, '../../../..');

describe('ng serve BFF proxy', () => {
  it('forwards /auth and /api to the local Quarkus BFF so /auth/login is not an Angular 404', () => {
    const proxy = JSON.parse(readFileSync(resolve(frontendRoot, 'proxy.conf.json'), 'utf8')) as Record<
      string,
      { target?: string; headers?: Record<string, string> }
    >;
    const angular = JSON.parse(readFileSync(resolve(frontendRoot, 'angular.json'), 'utf8')) as {
      projects: { folhea: { architect: { serve: { options?: { proxyConfig?: string } } } } };
    };

    expect(angular.projects.folhea.architect.serve.options?.proxyConfig).toBe('proxy.conf.json');
    expect(proxy['/auth']?.target).toBe('http://localhost:8080');
    expect(proxy['/api']?.target).toBe('http://localhost:8080');
    for (const path of ['/auth', '/api'] as const) {
      expect(proxy[path]?.headers).toEqual({
        'X-Forwarded-Host': 'localhost:4200',
        'X-Forwarded-Proto': 'http',
        'X-Forwarded-Port': '4200'
      });
    }
  });
});

import { defineConfig, devices } from '@playwright/test';

// Uses the complete local stack, without intercepting any domain/auth request.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  testMatch: '**/integrated.spec.ts',
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['FOLHEA_E2E_BASE_URL'] ?? 'https://localhost:9443',
    // Only this opt-in local stack accepts its development CA.
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome']
  }
});

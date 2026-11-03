import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('/cleardue_test')
)
  throw new Error('Browser tests require the dedicated migrated cleardue_test database.');
const env = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  APP_URL: 'http://127.0.0.1:3100',
  PAYMENT_MODE: 'demo',
  AI_MODE: 'fixture',
  LOCAL_DEMO_ACCESS: 'true',
  AG_STUDIO_ENABLED: 'true',
  AG_STUDIO_LICENSE_KEY: '',
  LIVE_AI_ENABLED: 'false',
} as Record<string, string>;
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'prepare', testMatch: /prepare\.setup\.ts/, timeout: 180000 },
    {
      name: 'chromium',
      testMatch: /journey\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['prepare'],
    },
  ],
  webServer: [
    {
      command: 'pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3100',
      url: 'http://127.0.0.1:3100/api/health',
      env,
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: 'pnpm worker',
      wait: { stdout: /ClearDue worker ready/ },
      env,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});

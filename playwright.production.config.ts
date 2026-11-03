import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) process.loadEnvFile('.env');
if (
  !process.env.TEST_DATABASE_URL ||
  new URL(process.env.TEST_DATABASE_URL).pathname !== '/cleardue_test'
)
  throw new Error('Production browser checks require migrated cleardue_test.');
const ownerEmail = `production-${randomBytes(8).toString('hex')}@cleardue.example`;
const judgeEmail = `judge-${randomBytes(8).toString('hex')}@cleardue.example`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  CLEARDUE_PRODUCTION_TEST: 'true',
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  APP_URL: 'http://127.0.0.1:3100',
  OWNER_EMAILS: `${ownerEmail},${judgeEmail}`,
  READ_ONLY_JUDGE_EMAIL: judgeEmail,
  BETTER_AUTH_SECRET: randomBytes(48).toString('hex'),
  PAYMENT_MODE: 'demo',
  AI_MODE: 'fixture',
  AI_PROVIDER: 'openai',
  LOCAL_DEMO_ACCESS: 'true',
  LIVE_AI_ENABLED: 'false',
  PAYPAL_SANDBOX_WRITE_ENABLED: 'false',
  PAYPAL_SANDBOX_TEST_ENABLED: 'false',
  PAYPAL_CLIENT_ID: '',
  PAYPAL_CLIENT_SECRET: '',
  PAYPAL_WEBHOOK_ID: '',
  OPENAI_API_KEY: '',
  ASTRO_GATEWAY_API_KEY: '',
  AG_STUDIO_ENABLED: 'true',
  AG_STUDIO_LICENSE_KEY: '',
} as Record<string, string>;
export default defineConfig({
  testDir: 'tests/production',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  outputDir: '.local/production-test/results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: env.APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command:
        'pnpm exec tsx scripts/prepare-production-test.ts && pnpm exec next start --hostname 127.0.0.1 --port 3100',
      url: `${env.APP_URL}/api/health`,
      env,
      reuseExistingServer: false,
      timeout: 60000,
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeEnvironment } from './environment.mjs';

test('dependency credentials are URL-encoded and production bypass stays disabled', () => {
  const env = runtimeEnvironment({
    KNOWLEDGE_DB_HOST: 'db',
    KNOWLEDGE_DB_PORT: '5432',
    POSTGRES_USER: 'judge@workspace',
    POSTGRES_PASSWORD: 'synthetic:#?/@ password',
    POSTGRES_DB: 'judge/db',
    LOCAL_DEMO_ACCESS: 'true',
  });
  const url = new URL(env.DATABASE_URL);
  assert.equal(url.hostname, 'db');
  assert.equal(decodeURIComponent(url.username), 'judge@workspace');
  assert.equal(decodeURIComponent(url.password), 'synthetic:#?/@ password');
  assert.equal(decodeURIComponent(url.pathname.slice(1)), 'judge/db');
  assert.equal(env.LOCAL_DEMO_ACCESS, 'false');
  assert.equal(env.NODE_ENV, 'production');
});

test('explicit database URL is preserved; partial metadata fails without echoing credentials', () => {
  const url = 'postgresql://synthetic:private@db:5432/judge?sslmode=require';
  assert.equal(runtimeEnvironment({ DATABASE_URL: url }).DATABASE_URL, url);
  assert.throws(
    () => runtimeEnvironment({ POSTGRES_PASSWORD: 'never-echo-this-secret' }),
    (error) => !error.message.includes('never-echo-this-secret'),
  );
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { modelSettings, liveLimits } from '../../src/server/config';
import { createModelClient } from '../../src/server/model-client';

beforeEach(() => {
  for (const [name, value] of Object.entries({
    LIVE_AI_ENABLED: 'true',
    AI_PROVIDER: 'astropods',
    ASTRO_GATEWAY_URL: 'https://aig.astropods.ai',
    ASTRO_GATEWAY_API_KEY: 'synthetic-gateway-key-not-real',
    ASTRO_GATEWAY_MODEL: 'synthetic-model',
    ASTROPODS_CREDIT_ONLY_CONFIRMED: 'true',
    LIVE_AI_DAILY_CALL_LIMIT: '12',
    LIVE_AI_DAILY_TOKEN_LIMIT: '100000',
    LIVE_AI_MAX_OUTPUT_TOKENS: '2000',
    OPENAI_API_KEY: 'unselected-synthetic-key',
    OPENAI_MODEL: 'unselected-model',
  }))
    vi.stubEnv(name, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('selects the explicit Gateway profile and returns budget metadata without its secret', () => {
  expect(modelSettings()).toMatchObject({
    provider: 'astropods',
    model: 'synthetic-model',
    baseURL: 'https://aig.astropods.ai/v1',
  });
  expect(liveLimits()).toEqual({
    provider: 'astropods',
    model: 'synthetic-model',
    calls: 12,
    tokens: 100000,
    output: 2000,
  });
});
it('refuses a missing Gateway key/model or unconfirmed credit-only setup instead of falling back to OpenAI', () => {
  for (const name of [
    'ASTRO_GATEWAY_API_KEY',
    'ASTRO_GATEWAY_MODEL',
    'ASTROPODS_CREDIT_ONLY_CONFIRMED',
  ]) {
    const prior = process.env[name];
    vi.stubEnv(name, '');
    expect(() => createModelClient()).toThrow();
    vi.stubEnv(name, prior!);
  }
});
it('rejects untrusted origins, URL credentials, paths, queries and non-TLS endpoints before a request', () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  for (const value of [
    'http://aig.astropods.ai',
    'https://attacker.example',
    'https://user:pass@aig.astropods.ai',
    'https://aig.astropods.ai/v1',
    'https://aig.astropods.ai?token=example',
    'https://aig.astropods.ai#other',
    'https://aig.astropods.ai:8443',
  ]) {
    vi.stubEnv('ASTRO_GATEWAY_URL', value);
    expect(() => createModelClient()).toThrow();
  }
  expect(request).not.toHaveBeenCalled();
});
it('retains the explicitly selected OpenAI profile without using the Gateway credentials', () => {
  vi.stubEnv('AI_PROVIDER', 'openai');
  expect(modelSettings()).toMatchObject({
    provider: 'openai',
    model: 'unselected-model',
    apiKey: 'unselected-synthetic-key',
    baseURL: 'https://api.openai.com/v1',
  });
});
it('requires the live flag even when both providers have configured credentials', () => {
  vi.stubEnv('LIVE_AI_ENABLED', 'false');
  expect(() => createModelClient()).toThrow('Enable live analysis');
});
it('does not retry or switch to the paid provider after a Gateway failure', async () => {
  const request = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ error: { message: 'Synthetic unavailable', type: 'server_error' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', request);
  await expect(
    createModelClient().responses.create({
      model: 'synthetic-model',
      input: 'synthetic',
      store: false,
    }),
  ).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
  const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(String(url)).toBe('https://aig.astropods.ai/v1/responses');
  expect(options.redirect).toBe('error');
  expect(options.cache).toBe('no-store');
  expect(new Headers(options.headers).get('authorization')).toBe(
    'Bearer synthetic-gateway-key-not-real',
  );
});

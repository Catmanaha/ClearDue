import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultView } from '../../src/domain/dashboard';
import { studioTurn } from '../../src/server/studio-model';

const mocked = vi.hoisted(() => ({ create: vi.fn(), analytics: vi.fn(), reserve: vi.fn() }));
vi.mock('../../src/server/model-client', () => ({
  createModelClient: () => ({ responses: { create: mocked.create } }),
}));
vi.mock('../../src/server/analytics', () => ({ analytics: mocked.analytics }));
vi.mock('../../src/server/investigator', () => ({ reserveBudget: mocked.reserve }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries({
    PAYMENT_MODE: 'demo',
    APP_URL: 'http://127.0.0.1:3000',
    PAYPAL_SELLER_EMAIL: 'synthetic-seller@example.com',
    PAYPAL_MERCHANT_ID: 'synthetic-merchant',
    LIVE_AI_ENABLED: 'true',
    AI_PROVIDER: 'astropods',
    ASTRO_GATEWAY_URL: 'https://aig.astropods.ai',
    ASTRO_GATEWAY_API_KEY: 'synthetic-key-not-real',
    ASTRO_GATEWAY_MODEL: 'synthetic-model',
    ASTROPODS_CREDIT_ONLY_CONFIRMED: 'true',
    LIVE_AI_DAILY_CALL_LIMIT: '6',
    LIVE_AI_DAILY_TOKEN_LIMIT: '100000',
    LIVE_AI_MAX_OUTPUT_TOKENS: '2000',
  }))
    vi.stubEnv(name, value);
  mocked.analytics.mockResolvedValue({ rows: [], view: defaultView });
  mocked.reserve.mockResolvedValue({
    provider: 'astropods',
    model: 'synthetic-model',
    calls: 6,
    tokens: 100000,
    output: 2000,
  });
  mocked.create.mockResolvedValue({
    id: 'synthetic-response',
    created_at: 0,
    status: 'completed',
    model: 'synthetic-model',
    output: [],
  });
});
afterEach(() => vi.unstubAllEnvs());

async function request() {
  await studioTurn('synthetic-owner', {
    input: [
      {
        id: 'synthetic-user-message',
        kind: 'input',
        type: 'message',
        role: 'user',
        content: [{ type: 'text', text: 'Show cases needing evidence.' }],
        status: 'completed',
      },
    ],
    responseFormat: { type: 'text' },
  });
  expect(mocked.analytics).toHaveBeenCalledWith('synthetic-owner');
  expect(mocked.create).toHaveBeenCalledOnce();
  return mocked.create.mock.calls[0][0];
}

it('sends the explicit simulated adapter identity even when the owner has no rows', async () => {
  expect((await request()).instructions).toContain('Configured payment adapter: demo (simulated).');
});
it('sends the explicit sandbox identity even when the owner has no rows', async () => {
  vi.stubEnv('PAYMENT_MODE', 'sandbox');
  expect((await request()).instructions).toContain(
    'Configured payment adapter: sandbox (PayPal test funds).',
  );
});
it('retains scoped row provenance and separate server-calculated amounts in the model request', async () => {
  vi.stubEnv('PAYMENT_MODE', 'sandbox');
  mocked.analytics.mockResolvedValue({
    rows: [
      {
        id: 'synthetic-case',
        customer: 'Synthetic customer',
        issue: 'QUESTIONED_CHARGE',
        state: 'RESOLVED',
        findingCurrent: true,
        needsEvidence: false,
        duePence: 0,
        paidPence: 100000,
        removedPence: 25000,
        payment: 'PAID',
        environment: 'sandbox',
      },
    ],
    view: defaultView,
  });
  const prompt = (await request()).instructions;
  expect(prompt).toContain('"environment":"sandbox"');
  expect(prompt).toContain('"paidPence":100000,"removedPence":25000,"duePence":0');
});

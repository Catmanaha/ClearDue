import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import {
  creditOnlyBilling,
  gatewayFromContainer,
  gatewayEnvUpdate,
  gatewayModel,
} from '../../scripts/lib/astropods-setup';

const secret = 'synthetic-managed-key-not-a-real-credential';
const directory = resolve('dev/astropods-gateway');
const env = {
  ASTRO_GATEWAY_URL: 'https://aig.astropods.ai',
  ASTRO_GATEWAY_API_KEY: secret,
  ASTRO_GATEWAY_MODEL: gatewayModel,
};
const billing = { currency: 'USD', has_credit: true, credit_remaining: 9.98, current_spend: 0 };
const status = {
  status: 'active',
  has_payment_method: false,
  credits_exhausted: false,
  workloads_suspended: false,
  gated: false,
};
const container = () => [
  {
    Config: {
      Labels: {
        'com.docker.compose.project': 'cleardue-gateway',
        'com.docker.compose.service': 'agent',
        'com.docker.compose.project.working_dir': directory,
      },
      Env: [
        `ASTRO_GATEWAY_URL=${env.ASTRO_GATEWAY_URL}`,
        `ASTRO_GATEWAY_API_KEY=${secret}`,
        `MODEL_DEFAULT=${gatewayModel}`,
      ],
    },
  },
];

describe('local Astropods setup boundary', () => {
  it('requires explicit positive credit and no-card active billing, never guesses unknown fields', () => {
    expect(creditOnlyBilling(billing, status).cashPayableUsd).toBe(0);
    for (const value of [
      { ...billing, credit_remaining: 0 },
      { ...billing, credit_remaining: NaN },
      { ...billing, current_spend: 1 },
      {},
    ])
      expect(() => creditOnlyBilling(value, status)).toThrow();
    for (const value of [
      { ...status, has_payment_method: true },
      { ...status, gated: true },
      { ...status, credits_exhausted: true },
      { ...status, workloads_suspended: true },
      {},
    ])
      expect(() => creditOnlyBilling(billing, value)).toThrow();
  });

  it('accepts only the local repository project, agent service, selected model and fixed origin', () => {
    expect(gatewayFromContainer(container(), directory, gatewayModel)).toEqual(env);
    expect(() =>
      gatewayFromContainer(container(), resolve('another-project'), gatewayModel),
    ).toThrow();
    expect(() => gatewayFromContainer(container(), directory, 'another-model')).toThrow();
    for (const label of ['com.docker.compose.project', 'com.docker.compose.service']) {
      const value = container();
      value[0].Config.Labels[label as keyof (typeof value)[0]['Config']['Labels']] = 'other';
      expect(() => gatewayFromContainer(value, directory, gatewayModel)).toThrow();
    }
    for (const origin of [
      'https://evil.example',
      'https://aig.astropods.ai/redirect',
      'http://aig.astropods.ai',
    ]) {
      const value = container();
      value[0].Config.Env[0] = `ASTRO_GATEWAY_URL=${origin}`;
      expect(() => gatewayFromContainer(value, directory, gatewayModel)).toThrow();
    }
  });

  it('rejects ambiguous or dotenv-unsafe credentials without including them in errors', () => {
    for (const key of ['short', secret + '\nOTHER=oops', secret + '$EXPAND', secret + '"']) {
      const value = container();
      value[0].Config.Env[1] = `ASTRO_GATEWAY_API_KEY=${key}`;
      expect(() => gatewayFromContainer(value, directory, gatewayModel)).toThrow();
      try {
        gatewayFromContainer(value, directory, gatewayModel);
      } catch (error) {
        expect((error as Error).message).not.toContain(secret);
      }
    }
    const duplicate = container();
    duplicate[0].Config.Env.push(`ASTRO_GATEWAY_API_KEY=${secret}`);
    expect(() => gatewayFromContainer(duplicate, directory, gatewayModel)).toThrow();
  });

  it('preserves unrelated bytes and flags while importing a key', () => {
    const original =
      '# Private\r\nPAYPAL_CLIENT_SECRET="keep-$-and-`-literal"\r\nAI_MODE=fixture\r\nLIVE_AI_ENABLED=false\r\nLIVE_AI_DAILY_CALL_LIMIT=12\r\nASTRO_GATEWAY_API_KEY=\r\n';
    const result = gatewayEnvUpdate(original, env, false);
    expect(result).toContain(original.slice(0, original.indexOf('ASTRO_GATEWAY_API_KEY')));
    expect(parseEnv(result)).toMatchObject({
      ...env,
      PAYPAL_CLIENT_SECRET: 'keep-$-and-`-literal',
      AI_MODE: 'fixture',
      LIVE_AI_ENABLED: 'false',
      LIVE_AI_DAILY_CALL_LIMIT: '12',
    });
    expect(gatewayEnvUpdate(result, env, false)).toBe(result);
  });

  it('requires deliberate replacement and handles standard dotenv whitespace', () => {
    const original = '  export ASTRO_GATEWAY_API_KEY = "older-managed-key"\nPAYMENT_MODE=demo\n';
    expect(() => gatewayEnvUpdate(original, env, false)).toThrow(/--replace/);
    const result = gatewayEnvUpdate(original, env, true);
    expect(parseEnv(result).ASTRO_GATEWAY_API_KEY).toBe(secret);
    expect(result.match(/ASTRO_GATEWAY_API_KEY/g)).toHaveLength(1);
  });

  it('rejects duplicates and multiline files rather than editing embedded dotenv-looking content', () => {
    expect(() =>
      gatewayEnvUpdate('ASTRO_GATEWAY_API_KEY=\n ASTRO_GATEWAY_API_KEY =duplicate\n', env, true),
    ).toThrow(/Duplicate/);
    expect(() =>
      gatewayEnvUpdate('OTHER="first\nASTRO_GATEWAY_API_KEY=embedded\nlast"\n', env, true),
    ).toThrow(/single-line/);
  });
});

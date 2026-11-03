import { z } from 'zod';
import { demoMerchant } from '../domain/fixtures';
import { DomainError } from '../domain/core';
export function config() {
  const mode = z.enum(['demo', 'sandbox']).parse(process.env.PAYMENT_MODE ?? 'demo');
  const ai = z.enum(['fixture', 'live']).parse(process.env.AI_MODE ?? 'fixture');
  const appUrl = new URL(process.env.APP_URL ?? 'http://127.0.0.1:3000');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(appUrl.hostname);
  const ownerEmails = (process.env.OWNER_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const readOnlyJudgeEmail = process.env.READ_ONLY_JUDGE_EMAIL?.trim().toLowerCase() || null;
  if (readOnlyJudgeEmail && (mode !== 'demo' || !ownerEmails.includes(readOnlyJudgeEmail)))
    throw new DomainError(
      'CONFIG',
      'The read-only judge account must be allowlisted in a simulated workspace.',
    );
  const demoAccess =
    mode === 'demo' &&
    !readOnlyJudgeEmail &&
    loopback &&
    process.env.NODE_ENV !== 'production' &&
    process.env.LOCAL_DEMO_ACCESS === 'true';
  if (!loopback && appUrl.protocol !== 'https:')
    throw new DomainError('CONFIG', 'Non-local APP_URL requires HTTPS.');
  const merchant = mode === 'demo' ? demoMerchant : process.env.PAYPAL_SELLER_EMAIL;
  if (!merchant)
    throw new DomainError('CONFIG', 'Configure PAYPAL_SELLER_EMAIL for the sandbox merchant.');
  if (mode === 'sandbox' && !process.env.PAYPAL_MERCHANT_ID)
    throw new DomainError('CONFIG', 'Configure PAYPAL_MERCHANT_ID.');
  return {
    mode,
    ai,
    appUrl: appUrl.origin,
    loopback,
    demoAccess,
    merchant,
    merchantId: mode === 'demo' ? 'cleardue-demo' : process.env.PAYPAL_MERCHANT_ID!,
    databaseUrl:
      process.env.DATABASE_URL ?? 'postgresql://cleardue:cleardue_local@127.0.0.1:5432/cleardue',
    ownerEmails,
    readOnlyJudgeEmail,
    studioEnabled: process.env.AG_STUDIO_ENABLED === 'true',
    studioKey: process.env.AG_STUDIO_LICENSE_KEY ?? '',
  };
}
export function modelSettings() {
  if (process.env.LIVE_AI_ENABLED !== 'true')
    throw new DomainError(
      'AI_DISABLED',
      'Enable live analysis and configure the selected project model before making model calls.',
    );
  const provider = z.enum(['openai', 'astropods']).parse(process.env.AI_PROVIDER ?? 'openai');
  const model =
    provider === 'astropods' ? process.env.ASTRO_GATEWAY_MODEL : process.env.OPENAI_MODEL;
  const apiKey =
    provider === 'astropods' ? process.env.ASTRO_GATEWAY_API_KEY : process.env.OPENAI_API_KEY;
  if (!model?.trim() || !apiKey?.trim())
    throw new DomainError(
      'AI_DISABLED',
      'Configure the selected project model and its credentials.',
    );
  if (provider === 'astropods') {
    if (process.env.ASTROPODS_CREDIT_ONLY_CONFIRMED !== 'true')
      throw new DomainError(
        'AI_SETUP',
        'Confirm the Astropods signup credits and no-card billing setup before live calls.',
      );
    let origin: URL;
    try {
      origin = new URL(process.env.ASTRO_GATEWAY_URL ?? '');
    } catch {
      throw new DomainError('AI_SETUP', 'Configure the verified Astropods Gateway origin.');
    }
    if (
      origin.origin !== 'https://aig.astropods.ai' ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    )
      throw new DomainError('AI_SETUP', 'Use only the verified Astropods Gateway origin.');
    return { provider, model, apiKey, baseURL: 'https://aig.astropods.ai/v1' };
  }
  return { provider, model, apiKey, baseURL: 'https://api.openai.com/v1' };
}
export function liveLimits() {
  const { provider, model } = modelSettings();
  const positive = z.coerce.number().int().positive();
  const parsed = z
    .object({
      calls: positive.max(10000),
      tokens: positive.max(10000000),
      output: positive.max(8000),
    })
    .safeParse({
      calls: process.env.LIVE_AI_DAILY_CALL_LIMIT,
      tokens: process.env.LIVE_AI_DAILY_TOKEN_LIMIT,
      output: process.env.LIVE_AI_MAX_OUTPUT_TOKENS,
    });
  if (!parsed.success)
    throw new DomainError(
      'AI_LIMITS',
      'Set positive daily call/token limits and maximum output tokens before enabling live AI.',
    );
  return { ...parsed.data, provider, model };
}

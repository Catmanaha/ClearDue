import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { PayPalProvider } from '../../src/server/providers';
import { demoMerchant, demoRaw } from '../../src/domain/fixtures';
import { projectInvoice, applyOperation } from '../../src/domain/invoice';
const saved = { ...process.env };
beforeEach(() => {
  Object.assign(process.env, {
    PAYMENT_MODE: 'sandbox',
    PAYPAL_MERCHANT_ID: 'synthetic-merchant',
    PAYPAL_SELLER_EMAIL: demoMerchant,
    PAYPAL_BUYER_EMAIL: 'synthetic-buyer@example.test',
    PAYPAL_CLIENT_ID: 'fake-test-id',
    PAYPAL_CLIENT_SECRET: 'fake-test-secret',
    PAYPAL_SANDBOX_TEST_ENABLED: 'true',
    PAYPAL_SANDBOX_WRITE_ENABLED: 'true',
    PAYPAL_PROJECT_INVOICE_IDS: 'INV2-CLEARDUE-TEST',
    PAYPAL_WEBHOOK_ID: 'synthetic-webhook',
  });
});
afterEach(() => {
  process.env = saved;
  vi.unstubAllGlobals();
});
const writable = () =>
  applyOperation(projectInvoice(demoRaw(), demoMerchant, 'demo'), {
    type: 'REMOVE_ITEM',
    lineId: 'social-pack',
  });
it('requests only the invoice and webhook scopes needed by this provider', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/oauth2/token')) {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('grant_type')).toBe('client_credentials');
      expect(form.get('scope')?.split(' ').sort()).toEqual([
        'https://uri.paypal.com/services/applications/webhooks',
        'https://uri.paypal.com/services/invoicing',
      ]);
      return Response.json({ access_token: 'synthetic-token' });
    }
    return Response.json(demoRaw());
  });
  vi.stubGlobal('fetch', fetchMock);
  await new PayPalProvider().read('INV2-CLEARDUE-TEST');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('builds one complete fixed-host PUT without unverified idempotency or conditional headers', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.redirect).toBe('error');
    return url.endsWith('/oauth2/token')
      ? Response.json({ access_token: 'synthetic-token', expires_in: 300 })
      : new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetchMock);
  await new PayPalProvider().update('INV2-CLEARDUE-TEST', writable());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const [url, init] = fetchMock.mock.calls[1];
  expect(url).toBe(
    'https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-CLEARDUE-TEST?send_to_recipient=false&send_to_invoicer=false',
  );
  expect(init?.method).toBe('PUT');
  expect(JSON.parse(String(init?.body))).toEqual(writable());
  expect(init?.headers).not.toHaveProperty('PayPal-Request-Id');
  expect(init?.headers).not.toHaveProperty('If-Match');
});
it('blocks non-project resources or disabled writes before any network request', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(new PayPalProvider().update('INV2-UNRELATED', writable())).rejects.toThrow(
    'allowlist',
  );
  process.env.PAYPAL_SANDBOX_WRITE_ENABLED = 'false';
  await expect(new PayPalProvider().update('INV2-CLEARDUE-TEST', writable())).rejects.toThrow(
    'flags',
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
it('refuses to send a tagged invoice that is no longer a draft', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/oauth2/token')
      ? Response.json({ access_token: 'synthetic-token' })
      : Response.json({
          status: 'SENT',
          detail: { memo: 'ClearDue project-created synthetic sandbox capability test' },
        }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await expect(new PayPalProvider().sendSynthetic('INV2-CLEARDUE-TEST')).rejects.toMatchObject({
    code: 'PAYPAL_RESOURCE',
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('sends a tagged draft with both email notifications explicitly suppressed', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'synthetic-token' });
    if (init?.method === 'POST') return new Response(null, { status: 204 });
    return Response.json({
      status: 'DRAFT',
      detail: { memo: 'ClearDue project-created synthetic sandbox capability test' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  await new PayPalProvider().sendSynthetic('INV2-CLEARDUE-TEST');
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
    send_to_invoicer: false,
    send_to_recipient: false,
  });
});
it('an ambiguous write sends no automatic retry', async () => {
  let writes = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'synthetic-token' });
      writes++;
      throw new Error('timeout after acceptance');
    }),
  );
  await expect(new PayPalProvider().update('INV2-CLEARDUE-TEST', writable())).rejects.toMatchObject(
    { code: 'UNKNOWN_OUTCOME' },
  );
  expect(writes).toBe(1);
});
it('a successful write with an unreadable response remains an unknown outcome without retry', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/oauth2/token')
      ? Response.json({ access_token: 'synthetic-token' })
      : new Response('{"id":', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await expect(new PayPalProvider().update('INV2-CLEARDUE-TEST', writable())).rejects.toMatchObject(
    { code: 'UNKNOWN_OUTCOME' },
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('an unreadable invoice read is classified as a provider read failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/oauth2/token')
        ? Response.json({ access_token: 'synthetic-token' })
        : new Response('{"id":', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
  await expect(new PayPalProvider().read('INV2-CLEARDUE-TEST')).rejects.toMatchObject({
    code: 'PAYPAL_READ',
  });
});
it('signature verification uses fixed postback and never fetches the supplied certificate URL', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return Response.json(
        url.endsWith('/oauth2/token')
          ? { access_token: 'synthetic-token' }
          : { verification_status: 'FAILURE' },
      );
    }),
  );
  const headers = new Headers({
    'paypal-transmission-id': 'test',
    'paypal-transmission-time': '2026-10-30T00:00:00Z',
    'paypal-cert-url': 'http://127.0.0.1/private',
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-transmission-sig': 'test',
  });
  expect(await new PayPalProvider().verifyWebhook(headers, { id: 'forged' })).toBe(false);
  expect(calls).toEqual([
    'https://api-m.sandbox.paypal.com/v1/oauth2/token',
    'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature',
  ]);
});

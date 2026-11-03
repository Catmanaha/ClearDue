import { eq, and } from 'drizzle-orm';
import { config } from './config';
import { db } from './db';
import { cases } from './schema';
import { DomainError, decimal } from '../domain/core';
import { projectInvoice, type WritableInvoice } from '../domain/invoice';

export interface InvoiceProvider {
  readonly provenance: 'simulated' | 'paypal-sandbox';
  read(invoiceId: string): Promise<unknown>;
  update(invoiceId: string, writable: WritableInvoice): Promise<void>;
}
export class DemoProvider implements InvoiceProvider {
  readonly provenance = 'simulated';
  async read(invoiceId: string) {
    const [c] = await db()
      .select()
      .from(cases)
      .where(
        and(
          eq(cases.invoiceId, invoiceId),
          eq(cases.environment, 'demo'),
          eq(cases.merchant, config().merchant),
        ),
      );
    if (!c) throw new DomainError('NOT_FOUND', 'Demo invoice was not found.', 404);
    return c.providerInvoice;
  }
  async update(invoiceId: string, writable: WritableInvoice) {
    const before = (await this.read(invoiceId)) as Record<string, unknown>;
    const { pence } = await import('../domain/core');
    const exactTotal = writable.items.reduce(
      (sum, i) => sum + Number(i.quantity) * pence(i.unit_amount.value),
      0,
    );
    const next = {
      ...writable,
      id: invoiceId,
      status: 'SENT',
      amount: { currency_code: 'GBP', value: decimal(exactTotal) },
      due_amount: { currency_code: 'GBP', value: decimal(exactTotal) },
      payments: before.payments,
    };
    await db()
      .update(cases)
      .set({ providerInvoice: next })
      .where(
        and(
          eq(cases.invoiceId, invoiceId),
          eq(cases.environment, 'demo'),
          eq(cases.merchant, config().merchant),
        ),
      );
  }
}
export class PayPalProvider implements InvoiceProvider {
  readonly provenance = 'paypal-sandbox';
  private token?: { value: string; expires: number };
  private readonly host = 'https://api-m.sandbox.paypal.com';
  private async accessToken() {
    if (this.token && Date.now() < this.token.expires) return this.token.value;
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET)
      throw new DomainError(
        'PAYPAL_SETUP',
        'Configure this project’s sandbox client ID and secret in the local environment.',
      );
    const response = await fetch(`${this.host}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: [
          'https://uri.paypal.com/services/invoicing',
          'https://uri.paypal.com/services/applications/webhooks',
        ].join(' '),
      }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok)
      throw new DomainError(
        'PAYPAL_AUTH',
        'PayPal sandbox authentication failed. Check this project’s credentials.',
      );
    const data = await response.json();
    if (typeof data.access_token !== 'string')
      throw new DomainError('PAYPAL_AUTH', 'PayPal returned an invalid token response.');
    this.token = {
      value: data.access_token,
      expires: Date.now() + Math.min(Number(data.expires_in) || 300, 3000) * 1000,
    };
    return this.token.value;
  }
  private async request(
    path: string,
    method = 'GET',
    body?: unknown,
    ambiguousWrite = false,
  ): Promise<unknown> {
    const token = await this.accessToken();
    try {
      const response = await fetch(`${this.host}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
        cache: 'no-store',
      });
      if (!response.ok)
        throw new DomainError(
          ambiguousWrite ? 'UNKNOWN_OUTCOME' : 'PAYPAL_READ',
          `PayPal sandbox returned HTTP ${response.status}. ${ambiguousWrite ? 'Reconcile before considering another change.' : 'Check access and retry the read.'}`,
        );
      return response.status === 204 ? null : await response.json();
    } catch (e) {
      if (e instanceof DomainError) throw e;
      throw new DomainError(
        ambiguousWrite ? 'UNKNOWN_OUTCOME' : 'PAYPAL_READ',
        ambiguousWrite
          ? 'The PayPal write may have succeeded. Reconciliation is required; it will not be retried automatically.'
          : 'PayPal sandbox could not be reached. Refresh when it is available.',
      );
    }
  }
  async read(invoiceId: string) {
    if (!/^INV2-[A-Z0-9-]+$/.test(invoiceId))
      throw new DomainError('INVOICE_ID', 'Use a PayPal Invoicing v2 sandbox ID.');
    return this.request(`/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
  }
  private writeGate(invoiceId?: string) {
    if (
      config().mode !== 'sandbox' ||
      process.env.PAYPAL_SANDBOX_TEST_ENABLED !== 'true' ||
      process.env.PAYPAL_SANDBOX_WRITE_ENABLED !== 'true' ||
      !process.env.PAYPAL_MERCHANT_ID ||
      !process.env.PAYPAL_BUYER_EMAIL
    )
      throw new DomainError(
        'PAYPAL_WRITE_DISABLED',
        'Sandbox writes require this project’s seller/buyer configuration and explicit test/write flags.',
      );
    if (
      invoiceId &&
      !(process.env.PAYPAL_PROJECT_INVOICE_IDS ?? '')
        .split(',')
        .map((v) => v.trim())
        .includes(invoiceId)
    )
      throw new DomainError(
        'PAYPAL_RESOURCE',
        'This invoice is not in the project-created sandbox resource allowlist.',
      );
  }
  async update(invoiceId: string, writable: WritableInvoice) {
    this.writeGate(invoiceId);
    // No unverified Request-Id or conditional header. Full PUT; suppress update communications.
    await this.request(
      `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}?send_to_recipient=false&send_to_invoicer=false`,
      'PUT',
      writable,
      true,
    );
  }
  async createSynthetic() {
    this.writeGate();
    const c = config();
    const raw = (await this.request(
      '/v2/invoicing/invoices',
      'POST',
      {
        detail: {
          currency_code: 'GBP',
          memo: 'ClearDue project-created synthetic sandbox capability test',
          payment_term: { term_type: 'DUE_ON_RECEIPT' },
        },
        invoicer: { email_address: c.merchant },
        primary_recipients: [{ billing_info: { email_address: process.env.PAYPAL_BUYER_EMAIL } }],
        items: [
          {
            name: 'Landing page',
            quantity: '1',
            unit_amount: { currency_code: 'GBP', value: '1000.00' },
          },
          {
            name: 'Social-media pack',
            quantity: '1',
            unit_amount: { currency_code: 'GBP', value: '250.00' },
          },
        ],
        configuration: { partial_payment: { allow_partial_payment: false }, allow_tip: false },
      },
      true,
    )) as Record<string, unknown>;
    return raw;
  }
  async sendSynthetic(invoiceId: string) {
    this.writeGate(invoiceId);
    const raw = (await this.read(invoiceId)) as { status?: string; detail?: { memo?: string } };
    if (
      raw.status !== 'DRAFT' ||
      raw.detail?.memo !== 'ClearDue project-created synthetic sandbox capability test'
    )
      throw new DomainError(
        'PAYPAL_RESOURCE',
        'Only this project’s tagged synthetic drafts may be sent.',
      );
    await this.request(
      `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
      'POST',
      { send_to_invoicer: false, send_to_recipient: false },
      true,
    );
  }
  async verifyWebhook(headers: Headers, event: unknown) {
    if (!process.env.PAYPAL_WEBHOOK_ID)
      throw new DomainError('WEBHOOK_SETUP', 'Configure the sandbox webhook ID.');
    const get = (name: string) => {
      const value = headers.get(name);
      if (!value || value.length > 2048)
        throw new DomainError(
          'WEBHOOK_SIGNATURE',
          'Required PayPal signature headers are missing.',
          400,
        );
      return value;
    };
    const result = (await this.request('/v1/notifications/verify-webhook-signature', 'POST', {
      transmission_id: get('paypal-transmission-id'),
      transmission_time: get('paypal-transmission-time'),
      cert_url: get('paypal-cert-url'),
      auth_algo: get('paypal-auth-algo'),
      transmission_sig: get('paypal-transmission-sig'),
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    })) as { verification_status?: string };
    return result.verification_status === 'SUCCESS';
  }
}
export function provider(): InvoiceProvider {
  return config().mode === 'demo' ? new DemoProvider() : new PayPalProvider();
}
export async function readProjection(p: InvoiceProvider, invoiceId: string) {
  const raw = await p.read(invoiceId);
  return { raw, invoice: projectInvoice(raw, config().merchant, config().mode) };
}

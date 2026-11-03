import { z } from 'zod';
import { DomainError, hash, pence, decimal, type PaymentState } from './core';

const amount = z.object({ currency_code: z.literal('GBP'), value: z.string() }).strict();
const zeroAmount = amount.extend({ value: z.string().regex(/^0(?:\.0{1,2})?$/) });
const simpleBreakdown = z
  .object({
    item_total: amount.optional(),
    tax_total: zeroAmount.optional(),
    discount: z
      .object({
        invoice_discount: z.object({ amount: zeroAmount }).strict().optional(),
        item_discount: zeroAmount.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const name = z
  .object({
    given_name: z.string().optional(),
    surname: z.string().optional(),
    full_name: z.string().optional(),
  })
  .strict();
const address = z
  .object({
    address_line_1: z.string().optional(),
    address_line_2: z.string().optional(),
    admin_area_1: z.string().optional(),
    admin_area_2: z.string().optional(),
    postal_code: z.string().optional(),
    country_code: z.string().length(2),
  })
  .strict();
const billing = z
  .object({
    name: name.optional(),
    email_address: z.email().optional(),
    address: address.optional(),
    language: z.string().optional(),
  })
  .strict();
const item = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    quantity: z.string().regex(/^[1-9]\d{0,2}$/),
    unit_amount: amount,
    unit_of_measure: z.enum(['QUANTITY', 'HOURS', 'AMOUNT']).optional(),
  })
  .strict();
export const writableSchema = z
  .object({
    detail: z
      .object({
        currency_code: z.literal('GBP'),
        invoice_number: z.string().max(25).optional(),
        invoice_date: z.string().optional(),
        reference: z.string().min(1).max(120).optional(),
        note: z.string().max(4000).optional(),
        terms_and_conditions: z.string().max(4000).optional(),
        memo: z.string().max(500).optional(),
        payment_term: z
          .object({ term_type: z.string(), due_date: z.string().optional() })
          .strict()
          .optional(),
      })
      .strict(),
    invoicer: z
      .object({
        name: name.optional(),
        business_name: z.string().optional(),
        email_address: z.email().optional(),
        address: address.optional(),
        website: z.url().optional(),
        tax_id: z.string().optional(),
        additional_notes: z.string().optional(),
        logo_url: z.url().optional(),
      })
      .strict(),
    primary_recipients: z.array(z.object({ billing_info: billing }).strict()).length(1),
    additional_recipients: z.array(z.email()).optional(),
    items: z.array(item).min(1).max(100),
    configuration: z
      .object({
        partial_payment: z
          .object({ allow_partial_payment: z.literal(false) })
          .strict()
          .optional(),
        allow_tip: z.literal(false).optional(),
        tax_calculated_after_discount: z.boolean().optional(),
        tax_inclusive: z.literal(false).optional(),
        template_id: z.string().optional(),
        save_item_for_future: z.boolean().optional(),
      })
      .strict()
      .optional(),
    settings: z.object({}).strict().optional(),
  })
  .strict();
// Legacy fields shown in PayPal's official response examples, outside its PUT schema.
// Support only this bounded inactive shape; preserve it separately through preflight/readback.
const compatibilitySchema = z
  .object({
    unilateral: z.literal(false).optional(),
    category_code: z.literal('SHIPPABLE').optional(),
    group_draft: z.literal(false).optional(),
    archived: z.literal(false).optional(),
    allow_only_pay_by_bank: z.literal(false).optional(),
    allow_vba_payments: z.literal(false).optional(),
  })
  .strict();
export type WritableInvoice = z.infer<typeof writableSchema>;
export type Operation =
  { type: 'REMOVE_ITEM'; lineId: string } | { type: 'SET_REFERENCE'; reference: string };
export type Invoice = {
  id: string;
  number: string;
  status: string;
  merchant: string;
  writable: WritableInvoice;
  fingerprint: string;
  lines: { id: string; name: string; quantity: number; unitPence: number; totalPence: number }[];
  totalPence: number;
  paidPence: number;
  duePence: number;
  payment: PaymentState;
  paymentUrl: string | null;
  reference: string | null;
  compatibility?: z.infer<typeof compatibilitySchema>;
};
function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function exactAmount(v: unknown): number {
  const a = amount.parse(v);
  return pence(a.value);
}
export function validPaymentUrl(value: unknown, environment: 'demo' | 'sandbox'): string | null {
  if (environment === 'demo') return null;
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' &&
      u.hostname === 'www.sandbox.paypal.com' &&
      !u.username &&
      !u.password &&
      !u.port &&
      (u.pathname.startsWith('/invoice/p/') || u.pathname === '/invoice/pay')
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function projectInvoice(
  raw: unknown,
  merchant: string,
  environment: 'demo' | 'sandbox',
): Invoice {
  const r = record(raw);
  if (typeof r.id !== 'string' || typeof r.status !== 'string')
    throw new DomainError('UNSUPPORTED', 'Invoice identity or status is missing.');
  const allowed = [
    'id',
    'status',
    'detail',
    'invoicer',
    'primary_recipients',
    'additional_recipients',
    'items',
    'configuration',
    'amount',
    'due_amount',
    'payments',
    'refunds',
    'links',
    'metadata',
    'recipient_view_url',
    'unilateral',
    'settings',
  ];
  if (Object.keys(r).some((k) => !allowed.includes(k)))
    throw new DomainError(
      'UNSUPPORTED',
      'This invoice contains unsupported fields. Review it in PayPal.',
    );
  const d = { ...record(r.detail) };
  const url = record(d.metadata).recipient_view_url ?? r.recipient_view_url;
  // Explicit documented read-only detail metadata; all other unknown detail fields fail schema.
  delete d.metadata;
  if (d.viewed_by_recipient !== undefined && typeof d.viewed_by_recipient !== 'boolean')
    throw new DomainError('UNSUPPORTED', 'Unsupported invoice view metadata.');
  // Viewing is a documented invoice lifecycle observation, not a financial change.
  delete d.viewed_by_recipient;
  const detailExtensions = ['category_code', 'group_draft', 'archived'];
  const configurationExtensions = ['allow_only_pay_by_bank', 'allow_vba_payments'];
  let configuration = r.configuration;
  const legacy: Record<string, unknown> = {};
  if (Object.hasOwn(r, 'unilateral')) legacy.unilateral = r.unilateral;
  for (const key of detailExtensions) {
    if (Object.hasOwn(d, key)) legacy[key] = d[key];
    delete d[key];
  }
  if (configuration !== undefined) {
    const object = z.record(z.string(), z.unknown()).safeParse(configuration);
    if (!object.success) throw new DomainError('UNSUPPORTED', 'Unsupported invoice configuration.');
    const copy = { ...object.data };
    for (const key of configurationExtensions) {
      if (Object.hasOwn(copy, key)) legacy[key] = copy[key];
      delete copy[key];
    }
    configuration = copy;
  }
  const compatibilityResult = compatibilitySchema.safeParse(legacy);
  if (!compatibilityResult.success)
    throw new DomainError(
      'UNSUPPORTED',
      'Unsupported invoice category, state or payment configuration.',
    );
  const compatibility = compatibilityResult.data;
  const rawItems = Array.isArray(r.items) ? r.items : [];
  const ids = rawItems.map((v, index) =>
    typeof record(v).id === 'string'
      ? String(record(v).id)
      : `line-${index}-${hash(v).slice(0, 16)}`,
  );
  if (new Set(ids).size !== ids.length)
    throw new DomainError('UNSUPPORTED', 'Duplicate invoice line identifiers.');
  const items = rawItems.map((v) => {
    const copy = { ...record(v) };
    delete copy.id;
    return copy;
  });
  const candidate = {
    detail: d,
    invoicer: r.invoicer,
    primary_recipients: r.primary_recipients,
    items,
    ...(r.additional_recipients === undefined
      ? {}
      : { additional_recipients: r.additional_recipients }),
    ...(configuration === undefined ? {} : { configuration }),
    ...(r.settings === undefined ? {} : { settings: r.settings }),
  };
  const parsed = writableSchema.safeParse(candidate);
  if (!parsed.success)
    throw new DomainError(
      'UNSUPPORTED',
      'Only simple GBP invoices without tax, discount, shipping, tips or unsupported fields can be changed. Review this invoice in PayPal.',
    );
  const writable = parsed.data;
  if (writable.invoicer.email_address?.toLowerCase() !== merchant.toLowerCase())
    throw new DomainError('OWNERSHIP', 'Invoice does not belong to the configured merchant.');
  const lines = writable.items.map((i, index) => ({
    id: ids[index],
    name: i.name,
    quantity: Number(i.quantity),
    unitPence: pence(i.unit_amount.value),
    totalPence: pence(i.unit_amount.value) * Number(i.quantity),
  }));
  const totalPence = lines.reduce((sum, line) => sum + line.totalPence, 0);
  decimal(totalPence);
  const totals = record(r.amount);
  if (Object.keys(totals).some((k) => !['currency_code', 'value', 'breakdown'].includes(k)))
    throw new DomainError('UNSUPPORTED', 'Unsupported invoice total fields.');
  const breakdownResult = simpleBreakdown.safeParse(
    totals.breakdown === undefined ? {} : totals.breakdown,
  );
  if (!breakdownResult.success)
    throw new DomainError('UNSUPPORTED', 'Invoice has unsupported charges or totals.');
  const breakdown = breakdownResult.data;
  const totalValue = { currency_code: totals.currency_code, value: totals.value };
  if (
    exactAmount(totalValue) !== totalPence ||
    (breakdown.item_total !== undefined && exactAmount(breakdown.item_total) !== totalPence)
  )
    throw new DomainError('UNSUPPORTED', 'Invoice has unsupported charges or totals.');
  if (r.refunds && Object.keys(record(r.refunds)).length)
    throw new DomainError('UNSUPPORTED', 'Refunded invoices need manual review.');
  const payments = record(r.payments);
  const paidPence = payments.paid_amount ? exactAmount(payments.paid_amount) : 0;
  const duePence = exactAmount(r.due_amount);
  const transactions = Array.isArray(payments.transactions)
    ? payments.transactions.map(record)
    : [];
  let payment: PaymentState = 'UNKNOWN';
  if (
    transactions.some((t) => /PENDING|PROCESSING/.test(String(t.status))) ||
    /PENDING/.test(r.status)
  )
    payment = 'PENDING';
  else if (transactions.some((t) => t.type === 'EXTERNAL') && paidPence > 0) payment = 'UNVERIFIED';
  else if (r.status === 'PAID' && paidPence === totalPence && duePence === 0) payment = 'PAID';
  else if ((paidPence > 0 && duePence > 0) || r.status === 'PARTIALLY_PAID') payment = 'PARTIAL';
  else if (paidPence === 0 && duePence === totalPence && ['SENT', 'UNPAID'].includes(r.status))
    payment = 'UNPAID';
  const fingerprint = hash({
    id: r.id,
    merchant,
    status: r.status,
    writable,
    lines: lines.map((l) => l.id),
    paidPence,
    duePence,
    payment,
    ...(Object.keys(compatibility).length ? { compatibility } : {}),
  });
  return {
    id: r.id,
    number: writable.detail.invoice_number ?? r.id,
    merchant,
    status: r.status,
    writable,
    fingerprint,
    lines,
    totalPence,
    paidPence,
    duePence,
    payment,
    paymentUrl: validPaymentUrl(url, environment),
    reference: writable.detail.reference ?? null,
    ...(Object.keys(compatibility).length ? { compatibility } : {}),
  };
}
export function applyOperation(invoice: Invoice, operation: Operation): WritableInvoice {
  if (invoice.payment !== 'UNPAID')
    throw new DomainError(
      'UNSUPPORTED',
      'Only a fully unpaid invoice can be corrected. Partial, pending or paid invoices need manual review.',
    );
  const next = structuredClone(invoice.writable);
  if (operation.type === 'REMOVE_ITEM') {
    const index = invoice.lines.findIndex((l) => l.id === operation.lineId);
    if (index < 0 || next.items.length <= 1)
      throw new DomainError(
        'OPERATION',
        'Select one existing extra line; the invoice must keep at least one item.',
      );
    next.items.splice(index, 1);
  } else if (operation.type === 'SET_REFERENCE') {
    if (!operation.reference.trim() || operation.reference.length > 120)
      throw new DomainError('OPERATION', 'Reference must contain 1–120 characters.');
    next.detail.reference = operation.reference;
  } else throw new DomainError('OPERATION', 'Unsupported invoice operation.');
  return writableSchema.parse(next);
}
export const intendedFingerprint = (writable: WritableInvoice) => hash(writable);

/** Accept only PayPal's observed additive same-day due-on-receipt date. */
export function matchesInvoiceIntent(actual: WritableInvoice, intended: WritableInvoice): boolean {
  if (intendedFingerprint(actual) === intendedFingerprint(intended)) return true;
  const expected = structuredClone(intended);
  const term = expected.detail.payment_term;
  const date = expected.detail.invoice_date;
  if (
    term?.term_type !== 'DUE_ON_RECEIPT' ||
    term.due_date !== undefined ||
    typeof date !== 'string' ||
    !z.iso.date().safeParse(date).success ||
    actual.detail.payment_term?.term_type !== 'DUE_ON_RECEIPT' ||
    actual.detail.payment_term.due_date !== date
  )
    return false;
  term.due_date = date;
  return intendedFingerprint(actual) === intendedFingerprint(expected);
}

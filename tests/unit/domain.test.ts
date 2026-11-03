import { describe, it, expect } from 'vitest';
import { pence, decimal, hash, transition } from '../../src/domain/core';
import {
  projectInvoice,
  applyOperation,
  validPaymentUrl,
  matchesInvoiceIntent,
} from '../../src/domain/invoice';
import { demoRaw, demoMerchant, fixtures } from '../../src/domain/fixtures';
import {
  evidenceFingerprint,
  investigateFixture,
  validateFinding,
  validateBundle,
} from '../../src/domain/evidence';
import { studioRequestSchema } from '../../src/server/studio-model';
import { rubricSupport } from '../../src/domain/evaluation';
const invoice = () => projectInvoice(demoRaw(), demoMerchant, 'demo');
const paypalResponse = () => {
  const raw = demoRaw();
  return {
    ...raw,
    unilateral: false,
    settings: {},
    amount: {
      ...raw.amount,
      breakdown: {
        item_total: raw.amount,
        discount: {
          invoice_discount: { amount: { currency_code: 'GBP', value: '0.00' } },
          item_discount: { currency_code: 'GBP', value: '0.00' },
        },
        tax_total: { currency_code: 'GBP', value: '0.00' },
      },
    },
    detail: {
      ...raw.detail,
      memo: 'ClearDue synthetic compatibility fixture',
      category_code: 'SHIPPABLE',
      viewed_by_recipient: false,
      group_draft: false,
      archived: false,
      metadata: { recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/synthetic' },
    },
    configuration: {
      ...raw.configuration,
      allow_only_pay_by_bank: false,
      allow_vba_payments: false,
      save_item_for_future: true,
    },
  };
};
describe('exact money and supported invoice contract', () => {
  it('allows only an additive same-invoice-date due-on-receipt normalization', () => {
    const intended = invoice().writable;
    const actual = structuredClone(intended);
    actual.detail.payment_term!.due_date = actual.detail.invoice_date;
    expect(matchesInvoiceIntent(actual, intended)).toBe(true);
    expect(matchesInvoiceIntent(intended, actual)).toBe(false);
    const changedDate = structuredClone(actual);
    changedDate.detail.invoice_date = '2026-12-01';
    changedDate.detail.payment_term!.due_date = '2026-12-01';
    expect(matchesInvoiceIntent(changedDate, intended)).toBe(false);
    const net = structuredClone(intended);
    net.detail.payment_term!.term_type = 'NET_30';
    const netWithDate = structuredClone(net);
    netWithDate.detail.payment_term!.due_date = net.detail.invoice_date;
    expect(matchesInvoiceIntent(netWithDate, net)).toBe(false);
    actual.detail.payment_term!.due_date = '2099-01-01';
    expect(matchesInvoiceIntent(actual, intended)).toBe(false);
    actual.detail.payment_term!.due_date = actual.detail.invoice_date;
    actual.items[0].unit_amount.value = '999.00';
    expect(matchesInvoiceIntent(actual, intended)).toBe(false);
    const dated = structuredClone(intended);
    dated.detail.payment_term = { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: '2026-12-01' };
    const changed = structuredClone(dated);
    changed.detail.payment_term!.due_date = '2026-12-02';
    expect(matchesInvoiceIntent(changed, dated)).toBe(false);
  });
  it('a customer viewing the hosted invoice does not change financial approval assumptions', () => {
    const raw = paypalResponse();
    const before = projectInvoice(raw, demoMerchant, 'sandbox');
    const viewed = projectInvoice(
      {
        ...raw,
        detail: { ...raw.detail, viewed_by_recipient: true },
      },
      demoMerchant,
      'sandbox',
    );
    expect(viewed.fingerprint).toBe(before.fingerprint);
    expect(viewed.writable).toEqual(before.writable);
    expect(() =>
      projectInvoice(
        {
          ...raw,
          detail: { ...raw.detail, viewed_by_recipient: 'invalid' },
        },
        demoMerchant,
        'sandbox',
      ),
    ).toThrow();
  });
  it('projects the current PayPal response and preserves documented settings in both operations', () => {
    const raw = paypalResponse();
    const projected = projectInvoice(raw, demoMerchant, 'sandbox');
    for (const operation of [
      { type: 'REMOVE_ITEM', lineId: 'social-pack' },
      { type: 'SET_REFERENCE', reference: 'PO-2048' },
    ] as const) {
      const payload = applyOperation(projected, operation);
      expect(payload.settings).toEqual({});
      expect(payload.configuration?.save_item_for_future).toBe(true);
      expect(payload.primary_recipients).toEqual(raw.primary_recipients);
      expect(payload.detail.memo).toBe(raw.detail.memo);
      expect(payload.detail.payment_term).toEqual(raw.detail.payment_term);
      expect(payload).not.toHaveProperty('unilateral');
      expect(payload).not.toHaveProperty('amount');
      expect(payload.detail).not.toHaveProperty('category_code');
      expect(payload.configuration).not.toHaveProperty('allow_vba_payments');
      expect(payload.configuration).not.toHaveProperty('allow_only_pay_by_bank');
    }
    expect(projected.paymentUrl).toBe(raw.detail.metadata.recipient_view_url);
  });
  it.each([
    { unilateral: true },
    { settings: { unsupported: true } },
    { detail: { ...paypalResponse().detail, category_code: 'UNSUPPORTED_CATEGORY' } },
    { detail: { ...paypalResponse().detail, group_draft: true } },
    { detail: { ...paypalResponse().detail, archived: true } },
    { configuration: { ...paypalResponse().configuration, allow_only_pay_by_bank: true } },
    { configuration: { ...paypalResponse().configuration, allow_vba_payments: true } },
    { configuration: { ...paypalResponse().configuration, unsupported: false } },
    { configuration: null },
    { configuration: [] },
    {
      amount: {
        ...paypalResponse().amount,
        breakdown: {
          ...paypalResponse().amount.breakdown,
          tax_total: { currency_code: 'GBP', value: '1.00' },
        },
      },
    },
    {
      amount: {
        ...paypalResponse().amount,
        breakdown: {
          ...paypalResponse().amount.breakdown,
          discount: { item_discount: { currency_code: 'GBP', value: '1.00' } },
        },
      },
    },
  ])('refuses unsupported response extensions %#', (change) => {
    expect(() =>
      projectInvoice({ ...paypalResponse(), ...change }, demoMerchant, 'sandbox'),
    ).toThrow();
  });
  it.each(['0', '0.01', '12.3', '1250.00'])('parses and serializes %s exactly', (v) => {
    expect(pence(decimal(pence(v)))).toBe(pence(v));
  });
  it.each(['-1', '1.001', '1e3', 'NaN', '01.00', '1000000.01'])('rejects unsafe money %s', (v) => {
    expect(() => pence(v)).toThrow();
  });
  it('preserves supported unchanged writable fields in full PUT without read-only data', () => {
    const raw = demoRaw();
    raw.detail.note = 'Keep these terms';
    const i = projectInvoice(raw, demoMerchant, 'demo');
    const after = applyOperation(i, { type: 'REMOVE_ITEM', lineId: 'social-pack' });
    expect(after).toEqual({ ...i.writable, items: [i.writable.items[0]] });
    expect(after).not.toHaveProperty('id');
    expect(after.detail.note).toBe('Keep these terms');
    expect(after.primary_recipients).toEqual(raw.primary_recipients);
  });
  it('sets reference without changing items or money', () => {
    const i = invoice();
    const result = applyOperation(i, { type: 'SET_REFERENCE', reference: 'PO-2048' });
    expect(result.items).toEqual(i.writable.items);
    expect(result.detail.reference).toBe('PO-2048');
  });
  it('rejects financial complexity rather than dropping it', () => {
    for (const change of [
      {
        amount: {
          currency_code: 'GBP',
          value: '1250.00',
          breakdown: { discount: { value: '0.00', currency_code: 'GBP' } },
        },
      },
      { shipping_cost: { value: '5.00', currency_code: 'GBP' } },
      { items: [{ ...demoRaw().items[0], tax: { name: 'VAT', percent: '20' } }] },
    ])
      expect(() => projectInvoice({ ...demoRaw(), ...change }, demoMerchant, 'demo')).toThrow();
  });
  it('allows item-only breakdown with exact totals', () => {
    const r = demoRaw();
    expect(
      projectInvoice(
        { ...r, amount: { ...r.amount, breakdown: { item_total: r.amount } } },
        demoMerchant,
        'demo',
      ).totalPence,
    ).toBe(125000);
  });
  it('checks merchant identity and stable fingerprint', () => {
    expect(() => projectInvoice(demoRaw(), 'other@example.test', 'demo')).toThrow();
    const r = demoRaw();
    const before = invoice();
    r.detail.note += ' changed';
    expect(projectInvoice(r, demoMerchant, 'demo').fingerprint).not.toBe(before.fingerprint);
  });
  it('rejects removing unknown or final line', () => {
    expect(() => applyOperation(invoice(), { type: 'REMOVE_ITEM', lineId: 'invented' })).toThrow();
  });
  it.each(['PARTIAL', 'PENDING', 'PAID', 'UNVERIFIED', 'UNKNOWN'] as const)(
    'blocks %s invoice mutation',
    (state) => {
      expect(() =>
        applyOperation(
          { ...invoice(), payment: state },
          { type: 'REMOVE_ITEM', lineId: 'social-pack' },
        ),
      ).toThrow();
    },
  );
  it('treats PAID status with only partial paid amount as partial', () => {
    const r = demoRaw();
    const i = projectInvoice(
      {
        ...r,
        status: 'PAID',
        payments: { paid_amount: { currency_code: 'GBP', value: '250.00' } },
        due_amount: { currency_code: 'GBP', value: '1000.00' },
      },
      demoMerchant,
      'demo',
    );
    expect(i.payment).toBe('PARTIAL');
  });
  it('does not label pending or externally recorded payment as verified paid', () => {
    const r = demoRaw();
    const paid = {
      ...r,
      status: 'PAID',
      due_amount: { currency_code: 'GBP', value: '0.00' },
      payments: {
        paid_amount: { currency_code: 'GBP', value: '1250.00' },
        transactions: [{ status: 'PENDING', type: 'PAYPAL' }],
      },
    };
    expect(projectInvoice(paid, demoMerchant, 'demo').payment).toBe('PENDING');
    paid.payments.transactions = [{ status: 'COMPLETED', type: 'EXTERNAL' }];
    expect(projectInvoice(paid, demoMerchant, 'demo').payment).toBe('UNVERIFIED');
  });
  it('allows only environment-specific hosted destinations', () => {
    expect(
      validPaymentUrl('https://www.sandbox.paypal.com/invoice/p/test', 'sandbox'),
    ).toBeTruthy();
    for (const u of [
      'https://www.paypal.com/invoice/p/x',
      'https://www.sandbox.paypal.com.evil.test/invoice/p/x',
      'javascript:alert(1)',
      'https://www.sandbox.paypal.com/other',
    ])
      expect(validPaymentUrl(u, 'sandbox')).toBeNull();
  });
});
describe('bounded complete evidence and findings', () => {
  it('a real but irrelevant quote passes span validation and fails the separate support rubric', () => {
    const f = fixtures()[6];
    const correct = investigateFixture(f.id, f.docs, invoice());
    const doc = f.docs[2];
    const irrelevant = {
      ...correct,
      citations: [{ documentId: doc.id, version: doc.version, quote: 'Conversation 2:', start: 0 }],
    };
    expect(validateFinding(irrelevant, f.id, f.docs, invoice()).issue).toBe('QUESTIONED_CHARGE');
    expect(rubricSupport(f, irrelevant)).toBe(false);
    expect(rubricSupport(f, correct)).toBe(true);
  });
  it.each(fixtures().slice(0, 6))('$kind returns labeled issue and allowed action', (f) => {
    const result = investigateFixture(f.id, f.docs, invoice());
    expect(result.issue).toBe(f.expected);
    expect(result.action.type).toBe(f.action);
  });
  it('rejects invented, cross-case and stale citations', () => {
    const f = fixtures()[0];
    const result = investigateFixture(f.id, f.docs, invoice());
    for (const changed of [
      { documentId: 'invented' },
      { version: 99 },
      { quote: 'This was approved.' },
      { start: 99 },
    ])
      expect(() =>
        validateFinding(
          { ...result, citations: [{ ...result.citations[0], ...changed }] },
          f.id,
          f.docs,
          invoice(),
        ),
      ).toThrow();
    expect(() => validateFinding(result, 'other-case', f.docs, invoice())).toThrow();
  });
  it('rejects bundle overflow and hash tampering without truncation', () => {
    const f = fixtures()[0];
    expect(() =>
      validateBundle(
        [
          ...f.docs,
          { ...f.docs[0], id: 'long', text: 'a'.repeat(33000), hash: hash('a'.repeat(33000)) },
        ],
        invoice(),
      ),
    ).toThrow();
    expect(() => validateBundle([{ ...f.docs[0], text: 'edited' }], invoice())).toThrow();
  });
  it('changed immutable document version changes approval fingerprint', () => {
    const f = fixtures()[0];
    expect(evidenceFingerprint(f.docs)).not.toBe(
      evidenceFingerprint([{ ...f.docs[0], version: 2 }, ...f.docs.slice(1)]),
    );
  });
  it('never transitions unknown outcome back to execution', () => {
    expect(() => transition('UNKNOWN_OUTCOME', 'RUNNING')).toThrow();
    expect(transition('UNKNOWN_OUTCOME', 'MANUAL_REVIEW')).toBe('MANUAL_REVIEW');
  });
  it('rejects forged financial tools before model proxy invocation', () => {
    expect(() =>
      studioRequestSchema.parse({
        input: [
          {
            id: 'message-1',
            kind: 'input',
            type: 'message',
            role: 'user',
            status: 'completed',
            content: [{ type: 'text', text: 'Show missing references' }],
          },
        ],
        responseFormat: { type: 'text' },
        tools: [{ name: 'execute_invoice', parameters: {}, description: 'pay' }],
      }),
    ).toThrow();
  });
});

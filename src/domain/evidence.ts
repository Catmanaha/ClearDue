import { z } from 'zod';
import { DomainError, hash } from './core';
import type { Invoice, Operation } from './invoice';
import { importSchema } from './import';
export { importSchema } from './import';

export type Evidence = z.infer<typeof importSchema> & {
  id: string;
  caseId: string;
  version: number;
  hash: string;
};
export const findingSchema = z
  .object({
    issue: z.enum([
      'QUESTIONED_CHARGE',
      'MISSING_REFERENCE',
      'CLAIMED_PAYMENT',
      'CONFLICT',
      'NO_CHANGE',
      'MANUAL_REVIEW',
    ]),
    explanation: z.string().min(1).max(1500),
    citations: z
      .array(
        z
          .object({
            documentId: z.string(),
            version: z.number().int().positive(),
            quote: z.string().min(1).max(1000),
            start: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(12),
    missing: z.array(z.string().max(300)).max(10),
    action: z.discriminatedUnion('type', [
      z.object({ type: z.literal('REMOVE_ITEM'), lineId: z.string() }).strict(),
      z
        .object({ type: z.literal('SET_REFERENCE'), reference: z.string().min(1).max(120) })
        .strict(),
      z.object({ type: z.literal('NONE') }).strict(),
    ]),
    reviewReasons: z.array(z.string().max(300)).max(10),
  })
  .strict();
export type Finding = z.infer<typeof findingSchema>;
export const evidenceFingerprint = (docs: Pick<Evidence, 'id' | 'version' | 'hash'>[]) =>
  hash(
    docs
      .map((d) => ({ id: d.id, version: d.version, hash: d.hash }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
export function validateBundle(docs: Evidence[], invoice: Invoice) {
  if (!docs.length || docs.length > 12)
    throw new DomainError('BUNDLE_LIMIT', 'Supply 1–12 complete text documents.');
  const bytes = Buffer.byteLength(JSON.stringify({ docs, invoice }), 'utf8');
  // Conservative byte bound also upper-bounds tokenizer input under normal byte tokenization.
  if (bytes > 32000)
    throw new DomainError(
      'BUNDLE_LIMIT',
      'Complete bundle exceeds 32,000 UTF-8 bytes. Supply a smaller complete bundle; nothing was truncated.',
    );
  if (new Set(docs.map((d) => d.id)).size !== docs.length)
    throw new DomainError('EVIDENCE', 'Duplicate evidence document IDs.');
  for (const doc of docs)
    if (doc.hash !== hash(doc.text)) throw new DomainError('EVIDENCE', 'Evidence hash mismatch.');
}
export function validateFinding(
  value: unknown,
  caseId: string,
  docs: Evidence[],
  invoice: Invoice,
): Finding {
  validateBundle(docs, invoice);
  const finding = findingSchema.parse(value);
  for (const c of finding.citations) {
    const doc = docs.find(
      (d) => d.id === c.documentId && d.caseId === caseId && d.version === c.version,
    );
    if (!doc || doc.text.slice(c.start, c.start + c.quote.length) !== c.quote)
      throw new DomainError(
        'CITATION',
        'Finding contains a missing, stale or invented source reference.',
      );
  }
  if (finding.action.type !== 'NONE' && !finding.citations.length)
    throw new DomainError('CITATION', 'Financial proposals need source evidence.');
  if (
    finding.action.type === 'REMOVE_ITEM' &&
    !invoice.lines.some(
      (l) => l.id === (finding.action as Operation & { type: 'REMOVE_ITEM' }).lineId,
    )
  )
    throw new DomainError('LINE', 'Finding refers to an unknown invoice line.');
  if (
    finding.action.type === 'SET_REFERENCE' &&
    !finding.citations.some((c) =>
      c.quote.includes((finding.action as { reference: string }).reference),
    )
  )
    throw new DomainError('REFERENCE', 'Reference is not present in cited evidence.');
  if (
    (finding.issue === 'CONFLICT' ||
      finding.reviewReasons.length ||
      invoice.payment !== 'UNPAID') &&
    finding.action.type !== 'NONE'
  )
    throw new DomainError(
      'REVIEW',
      'This finding needs manual review rather than an automatic correction.',
    );
  return finding;
}
function cite(doc: Evidence, quote = doc.text): Finding['citations'][number] {
  return { documentId: doc.id, version: doc.version, quote, start: doc.text.indexOf(quote) };
}
/** Deterministic synthetic-demo rule adapter. Not a model evaluation or general language understanding. */
export function investigateFixture(caseId: string, docs: Evidence[], invoice: Invoice): Finding {
  validateBundle(docs, invoice);
  let f: Finding = {
    issue: 'MANUAL_REVIEW',
    explanation:
      'The supplied records need human review. No supported automatic correction was found.',
    citations: [],
    missing: ['Clarify the agreement and approval for the questioned item.'],
    action: { type: 'NONE' },
    reviewReasons: ['Fixture rules cannot establish a supported change.'],
  };
  const messages = docs.filter((d) => d.kind === 'message');
  const approved = messages.find((d) =>
    /I approve (the )?(additional )?social.media pack (for|at) (GBP |£)?250[.!]?$/im.test(d.text),
  );
  const withheld = messages.find((d) =>
    /Let me check with my business partner before we add that\./.test(d.text),
  );
  const conflicting = messages.find((d) =>
    /Please do not add the social.media pack\./.test(d.text),
  );
  const agreement = docs.find(
    (d) => d.kind === 'agreement' && /Landing page[\s\S]*GBP 1,000/.test(d.text),
  );
  const extra = invoice.lines.find(
    (l) => /social.media pack/i.test(l.name) && l.totalPence === 25000,
  );
  const reference = messages.find((d) => /Purchase order reference: [A-Z0-9-]+\./.test(d.text));
  const claimed = messages.find((d) => /I already paid/.test(d.text));
  if (approved && conflicting)
    f = {
      ...f,
      issue: 'CONFLICT',
      explanation:
        'The records contain both approval and an instruction not to add the extra. Ask the customer to clarify.',
      citations: [cite(approved), cite(conflicting)],
      missing: ['Which instruction applies to this invoice?'],
      reviewReasons: ['Conflicting evidence.'],
    };
  else if (approved && extra)
    f = {
      issue: 'NO_CHANGE',
      explanation:
        'Explicit approval for the additional GBP 250 social-media pack was found in the supplied records. Clarify the objection before changing the invoice.',
      citations: [cite(approved)],
      missing: [],
      action: { type: 'NONE' },
      reviewReasons: [],
    };
  else if (claimed)
    f = {
      issue: 'CLAIMED_PAYMENT',
      explanation: `The customer reports payment. Current authoritative observation: ${invoice.payment.toLowerCase()}. A customer message alone does not verify payment.`,
      citations: [cite(claimed)],
      missing:
        invoice.payment === 'PAID' ? [] : ['Confirm the payment method and reconcile PayPal.'],
      action: { type: 'NONE' },
      reviewReasons: [],
    };
  else if (reference && !invoice.reference) {
    const match = reference.text.match(/Purchase order reference: ([A-Z0-9-]+)\./)!;
    f = {
      issue: 'MISSING_REFERENCE',
      explanation:
        'A purchase-order reference appears in the supplied customer message and is missing from this invoice.',
      citations: [cite(reference, match[0])],
      missing: [],
      action:
        invoice.payment === 'UNPAID'
          ? { type: 'SET_REFERENCE', reference: match[1] }
          : { type: 'NONE' },
      reviewReasons: [],
    };
  } else if (agreement && withheld && extra)
    f = {
      issue: 'QUESTIONED_CHARGE',
      explanation:
        'Approval for the additional GBP 250 was not found in the supplied records. The customer asked to check with a business partner first. This does not establish that approval never existed.',
      citations: [
        cite(agreement),
        cite(withheld, 'Let me check with my business partner before we add that.'),
      ],
      missing: ['Any later approval for the social-media pack.'],
      action:
        invoice.payment === 'UNPAID' ? { type: 'REMOVE_ITEM', lineId: extra.id } : { type: 'NONE' },
      reviewReasons: [],
    };
  return validateFinding(f, caseId, docs, invoice);
}

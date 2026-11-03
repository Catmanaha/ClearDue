import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DomainError, hash } from '../domain/core';
import { importSchema, validateBundle } from '../domain/evidence';
import { demoRaw } from '../domain/fixtures';
import { projectInvoice } from '../domain/invoice';
import { config } from './config';
import { db } from './db';
import { provider } from './providers';
import { cases, evidence, intakeReceipts } from './schema';

const inputSchema = z
  .object({
    customer: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(150),
    invoiceId: z.string().max(100).optional(),
    documents: z.array(importSchema).min(1).max(12),
    requestId: z.uuid().optional(),
  })
  .strict();
class IntakeReplay extends Error {}

export async function createIntakeCase(actor: string, value: unknown) {
  const input = inputSchema.parse(value);
  const cfg = config();
  const { requestId, ...content } = input;
  const inputHash = hash(content);
  async function receipt() {
    if (!requestId) return undefined;
    const [found] = await db()
      .select()
      .from(intakeReceipts)
      .where(
        and(
          eq(intakeReceipts.ownerId, actor),
          eq(intakeReceipts.merchant, cfg.merchant),
          eq(intakeReceipts.environment, cfg.mode),
          eq(intakeReceipts.requestKey, requestId),
        ),
      );
    if (found && found.inputHash !== inputHash)
      throw new DomainError(
        'INTAKE_CONFLICT',
        'This draft has already saved a case with different records. Check your case queue before starting a separate draft.',
        409,
      );
    return found;
  }
  const existing = await receipt();
  if (existing) return { id: existing.caseId, replayed: true };
  const id = randomUUID();
  // Invoice reads happen before the database transaction. Intake never writes a provider invoice.
  const raw =
    cfg.mode === 'demo'
      ? demoRaw(`DEMO-${id.slice(0, 8)}`)
      : await provider().read(input.invoiceId ?? '');
  const invoice = projectInvoice(raw, cfg.merchant, cfg.mode);
  const docs = input.documents.map((d) => ({
    ...d,
    id: randomUUID(),
    caseId: id,
    version: 1,
    hash: hash(d.text),
  }));
  validateBundle(docs, invoice);
  try {
    await db().transaction(async (tx) => {
      await tx
        .insert(cases)
        .values({
          id,
          ownerId: actor,
          merchant: cfg.merchant,
          environment: cfg.mode,
          invoiceId: invoice.id,
          customer: input.customer,
          title: input.title,
          kind: 'imported',
          providerInvoice: raw,
          invoice,
        });
      await tx.insert(evidence).values(docs);
      if (requestId) {
        const saved = await tx
          .insert(intakeReceipts)
          .values({
            ownerId: actor,
            merchant: cfg.merchant,
            environment: cfg.mode,
            requestKey: requestId,
            inputHash,
            caseId: id,
          })
          .onConflictDoNothing()
          .returning({ caseId: intakeReceipts.caseId });
        // Roll back the competing case and its records together, then read the committed receipt.
        if (!saved.length) throw new IntakeReplay();
      }
    });
    return { id, replayed: false };
  } catch (error) {
    if (!(error instanceof IntakeReplay)) throw error;
    const saved = await receipt();
    if (!saved)
      throw new DomainError(
        'INTAKE_RETRY',
        'The saved case could not be confirmed. Check your case queue before continuing.',
        503,
      );
    return { id: saved.caseId, replayed: true };
  }
}

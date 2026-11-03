import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { db } from './db';
import { queue } from './queue';
import { config } from './config';
import { cases, webhooks } from './schema';
import { PayPalProvider } from './providers';
import { DomainError } from '../domain/core';
export async function ingestWebhook(headers: Headers, raw: string) {
  if (config().mode !== 'sandbox')
    throw new DomainError(
      'WEBHOOK_DISABLED',
      'Real PayPal webhooks are disabled in fixture demo mode.',
      404,
    );
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    throw new DomainError('WEBHOOK_BODY', 'Invalid webhook JSON.', 400);
  }
  const verifier = new PayPalProvider();
  if (!(await verifier.verifyWebhook(headers, event)))
    throw new DomainError('WEBHOOK_SIGNATURE', 'PayPal signature verification failed.', 401);
  const result = await persistVerifiedWebhook(event);
  console.info(
    JSON.stringify({
      event: 'paypal_webhook_verified',
      outcome: 'duplicate' in result ? 'duplicate' : 'accepted' in result ? 'accepted' : 'ignored',
    }),
  );
  return result;
}
/** Internal persistence boundary; reachable HTTP always verifies first, with no fixture bypass. */
export async function persistVerifiedWebhook(event: unknown) {
  const parsed = z
    .object({
      id: z.string().min(1).max(200),
      event_type: z.string(),
      resource: z.object({
        invoice: z.object({ id: z.string().min(1).max(200) }),
      }),
    })
    .passthrough()
    .parse(event);
  if (!parsed.event_type.startsWith('INVOICING.INVOICE.')) return { ignored: true };
  const [c] = await db()
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.invoiceId, parsed.resource.invoice.id),
        eq(cases.merchant, config().merchant),
        eq(cases.environment, config().mode),
      ),
    );
  if (!c) return { ignored: true };
  const boss = await queue();
  return db().transaction(async (tx) => {
    const inserted = await tx
      .insert(webhooks)
      .values({ id: parsed.id, invoiceId: c.invoiceId, merchant: c.merchant, payload: event })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return { duplicate: true };
    const job = await boss.send(
      'reconcile',
      { caseId: c.id, actorId: c.ownerId },
      { db: fromDrizzle(tx, sql) },
    );
    if (!job) throw new Error('Webhook reconciliation enqueue failed');
    return { accepted: true };
  });
}

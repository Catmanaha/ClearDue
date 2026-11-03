import { randomUUID, randomBytes } from 'node:crypto';
import { and, eq, desc, sql, inArray } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { db } from './db';
import { queue } from './queue';
import { config } from './config';
import * as s from './schema';
import { DomainError, hash, transition, type CommandState } from '../domain/core';
import { applyOperation, intendedFingerprint, matchesInvoiceIntent } from '../domain/invoice';
import {
  evidenceFingerprint,
  importSchema,
  investigateFixture,
  validateBundle,
  validateFinding,
} from '../domain/evidence';
import { provider, readProjection, type InvoiceProvider } from './providers';
import { investigateLive, PROMPT_VERSION } from './investigator';

const scope = (actor: string) =>
  and(
    eq(s.cases.ownerId, actor),
    eq(s.cases.merchant, config().merchant),
    eq(s.cases.environment, config().mode),
  );
export async function getCase(actor: string, id: string) {
  const [c] = await db()
    .select()
    .from(s.cases)
    .where(and(eq(s.cases.id, id), scope(actor)));
  if (!c) throw new DomainError('NOT_FOUND', 'Case not found in your workspace.', 404);
  return c;
}
export async function listCases(actor: string) {
  const rows = await db()
    .select()
    .from(s.cases)
    .where(scope(actor))
    .orderBy(desc(s.cases.createdAt));
  if (!rows.length) return [];
  const counts = await db()
    .select({
      caseId: s.evidence.caseId,
      count: sql<number>`count(*)::int`,
      agreements: sql<number>`count(*) filter(where ${s.evidence.kind}='agreement')::int`,
      messages: sql<number>`count(*) filter(where ${s.evidence.kind}='message')::int`,
    })
    .from(s.evidence)
    .where(
      inArray(
        s.evidence.caseId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(s.evidence.caseId);
  return rows.map((row) => {
    const count = counts.find((c) => c.caseId === row.id);
    return {
      ...row,
      evidenceCount: count?.count ?? 0,
      evidenceStatus:
        count?.agreements && count?.messages
          ? 'Agreement + messages supplied'
          : count?.agreements
            ? 'Customer messages missing'
            : 'Agreement missing',
    };
  });
}
export async function workbench(actor: string, id: string) {
  const c = await getCase(actor, id);
  const [docs, runs, proposals, commands, audit, grants, customerFeedback, observations] =
    await Promise.all([
      db().select().from(s.evidence).where(eq(s.evidence.caseId, id)).orderBy(s.evidence.createdAt),
      db()
        .select()
        .from(s.investigations)
        .where(eq(s.investigations.caseId, id))
        .orderBy(desc(s.investigations.createdAt), desc(s.investigations.id))
        .limit(5),
      db()
        .select()
        .from(s.proposals)
        .where(eq(s.proposals.caseId, id))
        .orderBy(desc(s.proposals.version)),
      db()
        .select()
        .from(s.commands)
        .where(eq(s.commands.caseId, id))
        .orderBy(desc(s.commands.createdAt)),
      db()
        .select()
        .from(s.audit)
        .where(eq(s.audit.caseId, id))
        .orderBy(desc(s.audit.createdAt))
        .limit(20),
      db()
        .select({ id: s.grants.id, expiresAt: s.grants.expiresAt, revokedAt: s.grants.revokedAt })
        .from(s.grants)
        .where(eq(s.grants.caseId, id)),
      db()
        .select({
          message: s.feedback.message,
          createdAt: s.feedback.createdAt,
          id: s.feedback.id,
          reviewedAt: s.feedback.reviewedAt,
        })
        .from(s.feedback)
        .innerJoin(s.grants, eq(s.feedback.grantId, s.grants.id))
        .where(eq(s.grants.caseId, id))
        .orderBy(desc(s.feedback.createdAt)),
      db()
        .select({ observedAt: s.snapshots.createdAt, provenance: s.snapshots.provenance })
        .from(s.snapshots)
        .where(eq(s.snapshots.caseId, id))
        .orderBy(desc(s.snapshots.createdAt))
        .limit(1),
    ]);
  return {
    case: c,
    docs,
    runs,
    proposals,
    commands,
    audit,
    grants,
    customerFeedback,
    evidenceHash: evidenceFingerprint(docs),
    invoiceObservation: observations[0] ?? null,
  };
}
export async function addEvidence(actor: string, id: string, input: unknown) {
  const doc = importSchema.parse(input);
  const boss = await queue();
  await db().transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(s.cases)
      .where(and(eq(s.cases.id, id), scope(actor)))
      .for('update');
    if (!c) throw new DomainError('NOT_FOUND', 'Case not found.', 404);
    const executing = await tx
      .select({ id: s.commands.id })
      .from(s.commands)
      .where(
        and(eq(s.commands.caseId, id), inArray(s.commands.state, ['RUNNING', 'UNKNOWN_OUTCOME'])),
      );
    if (executing.length)
      throw new DomainError(
        'CASE_BUSY',
        'Wait for the current correction to be verified or reviewed before adding evidence.',
      );
    const existing = await tx.select().from(s.evidence).where(eq(s.evidence.caseId, id));
    const next = { ...doc, id: randomUUID(), caseId: id, version: 1, hash: hash(doc.text) };
    validateBundle([...existing, next], c.invoice);
    await tx.insert(s.evidence).values(next);
    await tx
      .update(s.proposals)
      .set({ state: 'STALE' })
      .where(and(eq(s.proposals.caseId, id), eq(s.proposals.state, 'DRAFT')));
    await tx
      .update(s.cases)
      .set({ state: 'INVESTIGATING', updatedAt: new Date() })
      .where(eq(s.cases.id, id));
    await tx.insert(s.audit).values({
      id: randomUUID(),
      caseId: id,
      actorId: actor,
      event: 'EVIDENCE_ADDED',
      data: { documentId: next.id, hash: next.hash },
    });
    await boss.send('investigate', { caseId: id, actorId: actor }, { db: fromDrizzle(tx, sql) });
  });
}
export async function requestInvestigation(actor: string, id: string) {
  const boss = await queue();
  await db().transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(s.cases)
      .where(and(eq(s.cases.id, id), scope(actor)))
      .for('update');
    if (!c) throw new DomainError('NOT_FOUND', 'Case not found.', 404);
    if (c.state === 'INVESTIGATING') return;
    const docs = await tx.select().from(s.evidence).where(eq(s.evidence.caseId, id));
    validateBundle(docs, c.invoice);
    await tx
      .update(s.proposals)
      .set({ state: 'SUPERSEDED' })
      .where(and(eq(s.proposals.caseId, id), eq(s.proposals.state, 'DRAFT')));
    await tx
      .update(s.cases)
      .set({ state: 'INVESTIGATING', updatedAt: new Date() })
      .where(eq(s.cases.id, id));
    await boss.send('investigate', { caseId: id, actorId: actor }, { db: fromDrizzle(tx, sql) });
  });
}
export async function runInvestigation(actor: string, id: string) {
  const c = await getCase(actor, id);
  const docs = await db().select().from(s.evidence).where(eq(s.evidence.caseId, id));
  const evidenceHash = evidenceFingerprint(docs);
  const runId = randomUUID();
  const live = config().ai === 'live';
  await db()
    .insert(s.investigations)
    .values({
      id: runId,
      caseId: id,
      evidenceHash,
      invoiceHash: c.invoice.fingerprint,
      status: 'RUNNING',
      provenance: live ? 'live-model' : 'fixture-rules',
      promptVersion: PROMPT_VERSION,
      model: live
        ? process.env.AI_PROVIDER === 'astropods'
          ? process.env.ASTRO_GATEWAY_MODEL
          : process.env.OPENAI_MODEL
        : null,
    });
  try {
    const result = live
      ? await investigateLive(id, docs, c.invoice)
      : { finding: investigateFixture(id, docs, c.invoice), usage: null };
    const finding = validateFinding(result.finding, id, docs, c.invoice);
    await db().transaction(async (tx) => {
      const [current] = await tx.select().from(s.cases).where(eq(s.cases.id, id)).for('update');
      const nowDocs = await tx.select().from(s.evidence).where(eq(s.evidence.caseId, id));
      if (
        !current ||
        current.invoice.fingerprint !== c.invoice.fingerprint ||
        evidenceFingerprint(nowDocs) !== evidenceHash
      )
        throw new DomainError(
          'STALE',
          'Evidence changed during analysis. Run investigation again.',
        );
      await tx
        .update(s.investigations)
        .set({ status: 'SUCCEEDED', result: finding, usage: result.usage })
        .where(eq(s.investigations.id, runId));
      await tx
        .update(s.proposals)
        .set({ state: 'SUPERSEDED' })
        .where(and(eq(s.proposals.caseId, id), eq(s.proposals.state, 'DRAFT')));
      if (finding.action.type !== 'NONE') {
        const [last] = await tx
          .select()
          .from(s.proposals)
          .where(eq(s.proposals.caseId, id))
          .orderBy(desc(s.proposals.version))
          .limit(1);
        await tx.insert(s.proposals).values({
          id: randomUUID(),
          caseId: id,
          investigationId: runId,
          version: (last?.version ?? 0) + 1,
          invoiceHash: c.invoice.fingerprint,
          evidenceHash,
          operation: finding.action,
          explanation: finding.explanation,
          state: 'DRAFT',
        });
      }
      await tx
        .update(s.cases)
        .set({
          state: finding.reviewReasons.length ? 'MANUAL_REVIEW' : 'REVIEW',
          updatedAt: new Date(),
        })
        .where(eq(s.cases.id, id));
      await tx.insert(s.audit).values({
        id: randomUUID(),
        caseId: id,
        actorId: actor,
        event: 'INVESTIGATED',
        data: { runId, provenance: live ? 'live-model' : 'fixture-rules' },
      });
    });
  } catch (e) {
    const message =
      e instanceof DomainError
        ? e.message
        : 'Analysis failed or returned an invalid response. Review the complete bundle and try again.';
    await db()
      .update(s.investigations)
      .set({ status: 'FAILED', error: message })
      .where(eq(s.investigations.id, runId));
    await db()
      .update(s.cases)
      .set({ state: 'MANUAL_REVIEW', updatedAt: new Date() })
      .where(eq(s.cases.id, id));
  }
}
export async function reviseProposal(
  actor: string,
  id: string,
  proposalId: string,
  explanation: string,
) {
  if (!explanation.trim() || explanation.length > 1500)
    throw new DomainError('EXPLANATION', 'Explanation must contain 1–1,500 characters.');
  await getCase(actor, id);
  return db().transaction(async (tx) => {
    await tx.select().from(s.cases).where(eq(s.cases.id, id)).for('update');
    const [p] = await tx
      .select()
      .from(s.proposals)
      .where(and(eq(s.proposals.id, proposalId), eq(s.proposals.caseId, id)));
    if (!p || p.state !== 'DRAFT')
      throw new DomainError('STALE', 'Only the current draft may be revised.');
    const [last] = await tx
      .select()
      .from(s.proposals)
      .where(eq(s.proposals.caseId, id))
      .orderBy(desc(s.proposals.version))
      .limit(1);
    const { createdAt: _created, ...copy } = p;
    void _created;
    await tx.update(s.proposals).set({ state: 'SUPERSEDED' }).where(eq(s.proposals.id, p.id));
    const [next] = await tx
      .insert(s.proposals)
      .values({
        ...copy,
        id: randomUUID(),
        explanation: explanation.trim(),
        version: last.version + 1,
        state: 'DRAFT',
      })
      .returning();
    return next;
  });
}
export async function approve(
  actor: string,
  id: string,
  proposalId: string,
  supported: boolean,
  failAfterEnqueue = false,
) {
  if (!supported)
    throw new DomainError(
      'REVIEW',
      'Confirm you reviewed the sources and support this exact correction.',
    );
  const boss = await queue();
  return db().transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(s.cases)
      .where(and(eq(s.cases.id, id), scope(actor)))
      .for('update');
    if (!c) throw new DomainError('NOT_FOUND', 'Case not found.', 404);
    const [p] = await tx
      .select()
      .from(s.proposals)
      .where(and(eq(s.proposals.id, proposalId), eq(s.proposals.caseId, id)));
    if (!p) throw new DomainError('NOT_FOUND', 'Proposal not found.', 404);
    const [prior] = await tx.select().from(s.commands).where(eq(s.commands.proposalId, proposalId));
    if (prior) return prior;
    const [run] = await tx
      .select()
      .from(s.investigations)
      .where(eq(s.investigations.caseId, id))
      .orderBy(desc(s.investigations.createdAt), desc(s.investigations.id))
      .limit(1);
    if (c.state === 'INVESTIGATING' || run?.status !== 'SUCCEEDED' || run.id !== p.investigationId)
      throw new DomainError(
        'INVESTIGATION_CHANGED',
        'This draft belongs to an earlier analysis. Review the latest case before approving a correction.',
        409,
      );
    const docs = await tx.select().from(s.evidence).where(eq(s.evidence.caseId, id));
    if (
      p.state !== 'DRAFT' ||
      p.invoiceHash !== c.invoice.fingerprint ||
      p.evidenceHash !== evidenceFingerprint(docs)
    )
      throw new DomainError(
        'STALE',
        'Invoice or evidence changed. Investigate and review a new proposal.',
      );
    if (!run.result || hash(run.result.action) !== hash(p.operation))
      throw new DomainError('PROPOSAL', 'Proposal does not match its validated finding.');
    validateFinding(run.result, id, docs, c.invoice);
    const active = await tx
      .select()
      .from(s.commands)
      .where(
        and(
          eq(s.commands.invoiceId, c.invoiceId),
          eq(s.commands.merchant, c.merchant),
          eq(s.commands.environment, c.environment),
          inArray(s.commands.state, [
            'QUEUED',
            'RUNNING',
            'RETRYABLE_FAILURE',
            'UNKNOWN_OUTCOME',
            'MANUAL_REVIEW',
          ]),
        ),
      );
    if (active.length)
      throw new DomainError(
        'INVOICE_BUSY',
        'An earlier command needs reconciliation or manual resolution before another correction.',
      );
    const after = applyOperation(c.invoice, p.operation);
    const [command] = await tx
      .insert(s.commands)
      .values({
        id: randomUUID(),
        proposalId,
        caseId: id,
        actorId: actor,
        merchant: c.merchant,
        environment: c.environment,
        invoiceId: c.invoiceId,
        operation: p.operation,
        beforeHash: p.invoiceHash,
        evidenceHash: p.evidenceHash,
        intendedAfter: after,
        state: 'QUEUED',
      })
      .returning();
    await tx.update(s.proposals).set({ state: 'APPROVED' }).where(eq(s.proposals.id, p.id));
    await tx
      .update(s.cases)
      .set({ state: 'RESOLVING', updatedAt: new Date() })
      .where(eq(s.cases.id, id));
    const job = await boss.send('execute', { commandId: command.id }, { db: fromDrizzle(tx, sql) });
    if (!job)
      throw new DomainError('QUEUE', 'Execution job was not created. Approval was rolled back.');
    await tx.insert(s.audit).values({
      id: randomUUID(),
      caseId: id,
      actorId: actor,
      event: 'APPROVED',
      data: {
        commandId: command.id,
        proposalId,
        proposalVersion: p.version,
        merchant: c.merchant,
        environment: c.environment,
        invoiceHash: p.invoiceHash,
        evidenceHash: p.evidenceHash,
        operation: p.operation,
        sourceSupportAttested: true,
      },
    });
    if (failAfterEnqueue) throw new Error('Injected transaction rollback');
    return command;
  });
}
async function commandState(id: string, state: CommandState, error: string | null = null) {
  await db().transaction(async (tx) => {
    const [current] = await tx.select().from(s.commands).where(eq(s.commands.id, id)).for('update');
    if (!current) throw new DomainError('COMMAND', 'Command not found.');
    transition(current.state, state);
    const [c] = await tx
      .update(s.commands)
      .set({ state, error, updatedAt: new Date() })
      .where(eq(s.commands.id, id))
      .returning();
    await tx.insert(s.audit).values({
      id: randomUUID(),
      caseId: c.caseId,
      actorId: 'worker',
      event: `COMMAND_${state}`,
      data: { commandId: id, message: error },
    });
    if (['MANUAL_REVIEW', 'STALE', 'UNSUPPORTED'].includes(state))
      await tx
        .update(s.cases)
        .set({ state: 'MANUAL_REVIEW', updatedAt: new Date() })
        .where(eq(s.cases.id, c.caseId));
    if (state === 'SUCCEEDED')
      await tx
        .update(s.cases)
        .set({ state: 'RESOLVED', updatedAt: new Date() })
        .where(eq(s.cases.id, c.caseId));
  });
}
export async function executeCommand(id: string, injectedProvider?: InvoiceProvider) {
  const [command] = await db()
    .update(s.commands)
    .set({ state: 'RUNNING', attempts: sql`${s.commands.attempts}+1`, updatedAt: new Date() })
    .where(and(eq(s.commands.id, id), eq(s.commands.state, 'QUEUED')))
    .returning();
  if (!command) return; // Redelivery cannot claim an already running or completed command.
  if (command.environment !== config().mode || command.merchant !== config().merchant) {
    await commandState(id, 'UNSUPPORTED', 'Worker environment does not match approval.');
    return;
  }
  const p = injectedProvider ?? provider();
  let fresh;
  try {
    fresh = await readProjection(p, command.invoiceId);
    const docs = await db().select().from(s.evidence).where(eq(s.evidence.caseId, command.caseId));
    if (
      fresh.invoice.fingerprint !== command.beforeHash ||
      evidenceFingerprint(docs) !== command.evidenceHash
    ) {
      await commandState(
        id,
        'STALE',
        'Invoice or evidence changed after approval. No write was sent.',
      );
      return;
    }
    if (
      intendedFingerprint(applyOperation(fresh.invoice, command.operation)) !==
      intendedFingerprint(command.intendedAfter)
    )
      throw new DomainError(
        'UNSUPPORTED',
        'Approved operation no longer matches intended invoice.',
      );
  } catch (e) {
    if (e instanceof DomainError && ['UNSUPPORTED', 'OWNERSHIP', 'OPERATION'].includes(e.code))
      await commandState(id, 'UNSUPPORTED', e.message);
    else if (command.attempts >= 2)
      await commandState(
        id,
        'MANUAL_REVIEW',
        'Preflight read failed after three attempts. No write was sent.',
      );
    else {
      await commandState(
        id,
        'RETRYABLE_FAILURE',
        'Preflight read failed. No write was sent; bounded recovery will retry.',
      );
    }
    return;
  }
  try {
    await saveObservation(command.caseId, fresh.raw, fresh.invoice, p.provenance);
    await p.update(command.invoiceId, command.intendedAfter);
    const after = await readProjection(p, command.invoiceId);
    if (
      !matchesInvoiceIntent(after.invoice.writable, command.intendedAfter) ||
      hash(after.invoice.compatibility ?? {}) !== hash(fresh.invoice.compatibility ?? {})
    ) {
      await commandState(
        id,
        'MANUAL_REVIEW',
        'Readback differs from the approved correction. Another client may have changed the invoice.',
      );
      return;
    }
    await saveObservation(command.caseId, after.raw, after.invoice, p.provenance);
    await commandState(id, 'SUCCEEDED');
  } catch {
    const boss = await queue();
    await db().transaction(async (tx) => {
      await tx
        .update(s.commands)
        .set({
          state: 'UNKNOWN_OUTCOME',
          error:
            'The write may have completed. Reconciliation will read before any further action.',
          updatedAt: new Date(),
        })
        .where(eq(s.commands.id, id));
      await boss.send(
        'reconcile',
        { caseId: command.caseId, actorId: command.actorId },
        { db: fromDrizzle(tx, sql) },
      );
      await tx.insert(s.audit).values({
        id: randomUUID(),
        caseId: command.caseId,
        actorId: 'worker',
        event: 'COMMAND_UNKNOWN_OUTCOME',
        data: { commandId: id },
      });
    });
  }
}
async function saveObservation(
  caseId: string,
  raw: unknown,
  invoice: typeof s.cases.$inferSelect.invoice,
  provenance: string,
) {
  await db().transaction(async (tx) => {
    await tx.select().from(s.cases).where(eq(s.cases.id, caseId)).for('update');
    await tx.insert(s.snapshots).values({
      id: randomUUID(),
      caseId,
      raw,
      projection: invoice,
      fingerprint: invoice.fingerprint,
      provenance,
    });
    await tx.update(s.cases).set({ invoice, updatedAt: new Date() }).where(eq(s.cases.id, caseId));
    await tx
      .update(s.proposals)
      .set({ state: 'STALE' })
      .where(
        and(
          eq(s.proposals.caseId, caseId),
          eq(s.proposals.state, 'DRAFT'),
          sql`${s.proposals.invoiceHash} <> ${invoice.fingerprint}`,
        ),
      );
  });
}
export async function reconcileCase(actor: string, id: string, injectedProvider?: InvoiceProvider) {
  const c = await getCase(actor, id);
  const p = injectedProvider ?? provider();
  const observed = await readProjection(p, c.invoiceId);
  await saveObservation(id, observed.raw, observed.invoice, p.provenance);
  const unknown = await db()
    .select()
    .from(s.commands)
    .where(and(eq(s.commands.caseId, id), eq(s.commands.state, 'UNKNOWN_OUTCOME')));
  for (const command of unknown) {
    const [approvedSnapshot] = await db()
      .select({ projection: s.snapshots.projection })
      .from(s.snapshots)
      .where(and(eq(s.snapshots.caseId, id), eq(s.snapshots.fingerprint, command.beforeHash)))
      .limit(1);
    const match =
      !!approvedSnapshot &&
      matchesInvoiceIntent(observed.invoice.writable, command.intendedAfter) &&
      hash(observed.invoice.compatibility ?? {}) ===
        hash(approvedSnapshot.projection.compatibility ?? {});
    await commandState(
      command.id,
      match ? 'SUCCEEDED' : 'MANUAL_REVIEW',
      match
        ? null
        : 'Unknown write result does not match intended state. Inspect PayPal and audit manually; no automatic retry.',
    );
  }
  await db()
    .update(s.webhooks)
    .set({ processed: true })
    .where(and(eq(s.webhooks.invoiceId, c.invoiceId), eq(s.webhooks.merchant, c.merchant)));
  return observed.invoice;
}
export async function requestRefresh(actor: string, id: string) {
  await getCase(actor, id);
  await (await queue()).send('reconcile', { caseId: id, actorId: actor });
}
export async function recoverCommands() {
  const stuck = await db()
    .select()
    .from(s.commands)
    .where(
      and(
        eq(s.commands.environment, config().mode),
        eq(s.commands.merchant, config().merchant),
        inArray(s.commands.state, ['RUNNING', 'RETRYABLE_FAILURE', 'UNKNOWN_OUTCOME']),
      ),
    )
    .limit(20);
  const boss = await queue();
  for (const c of stuck) {
    if (Date.now() - c.updatedAt.getTime() < 130000) continue;
    await db().transaction(async (tx) => {
      if (c.attempts >= 3) {
        const stopped = await tx
          .update(s.commands)
          .set({
            state: 'MANUAL_REVIEW',
            error:
              'Automatic recovery budget exhausted. Inspect authoritative PayPal state before any further action; no write will be retried.',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(s.commands.id, c.id),
              inArray(s.commands.state, ['RUNNING', 'RETRYABLE_FAILURE', 'UNKNOWN_OUTCOME']),
              sql`${s.commands.attempts} >= 3`,
              sql`${s.commands.updatedAt} < now() - interval '130 seconds'`,
            ),
          )
          .returning();
        if (stopped.length) {
          await tx
            .update(s.cases)
            .set({ state: 'MANUAL_REVIEW', updatedAt: new Date() })
            .where(eq(s.cases.id, c.caseId));
          await tx.insert(s.audit).values({
            id: randomUUID(),
            caseId: c.caseId,
            actorId: 'worker',
            event: 'RECOVERY_BUDGET_EXHAUSTED',
            data: { commandId: c.id },
          });
        }
        return;
      }
      if (c.state === 'RETRYABLE_FAILURE') {
        const claimed = await tx
          .update(s.commands)
          .set({ state: 'QUEUED', updatedAt: new Date() })
          .where(and(eq(s.commands.id, c.id), eq(s.commands.state, 'RETRYABLE_FAILURE')))
          .returning();
        if (claimed.length)
          await boss.send('execute', { commandId: c.id }, { db: fromDrizzle(tx, sql) });
      } else {
        const claimed = await tx
          .update(s.commands)
          .set({
            state: 'UNKNOWN_OUTCOME',
            attempts: sql`${s.commands.attempts}+1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(s.commands.id, c.id),
              inArray(s.commands.state, ['RUNNING', 'UNKNOWN_OUTCOME']),
              sql`${s.commands.attempts}<3`,
              sql`${s.commands.updatedAt} < now() - interval '130 seconds'`,
            ),
          )
          .returning();
        if (claimed.length)
          await boss.send(
            'reconcile',
            { caseId: c.caseId, actorId: c.actorId },
            { db: fromDrizzle(tx, sql) },
          );
      }
    });
  }
}
export async function createGrant(actor: string, id: string) {
  const c = await getCase(actor, id);
  const [command] = await db()
    .select()
    .from(s.commands)
    .where(and(eq(s.commands.caseId, id), eq(s.commands.state, 'SUCCEEDED')))
    .orderBy(desc(s.commands.createdAt))
    .limit(1);
  if (!command)
    throw new DomainError(
      'GRANT',
      'Complete and verify the approved correction before creating a customer link.',
    );
  const [proposal] = await db()
    .select()
    .from(s.proposals)
    .where(eq(s.proposals.id, command.proposalId));
  if (!matchesInvoiceIntent(c.invoice.writable, command.intendedAfter))
    throw new DomainError(
      'STALE',
      'The current invoice differs from the approved correction. Review it before sharing.',
    );
  const token = randomBytes(32).toString('base64url');
  const [grant] = await db()
    .insert(s.grants)
    .values({
      id: randomUUID(),
      tokenHash: hash(token),
      caseId: id,
      explanation: proposal.explanation,
      invoiceHash: hash(c.invoice.writable),
      expiresAt: new Date(Date.now() + 48 * 3600000),
    })
    .returning();
  return { id: grant.id, url: `${config().appUrl}/r#${token}`, expiresAt: grant.expiresAt };
}
export async function clarificationGrant(
  actor: string,
  id: string,
  explanation: string,
  invoiceHash: string,
  evidenceHash: string,
  reviewed: boolean,
) {
  if (!reviewed || !explanation.trim() || explanation.length > 1500)
    throw new DomainError(
      'REVIEW',
      'Review and explicitly approve a clarification of 1–1,500 characters.',
    );
  const token = randomBytes(32).toString('base64url');
  const grant = await db().transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(s.cases)
      .where(and(eq(s.cases.id, id), scope(actor)))
      .for('update');
    if (!c) throw new DomainError('NOT_FOUND', 'Case not found.', 404);
    const docs = await tx.select().from(s.evidence).where(eq(s.evidence.caseId, id));
    if (c.invoice.fingerprint !== invoiceHash || evidenceFingerprint(docs) !== evidenceHash)
      throw new DomainError(
        'STALE',
        'Invoice or evidence changed. Review the clarification again.',
      );
    const [g] = await tx
      .insert(s.grants)
      .values({
        id: randomUUID(),
        caseId: id,
        tokenHash: hash(token),
        invoiceHash: hash(c.invoice.writable),
        explanation: explanation.trim(),
        expiresAt: new Date(Date.now() + 48 * 3600000),
      })
      .returning();
    await tx.insert(s.audit).values({
      id: randomUUID(),
      caseId: id,
      actorId: actor,
      event: 'CLARIFICATION_APPROVED',
      data: { grantId: g.id, invoiceHash, evidenceHash },
    });
    return g;
  });
  return { id: grant.id, url: `${config().appUrl}/r#${token}`, expiresAt: grant.expiresAt };
}
export async function customerView(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new DomainError(
      'GRANT',
      'This link is invalid or expired. Ask the studio for a new link.',
      404,
    );
  const [g] = await db()
    .select()
    .from(s.grants)
    .where(eq(s.grants.tokenHash, hash(token)));
  if (!g || g.revokedAt || g.expiresAt.getTime() <= Date.now())
    throw new DomainError(
      'GRANT',
      'This link is invalid or expired. Ask the studio for a new link.',
      404,
    );
  const [c] = await db()
    .select()
    .from(s.cases)
    .where(
      and(
        eq(s.cases.id, g.caseId),
        eq(s.cases.environment, config().mode),
        eq(s.cases.merchant, config().merchant),
      ),
    );
  if (!c) throw new DomainError('GRANT', 'This link is unavailable.', 404);
  if (g.invoiceHash !== hash(c.invoice.writable))
    throw new DomainError(
      'GRANT',
      'The invoice changed after this explanation was approved. Ask the studio for a new resolution link.',
      409,
    );
  const [observation] = await db()
    .select({ createdAt: s.snapshots.createdAt })
    .from(s.snapshots)
    .where(eq(s.snapshots.caseId, c.id))
    .orderBy(desc(s.snapshots.createdAt))
    .limit(1);
  return {
    grantId: g.id,
    explanation: g.explanation,
    studioName: c.invoice.writable.invoicer.business_name ?? 'Your studio',
    invoiceNumber: c.invoice.number,
    lines: c.invoice.lines.map((l) => ({ name: l.name, totalPence: l.totalPence })),
    totalPence: c.invoice.totalPence,
    duePence: c.invoice.duePence,
    payment: c.invoice.payment,
    paymentUrl: c.invoice.paymentUrl,
    mode: c.environment,
    canSimulatePayment: config().demoAccess,
    observedAt: observation?.createdAt ?? c.createdAt,
  };
}

import { and, eq, inArray } from 'drizzle-orm';
import { config } from './config';
import { db, pool } from './db';
import { intakeReceipts } from './schema';
import { createIntakeCase } from './intake';
import { runInvestigation, workbench } from './workflow';
import { fixtures } from '../domain/fixtures';

const examples = [
  {
    requestId: '717ed508-3a30-4630-9053-ef3bf11a6001',
    fixtureIndex: 0,
    title: 'Example: a questioned £250 extra',
    label: 'Review the questioned extra',
    description: 'Read why the customer’s reply calls for clarification or owner review.',
  },
  {
    requestId: '717ed508-3a30-4630-9053-ef3bf11a6002',
    fixtureIndex: 1,
    title: 'Example: the customer approved the extra',
    label: 'Compare the approved extra',
    description: 'Find the explicit approval and see why the original charge stays.',
  },
] as const;

export type JudgeExampleLink = { id: string; label: string; description: string };

export async function savedJudgeExamples(actor: string): Promise<JudgeExampleLink[]> {
  const cfg = config();
  if (cfg.mode !== 'demo') return [];
  const receipts = await db()
    .select()
    .from(intakeReceipts)
    .where(
      and(
        eq(intakeReceipts.ownerId, actor),
        eq(intakeReceipts.merchant, cfg.merchant),
        eq(intakeReceipts.environment, cfg.mode),
        inArray(
          intakeReceipts.requestKey,
          examples.map((example) => example.requestId),
        ),
      ),
    );
  const links: JudgeExampleLink[] = [];
  for (const example of examples) {
    const receipt = receipts.find((row) => row.requestKey === example.requestId);
    if (!receipt) continue;
    const data = await workbench(actor, receipt.caseId);
    const expected = fixtures()[example.fixtureIndex];
    const run = data.runs[0];
    if (
      run?.status !== 'SUCCEEDED' ||
      run.provenance !== 'fixture-rules' ||
      run.evidenceHash !== data.evidenceHash ||
      run.invoiceHash !== data.case.invoice.fingerprint ||
      run.result?.issue !== expected.expected ||
      run.result.action.type !== expected.action
    )
      continue;
    links.push({ id: receipt.caseId, label: example.label, description: example.description });
  }
  return links.length === examples.length ? links : [];
}

// Operator-only preparation. Normal web requests never call this function.
export async function prepareJudgeExamples(actor: string) {
  if (
    config().mode !== 'demo' ||
    config().ai !== 'fixture' ||
    process.env.LIVE_AI_ENABLED !== 'false' ||
    process.env.PAYPAL_SANDBOX_WRITE_ENABLED === 'true' ||
    process.env.PAYPAL_SANDBOX_TEST_ENABLED === 'true'
  )
    throw new Error('Judge examples require explicit fixture analysis and simulated invoices.');
  const lock = await pool().connect();
  try {
    await lock.query('SELECT pg_advisory_lock(41702028)');
    for (const example of examples) {
      const fixture = fixtures()[example.fixtureIndex];
      const saved = await createIntakeCase(actor, {
        requestId: example.requestId,
        customer: fixture.customer,
        title: example.title,
        documents: fixture.docs.map(({ label, kind, text }) => ({ label, kind, text })),
      });
      const data = await workbench(actor, saved.id);
      if (
        data.commands.length ||
        data.case.invoice.payment !== 'UNPAID' ||
        data.case.invoice.totalPence !== 125000 ||
        data.case.invoice.duePence !== 125000 ||
        data.case.state === 'INVESTIGATING'
      )
        throw new Error('A saved example changed. Inspect it before preparing it again.');
      const run = data.runs[0];
      if (run?.status === 'SUCCEEDED') {
        if (
          run.provenance !== 'fixture-rules' ||
          run.evidenceHash !== data.evidenceHash ||
          run.invoiceHash !== data.case.invoice.fingerprint ||
          run.result?.issue !== fixture.expected ||
          run.result.action.type !== fixture.action
        )
          throw new Error('A saved example has different analysis. Inspect it before continuing.');
      } else {
        if (run?.status === 'RUNNING') throw new Error('An example is already being prepared.');
        await runInvestigation(actor, saved.id);
      }
    }
    const links = await savedJudgeExamples(actor);
    if (links.length !== examples.length) throw new Error('Both saved examples must be complete.');
    return links;
  } finally {
    try {
      await lock.query('SELECT pg_advisory_unlock(41702028)');
    } finally {
      lock.release();
    }
  }
}

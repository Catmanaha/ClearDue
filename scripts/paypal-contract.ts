import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PayPalProvider, readProjection } from '../src/server/providers';
import { config } from '../src/server/config';
import { db, closeDb } from '../src/server/db';
import { closeQueue } from '../src/server/queue';
import { cases, evidence } from '../src/server/schema';
import { fixtures } from '../src/domain/fixtures';
import { applyOperation } from '../src/domain/invoice';
import { hash } from '../src/domain/core';
import {
  approve,
  runInvestigation,
  workbench,
  executeCommand,
  reconcileCase,
} from '../src/server/workflow';
const c = config();
if (c.mode !== 'sandbox' || process.env.PAYPAL_SANDBOX_TEST_ENABLED !== 'true')
  throw new Error(
    'NOT RUN: set PAYMENT_MODE=sandbox and project sandbox credentials, then explicitly enable PAYPAL_SANDBOX_TEST_ENABLED.',
  );
const stage = process.env.PAYPAL_CONTRACT_STAGE ?? 'read';
const p = new PayPalProvider();
try {
  if (stage === 'create') {
    const result = await p.createSynthetic();
    await mkdir('.local', { recursive: true });
    await writeFile('.local/paypal-created.json', JSON.stringify(result, null, 2));
    console.log(
      'Created synthetic sandbox invoice; inspect .local/paypal-created.json privately. Add its actual ID to PAYPAL_PROJECT_INVOICE_IDS. No retry after an unknown outcome.',
    );
  } else {
    const id = process.env.PAYPAL_CONTRACT_INVOICE_ID;
    if (
      !id ||
      !(process.env.PAYPAL_PROJECT_INVOICE_IDS ?? '')
        .split(',')
        .map((s) => s.trim())
        .includes(id)
    )
      throw new Error(
        'Configure PAYPAL_CONTRACT_INVOICE_ID from this project’s created invoice and include it in PAYPAL_PROJECT_INVOICE_IDS.',
      );
    if (stage === 'send') await p.sendSynthetic(id);
    const observed = await readProjection(p, id);
    if (stage === 'reconcile') {
      const prepared = JSON.parse(await readFile('.local/paypal-prepared.json', 'utf8'));
      const owner = process.env.CLEARDUE_OWNER_ID;
      if (!owner || owner !== prepared.ownerId || id !== prepared.invoiceId)
        throw new Error('Reconciliation requires the prepared project owner and invoice.');
      const current = await workbench(owner, prepared.caseId);
      if (current.case.invoiceId !== id)
        throw new Error('Prepared case belongs to another invoice.');
      await reconcileCase(owner, prepared.caseId, p);
      console.log(
        'Authoritative payment observation reconciled into the owner-scoped case. No provider write sent.',
      );
    }
    if (stage === 'prepare' || stage === 'correct') {
      if (
        (stage === 'correct' && process.env.PAYPAL_CONTRACT_APPROVE_CORRECTION !== 'true') ||
        !process.env.CLEARDUE_OWNER_ID
      )
        throw new Error(
          'Review the exact GBP1,250 -> GBP1,000 synthetic correction, then set PAYPAL_CONTRACT_APPROVE_CORRECTION=true and CLEARDUE_OWNER_ID.',
        );
      if (
        observed.invoice.totalPence !== 125000 ||
        observed.invoice.payment !== 'UNPAID' ||
        observed.invoice.writable.detail.memo !==
          'ClearDue project-created synthetic sandbox capability test'
      )
        throw new Error(
          'Contract correction only supports this project’s tagged fully unpaid GBP1,250 invoice.',
        );
      if (stage === 'prepare') {
        if (existsSync('.local/paypal-prepared.json'))
          throw new Error(
            'A prepared proposal already exists. Review that case; do not create another.',
          );
        const caseId = randomUUID();
        const fixture = fixtures()[0];
        await db().transaction(async (tx) => {
          await tx.insert(cases).values({
            id: caseId,
            ownerId: process.env.CLEARDUE_OWNER_ID!,
            merchant: c.merchant,
            environment: 'sandbox',
            invoiceId: id,
            customer: 'Synthetic sandbox buyer',
            title: 'PayPal capability correction',
            kind: 'unsupported-extra',
            providerInvoice: observed.raw,
            invoice: observed.invoice,
          });
          await tx
            .insert(evidence)
            .values(fixture.docs.map((d) => ({ ...d, id: randomUUID(), caseId })));
        });
        await runInvestigation(process.env.CLEARDUE_OWNER_ID, caseId);
        const data = await workbench(process.env.CLEARDUE_OWNER_ID, caseId);
        const draft = data.proposals.find((p) => p.state === 'DRAFT');
        if (!draft)
          throw new Error('No supported correction proposal. Inspect the finding; no write sent.');
        const intended = applyOperation(observed.invoice, draft.operation);
        const operation = draft.operation;
        if (
          operation.type !== 'REMOVE_ITEM' ||
          observed.invoice.lines.find((line) => line.id === operation.lineId)?.totalPence !== 25000
        )
          throw new Error(
            'Prepared proposal is not the expected GBP250 extra removal. No approval sent.',
          );
        await mkdir('.local', { recursive: true });
        await writeFile(
          '.local/paypal-prepared.json',
          JSON.stringify(
            {
              caseId,
              proposalId: draft.id,
              ownerId: process.env.CLEARDUE_OWNER_ID,
              invoiceId: id,
              invoiceHash: draft.invoiceHash,
              evidenceHash: draft.evidenceHash,
              operation: draft.operation,
              explanation: draft.explanation,
              before: observed.invoice.writable,
              after: intended,
              beforePence: 125000,
              afterPence: 100000,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
        console.log(
          'Prepared the exact persisted GBP1,250 -> GBP1,000 proposal privately; no approval or PayPal correction sent.',
        );
      } else {
        const prepared = JSON.parse(await readFile('.local/paypal-prepared.json', 'utf8'));
        if (
          prepared.ownerId !== process.env.CLEARDUE_OWNER_ID ||
          prepared.invoiceId !== id ||
          prepared.invoiceHash !== observed.invoice.fingerprint
        )
          throw new Error(
            'Prepared proposal does not match this owner/invoice snapshot. Review again; no write sent.',
          );
        const data = await workbench(process.env.CLEARDUE_OWNER_ID, prepared.caseId);
        const draft = data.proposals.find(
          (proposal) => proposal.id === prepared.proposalId && proposal.state === 'DRAFT',
        );
        if (
          !draft ||
          draft.invoiceHash !== prepared.invoiceHash ||
          draft.evidenceHash !== prepared.evidenceHash ||
          hash(draft.operation) !== hash(prepared.operation) ||
          draft.explanation !== prepared.explanation ||
          hash(applyOperation(observed.invoice, draft.operation)) !== hash(prepared.after) ||
          data.commands.length
        )
          throw new Error(
            'The exact prepared proposal changed or already has a command. Inspect it; no repeated correction.',
          );
        const caseId = prepared.caseId;
        const command = await approve(process.env.CLEARDUE_OWNER_ID, caseId, draft.id, true);
        await executeCommand(command.id, p);
        const after = await workbench(process.env.CLEARDUE_OWNER_ID, caseId);
        console.log(
          `Command ${command.id}: ${after.commands[0].state}; invoice total ${after.case.invoice.totalPence} pence.`,
        );
        if (after.commands[0].state !== 'SUCCEEDED' || after.case.invoice.totalPence !== 100000)
          throw new Error(
            'Contract correction did not verify. Reconcile; never blindly repeat this stage.',
          );
      }
    }
    const final = await readProjection(p, id);
    await mkdir('.local', { recursive: true });
    await writeFile(
      '.local/paypal-observation.json',
      JSON.stringify(
        { observedAt: new Date().toISOString(), provenance: p.provenance, invoice: final.invoice },
        null,
        2,
      ),
    );
    console.log(
      `Observed project invoice: ${final.invoice.payment}, total ${final.invoice.totalPence} pence. Hosted buyer link ${final.invoice.paymentUrl ? 'saved privately in the observation' : 'not supplied in a supported form'}.`,
    );
    console.log(
      'Buyer must personally complete the corresponding hosted sandbox invoice payment. Run read again to verify; do not record an offline payment or create a separate checkout. Webhook verification needs authorized HTTPS setup.',
    );
  }
} finally {
  await closeQueue();
  await closeDb();
}

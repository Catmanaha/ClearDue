import { queue, closeQueue } from '../src/server/queue';
import { closeDb, db } from '../src/server/db';
import {
  executeCommand,
  runInvestigation,
  reconcileCase,
  recoverCommands,
} from '../src/server/workflow';
import { cases } from '../src/server/schema';
import { and, eq, sql } from 'drizzle-orm';
import { config } from '../src/server/config';
const boss = await queue();
await boss.work<{ caseId: string; actorId: string }>(
  'investigate',
  { pollingIntervalSeconds: 1 },
  async (jobs) => {
    for (const j of jobs) await runInvestigation(j.data.actorId, j.data.caseId);
  },
);
await boss.work<{ commandId: string }>('execute', { pollingIntervalSeconds: 1 }, async (jobs) => {
  for (const j of jobs) await executeCommand(j.data.commandId);
});
await boss.work<{ caseId?: string; actorId?: string; sweep?: boolean }>(
  'reconcile',
  { pollingIntervalSeconds: 1 },
  async (jobs) => {
    for (const j of jobs) {
      if (j.data.caseId && j.data.actorId) await reconcileCase(j.data.actorId, j.data.caseId);
      else if (j.data.sweep) {
        await recoverCommands();
        const rows = await db()
          .select()
          .from(cases)
          .where(
            and(
              eq(cases.environment, config().mode),
              eq(cases.merchant, config().merchant),
              sql`${cases.updatedAt} < now() - interval '10 minutes'`,
              sql`${cases.createdAt} > now() - interval '7 days'`,
              sql`${cases.state} NOT IN ('MANUAL_REVIEW','UNSUPPORTED')`,
            ),
          )
          .limit(10);
        for (const c of rows) await boss.send('reconcile', { caseId: c.id, actorId: c.ownerId });
      }
    }
  },
);
await boss.schedule('reconcile', '*/5 * * * *', { sweep: true });
console.log(
  'ClearDue worker ready. Durable investigation, execution and bounded reconciliation enabled.',
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await closeQueue();
    await closeDb();
    process.exit(0);
  });

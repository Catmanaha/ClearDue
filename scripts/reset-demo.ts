import { sql } from 'drizzle-orm';
import { config } from '../src/server/config';
import { db, closeDb } from '../src/server/db';
import { seed } from '../src/server/seed';
if (config().mode !== 'demo' || process.env.RESET_DEMO_DATA !== 'true')
  throw new Error(
    'Reset disabled. Only explicit RESET_DEMO_DATA=true with PAYMENT_MODE=demo may delete this project’s synthetic demo cases.',
  );
try {
  await db().transaction(async (tx) => {
    await tx.execute(
      sql`DELETE FROM pgboss.job WHERE data->>'caseId' IN (SELECT id FROM cases WHERE environment='demo' AND merchant='studio@cleardue.example') OR data->>'commandId' IN (SELECT id FROM commands WHERE environment='demo' AND merchant='studio@cleardue.example')`,
    );
    await tx.execute(
      sql`DELETE FROM customer_feedback WHERE grant_id IN (SELECT id FROM customer_grants WHERE case_id IN (SELECT id FROM cases WHERE environment='demo' AND merchant='studio@cleardue.example'))`,
    );
    for (const table of [
      'customer_grants',
      'audit',
      'commands',
      'proposals',
      'investigations',
      'snapshots',
      'evidence',
    ] as const)
      await tx.execute(
        sql`DELETE FROM ${sql.identifier(table)} WHERE case_id IN (SELECT id FROM cases WHERE environment='demo' AND merchant='studio@cleardue.example')`,
      );
    await tx.execute(sql`DELETE FROM webhook_inbox WHERE merchant='studio@cleardue.example'`);
    await tx.execute(
      sql`DELETE FROM cases WHERE environment='demo' AND merchant='studio@cleardue.example'`,
    );
  });
  await seed();
  console.log('Synthetic demo cases reset. Sandbox records and authentication were preserved.');
} finally {
  await closeDb();
}

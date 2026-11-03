import { demoRaw, fixtures, demoMerchant } from '../domain/fixtures';
import { projectInvoice } from '../domain/invoice';
import { config } from './config';
import { db } from './db';
import { cases, evidence } from './schema';
export async function seed(ownerId = 'demo-owner') {
  if (config().mode !== 'demo')
    throw new Error('Seed is restricted to the isolated demo environment.');
  await db().transaction(async (tx) => {
    const { sql } = await import('drizzle-orm');
    if (ownerId === 'demo-owner')
      await tx.execute(
        sql`INSERT INTO "user"(id,name,email,"emailVerified") VALUES('demo-owner','Demo owner','owner@cleardue.example',true) ON CONFLICT DO NOTHING`,
      );
    for (const f of fixtures().slice(0, 6)) {
      const raw = demoRaw(`DEMO-100${f.id.slice(-1)}`);
      const invoice = projectInvoice(raw, demoMerchant, 'demo');
      await tx
        .insert(cases)
        .values({
          id: f.id,
          ownerId,
          merchant: demoMerchant,
          environment: 'demo',
          invoiceId: invoice.id,
          customer: f.customer,
          title: f.title,
          kind: f.kind,
          providerInvoice: raw,
          invoice,
        })
        .onConflictDoNothing();
      for (const doc of f.docs) await tx.insert(evidence).values(doc).onConflictDoNothing();
    }
  });
  console.log('Synthetic demo seed is present. Existing case progress was preserved.');
}

import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, pool, closeDb } from '../../src/server/db';
import { queue, closeQueue } from '../../src/server/queue';
import { seed } from '../../src/server/seed';
import {
  approve,
  requestInvestigation,
  runInvestigation,
  executeCommand,
  reconcileCase,
  workbench,
  addEvidence,
  createGrant,
  customerView,
  getCase,
  recoverCommands,
  clarificationGrant,
} from '../../src/server/workflow';
import { DemoProvider } from '../../src/server/providers';
import { commands, proposals, cases, evidence, grants, webhooks } from '../../src/server/schema';
import { demoRaw, demoMerchant, fixtures } from '../../src/domain/fixtures';
import { projectInvoice } from '../../src/domain/invoice';
import { persistVerifiedWebhook, ingestWebhook } from '../../src/server/webhooks';
import { requireOwner } from '../../src/server/auth';
import { auth } from '../../src/server/auth';
import { provisionOwner } from '../../src/server/provision-owner';
import { reserveBudget } from '../../src/server/investigator';
import { createIntakeCase } from '../../src/server/intake';
if (existsSync('.env')) process.loadEnvFile('.env');
const testUrl = process.env.TEST_DATABASE_URL;
if (
  !testUrl ||
  !new URL(testUrl).pathname.endsWith('/cleardue_test') ||
  process.env.ALLOW_TEST_DATABASE_RESET !== 'true'
)
  throw new Error(
    'Not run: configure dedicated TEST_DATABASE_URL ending /cleardue_test and ALLOW_TEST_DATABASE_RESET=true. Tests clear only that database.',
  );
process.env.DATABASE_URL = testUrl;
process.env.PAYMENT_MODE = 'demo';
process.env.AI_MODE = 'fixture';
process.env.AI_PROVIDER = 'openai';
process.env.LOCAL_DEMO_ACCESS = 'true';
async function draft(id = 'case-1') {
  await runInvestigation('demo-owner', id);
  const data = await workbench('demo-owner', id);
  return data.proposals[0];
}
beforeAll(async () => {
  await pool().query(
    'DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public',
  );
  await pool().query(
    'CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const file of readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await pool().query(readFileSync(`migrations/${file}`, 'utf8'));
    await pool().query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
  }
  await queue();
});
beforeEach(async () => {
  await pool().query('TRUNCATE cases CASCADE');
  await pool().query('DELETE FROM pgboss.job');
  await seed();
});
afterAll(async () => {
  await closeQueue();
  await closeDb();
});
describe('real PostgreSQL transactional safety', () => {
  it('concurrent retries save one case and roll back competing records', async () => {
    const key = randomUUID();
    const input = {
      requestId: key,
      customer: 'Receipt race',
      title: 'One saved case',
      documents: fixtures()[0].docs.map(({ label, kind, text }) => ({ label, kind, text })),
    };
    const before = Number((await pool().query('SELECT count(*) FROM cases')).rows[0].count);
    const beforeDocs = Number((await pool().query('SELECT count(*) FROM evidence')).rows[0].count);
    const blocker = await pool().connect();
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE intake_receipts IN SHARE MODE');
    const pending = [createIntakeCase('demo-owner', input), createIntakeCase('demo-owner', input)];
    let results: Awaited<ReturnType<typeof createIntakeCase>>[] = [];
    try {
      await expect
        .poll(
          async () =>
            Number(
              (
                await pool().query(
                  `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'insert into "intake_receipts"%'`,
                )
              ).rows[0].count,
            ),
          { timeout: 5000, interval: 25 },
        )
        .toBe(2);
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
      results = await Promise.all(pending);
    }
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    expect(Number((await pool().query('SELECT count(*) FROM cases')).rows[0].count)).toBe(
      before + 1,
    );
    expect(Number((await pool().query('SELECT count(*) FROM evidence')).rows[0].count)).toBe(
      beforeDocs + input.documents.length,
    );
    expect(Number((await pool().query('SELECT count(*) FROM intake_receipts')).rows[0].count)).toBe(
      1,
    );
    expect(await createIntakeCase('demo-owner', input)).toEqual({
      id: results[0].id,
      replayed: true,
    });
    await expect(
      createIntakeCase('demo-owner', { ...input, title: 'Different intent' }),
    ).rejects.toMatchObject({ code: 'INTAKE_CONFLICT', status: 409 });
    const otherActor = `intake-${randomUUID()}`;
    await pool().query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [
      otherActor,
      'Other synthetic owner',
      `${otherActor}@cleardue.example`,
    ]);
    const other = await createIntakeCase(otherActor, input);
    expect(other.id).not.toBe(results[0].id);
  });
  it('exhausted automatic recovery stops polling and blocks dependent corrections', async () => {
    const p = await draft();
    const command = await approve('demo-owner', 'case-1', p.id, true);
    await db()
      .update(commands)
      .set({ state: 'UNKNOWN_OUTCOME', attempts: 3, updatedAt: new Date(Date.now() - 180000) })
      .where(eq(commands.id, command.id));
    await recoverCommands();
    await recoverCommands();
    const [result] = await db().select().from(commands);
    expect(result.state).toBe('MANUAL_REVIEW');
    expect((await getCase('demo-owner', 'case-1')).state).toBe('MANUAL_REVIEW');
    expect(
      Number(
        (await pool().query("SELECT count(*) FROM pgboss.job WHERE name='reconcile'")).rows[0]
          .count,
      ),
    ).toBe(0);
  });
  it('concurrent model budget reservations cannot exceed the configured daily call limit', async () => {
    const names = [
      'OPENAI_API_KEY',
      'OPENAI_MODEL',
      'LIVE_AI_ENABLED',
      'LIVE_AI_DAILY_CALL_LIMIT',
      'LIVE_AI_DAILY_TOKEN_LIMIT',
      'LIVE_AI_MAX_OUTPUT_TOKENS',
    ] as const;
    const prior = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    Object.assign(process.env, {
      OPENAI_API_KEY: 'fake-no-network-key',
      OPENAI_MODEL: 'test-no-network-model',
      LIVE_AI_ENABLED: 'true',
      LIVE_AI_DAILY_CALL_LIMIT: '1',
      LIVE_AI_DAILY_TOKEN_LIMIT: '2000',
      LIVE_AI_MAX_OUTPUT_TOKENS: '100',
    });
    try {
      await pool().query('DELETE FROM ai_budget');
      const results = await Promise.allSettled([reserveBudget(100), reserveBudget(100)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await pool().query('SELECT calls,tokens FROM ai_budget')).rows[0]).toMatchObject({
        calls: 1,
        tokens: 200,
      });
    } finally {
      for (const n of names) {
        if (prior[n] === undefined) delete process.env[n];
        else process.env[n] = prior[n];
      }
    }
  });
  it('clarification is explicit, invoice-bound and creates no command', async () => {
    const data = await workbench('demo-owner', 'case-1');
    const g = await clarificationGrant(
      'demo-owner',
      'case-1',
      'Please supply any later approval so we can clarify the extra.',
      data.case.invoice.fingerprint,
      data.evidenceHash,
      true,
    );
    const token = new URL(g.url).hash.slice(1);
    expect((await customerView(token)).totalPence).toBe(125000);
    expect(await db().select().from(commands)).toHaveLength(0);
    const changed = {
      ...data.case.invoice,
      writable: {
        ...data.case.invoice.writable,
        detail: { ...data.case.invoice.writable.detail, reference: 'CHANGED' },
      },
    };
    await db().update(cases).set({ invoice: changed }).where(eq(cases.id, 'case-1'));
    await expect(customerView(token)).rejects.toThrow('changed');
  });
  it('rolls back command, approval and queue job together', async () => {
    const p = await draft();
    await expect(approve('demo-owner', 'case-1', p.id, true, true)).rejects.toThrow('rollback');
    expect(await db().select().from(commands)).toHaveLength(0);
    expect((await db().select().from(proposals).where(eq(proposals.id, p.id)))[0].state).toBe(
      'DRAFT',
    );
    expect(
      Number(
        (await pool().query("SELECT count(*) FROM pgboss.job WHERE name='execute'")).rows[0].count,
      ),
    ).toBe(0);
  });
  it('concurrent duplicate approvals return the same unique command/job', async () => {
    const p = await draft();
    const results = await Promise.all([
      approve('demo-owner', 'case-1', p.id, true),
      approve('demo-owner', 'case-1', p.id, true),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(await db().select().from(commands)).toHaveLength(1);
    expect(
      Number(
        (await pool().query("SELECT count(*) FROM pgboss.job WHERE name='execute'")).rows[0].count,
      ),
    ).toBe(1);
  });
  it('retires an unapproved draft as soon as a new investigation is queued', async () => {
    const earlier = await draft();
    await requestInvestigation('demo-owner', 'case-1');
    await expect(approve('demo-owner', 'case-1', earlier.id, true)).rejects.toMatchObject({
      code: 'INVESTIGATION_CHANGED',
    });
    expect(await db().select().from(commands)).toHaveLength(0);
    expect((await pool().query("SELECT 1 FROM pgboss.job WHERE name='execute'")).rowCount).toBe(0);

    const current = await draft();
    const approved = await approve('demo-owner', 'case-1', current.id, true);
    await requestInvestigation('demo-owner', 'case-1');
    expect((await approve('demo-owner', 'case-1', current.id, true)).id).toBe(approved.id);
    expect((await pool().query("SELECT 1 FROM pgboss.job WHERE name='execute'")).rowCount).toBe(1);
  });
  it('rejects a persisted earlier draft when the latest investigation failed', async () => {
    const earlier = await draft();
    vi.stubEnv('AI_MODE', 'live');
    vi.stubEnv('LIVE_AI_ENABLED', 'false');
    try {
      await runInvestigation('demo-owner', 'case-1');
    } finally {
      vi.unstubAllEnvs();
    }
    const data = await workbench('demo-owner', 'case-1');
    expect(data.runs[0].status).toBe('FAILED');
    expect(data.proposals[0]).toMatchObject({ id: earlier.id, state: 'DRAFT' });
    await expect(approve('demo-owner', 'case-1', earlier.id, true)).rejects.toMatchObject({
      code: 'INVESTIGATION_CHANGED',
    });
    expect(await db().select().from(commands)).toHaveLength(0);
    expect((await pool().query("SELECT 1 FROM pgboss.job WHERE name='execute'")).rowCount).toBe(0);
  });
  it('executes once on concurrent redelivery and persists after reopening the pool', async () => {
    const p = await draft();
    const command = await approve('demo-owner', 'case-1', p.id, true);
    const provider = new DemoProvider();
    let writes = 0;
    const injected = {
      provenance: 'simulated' as const,
      read: provider.read.bind(provider),
      update: async (...args: Parameters<DemoProvider['update']>) => {
        writes++;
        await provider.update(...args);
      },
    };
    await Promise.all([executeCommand(command.id, injected), executeCommand(command.id, injected)]);
    expect(writes).toBe(1);
    await closeDb();
    const data = await workbench('demo-owner', 'case-1');
    expect(data.case.invoice.totalPence).toBe(100000);
    expect(data.commands[0].state).toBe('SUCCEEDED');
  });
  it('new evidence invalidates a draft and an already approved queued command', async () => {
    const p = await draft();
    const command = await approve('demo-owner', 'case-1', p.id, true);
    await addEvidence('demo-owner', 'case-1', {
      label: 'Later approval',
      kind: 'message',
      text: 'I approve the additional social-media pack for GBP 250.',
    });
    await executeCommand(command.id);
    expect((await db().select().from(commands))[0].state).toBe('STALE');
    expect((await getCase('demo-owner', 'case-1')).invoice.totalPence).toBe(125000);
  });
  it('fresh external invoice edits invalidate approval before write', async () => {
    const p = await draft();
    const command = await approve('demo-owner', 'case-1', p.id, true);
    const raw = demoRaw('DEMO-1001');
    raw.detail.note = 'External change';
    await db().update(cases).set({ providerInvoice: raw }).where(eq(cases.id, 'case-1'));
    await executeCommand(command.id);
    expect((await db().select().from(commands))[0].state).toBe('STALE');
  });
  it('possible successful write times out, reconciles and never rewrites', async () => {
    const p = await draft();
    const command = await approve('demo-owner', 'case-1', p.id, true);
    const provider = new DemoProvider();
    let writes = 0;
    await executeCommand(command.id, {
      provenance: 'simulated',
      read: provider.read.bind(provider),
      update: async (id, after) => {
        writes++;
        await provider.update(id, after);
        throw new Error('network timeout after write');
      },
    });
    expect((await db().select().from(commands))[0].state).toBe('UNKNOWN_OUTCOME');
    await executeCommand(command.id);
    expect(writes).toBe(1);
    await reconcileCase('demo-owner', 'case-1');
    expect((await db().select().from(commands))[0].state).toBe('SUCCEEDED');
  });
  it('does not report success when readback loses a compatibility invariant', async () => {
    const raw = { ...demoRaw('DEMO-1001'), unilateral: false };
    await db()
      .update(cases)
      .set({
        providerInvoice: raw,
        invoice: projectInvoice(raw, demoMerchant, 'demo'),
      })
      .where(eq(cases.id, 'case-1'));
    const p = await draft();
    const command = await approve('demo-owner', 'case-1', p.id, true);
    // DemoProvider deliberately rebuilds its response without the legacy flag.
    await executeCommand(command.id);
    expect((await db().select().from(commands))[0].state).toBe('MANUAL_REVIEW');
  });
  it.each([false, true])(
    'accepts an added due-on-receipt date, response lost=%s',
    async (lostResponse) => {
      const p = await draft();
      const command = await approve('demo-owner', 'case-1', p.id, true);
      const provider = new DemoProvider();
      await executeCommand(command.id, {
        provenance: 'simulated',
        read: provider.read.bind(provider),
        update: async (id, after) => {
          await provider.update(id, after);
          const updated = (await provider.read(id)) as ReturnType<typeof demoRaw>;
          await db()
            .update(cases)
            .set({
              providerInvoice: {
                ...updated,
                detail: {
                  ...updated.detail,
                  payment_term: {
                    ...updated.detail.payment_term,
                    due_date: updated.detail.invoice_date,
                  },
                },
              },
            })
            .where(eq(cases.id, 'case-1'));
          if (lostResponse) throw new Error('response lost after successful write');
        },
      });
      if (lostResponse) {
        expect((await db().select().from(commands))[0].state).toBe('UNKNOWN_OUTCOME');
        await reconcileCase('demo-owner', 'case-1');
      }
      expect((await db().select().from(commands))[0].state).toBe('SUCCEEDED');
      await expect(createGrant('demo-owner', 'case-1')).resolves.toBeTruthy();
    },
  );
  it('reconciles compatibility against the immutable approved snapshot after a later observation', async () => {
    const raw = { ...demoRaw('DEMO-1001'), unilateral: false };
    await db()
      .update(cases)
      .set({
        providerInvoice: raw,
        invoice: projectInvoice(raw, demoMerchant, 'demo'),
      })
      .where(eq(cases.id, 'case-1'));
    const p = await draft();
    const command = await approve('demo-owner', 'case-1', p.id, true);
    const provider = new DemoProvider();
    await executeCommand(command.id, {
      provenance: 'simulated',
      read: provider.read.bind(provider),
      update: async (id, after) => {
        await provider.update(id, after);
        throw new Error('response lost after accepted write');
      },
    });
    expect((await db().select().from(commands))[0].state).toBe('UNKNOWN_OUTCOME');
    const after = await provider.read('DEMO-1001');
    await db()
      .update(cases)
      .set({ invoice: projectInvoice(after, demoMerchant, 'demo') })
      .where(eq(cases.id, 'case-1'));
    await reconcileCase('demo-owner', 'case-1');
    expect((await db().select().from(commands))[0].state).toBe('MANUAL_REVIEW');
  });
  it('unknown outcome that does not match intent requires manual review', async () => {
    const p = await draft();
    const command = await approve('demo-owner', 'case-1', p.id, true);
    const provider = new DemoProvider();
    await executeCommand(command.id, {
      provenance: 'simulated',
      read: provider.read.bind(provider),
      update: async () => {
        throw new Error('timeout');
      },
    });
    await reconcileCase('demo-owner', 'case-1');
    expect((await db().select().from(commands))[0].state).toBe('MANUAL_REVIEW');
  });
  it('stale RUNNING after a crash goes to reconciliation, not write retry', async () => {
    const p = await draft();
    const command = await approve('demo-owner', 'case-1', p.id, true);
    await db()
      .update(commands)
      .set({ state: 'RUNNING', updatedAt: new Date(Date.now() - 180000) })
      .where(eq(commands.id, command.id));
    await recoverCommands();
    expect((await db().select().from(commands))[0].state).toBe('UNKNOWN_OUTCOME');
    expect(
      Number(
        (await pool().query("SELECT count(*) FROM pgboss.job WHERE name='reconcile'")).rows[0]
          .count,
      ),
    ).toBe(1);
  });
  it('database invoice serialization rejects an independent second unresolved command', async () => {
    const p = await draft();
    const first = await approve('demo-owner', 'case-1', p.id, true);
    const { createdAt: _created, ...copy } = p;
    void _created;
    const [second] = await db()
      .insert(proposals)
      .values({ ...copy, id: randomUUID(), version: 2 })
      .returning();
    await expect(approve('demo-owner', 'case-1', second.id, true)).rejects.toThrow(
      'earlier command',
    );
    await expect(
      db()
        .insert(commands)
        .values({ ...first, id: randomUUID(), proposalId: second.id }),
    ).rejects.toThrow();
  });
  it('owner/case and cross-case citations are scoped', async () => {
    await expect(getCase('other-owner', 'case-1')).rejects.toThrow('not found');
    const p = await draft();
    await expect(approve('demo-owner', 'case-2', p.id, true)).rejects.toThrow('not found');
    const doc = (await db().select().from(evidence).where(eq(evidence.caseId, 'case-2')))[0];
    expect(doc.caseId).toBe('case-2');
  });
  it('customer projection excludes internal data; expired/revoked tokens fail', async () => {
    const p = await draft();
    const c = await approve('demo-owner', 'case-1', p.id, true);
    await executeCommand(c.id);
    const grant = await createGrant('demo-owner', 'case-1');
    const token = new URL(grant.url).hash.slice(1);
    const view = await customerView(token);
    expect(view.totalPence).toBe(100000);
    expect(view).not.toHaveProperty('docs');
    expect(view).not.toHaveProperty('commands');
    expect(view).not.toHaveProperty('ownerId');
    await db()
      .update(cases)
      .set({ updatedAt: new Date(Date.now() + 60000) })
      .where(eq(cases.id, 'case-1'));
    expect((await customerView(token)).observedAt).toEqual(view.observedAt);
    await db()
      .update(grants)
      .set({ expiresAt: new Date(0) })
      .where(eq(grants.id, grant.id));
    await expect(customerView(token)).rejects.toThrow('expired');
    await db()
      .update(grants)
      .set({ expiresAt: new Date(Date.now() + 60000), revokedAt: new Date() })
      .where(eq(grants.id, grant.id));
    await expect(customerView(token)).rejects.toThrow('expired');
  });
  it('verified duplicate/out-of-order inbox events enqueue reads and never declare payment', async () => {
    const event = {
      id: 'evt-1',
      event_type: 'INVOICING.INVOICE.PAID',
      resource: { invoice: { id: 'DEMO-1001', status: 'PAID' } },
    };
    expect(await persistVerifiedWebhook(event)).toEqual({ accepted: true });
    expect(await persistVerifiedWebhook(event)).toEqual({ duplicate: true });
    await persistVerifiedWebhook({
      ...event,
      id: 'evt-older',
      event_type: 'INVOICING.INVOICE.UPDATED',
    });
    expect(await db().select().from(webhooks)).toHaveLength(2);
    expect(
      Number(
        (await pool().query("SELECT count(*) FROM pgboss.job WHERE name='reconcile'")).rows[0]
          .count,
      ),
    ).toBe(2);
    expect((await getCase('demo-owner', 'case-1')).invoice.payment).toBe('UNPAID');
    await reconcileCase('demo-owner', 'case-1');
    expect((await getCase('demo-owner', 'case-1')).invoice.payment).toBe('UNPAID');
    await expect(ingestWebhook(new Headers(), JSON.stringify(event))).rejects.toThrow('disabled');
  });
  it('rejects malformed invoice envelopes before creating an inbox entry or job', async () => {
    const priorInbox = await db().select().from(webhooks);
    for (const resource of [
      { id: 'DEMO-1001' },
      { invoice: {} },
      { invoice: { id: '' } },
      { invoice: { id: 123 } },
    ]) {
      await expect(
        persistVerifiedWebhook({
          id: 'bad-envelope',
          event_type: 'INVOICING.INVOICE.CREATED',
          resource,
        }),
      ).rejects.toThrow();
    }
    expect(await db().select().from(webhooks)).toEqual(priorInbox);
    expect(
      Number(
        (await pool().query("SELECT count(*) FROM pgboss.job WHERE name='reconcile'")).rows[0]
          .count,
      ),
    ).toBe(0);
  });
  it('uses only the nested invoice identity and scopes it to the configured merchant and environment', async () => {
    const priorInbox = await db().select().from(webhooks);
    const event = {
      id: 'scoped-envelope',
      event_type: 'INVOICING.INVOICE.CREATED',
      resource: { invoice: { id: 'DEMO-1001' } },
    };
    expect(
      await persistVerifiedWebhook({
        ...event,
        resource: { id: 'DEMO-1001', invoice: { id: 'OTHER-INVOICE' } },
      }),
    ).toEqual({ ignored: true });
    await db().update(cases).set({ merchant: 'another-merchant' }).where(eq(cases.id, 'case-1'));
    expect(await persistVerifiedWebhook(event)).toEqual({ ignored: true });
    await db()
      .update(cases)
      .set({ merchant: demoMerchant, environment: 'sandbox' })
      .where(eq(cases.id, 'case-1'));
    expect(await persistVerifiedWebhook(event)).toEqual({ ignored: true });
    expect(await db().select().from(webhooks)).toEqual(priorInbox);
    expect(
      Number(
        (await pool().query("SELECT count(*) FROM pgboss.job WHERE name='reconcile'")).rows[0]
          .count,
      ),
    ).toBe(0);
  });
  it('demo bypass rejects a non-loopback Host', async () => {
    await expect(requireOwner(new Headers({ host: 'evil.example' }))).rejects.toThrow();
  });
  it('real Better Auth sessions persist and public signup is disabled', async () => {
    const prior = {
      secret: process.env.BETTER_AUTH_SECRET,
      emails: process.env.OWNER_EMAILS,
      demo: process.env.LOCAL_DEMO_ACCESS,
    };
    process.env.BETTER_AUTH_SECRET = 'test-only-' + randomUUID() + randomUUID();
    process.env.OWNER_EMAILS = 'judge@cleardue.example';
    process.env.LOCAL_DEMO_ACCESS = 'false';
    try {
      const account = await provisionOwner(
        'judge@cleardue.example',
        'synthetic-test-password-2026',
      );
      const response = await auth().api.signInEmail({
        body: { email: 'judge@cleardue.example', password: 'synthetic-test-password-2026' },
        asResponse: true,
      });
      expect(response.ok).toBe(true);
      const cookies = response.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
      const actor = await requireOwner(new Headers({ host: '127.0.0.1:3000', cookie: cookies }));
      expect(actor.id).toBe(account.user.id);
      expect(
        Number(
          (await pool().query('SELECT count(*) FROM session WHERE "userId"=$1', [actor.id])).rows[0]
            .count,
        ),
      ).toBe(1);
      const signup = await auth().handler(
        new Request('http://127.0.0.1:3000/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3000' },
          body: JSON.stringify({
            email: 'outsider@cleardue.example',
            password: 'synthetic-password',
            name: 'Outsider',
          }),
        }),
      );
      expect(signup.ok).toBe(false);
    } finally {
      process.env.BETTER_AUTH_SECRET = prior.secret ?? '';
      process.env.OWNER_EMAILS = prior.emails ?? '';
      process.env.LOCAL_DEMO_ACCESS = prior.demo ?? '';
    }
  });
});

it('analytics marks new evidence as outdated and does not reuse success after a newer failed run', async () => {
  const { analytics } = await import('../../src/server/analytics');
  const { investigations } = await import('../../src/server/schema');
  await runInvestigation('demo-owner', 'case-2');
  let row = (await analytics('demo-owner')).rows.find((r) => r.id === 'case-2')!;
  expect(row.findingCurrent).toBe(true);
  expect(row.needsEvidence).toBe(false);
  await addEvidence('demo-owner', 'case-2', {
    label: 'New question',
    kind: 'message',
    text: 'Please clarify the approved scope.',
  });
  row = (await analytics('demo-owner')).rows.find((r) => r.id === 'case-2')!;
  expect(row.findingCurrent).toBe(false);
  expect(row.needsEvidence).toBe(true);
  await runInvestigation('demo-owner', 'case-2');
  const latest = (await workbench('demo-owner', 'case-2')).runs[0];
  await db()
    .update(investigations)
    .set({ status: 'FAILED', result: null })
    .where(eq(investigations.id, latest.id));
  row = (await analytics('demo-owner')).rows.find((r) => r.id === 'case-2')!;
  expect(row.issue).toBe('NOT_INVESTIGATED');
  expect(row.citations).toHaveLength(0);
  expect(row.needsEvidence).toBe(true);
  expect(row.explanation).toContain('latest investigation failed');
  expect((await analytics('unrelated-owner')).rows).toHaveLength(0);
});

it('analytics preserves scoped, separate totals with 200 cases and retained history', async () => {
  const { analytics } = await import('../../src/server/analytics');
  const { snapshots, investigations } = await import('../../src/server/schema');
  const { dashboardTotals } = await import('../../src/domain/dashboard');
  const { hash } = await import('../../src/domain/core');
  const baselineCount = (await analytics('demo-owner')).rows.length;
  const samples = Array.from({ length: 200 }, (_, index) => {
    const raw = demoRaw(`DEMO-SCALE-${index}`);
    return { id: randomUUID(), raw, invoice: projectInvoice(raw, demoMerchant, 'demo') };
  });
  await db()
    .insert(cases)
    .values(
      samples.map(({ id, raw, invoice }) => ({
        id,
        ownerId: 'demo-owner',
        merchant: demoMerchant,
        environment: 'demo' as const,
        invoiceId: invoice.id,
        customer: 'Synthetic scale check',
        title: 'Synthetic scope question',
        kind: fixtures()[0].kind,
        providerInvoice: raw,
        invoice,
      })),
    );
  await db()
    .insert(snapshots)
    .values(
      samples.flatMap(({ id, raw, invoice }) =>
        Array.from({ length: 8 }, () => ({
          id: randomUUID(),
          caseId: id,
          raw,
          projection: invoice,
          fingerprint: invoice.fingerprint,
          provenance: 'demo',
        })),
      ),
    );
  await db()
    .insert(investigations)
    .values(
      samples.flatMap(({ id, invoice }) =>
        Array.from({ length: 4 }, (_, version) => ({
          id: randomUUID(),
          caseId: id,
          invoiceHash: invoice.fingerprint,
          evidenceHash: hash([]),
          status: 'FAILED',
          provenance: 'demo',
          promptVersion: 'synthetic-scale-check',
          createdAt: new Date(Date.UTC(2026, 9, 1, version)),
        })),
      ),
    );
  await db()
    .insert(evidence)
    .values(
      samples.flatMap(({ id }) =>
        Array.from({ length: 4 }, () => ({
          id: randomUUID(),
          caseId: id,
          version: 1,
          label: 'Supplied scope',
          kind: 'message' as const,
          text: 'Synthetic supplied scope record.',
          hash: hash('Synthetic supplied scope record.'),
        })),
      ),
    );
  const timings: number[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const start = performance.now();
    const result = await analytics('demo-owner');
    timings.push(Math.round(performance.now() - start));
    expect(result.rows).toHaveLength(baselineCount + samples.length);
    const scaled = result.rows.filter((row) => row.customer === 'Synthetic scale check');
    expect(scaled).toHaveLength(200);
    expect(scaled.every((row) => row.issue === 'NOT_INVESTIGATED' && row.needsEvidence)).toBe(true);
    expect(dashboardTotals(scaled)).toEqual({
      cases: 200,
      paidPence: 0,
      removedPence: 0,
      duePence: 25000000,
    });
  }
  expect((await analytics('unrelated-owner')).rows).toHaveLength(0);
  mkdirSync('.local', { recursive: true });
  writeFileSync(
    '.local/analytics-scale-check.json',
    JSON.stringify(
      {
        synthetic: true,
        cases: 200,
        snapshots: 1600,
        investigations: 800,
        records: 800,
        timingsMs: timings,
        medianMs: [...timings].sort((a, b) => a - b)[2],
        note: 'Local disposable PostgreSQL; no before/after speedup or production-load claim.',
      },
      null,
      2,
    ),
  );
});

it('analytics pairs verified correction with its own approval and never substitutes case progress for payment observation', async () => {
  const { analytics } = await import('../../src/server/analytics');
  const { audit } = await import('../../src/server/schema');
  const proposal = await draft();
  const command = await approve('demo-owner', 'case-1', proposal.id, true);
  await executeCommand(command.id);
  const before = (await analytics('demo-owner')).rows.find((row) => row.id === 'case-1')!;
  expect(before.trail.approvedAt).not.toBeNull();
  expect(before.trail.correctedAt).not.toBeNull();
  const unrelatedTime = new Date(Date.now() + 60000);
  await db()
    .insert(audit)
    .values({
      id: randomUUID(),
      caseId: 'case-1',
      actorId: 'demo-owner',
      event: 'APPROVED',
      data: { commandId: 'different-command' },
      createdAt: unrelatedTime,
    });
  await db().update(cases).set({ updatedAt: unrelatedTime }).where(eq(cases.id, 'case-1'));
  const after = (await analytics('demo-owner')).rows.find((row) => row.id === 'case-1')!;
  expect(after.trail.approvedAt).toBe(before.trail.approvedAt);
  expect(after.trail.correctedAt).toBe(before.trail.correctedAt);
  expect(after.trail.observedAt).toBe(before.trail.observedAt);
  expect(after.paidPence).toBe(0);
  expect(after.removedPence).toBe(25000);
});

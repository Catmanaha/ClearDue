import { and, eq, desc, inArray } from 'drizzle-orm';
import { db } from './db';
import * as s from './schema';
import { listCases } from './workflow';
import { defaultView, viewSchema } from '../domain/dashboard';
import { pence } from '../domain/core';
import { evidenceFingerprint } from '../domain/evidence';
function groupByCase<T extends { caseId: string | null }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (row.caseId === null) continue;
    const group = groups.get(row.caseId);
    if (group) group.push(row);
    else groups.set(row.caseId, [row]);
  }
  return groups;
}
export async function analytics(actor: string) {
  const rows = await listCases(actor);
  const ids = rows.map((r) => r.id);
  const [runs, commands, snapshots, records, events] = ids.length
    ? await Promise.all([
        db()
          .selectDistinctOn([s.investigations.caseId])
          .from(s.investigations)
          .where(inArray(s.investigations.caseId, ids))
          .orderBy(
            s.investigations.caseId,
            desc(s.investigations.createdAt),
            desc(s.investigations.id),
          ),
        db()
          .select()
          .from(s.commands)
          .where(and(inArray(s.commands.caseId, ids), eq(s.commands.state, 'SUCCEEDED'))),
        db()
          .select({
            caseId: s.snapshots.caseId,
            fingerprint: s.snapshots.fingerprint,
            projection: s.snapshots.projection,
            createdAt: s.snapshots.createdAt,
          })
          .from(s.snapshots)
          .where(inArray(s.snapshots.caseId, ids)),
        db()
          .select({
            id: s.evidence.id,
            caseId: s.evidence.caseId,
            version: s.evidence.version,
            hash: s.evidence.hash,
          })
          .from(s.evidence)
          .where(inArray(s.evidence.caseId, ids)),
        db()
          .select({
            caseId: s.audit.caseId,
            event: s.audit.event,
            createdAt: s.audit.createdAt,
            data: s.audit.data,
          })
          .from(s.audit)
          .where(
            and(
              inArray(s.audit.caseId, ids),
              inArray(s.audit.event, ['APPROVED', 'COMMAND_SUCCEEDED']),
            ),
          )
          .orderBy(desc(s.audit.createdAt)),
      ])
    : [[], [], [], [], []];
  const [saved] = await db().select().from(s.dashboard).where(eq(s.dashboard.ownerId, actor));
  const latestRuns = new Map(runs.map((run) => [run.caseId, run]));
  const caseCommands = groupByCase(commands);
  const caseSnapshots = groupByCase(snapshots);
  const caseRecords = groupByCase(records);
  const caseEvents = groupByCase(events);
  return {
    view: viewSchema.safeParse(saved?.state).success ? viewSchema.parse(saved?.state) : defaultView,
    rows: rows.map((c) => {
      const latest = latestRuns.get(c.id);
      const commands = caseCommands.get(c.id) ?? [];
      const snapshots = caseSnapshots.get(c.id) ?? [];
      const events = caseEvents.get(c.id) ?? [];
      const finding = latest?.status === 'SUCCEEDED' ? latest.result : null;
      const findingCurrent = Boolean(
        finding && latest?.evidenceHash === evidenceFingerprint(caseRecords.get(c.id) ?? []),
      );
      const observed = snapshots
        .filter(
          (snapshot) =>
            snapshot.caseId === c.id &&
            snapshot.fingerprint === c.invoice.fingerprint &&
            snapshot.projection.payment === c.invoice.payment &&
            snapshot.projection.paidPence === c.invoice.paidPence &&
            snapshot.projection.duePence === c.invoice.duePence,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const commandId = (data: unknown) =>
        data &&
        typeof data === 'object' &&
        'commandId' in data &&
        typeof data.commandId === 'string'
          ? data.commandId
          : null;
      const verified = commands
        .filter((command) => command.caseId === c.id)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
      const approval = events.find(
        (event) =>
          event.caseId === c.id &&
          event.event === 'APPROVED' &&
          (!verified || commandId(event.data) === verified.id),
      );
      const approvedReductions = commands
        .filter((command) => command.caseId === c.id && command.operation.type === 'REMOVE_ITEM')
        .reduce((sum, command) => {
          const before = snapshots.find(
            (snap) => snap.caseId === c.id && snap.fingerprint === command.beforeHash,
          )?.projection;
          const afterTotal = command.intendedAfter.items.reduce(
            (n, i) => n + Number(i.quantity) * pence(i.unit_amount.value),
            0,
          );
          return sum + (before ? Math.max(0, before.totalPence - afterTotal) : 0);
        }, 0);
      return {
        id: c.id,
        customer: c.customer,
        title: c.title,
        kind: c.kind,
        state: c.state,
        findingCurrent,
        needsEvidence:
          c.state !== 'RESOLVED' &&
          (!findingCurrent || Boolean(finding?.missing.length || finding?.reviewReasons.length)),
        issue: finding?.issue ?? 'NOT_INVESTIGATED',
        explanation:
          finding?.explanation ??
          (latest?.status === 'FAILED'
            ? 'The latest investigation failed. Review the records and investigate again.'
            : latest
              ? 'Investigation is pending.'
              : 'Investigation has not run.'),
        findingId: finding ? (latest?.id ?? null) : null,
        findingProvenance: finding ? (latest?.provenance ?? null) : null,
        citations: finding?.citations ?? [],
        trail: {
          investigatedAt: latest?.status === 'SUCCEEDED' ? latest.createdAt.toISOString() : null,
          approvedAt: approval?.createdAt.toISOString() ?? null,
          correctedAt: verified?.updatedAt.toISOString() ?? null,
          observedAt: observed?.createdAt.toISOString() ?? null,
        },
        totalPence: c.invoice.totalPence,
        duePence: c.invoice.duePence,
        paidPence: c.invoice.payment === 'PAID' ? c.invoice.paidPence : 0,
        removedPence: approvedReductions,
        payment: c.invoice.payment,
        environment: c.environment,
        createdAt: c.createdAt.toISOString(),
      };
    }),
  };
}
export type AnalyticsData = Awaited<ReturnType<typeof analytics>>;

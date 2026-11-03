import { headers } from 'next/headers';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { requireWorkspaceAccess } from '@/server/auth';
import { listCases } from '@/server/workflow';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { feedback, grants } from '@/server/schema';
import { Shell, SetupRequired } from '@/components/ui';
import { CaseQueue } from '@/components/case-queue';
import { pageData, requestTimestamp } from '@/server/page-data';
import { hash } from '@/domain/core';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const result = await pageData(async () => {
    const c = config();
    const actor = await requireWorkspaceAccess(await headers());
    const rows = await listCases(actor.id);
    const replies =
      rows.length && !actor.readOnly
        ? await db()
            .select({ caseId: grants.caseId, count: sql<number>`count(*)::int` })
            .from(feedback)
            .innerJoin(grants, eq(grants.id, feedback.grantId))
            .where(
              and(
                inArray(
                  grants.caseId,
                  rows.map((row) => row.id),
                ),
                isNull(feedback.reviewedAt),
              ),
            )
            .groupBy(grants.caseId)
        : [];
    const pendingReplies = Object.fromEntries(replies.map(({ caseId, count }) => [caseId, count]));
    return {
      c,
      rows: rows.map((row) => ({ ...row, pendingReplies: pendingReplies[row.id] ?? 0 })),
      readOnly: actor.readOnly,
      now: requestTimestamp(),
      draftScope: hash([actor.id, c.merchant, c.mode]),
    };
  });
  if (result.error)
    return <SetupRequired message={result.error} signInRequired={result.signInRequired} />;
  const { c, rows, now, draftScope, readOnly } = result.data!;
  return (
    <Shell mode={c.mode} ai={c.ai} readOnly={readOnly}>
      <CaseQueue
        key={draftScope}
        initial={rows}
        mode={c.mode}
        now={now}
        draftScope={draftScope}
        readOnly={readOnly}
      />
    </Shell>
  );
}

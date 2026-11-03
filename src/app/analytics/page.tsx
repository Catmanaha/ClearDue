import { pageData } from '@/server/page-data';
import { headers } from 'next/headers';
import { requireWorkspaceAccess } from '@/server/auth';
import { analytics } from '@/server/analytics';
import { config } from '@/server/config';
import { Shell, SetupRequired } from '@/components/ui';
import { Analytics } from '@/components/analytics';
export const dynamic = 'force-dynamic';
export default async function AnalyticsPage() {
  const result = await pageData(async () => {
    const actor = await requireWorkspaceAccess(await headers());
    return { c: config(), data: await analytics(actor.id), readOnly: actor.readOnly };
  });
  if (result.error)
    return <SetupRequired message={result.error} signInRequired={result.signInRequired} />;
  const { c, data, readOnly } = result.data!;
  return (
    <Shell active="analytics" mode={c.mode} ai={c.ai} readOnly={readOnly}>
      <Analytics
        initial={data}
        studioEnabled={c.studioEnabled}
        studioKey={c.studioKey}
        live={c.ai === 'live' && !readOnly}
        readOnly={readOnly}
      />
    </Shell>
  );
}

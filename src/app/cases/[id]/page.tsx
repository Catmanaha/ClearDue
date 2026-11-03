import { headers } from 'next/headers';
import { requireWorkspaceAccess } from '@/server/auth';
import { workbench } from '@/server/workflow';
import { config } from '@/server/config';
import { Shell, SetupRequired } from '@/components/ui';
import { Workbench } from '@/components/workbench';
import { pageData } from '@/server/page-data';
export const dynamic = 'force-dynamic';
export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    source?: string | string[];
    finding?: string | string[];
    quote?: string | string[];
  }>;
}) {
  const result = await pageData(async () => {
    const actor = await requireWorkspaceAccess(await headers());
    return {
      data: await workbench(actor.id, (await params).id),
      c: config(),
      readOnly: actor.readOnly,
    };
  });
  if (result.error)
    return <SetupRequired message={result.error} signInRequired={result.signInRequired} />;
  const { c, data, readOnly } = result.data!;
  const { source, finding, quote } = await searchParams;
  const doc = data.docs.find((record) => record.id === source);
  const run = data.runs.find((saved) => saved.id === finding && saved.status === 'SUCCEEDED');
  const citation =
    typeof quote === 'string' && /^(?:[0-9]|1[01])$/.test(quote)
      ? run?.result?.citations[Number(quote)]
      : undefined;
  const initialCitation =
    doc &&
    citation?.documentId === doc.id &&
    citation.version === doc.version &&
    doc.text.slice(citation.start, citation.start + citation.quote.length) === citation.quote
      ? citation
      : undefined;
  return (
    <Shell mode={c.mode} ai={c.ai} readOnly={readOnly}>
      <Workbench
        key={JSON.stringify([data.case.id, doc?.id, initialCitation ? [finding, quote] : null])}
        initial={data}
        initialSourceId={doc?.id}
        initialCitation={initialCitation}
        citationUnavailable={Boolean(finding || quote) && !initialCitation}
        readOnly={readOnly}
      />
    </Shell>
  );
}

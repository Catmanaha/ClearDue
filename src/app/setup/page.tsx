import { pageData } from '@/server/page-data';
import { headers } from 'next/headers';
import { requireWorkspaceAccess } from '@/server/auth';
import { config } from '@/server/config';
import { Shell, SetupRequired } from '@/components/ui';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export default async function Setup() {
  const result = await pageData(async () => {
    const actor = await requireWorkspaceAccess(await headers());
    return { c: config(), readOnly: actor.readOnly };
  });
  if (result.error)
    return <SetupRequired message={result.error} signInRequired={result.signInRequired} />;
  const { c, readOnly } = result.data!;
  return (
    <Shell mode={c.mode} ai={c.ai} active="setup" readOnly={readOnly}>
      <div className="page-heading">
        <div>
          <h1>Connections</h1>
          <p>Understand how this workspace checks records and handles invoices.</p>
        </div>
      </div>
      <div className="connection-overview">
        <section>
          <h2>Invoices and payments</h2>
          <div>
            <strong>{c.mode === 'demo' ? 'Demo · no real money' : 'PayPal test mode'}</strong>
            <p>
              {c.mode === 'demo'
                ? 'Invoices and payments are simulated. Use this workspace to explore the steps without taking money.'
                : 'This workspace uses PayPal’s sandbox with test funds. Every invoice correction needs your explicit approval. Customers pay on PayPal.'}
            </p>
          </div>
        </section>
        <section>
          <h2>Record analysis</h2>
          <div>
            <strong>
              {c.ai === 'fixture' ? 'Example analysis · no AI' : 'AI analysis selected'}
            </strong>
            <p>
              {c.ai === 'fixture'
                ? 'Results follow fixed examples. They show how the review process works and are labelled as examples.'
                : 'Availability and usage limits are checked when you request analysis. Supplied case records are shared with the configured AI service. If analysis cannot run, you will see an error.'}
            </p>
            {c.ai === 'live' && (
              <p>Selecting AI does not confirm that its connection is working.</p>
            )}
          </div>
        </section>
        <section>
          <h2>Case dashboard</h2>
          <div>
            <strong>
              {c.studioEnabled ? 'Interactive dashboard selected' : 'Standard dashboard'}
            </strong>
            <p>
              Browse cases, follow their sources and compare payments, reductions and outstanding
              amounts. Dashboard changes never approve an invoice correction.
            </p>
            {c.studioEnabled && (
              <p>
                {c.studioKey
                  ? 'A dashboard licence has been added. Check its expiry and permitted use before sharing this app.'
                  : 'AG Studio unlicensed evaluation. A licence is needed before sharing this dashboard.'}
              </p>
            )}
          </div>
        </section>
        <section>
          <h2>Workspace access</h2>
          <div>
            <strong>{c.demoAccess ? 'Local demo access' : 'Approved users only'}</strong>
            {c.demoAccess && (
              <p>This local demo can be opened without signing in. Use example records only.</p>
            )}
            <p>
              Customers see only the invoice and explanation shared with them. Internal case records
              stay in the workspace.
            </p>
          </div>
        </section>
      </div>
      <div className="connection-help">
        <h2>Need help with a connection?</h2>
        <p>
          Ask the person who set up this workspace to check it. The technical details below can help
          them. Never share passwords, access keys or private customer links.
        </p>
        <Link href="/" className="button secondary">
          Back to cases
        </Link>
      </div>
      <details className="connection-technical">
        <summary>Technical details for workspace administrators</summary>
        <p>
          Configuration is not a connection test. These instructions do not confirm that analysis,
          background processing or PayPal is available.
        </p>
        <div className="setup-grid">
          <section className="sheet">
            <h2>Local workspace</h2>
            <p>
              Uses PostgreSQL, a separate durable worker and deterministic providers. Simulated
              payments stay labeled.
            </p>
            <ul>
              <li>
                <code>docker compose up -d db</code>
              </li>
              <li>
                <code>pnpm db:migrate</code> then <code>pnpm db:seed</code>
              </li>
              <li>
                Run <code>pnpm dev</code> and <code>pnpm worker</code>
              </li>
            </ul>
          </section>
          <section className="sheet">
            <h2>PayPal sandbox</h2>
            <p>
              {c.mode === 'sandbox'
                ? 'Sandbox mode configured. Actual flow still needs contract verification.'
                : 'Disabled. No sandbox payment flow is claimed.'}
            </p>
            <ul>
              <li>Configure project seller/client credentials, merchant ID and buyer email.</li>
              <li>
                Set test/write flags deliberately and allowlist only project-created invoice IDs.
              </li>
              <li>
                Run the guarded contract harness; use the actual hosted invoice for buyer payment.
              </li>
              <li>Configure a real HTTPS webhook and webhook ID for delivery verification.</li>
            </ul>
          </section>
          <section className="sheet">
            <h2>Evidence & live AI</h2>
            <p>
              {c.ai === 'fixture'
                ? 'Fixture rules active. These results do not use a live model.'
                : 'Live mode selected; each request still checks credentials and limits.'}
            </p>
            <ul>
              <li>Configure a credential and model for the selected AI provider.</li>
              <li>
                Set <code>LIVE_AI_ENABLED</code> and choose daily call/token limits plus output
                limit.
              </li>
              <li>Live analysis sends the complete supported bundle to the configured provider.</li>
              <li>Daily reservations are persistent. No silent mock fallback.</li>
            </ul>
          </section>
          <section className="sheet">
            <h2>Studio, judge access & hosting</h2>
            <p>
              {c.studioEnabled
                ? 'Studio enabled; verify licence/domain/AI expiry coverage.'
                : 'Studio disabled; local analytics fallback active.'}
            </p>
            <ul>
              <li>Configure AG Studio access and client licence according to vendor terms.</li>
              <li>Confirm AI and deployed-domain coverage through the actual judging period.</li>
              <li>
                Configure Better Auth secret and restricted owner/judge emails. Public signup stays
                disabled.
              </li>
              <li>
                Render configuration is preparation only. Deployment needs permission and funded
                service/DB lifetime.
              </li>
            </ul>
          </section>
        </div>
      </details>
    </Shell>
  );
}

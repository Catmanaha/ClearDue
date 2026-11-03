'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ChevronRight,
  FileText,
  Link2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { money } from '@/lib/format';
import { Notice, Status } from './ui';
import type { workbench } from '@/server/workflow';
import type { Evidence, Finding } from '@/domain/evidence';
import { historyCopy } from '@/lib/case-history';
import { importSchema } from '@/domain/import';
type Data = Awaited<ReturnType<typeof workbench>>;
export function Workbench({
  initial,
  initialSourceId,
  initialCitation,
  citationUnavailable = false,
  readOnly = false,
}: {
  initial: Data;
  initialSourceId?: string;
  initialCitation?: Finding['citations'][number];
  citationUnavailable?: boolean;
  readOnly?: boolean;
}) {
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState(
    initial.docs.find((doc) => doc.id === initialSourceId)?.id ?? initial.docs[0]?.id ?? '',
  );
  const [citation, setCitation] = useState<Finding['citations'][number] | null>(
    initialCitation ?? null,
  );
  const [pending, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const busy = pending || needsReload;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pollUntil, setPollUntil] = useState(0);
  const [adding, setAdding] = useState(false);
  const [customerUrl, setCustomerUrl] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [clarifying, setClarifying] = useState(false);
  const caseId = data.case.id;
  const c = data.case;
  const run = data.runs[0];
  const finding = run?.status === 'SUCCEEDED' ? run.result : null;
  const evidenceChanged = Boolean(run && run.evidenceHash !== data.evidenceHash);
  const proposal =
    c.state !== 'INVESTIGATING' && run?.status === 'SUCCEEDED'
      ? data.proposals.find((p) => p.state === 'DRAFT' && p.investigationId === run.id)
      : undefined;
  const doc = data.docs.find((d) => d.id === selected);
  const command = data.commands[0];
  useEffect(() => {
    if (initialCitation) document.getElementById('source-text')?.focus();
  }, [initialCitation]);
  async function reload() {
    const r = await fetch(`/api/cases/${caseId}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const value = await r.json();
    if (!r.ok) throw new Error(value.error);
    setData(value);
    setNeedsReload(false);
  }
  useEffect(() => {
    if (!pollUntil) return;
    const interval = setInterval(() => {
      if (Date.now() > pollUntil) {
        clearInterval(interval);
        return;
      }
      fetch(`/api/cases/${caseId}`, { cache: 'no-store' })
        .then(async (r) => {
          if (r.ok) setData(await r.json());
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(interval);
  }, [caseId, pollUntil]);
  async function action(input: Record<string, unknown>) {
    if (busy || readOnly) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch(`/api/cases/${caseId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30000),
      });
      const value = await r.json();
      if (!r.ok) {
        if (r.status >= 500) setNeedsReload(true);
        throw new Error(value.error);
      }
      if (input.action === 'grant' || input.action === 'clarification-grant') {
        setCustomerUrl(value.url);
        setCopyStatus('');
      } else if (input.action === 'approve')
        setNotice('Approval saved. The invoice change has a separate status.');
      else if (input.action === 'investigate')
        setNotice('Investigation requested. You can return to this case at any time.');
      else if (input.action === 'refresh') setNotice('Invoice status check requested.');
      else if (input.action === 'review-feedback')
        setNotice('Customer reply marked reviewed. The invoice is unchanged.');
      else if (input.action === 'revoke') {
        setCustomerUrl('');
        setCopyStatus('');
        setNotice('Customer link revoked.');
      }
      if (input.action !== 'review-feedback') setPollUntil(Date.now() + 45000);
      try {
        await reload();
      } catch {
        setNeedsReload(true);
        setError(
          'Your action was accepted, but the latest case view could not load. Reload the saved case before taking another action.',
        );
      }
      return true;
    } catch (e) {
      if (
        e instanceof TypeError ||
        (e instanceof Error && ['SyntaxError', 'TimeoutError', 'AbortError'].includes(e.name))
      ) {
        setNeedsReload(true);
        setError(
          'The result could not be confirmed. Reload the saved case to check its current state before taking another action.',
        );
      } else setError(e instanceof Error ? e.message : 'This action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  function selectSource(cite: Finding['citations'][number]) {
    setSelected(cite.documentId);
    setCitation(cite);
    document.getElementById('source-text')?.focus();
  }
  return (
    <>
      <Link href="/" className="back-link">
        <ArrowLeft size={16} />
        All cases
      </Link>
      <div className="page-heading case-heading">
        <div>
          <div className="case-context">
            {c.customer}
            <ChevronRight size={14} />
            {c.invoice.number}
          </div>
          <h1>{c.title}</h1>
          <div className="heading-statuses">
            <Status value={c.state} />
            <Status value={c.invoice.payment} />
          </div>
        </div>
        {!readOnly && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => action({ action: 'refresh' })}
          >
            <RefreshCw />
            Refresh invoice status
          </button>
        )}
      </div>
      {readOnly && (
        <Notice>Read-only case. You can review saved findings and their sources.</Notice>
      )}
      {error && <Notice error>{error}</Notice>}
      {needsReload && (
        <button
          className="button secondary"
          disabled={pending}
          onClick={async () => {
            setBusy(true);
            try {
              await reload();
              setError('');
              setNotice('Saved case reloaded. Review its current state before continuing.');
            } catch {
              setError(
                'The saved case is still unavailable. Try loading it again when the connection returns.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Reload saved case
        </button>
      )}
      {notice && (
        <Notice>
          {notice.startsWith('Approved') && command?.state === 'SUCCEEDED'
            ? 'The approved correction is verified. Payment is tracked separately.'
            : notice}{' '}
          {['INVESTIGATING', 'RESOLVING'].includes(c.state) && (
            <>
              If this keeps waiting, check <Link href="/setup">Connections &amp; setup</Link>.
            </>
          )}
        </Notice>
      )}
      {!readOnly && customerUrl && (
        <Notice>
          <strong>Your customer link is ready.</strong>
          <p>Share it with {c.customer}. It expires in 48 hours and can be revoked below.</p>
          <div className="customer-link-actions">
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  if (!navigator.clipboard) throw new Error('Clipboard unavailable');
                  await navigator.clipboard.writeText(customerUrl);
                  setCopyStatus('Link copied. It is ready to share.');
                } catch {
                  setCopyStatus('Open the customer view and copy its address to share the link.');
                }
              }}
            >
              <Copy size={16} />
              Copy customer link
            </button>
            <a href={customerUrl} target="_blank" rel="noreferrer" className="customer-link">
              Open customer resolution <ArrowRight size={15} />
            </a>
          </div>
          {copyStatus && <p>{copyStatus}</p>}
        </Notice>
      )}
      {!readOnly && data.grants.some((g) => !g.revokedAt) && (
        <div className="grant-controls">
          {data.grants
            .filter((g) => !g.revokedAt)
            .map((g) => (
              <div className="grant-item" key={g.id}>
                <span>
                  Customer link · expires {new Date(g.expiresAt).toLocaleDateString('en-GB')}
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => action({ action: 'revoke', grantId: g.id })}
                >
                  Revoke customer link
                </button>
              </div>
            ))}
        </div>
      )}
      {!readOnly && data.customerFeedback.length > 0 && (
        <section
          id="customer-replies"
          className="sheet reply-panel"
          aria-labelledby="reply-heading"
        >
          <h2 id="reply-heading">Customer replies</h2>
          <p>Mark each reply reviewed after reading it. This only updates your case queue.</p>
          <ul>
            {data.customerFeedback.map((reply) => (
              <li key={reply.id}>
                <p>{reply.message}</p>
                <p className="fine-print">
                  Received{' '}
                  {new Date(reply.createdAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}{' '}
                  (London)
                </p>
                {reply.reviewedAt ? (
                  <span className="fine-print">Reviewed</span>
                ) : (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => action({ action: 'review-feedback', feedbackId: reply.id })}
                  >
                    Mark reply reviewed
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="workbench-grid">
        <section className="evidence-area">
          <div className="section-title">
            <h2>Start with the record.</h2>
            <span>
              {data.docs.length} {data.docs.length === 1 ? 'document' : 'documents'}
            </span>
          </div>
          {citationUnavailable && (
            <Notice>
              This saved quote could not be highlighted. Review the supplied records below.
            </Notice>
          )}
          <div className="source-workspace sheet">
            <div className="source-tabs" role="group" aria-label="Evidence documents">
              {data.docs.map((d) => (
                <button
                  key={d.id}
                  aria-pressed={selected === d.id}
                  onClick={() => {
                    setSelected(d.id);
                    setCitation(null);
                  }}
                >
                  {d.kind === 'message' ? <MessageSquare size={15} /> : <FileText size={15} />}
                  <span>{d.label}</span>
                </button>
              ))}
            </div>
            <div className="source-document">
              <div className="document-meta">
                <span>
                  {doc?.kind === 'agreement' ? 'Supplied agreement' : 'Supplied conversation'}
                </span>
                <span>Saved source · version {doc?.version}</span>
              </div>
              <h3>{doc?.label ?? 'No document selected'}</h3>
              <div id="source-text" tabIndex={-1} className="source-text">
                {doc && citation && citation.documentId === doc.id ? (
                  <>
                    {doc.text.slice(0, citation.start)}
                    <mark>
                      {doc.text.slice(citation.start, citation.start + citation.quote.length)}
                    </mark>
                    {doc.text.slice(citation.start + citation.quote.length)}
                  </>
                ) : (
                  doc?.text
                )}
              </div>
              <div className="document-foot">
                <ShieldCheck size={14} />
                Full text of the supplied record.
              </div>
            </div>
          </div>
          {!readOnly && (
            <>
              <div className="evidence-actions">
                <span>Missing a later approval or another message?</span>
                <button className="text-button" onClick={() => setAdding(!adding)}>
                  <Upload size={15} />
                  {adding ? 'Hide evidence draft' : 'Add evidence'}
                </button>
              </div>
              <div hidden={!adding}>
                <EvidenceImport
                  busy={busy}
                  onSubmit={async (document) => {
                    const saved = await action({ action: 'evidence', document });
                    if (saved) setAdding(false);
                    return saved;
                  }}
                />
              </div>
            </>
          )}
          <section className="finding-section">
            <div className="section-title">
              <h2>What the evidence suggests</h2>
              {run && (
                <span>
                  {run.provenance === 'fixture-rules' ? 'Example analysis · no AI' : 'AI analysis'}
                </span>
              )}
            </div>
            {run?.provenance === 'live-model' && (
              <details className="analysis-details">
                <summary>Technical analysis details</summary>
                <p>Model: {run.model ?? 'Not recorded'}</p>
              </details>
            )}
            {evidenceChanged && (
              <Notice>
                New evidence has been added since this investigation. The conclusion below belongs
                to the earlier records.
                {!readOnly && ' Investigate again to include the new material.'}
              </Notice>
            )}
            {!run || run.status === 'FAILED' ? (
              <div className="sheet finding-empty">
                <div className="finding-symbol">
                  <SearchIcon />
                </div>
                <h3>
                  {run?.status === 'FAILED'
                    ? 'This investigation needs another look.'
                    : 'Connect the dots before you act.'}
                </h3>
                <p>
                  {run?.status === 'FAILED'
                    ? 'The investigation could not be completed. Your records are still saved. Check Connections before requesting another analysis.'
                    : 'Compare all the supplied records with the invoice. Review the sources before approving a correction.'}
                </p>
                {!readOnly && (
                  <button
                    className="button"
                    disabled={busy || c.state === 'INVESTIGATING'}
                    onClick={() => action({ action: 'investigate' })}
                  >
                    {c.state === 'INVESTIGATING'
                      ? 'Investigation queued…'
                      : 'Investigate this case'}
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            ) : run.status === 'RUNNING' || c.state === 'INVESTIGATING' ? (
              <div className="sheet finding-empty">
                <p role="status">Examining the complete evidence bundle…</p>
                <p className="muted">
                  Your investigation is saved. You can return to this case later.
                </p>
              </div>
            ) : finding ? (
              <div className="sheet finding-result">
                <Status value={finding.issue} />
                <h3>
                  {finding.issue === 'QUESTIONED_CHARGE'
                    ? 'The extra needs a conversation.'
                    : finding.issue === 'NO_CHANGE'
                      ? 'The customer approved this extra.'
                      : finding.issue === 'MISSING_REFERENCE'
                        ? 'The reference is in the message.'
                        : 'Clarity comes before a correction.'}
                </h3>
                <p>{finding.explanation}</p>
                <div className="decision-guidance">
                  <strong>
                    {finding.issue === 'CONFLICT'
                      ? 'Conflicting instructions need clarification'
                      : finding.issue === 'CLAIMED_PAYMENT'
                        ? 'A payment claim needs an invoice check'
                        : finding.action.type === 'NONE'
                          ? 'Clarify before choosing a correction'
                          : 'A possible correction needs your review'}
                  </strong>
                  <p>
                    {finding.issue === 'CONFLICT'
                      ? 'Review both instructions and ask which applies. These records do not establish an approved correction.'
                      : finding.issue === 'CLAIMED_PAYMENT'
                        ? 'Compare the customer’s report with the current invoice status. A message does not verify payment.'
                        : finding.issue === 'NO_CHANGE'
                          ? 'Approval was found in the supplied records. Ask what the customer is questioning before changing the invoice.'
                          : 'Read the quoted sources and check that they support the explanation. Exact quotes alone do not establish the right conclusion.'}
                  </p>
                </div>
                <h4>Cited records</h4>
                {!finding.citations.length && (
                  <p className="muted">
                    No source excerpts were cited. Review the supplied records before deciding what
                    to do.
                  </p>
                )}
                <div className="citations">
                  {finding.citations.map((cite, i) => (
                    <button key={i} onClick={() => selectSource(cite)} className="citation">
                      <span className="citation-source">
                        <FileText size={14} />
                        {data.docs.find((d) => d.id === cite.documentId)?.label} · v{cite.version}
                        <ArrowRight size={14} />
                      </span>
                      <q>{cite.quote}</q>
                    </button>
                  ))}
                </div>
                {finding.missing.length > 0 && (
                  <div className="missing-info">
                    <strong>Information to find or clarify</strong>
                    {finding.missing.map((m, i) => (
                      <p key={i}>{m}</p>
                    ))}
                  </div>
                )}
                {finding.reviewReasons.length > 0 && <h4>Reasons for human review</h4>}
                {finding.reviewReasons.map((reason, i) => (
                  <Notice key={i}>{reason}</Notice>
                ))}
                {finding.action.type === 'NONE' && (
                  <p className="muted">
                    No automatic correction is proposed. Clarify the disagreement or supply more
                    evidence.
                  </p>
                )}
                {!readOnly && (
                  <>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => action({ action: 'investigate' })}
                    >
                      <RefreshCw size={14} />
                      Investigate again
                    </button>
                    <button
                      className="text-button clarification-button"
                      onClick={() => setClarifying(!clarifying)}
                    >
                      Prepare a clarification link <ArrowRight size={14} />
                    </button>
                  </>
                )}
              </div>
            ) : null}
            {!readOnly && clarifying && (
              <form
                className="sheet import-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  if (
                    await action({
                      action: 'clarification-grant',
                      explanation: f.get('explanation'),
                      reviewed: f.get('reviewed') === 'on',
                      invoiceHash: c.invoice.fingerprint,
                      evidenceHash: data.evidenceHash,
                    })
                  )
                    setClarifying(false);
                }}
              >
                <h3>Clarify before changing anything.</h3>
                <label>
                  Customer explanation
                  <textarea
                    name="explanation"
                    required
                    rows={4}
                    maxLength={1500}
                    placeholder="Ask for the missing approval or explain the supported reference. No invoice change will be made."
                  />
                </label>
                <label className="check-label">
                  <input name="reviewed" type="checkbox" required />
                  <span>
                    I reviewed this evidence and current invoice, and approve this explanation for
                    the customer.
                  </span>
                </label>
                <button className="button secondary" disabled={busy}>
                  Create approved clarification link
                </button>
              </form>
            )}
          </section>
          {data.runs.length > 1 && (
            <details className="previous-investigations">
              <summary>Earlier investigations ({data.runs.length - 1} shown)</summary>
              <p className="muted">
                Previous conclusions are retained for comparison. They may use earlier evidence or
                invoice details. Up to five recent investigations are available here.
              </p>
              {data.runs.slice(1).map((previous) => (
                <article key={previous.id}>
                  <h3>
                    {previous.status === 'SUCCEEDED'
                      ? 'Earlier conclusion'
                      : previous.status === 'FAILED'
                        ? 'Earlier investigation failed'
                        : 'Earlier investigation pending'}
                  </h3>
                  <p className="muted">
                    {new Date(previous.createdAt).toLocaleString('en-GB', {
                      timeZone: 'Europe/London',
                    })}{' '}
                    · London ·{' '}
                    {previous.provenance === 'fixture-rules' ? 'Fixture rules' : 'AI analysis'}
                  </p>
                  {previous.provenance === 'live-model' && (
                    <details className="analysis-details">
                      <summary>Technical analysis details</summary>
                      <p>Model: {previous.model ?? 'Not recorded'}</p>
                    </details>
                  )}
                  {previous.result && (
                    <>
                      <Status value={previous.result.issue} />
                      <p>{previous.result.explanation}</p>
                      {previous.result.citations.map((cite, index) => (
                        <button
                          type="button"
                          className="citation"
                          key={index}
                          onClick={() => selectSource(cite)}
                        >
                          <span className="citation-source">
                            {data.docs.find((source) => source.id === cite.documentId)?.label ??
                              'Earlier record'}{' '}
                            · v{cite.version}
                            <ArrowRight size={14} />
                          </span>
                          <q>{cite.quote}</q>
                        </button>
                      ))}
                    </>
                  )}
                </article>
              ))}
            </details>
          )}
        </section>
        <aside className="resolution-area">
          <section className="sheet invoice-panel">
            <div className="invoice-header">
              <h2>The current invoice</h2>
              <span>{c.invoice.number}</span>
            </div>
            <div className="invoice-lines">
              {c.invoice.lines.map((l) => (
                <div
                  key={l.id}
                  className={
                    proposal?.operation.type === 'REMOVE_ITEM' && proposal.operation.lineId === l.id
                      ? 'questioned-line'
                      : ''
                  }
                >
                  <span>
                    {l.name}
                    <small>
                      {l.quantity} × {money(l.unitPence)}
                    </small>
                  </span>
                  <strong>{money(l.totalPence)}</strong>
                </div>
              ))}
            </div>
            <div className="invoice-total">
              <span>Invoice total</span>
              <strong>{money(c.invoice.totalPence)}</strong>
            </div>
            <div className="invoice-detail">
              <span>Purchase order</span>
              <span>{c.invoice.reference ?? 'Not supplied'}</span>
            </div>
            <div className="invoice-detail">
              <span>Outstanding</span>
              <strong>{money(c.invoice.duePence)}</strong>
            </div>
            <p className="invoice-provenance">
              {c.environment === 'demo'
                ? 'Simulated invoice · no real funds'
                : 'PayPal sandbox observation'}
            </p>
            <p className="invoice-provenance">
              {data.invoiceObservation ? (
                <>
                  Status observed{' '}
                  {new Date(data.invoiceObservation.observedAt).toLocaleString('en-GB', {
                    timeZone: 'Europe/London',
                  })}{' '}
                  (London).
                </>
              ) : readOnly ? (
                'No saved invoice-status observation yet.'
              ) : (
                'No saved invoice-status observation yet. Refresh invoice status to check.'
              )}
            </p>
          </section>
          {proposal && (
            <ProposalReview
              key={proposal.id}
              proposal={proposal}
              data={data}
              busy={busy}
              action={action}
              readOnly={readOnly}
            />
          )}
          {command && (
            <section className="sheet command-panel">
              <h2>Correction activity</h2>
              <Status value={command.state} />
              {command.error && <p>{historyCopy(`COMMAND_${command.state}`).description}</p>}
              <p className="muted">
                Your approved correction stays on record. Payment is tracked separately.
              </p>
            </section>
          )}
          {c.state === 'RESOLVED' && (
            <section className="sheet outcome-panel">
              <span className="outcome-icon">
                <Check size={24} />
              </span>
              <h2>
                A clearer invoice.
                <br />A better next step.
              </h2>
              <p>
                The correction has been read back and verified{' '}
                {c.environment === 'demo'
                  ? 'using simulated invoice records'
                  : 'from PayPal sandbox'}
                .{' '}
                {c.invoice.payment === 'PAID'
                  ? 'Full payment is observed.'
                  : 'Payment remains outstanding.'}
              </p>
              {!readOnly && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => action({ action: 'grant' })}
                >
                  <Link2 size={16} />
                  Create customer link
                </button>
              )}
            </section>
          )}
          <div className="guardrail">
            <ShieldCheck size={18} />
            <p>
              Only an owner-approved correction can change this invoice. Payments are handled
              separately.
            </p>
          </div>
        </aside>
      </div>
      <section className="audit-section">
        <h2>Case history</h2>
        <p className="muted">
          Latest 20 recorded events, newest first. Times shown in London. Invoice payment is tracked
          separately from a correction.
        </p>
        {!data.audit.length ? (
          <p className="muted">Activity will appear here after investigation.</p>
        ) : (
          <ol>
            {data.audit.map((event) => (
              <li key={event.id}>
                <span className="audit-dot" />
                <div>
                  <strong>{historyCopy(event.event).title}</strong>
                  <p>{historyCopy(event.event).description}</p>
                </div>
                <time dateTime={new Date(event.createdAt).toISOString()}>
                  {new Date(event.createdAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
function SearchIcon() {
  return <FileText size={24} />;
}
function ProposalReview({
  proposal,
  data,
  busy,
  action,
  readOnly,
}: {
  proposal: Data['proposals'][number];
  data: Data;
  busy: boolean;
  action: (input: Record<string, unknown>) => Promise<boolean>;
  readOnly: boolean;
}) {
  const [explanation, setExplanation] = useState(proposal.explanation);
  const [reviewed, setReviewed] = useState(false);
  const [selected, setSelected] = useState(false);
  const line =
    proposal.operation.type === 'REMOVE_ITEM'
      ? data.case.invoice.lines.find(
          (l) => l.id === (proposal.operation as { lineId: string }).lineId,
        )
      : undefined;
  const after = data.case.invoice.totalPence - (line?.totalPence ?? 0);
  const changed = explanation !== proposal.explanation;
  return (
    <section className="sheet approval-panel">
      <div className="section-title">
        <h2>{readOnly ? 'Proposed correction' : 'Your decision'}</h2>
        <span>Proposal v{proposal.version}</span>
      </div>
      <p>
        {line
          ? 'Removing the questioned extra is one option. You can also clarify the charge or add missing approval evidence.'
          : 'The proposed reference comes directly from supplied evidence.'}
      </p>
      {line ? (
        <div className="before-after">
          <div>
            <span>Before</span>
            <strong>{money(data.case.invoice.totalPence)}</strong>
          </div>
          <ArrowRight size={18} />
          <div>
            <span>After removal</span>
            <strong>{money(after)}</strong>
          </div>
        </div>
      ) : (
        <div className="reference-change">
          <span>Verified reference</span>
          <strong>
            {proposal.operation.type === 'SET_REFERENCE' && proposal.operation.reference}
          </strong>
        </div>
      )}
      {readOnly ? (
        <>
          {line && (
            <p>
              Proposed removal: {line.name} ({money(line.totalPence)}).
            </p>
          )}
          <h3>Customer explanation</h3>
          <p>{proposal.explanation}</p>
          <p className="fine-print">Only the workspace owner can approve a correction.</p>
        </>
      ) : (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => setSelected(e.target.checked)}
            />
            <span>
              {line
                ? `I explicitly select “${line.name}” (${money(line.totalPence)}) for removal.`
                : 'I select this evidenced reference for the invoice.'}
            </span>
          </label>
          <label>
            Customer explanation
            <textarea
              rows={5}
              maxLength={1500}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
            />
          </label>
          {changed && (
            <>
              <Notice>Editing creates a new proposal version that needs fresh approval.</Notice>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => action({ action: 'revise', proposalId: proposal.id, explanation })}
              >
                Save revised proposal
              </button>
            </>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            <span>
              I reviewed the exact sources, missing information and before/after invoice, and
              support this correction.
            </span>
          </label>
          <button
            className="button approve-button"
            disabled={busy || !reviewed || !selected || changed}
            onClick={() =>
              action({ action: 'approve', proposalId: proposal.id, sourceSupportReviewed: true })
            }
          >
            <ShieldCheck size={17} />
            {busy ? 'Saving…' : 'Approve this correction'}
          </button>
          <p className="fine-print">
            ClearDue checks the invoice again before applying the correction. If the invoice or
            records have changed, a new review is required.
          </p>
        </>
      )}
    </section>
  );
}
function EvidenceImport({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (document: { label: string; text: string; kind: Evidence['kind'] }) => Promise<boolean>;
}) {
  const [label, setLabel] = useState('Customer message');
  const [kind, setKind] = useState<Evidence['kind']>('message');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="sheet import-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!importSchema.safeParse({ label, kind, text }).success) {
          setError(
            'Supply a record name and 1–16,000 characters of complete, nonblank text. Nothing was shortened.',
          );
          return;
        }
        if (await onSubmit({ label, kind, text })) {
          setText('');
          setError('');
        }
      }}
    >
      <fieldset className="intake-fields" disabled={busy}>
        <h3>Add a complete document</h3>
        <div className="form-row">
          <label>
            Source label
            <input
              required
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setError('');
              }}
              maxLength={100}
            />
          </label>
          <label>
            Source type
            <select value={kind} onChange={(e) => setKind(e.target.value as Evidence['kind'])}>
              <option value="message">Customer message</option>
              <option value="agreement">Agreement</option>
              <option value="note">Owner note</option>
            </select>
          </label>
        </div>
        <label>
          UTF-8 text or JSON document
          <input
            type="file"
            accept=".txt,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError('');
              try {
                if (file.size > 32000 || !/\.(txt|json)$/i.test(file.name))
                  throw new Error('Choose a UTF-8 .txt or .json file up to 32,000 bytes.');
                const value = new TextDecoder('utf-8', { fatal: true }).decode(
                  await file.arrayBuffer(),
                );
                if (/\.json$/i.test(file.name)) {
                  const parsed = JSON.parse(value);
                  if (!importSchema.safeParse(parsed).success)
                    throw new Error(
                      'JSON needs only label, kind and complete text fields; use a supported type and up to 16,000 characters.',
                    );
                  setText(parsed.text);
                  setLabel(parsed.label);
                  setKind(parsed.kind);
                } else {
                  if (!importSchema.safeParse({ label, kind, text: value }).success)
                    throw new Error(
                      'Use 1–16,000 characters of complete, nonblank text. Nothing was shortened.',
                    );
                  setText(value);
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : 'File could not be read.');
              }
            }}
          />
        </label>
        <label>
          Complete source text
          <textarea
            required
            rows={5}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
          />
        </label>
        <p className="fine-print">
          1–12 documents; 32,000-byte complete bundle limit including invoice. No documents are
          silently omitted.
        </p>
        {error && <Notice error>{error}</Notice>}
        <button className="button secondary" disabled={busy || !!error}>
          Save evidence & investigate
        </button>
      </fieldset>
    </form>
  );
}

'use client';
import { createContext, useContext, useState, useMemo, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowRight, FileText, PanelTop, RefreshCw } from 'lucide-react';
import type { AnalyticsData } from '@/server/analytics';
import {
  defaultView,
  viewSchema,
  matchesView,
  dashboardTotals,
  type DashboardView,
} from '@/domain/dashboard';
import { money } from '@/lib/format';
import { labels, Notice, Status } from './ui';
import { CaseExplorer, CaseTrail, findingSource } from './case-explorer';
const Studio = dynamic(() => import('./studio').then((m) => m.Studio), {
  ssr: false,
  loading: () => (
    <div className="empty" role="status">
      Loading AG Studio…
    </div>
  ),
});
export const AnalyticsContext = createContext<{
  rows: AnalyticsData['rows'];
  view: DashboardView;
  selectedId: string | null;
  selectCase: (id: string | null) => void;
}>({ rows: [], view: defaultView, selectedId: null, selectCase: () => {} });
export function Analytics({
  initial,
  studioEnabled,
  studioKey,
  live,
  readOnly = false,
}: {
  initial: AnalyticsData;
  studioEnabled: boolean;
  studioKey: string;
  live: boolean;
  readOnly?: boolean;
}) {
  const [data, setData] = useState(initial);
  const [selectedId, selectCase] = useState<string | null>(null);
  const [view, setView] = useState(initial.view);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const recoveryRequired = useRef(false);
  const requestPending = useRef(false);
  const rows = useMemo(
    () =>
      data.rows
        .filter((r) => matchesView(r, view.filter))
        .sort((a, b) =>
          view.sort === 'largest'
            ? b.duePence - a.duePence
            : view.sort === 'customer'
              ? a.customer.localeCompare(b.customer)
              : a.createdAt.localeCompare(b.createdAt),
        ),
    [data.rows, view],
  );
  const selectedCase = rows.find((row) => row.id === selectedId);
  const summaryRows = selectedCase ? [selectedCase] : rows;
  const summary = dashboardTotals(summaryRows);
  const applyView = useCallback(
    async (next: DashboardView) => {
      viewSchema.parse(next);
      if (readOnly) {
        setView(next);
        return;
      }
      if (recoveryRequired.current)
        throw new Error('Reload the saved dashboard view before making another change.');
      if (requestPending.current)
        throw new Error('Wait for the current dashboard request to finish.');
      requestPending.current = true;
      setSaving(true);
      setError('');
      setSaved('');
      let refused = false;
      try {
        const r = await fetch('/api/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
          signal: AbortSignal.timeout(15000),
        });
        const value = await r.json();
        if (!r.ok) {
          refused = r.status < 500;
          throw new Error(value.error);
        }
        setView(next);
        setSaved('Presentation saved. Invoice state is unchanged.');
      } catch (e) {
        let message =
          'This dashboard change could not be saved. Check the view controls and try again.';
        if (!refused) {
          recoveryRequired.current = true;
          setNeedsReload(true);
          message =
            'We could not confirm whether your dashboard view was saved. Reload the saved view before making another change. Invoice state is unchanged.';
        } else if (e instanceof Error) message = e.message;
        setError(message);
        throw new Error(message);
      } finally {
        requestPending.current = false;
        setSaving(false);
      }
    },
    [readOnly],
  );
  async function refreshView() {
    if (requestPending.current) return;
    requestPending.current = true;
    setRefreshing(true);
    setError('');
    try {
      const r = await fetch('/api/dashboard', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json();
      if (!r.ok)
        throw new Error('The saved dashboard view could not be loaded. Try loading it again.');
      const savedView = viewSchema.parse(d.view);
      setData(d);
      setView(savedView);
      recoveryRequired.current = false;
      setNeedsReload(false);
      setSaved('Saved dashboard view reloaded. Invoice state is unchanged.');
    } catch {
      setError(
        'The saved dashboard view could not be loaded. Your current view is still here. Try loading it again.',
      );
    } finally {
      requestPending.current = false;
      setRefreshing(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>See what’s holding things up.</h1>
          <p>Explore the evidence. Keep payment, concessions and balances distinct.</p>
        </div>
        {!readOnly && (
          <button
            className="button secondary"
            disabled={saving || refreshing}
            onClick={refreshView}
          >
            <RefreshCw />
            {refreshing
              ? 'Loading saved view…'
              : needsReload
                ? 'Reload saved view'
                : 'Refresh insights'}
          </button>
        )}
      </div>
      {readOnly && <Notice>Explore saved cases. View changes stay on this page.</Notice>}
      {error && <Notice error>{error}</Notice>}
      {saving ? <Notice>Saving your dashboard view…</Notice> : saved && <Notice>{saved}</Notice>}
      <fieldset
        className="analytics-controls"
        aria-label="Dashboard view"
        disabled={saving || refreshing || needsReload}
      >
        <label>
          Show
          <select
            value={view.filter}
            onChange={(e) =>
              applyView({ ...view, filter: e.target.value as DashboardView['filter'] }).catch((e) =>
                setError(e.message),
              )
            }
          >
            <option value="all">All cases</option>
            <option value="missing-reference">Missing references</option>
            <option value="questioned-charge">Questioned charges</option>
            <option value="manual-review">Manual review</option>
            <option value="needs-evidence">Needs evidence or clarification</option>
            <option value="confirmed-outcomes">Confirmed outcomes</option>
          </select>
        </label>
        <label>
          Sort
          <select
            value={view.sort}
            onChange={(e) =>
              applyView({ ...view, sort: e.target.value as DashboardView['sort'] }).catch((e) =>
                setError(e.message),
              )
            }
          >
            <option value="largest">Largest balances first</option>
            <option value="oldest">Oldest first</option>
            <option value="customer">Customer name</option>
          </select>
        </label>
        <label>
          Layout
          <select
            value={view.layout}
            onChange={(e) =>
              applyView({ ...view, layout: e.target.value as DashboardView['layout'] }).catch((e) =>
                setError(e.message),
              )
            }
          >
            <option value="evidence-first">Evidence first</option>
            <option value="outcomes-first">Outcomes first</option>
          </select>
        </label>
        <span>
          {rows.length} matching {rows.length === 1 ? 'case' : 'cases'}
        </span>
      </fieldset>
      <section className="analytics-overview" aria-label="Financial summary for the current view">
        <div className="analytics-overview-scope">
          <span>
            {selectedCase
              ? `Selected case: ${selectedCase.title}`
              : `${rows.length} matching ${rows.length === 1 ? 'case' : 'cases'}`}
          </span>
          {selectedCase && (
            <Link href={`/cases/${selectedCase.id}`} className="text-button">
              Open selected case <ArrowRight size={14} />
            </Link>
          )}
        </div>
        <dl>
          <div>
            <dt>Fully paid</dt>
            <dd>{money(summary.paidPence)}</dd>
          </div>
          <div>
            <dt>Approved reductions</dt>
            <dd>{money(summary.removedPence)}</dd>
          </div>
          <div>
            <dt>Still outstanding</dt>
            <dd>{money(summary.duePence)}</dd>
          </div>
        </dl>
        <p className="fine-print">
          {!summaryRows.length
            ? 'No cases match this view.'
            : summaryRows.every((r) => r.environment === 'demo')
              ? 'Simulated amounts. No real money.'
              : 'PayPal sandbox amounts. Test funds only.'}{' '}
          A reduction is not a payment.
        </p>
      </section>
      <AnalyticsContext.Provider
        value={{
          rows,
          view,
          selectedId: rows.some((row) => row.id === selectedId) ? selectedId : null,
          selectCase,
        }}
      >
        {studioEnabled ? (
          <>
            {!studioKey && (
              <Notice>
                AG Studio unlicensed evaluation. A licence is needed before sharing this dashboard.
              </Notice>
            )}
            {!readOnly && (
              <Notice>
                {live
                  ? 'Open Studio’s chat panel to change the dashboard with natural language.'
                  : 'AI chat is off. You can still use the view controls and open case records.'}
              </Notice>
            )}
            <Studio studioKey={studioKey} live={live && !readOnly} applyView={applyView} />
          </>
        ) : (
          <>
            <div className="fallback-label">
              <PanelTop size={18} />
              <span>Standard dashboard · the interactive Studio dashboard is turned off.</span>
            </div>
            <CaseExplorer />
            <div className={`analytics-fallback ${view.layout}`}>
              <section className="sheet evidence-widget">
                <EvidenceComparison />
              </section>
              <section className="sheet outcomes-widget">
                <ResolutionOutcomes />
              </section>
            </div>
            {!readOnly && (
              <Notice>
                AI dashboard chat is off. Use the view controls to explore cases and their sources.
              </Notice>
            )}
          </>
        )}
      </AnalyticsContext.Provider>
    </>
  );
}
export function EvidenceComparison() {
  const { rows, selectedId, selectCase } = useContext(AnalyticsContext);
  const shown = selectedId ? rows.filter((row) => row.id === selectedId) : rows;
  return (
    <div className="custom-widget">
      <h2>Evidence comparison</h2>
      <p className="muted">
        Agreement, messages and questioned lines in one view. Select a case in the grid to inspect
        its evidence and recorded outcome.
      </p>
      {selectedId && (
        <>
          <button className="text-button" onClick={() => selectCase(null)}>
            Show all matching evidence
          </button>
          <CaseTrail />
        </>
      )}
      {!rows.length ? (
        <p>No cases match this view.</p>
      ) : (
        (selectedId ? [] : shown).map((row) => (
          <article className="comparison-row" key={row.id}>
            <div className="comparison-title">
              <Link href={`/cases/${row.id}`}>
                {row.title}
                <ArrowRight size={14} />
              </Link>
              <Status value={row.issue} />
            </div>
            <p className="fine-print">
              {[row.customer, findingSource(row.findingProvenance)].filter(Boolean).join(' · ')}
            </p>
            <p>{row.explanation}</p>
            {!row.findingCurrent && row.citations.length > 0 && (
              <p className="fine-print">
                Earlier analysis: new evidence needs investigation before relying on this
                conclusion.
              </p>
            )}
            {row.citations.length > 0 ? (
              <blockquote>
                <FileText size={15} />
                <q>{row.citations[row.citations.length - 1].quote}</q>
                <small>
                  Exact excerpt · document v{row.citations[row.citations.length - 1].version}
                </small>
              </blockquote>
            ) : (
              <p className="fine-print">Run the case investigation to link source excerpts.</p>
            )}
            <div className="comparison-balance">
              Invoice {money(row.totalPence)} · outstanding {money(row.duePence)}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
export function ResolutionOutcomes() {
  const { rows: matchingRows, selectedId } = useContext(AnalyticsContext);
  const rows = selectedId ? matchingRows.filter((row) => row.id === selectedId) : matchingRows;
  const demo = rows.every((r) => r.environment === 'demo');
  const { paidPence: paid, removedPence: removed, duePence: due } = dashboardTotals(rows);
  const total = Math.max(paid + removed + due, 1);
  return (
    <div className="custom-widget">
      <h2>Resolution outcomes</h2>
      <p className="fine-print">
        {selectedId
          ? 'Selected case only. Clear the selection to compare all matching cases.'
          : 'Totals for all matching cases.'}
      </p>
      <p className="muted">
        {!rows.length
          ? 'No observations match this view.'
          : demo
            ? 'Simulated observations. No verified sandbox payments.'
            : 'Authoritative sandbox observations. No live funds.'}
      </p>
      <div
        className="outcomes-bar"
        aria-label={`Paid ${money(paid)}, removed ${money(removed)}, outstanding ${money(due)}`}
      >
        <span style={{ width: `${(paid / total) * 100}%` }} />
        <span style={{ width: `${(removed / total) * 100}%` }} />
        <span style={{ width: `${(due / total) * 100}%` }} />
      </div>
      <dl className="outcome-ledger">
        <div>
          <dt>
            <i className="legend paid" />
            {!rows.length ? 'Paid' : demo ? 'Simulated paid' : 'Verified full payments'}
          </dt>
          <dd>{money(paid)}</dd>
        </div>
        <div>
          <dt>
            <i className="legend removed" />
            Approved reductions
          </dt>
          <dd>{money(removed)}</dd>
        </div>
        <div>
          <dt>
            <i className="legend outstanding" />
            Outstanding balance
          </dt>
          <dd>{money(due)}</dd>
        </div>
      </dl>
      <p className="fine-print">
        A reduction is not a payment. Partially paid, pending and externally reported amounts are
        never included in full payments.
      </p>
      <h3>Cases in this view</h3>
      <p className="fine-print">
        Showing up to five cases in your selected order. Open a case to inspect its records and
        outcome.
      </p>
      {rows.slice(0, 5).map((row) => (
        <Link className="next-conversation" key={row.id} href={`/cases/${row.id}`}>
          <span>
            {row.title}
            <small>
              {row.customer} · {labels[row.issue] ?? row.issue}
            </small>
          </span>
          <strong>{money(row.duePence)}</strong>
          <ArrowRight size={15} />
        </Link>
      ))}
    </div>
  );
}

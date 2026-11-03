'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowDown, ArrowRight, FileText, Plus, Search, X } from 'lucide-react';
import { NewCase } from './new-case';
import { Status } from './ui';
import { money } from '@/lib/format';
import type { listCases } from '@/server/workflow';
import { useIntakeDraftStore } from './intake-draft';
type Row = Awaited<ReturnType<typeof listCases>>[number] & { pendingReplies: number };
export function CaseQueue({
  initial,
  mode,
  now,
  draftScope,
  readOnly = false,
}: {
  initial: Row[];
  mode: string;
  now: number;
  draftScope: string;
  readOnly?: boolean;
}) {
  const draftStore = useIntakeDraftStore();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('largest');
  const [creating, setCreating] = useState(() => !readOnly && Boolean(draftStore.read(draftScope)));
  const counterexample =
    mode === 'demo' && initial.find((row) => row.id === 'case-2' && row.kind === 'approved-extra');
  const rows = initial
    .filter(
      (r) =>
        `${r.customer} ${r.title} ${r.invoice.number}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === 'all' ||
          (filter === 'review'
            ? r.pendingReplies > 0 || ['REVIEW', 'MANUAL_REVIEW'].includes(r.state)
            : filter === 'customer-replies'
              ? r.pendingReplies > 0
              : r.invoice.payment === filter)),
    )
    .sort((a, b) =>
      sort === 'largest'
        ? b.invoice.duePence - a.invoice.duePence
        : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Make room for a resolution.</h1>
          <p>
            {readOnly
              ? 'Explore saved cases in this read-only workspace.'
              : 'Your open billing conversations, with a clear next step.'}
          </p>
        </div>
        {!readOnly && (
          <button
            className="button"
            aria-expanded={creating}
            aria-controls="case-intake"
            onClick={() => setCreating(!creating)}
          >
            {creating ? <X /> : <Plus />}
            {creating ? 'Hide draft' : 'New case'}
          </button>
        )}
      </div>
      {!readOnly && (
        <div id="case-intake" hidden={!creating}>
          <NewCase mode={mode} draftScope={draftScope} />
        </div>
      )}
      <div className="queue-summary">
        <span>
          <strong>{initial.length}</strong> {initial.length === 1 ? 'case' : 'cases'} in your
          workspace
        </span>
        <span>
          <strong>{money(initial.reduce((sum, r) => sum + r.invoice.duePence, 0))}</strong>{' '}
          outstanding {mode === 'demo' && <small>simulated</small>}
        </span>
        <span>
          <strong>{initial.filter((r) => r.state === 'RESOLVED').length}</strong> disagreements
          resolved
        </span>
      </div>
      <section className="sheet queue-sheet" aria-label="Case queue">
        <div className="queue-toolbar">
          <div className="tabs" aria-label="Filter cases">
            {[
              ['all', 'All cases'],
              ['review', 'Needs review'],
              ...(!readOnly ? [['customer-replies', 'Customer replies']] : []),
              ['UNPAID', 'Unpaid'],
              ['PAID', 'Paid'],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                className={filter === value ? 'selected' : ''}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={17} />
            <input
              placeholder="Find a case…"
              aria-label="Find a case"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Customer & conversation</th>
                <th>
                  <button
                    className="text-button"
                    onClick={() => setSort(sort === 'largest' ? 'oldest' : 'largest')}
                  >
                    Balance <ArrowDown size={13} />
                  </button>
                </th>
                <th>Case status</th>
                <th>Payment</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <div className="customer-cell">
                      <span className={`customer-monogram tone-${i % 4}`}>
                        {r.customer
                          .split(' ')
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join('')}
                      </span>
                      <div>
                        <Link href={`/cases/${r.id}`} className="customer-name">
                          {r.customer}
                        </Link>
                        <span className="cell-note">{r.title}</span>
                        <span className="case-id">
                          {r.evidenceCount} sources · {r.evidenceStatus}
                        </span>
                        <span className="case-id">
                          {r.invoice.number} ·{' '}
                          {Math.max(
                            0,
                            Math.floor((now - new Date(r.createdAt).getTime()) / 86400000),
                          )}{' '}
                          days in queue
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="money-cell">{money(r.invoice.duePence)}</td>
                  <td>
                    <Status value={r.state} />
                    {r.pendingReplies > 0 && (
                      <span className="cell-note">
                        {r.pendingReplies === 1
                          ? '1 new customer reply'
                          : `${r.pendingReplies} new customer replies`}
                      </span>
                    )}
                  </td>
                  <td>
                    <Status value={r.invoice.payment} />
                  </td>
                  <td>
                    <Link
                      className="next-action"
                      href={`/cases/${r.id}${r.pendingReplies ? '#customer-replies' : ''}`}
                    >
                      {readOnly
                        ? 'View case'
                        : r.pendingReplies
                          ? 'Read reply'
                          : r.state === 'NEW'
                            ? 'Investigate'
                            : r.state === 'RESOLVED'
                              ? 'View outcome'
                              : 'Review case'}
                      <ArrowRight size={16} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <div className="empty">
            <FileText />
            <h2>{initial.length ? 'No matching conversations.' : 'A clear queue starts here.'}</h2>
            <p>
              {initial.length
                ? 'Try another filter or search.'
                : readOnly
                  ? 'Saved cases will appear here.'
                  : 'Create a case with a complete agreement and customer conversation.'}
            </p>
          </div>
        )}
        <div className="table-caption">
          {rows.length} of {initial.length} {initial.length === 1 ? 'case' : 'cases'}
          <span>Payment and disagreement status are tracked separately.</span>
        </div>
      </section>
      <div className="queue-bottom">
        <FileText size={22} />
        <div>
          <h2>The reason matters.</h2>
          <p>
            Open a case to compare the agreement, customer messages and invoice. Nothing changes
            without your review.
          </p>
        </div>
        {counterexample && (
          <Link href={`/cases/${counterexample.id}`}>
            See an approval counterexample <ArrowRight size={16} />
          </Link>
        )}
      </div>
    </>
  );
}

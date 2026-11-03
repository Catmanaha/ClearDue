'use client';
import { useContext } from 'react';
import Link from 'next/link';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
} from 'ag-grid-community';
import { AnalyticsContext } from './analytics';
import type { AnalyticsData } from '@/server/analytics';
import { money } from '@/lib/format';
import { labels, Status } from './ui';

type Row = AnalyticsData['rows'][number];
const theme = themeQuartz.withParams({
  accentColor: '#224e3d',
  backgroundColor: '#ffffff',
  foregroundColor: '#20382f',
  borderColor: '#dce3dc',
  headerBackgroundColor: '#f7f8f5',
  selectedRowBackgroundColor: '#eee9f6',
  fontFamily: 'Segoe UI, Arial, sans-serif',
  fontSize: 13,
  rowHeight: 44,
});
function CaseTitle({ data }: ICellRendererParams<Row>) {
  const { selectedId, selectCase } = useContext(AnalyticsContext);
  return data ? (
    <button
      type="button"
      className="text-button grid-case-label"
      data-case-id={data.id}
      aria-pressed={data.id === selectedId}
      onClick={() => selectCase(data.id)}
    >
      <span title={data.title}>{data.title}</span>
      <small>{data.customer}</small>
    </button>
  ) : null;
}
function FindingLabel({ data, valueFormatted }: ICellRendererParams<Row>) {
  const source = data && findingSource(data.findingProvenance);
  return (
    <span className="grid-case-label">
      <span>{valueFormatted}</span>
      {source && <small>{source}</small>}
    </span>
  );
}
const columns: ColDef<Row>[] = [
  {
    field: 'title',
    headerName: 'Case',
    minWidth: 210,
    flex: 1,
    cellRenderer: CaseTitle,
  },
  {
    field: 'issue',
    headerName: 'Finding',
    minWidth: 150,
    flex: 1,
    valueFormatter: ({ value }) => labels[value] ?? value,
    cellRenderer: FindingLabel,
  },
  {
    field: 'duePence',
    headerName: 'Outstanding',
    width: 130,
    valueFormatter: ({ value }) => money(value ?? 0),
  },
  {
    field: 'payment',
    headerName: 'Payment',
    width: 120,
    valueFormatter: ({ value }) => labels[value] ?? value,
  },
];
export function findingSource(provenance: Row['findingProvenance']) {
  if (provenance === 'live-model') return 'AI analysis';
  if (provenance === 'fixture-rules') return 'Example analysis';
  return null;
}
export function CaseExplorer() {
  const { rows, selectedId, selectCase } = useContext(AnalyticsContext);
  const selected = rows.find((row) => row.id === selectedId);
  return (
    <section className="case-explorer" aria-label="Read-only case explorer">
      <h2>Follow a case from evidence to outcome.</h2>
      <p>
        Select a row, or focus a cell and press Enter, to inspect the record below. Grid sorting
        changes this view only.
      </p>
      <div style={{ height: 224, width: '100%' }}>
        <AgGridReact<Row>
          modules={[AllCommunityModule]}
          theme={theme}
          rowData={rows}
          columnDefs={columns}
          getRowId={({ data }) => data.id}
          defaultColDef={{ sortable: true, resizable: true, editable: false }}
          onRowClicked={({ data }) => data && selectCase(data.id)}
          onCellKeyDown={({ data, event }) => {
            if (data && (event as KeyboardEvent | undefined)?.key === 'Enter') selectCase(data.id);
          }}
          rowClassRules={{ 'case-explorer-selected': ({ data }) => data?.id === selectedId }}
          overlayNoRowsTemplate="No cases match the dashboard filter."
        />
      </div>
      <p role="status" className="fine-print">
        {selected
          ? `Selected: ${selected.title}. Evidence and its trail are shown below.`
          : `${rows.length} matching ${rows.length === 1 ? 'case' : 'cases'}. Select one to inspect its trail.`}
      </p>
      <p className="grid-scroll-hint">Scroll the table sideways to see more columns.</p>
    </section>
  );
}
const date = (value: string | null) =>
  value
    ? `${new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London' })} · London`
    : 'Not recorded';
export function CaseTrail() {
  const { rows, selectedId } = useContext(AnalyticsContext);
  const row = rows.find((item) => item.id === selectedId);
  if (!row) return null;
  const provenance = findingSource(row.findingProvenance);
  return (
    <section className="case-trail" aria-label="Evidence to outcome trail">
      <h3>{row.title}</h3>
      <p className="fine-print">
        {row.customer}
        {provenance && ` · ${provenance}`}
      </p>
      <p>{row.explanation}</p>
      {!row.findingCurrent && (
        <p className="fine-print">
          Current records still need investigation before relying on this conclusion.
        </p>
      )}
      {row.citations.length > 0 && (
        <blockquote className="trail-excerpt">
          <q>{row.citations[row.citations.length - 1].quote}</q>
          <span>
            Exact supplied excerpt · version {row.citations[row.citations.length - 1].version}.
            Review its meaning in the source.
          </span>
        </blockquote>
      )}
      <p>
        {row.environment === 'demo'
          ? 'Synthetic demo records and simulated outcomes.'
          : 'PayPal sandbox records. No live funds.'}
      </p>
      <p className="fine-print">
        Evidence below comes from the latest investigation. Approval and correction dates refer to a
        recorded correction and may use earlier records; open the case to review the exact versions.
      </p>
      <ol>
        <li>
          <strong>Evidence examined</strong>
          <span>
            {row.trail.investigatedAt
              ? `Started ${date(row.trail.investigatedAt)}`
              : 'No successful investigation recorded'}
          </span>
          <span>
            {row.findingCurrent
              ? 'Uses the current supplied records.'
              : 'Current records still need investigation.'}
          </span>
        </li>
        <li>
          <strong>Owner approval</strong>
          <span>
            {row.trail.approvedAt ? date(row.trail.approvedAt) : 'No correction approval recorded'}
          </span>
          <span>An approval alone does not verify a change.</span>
        </li>
        <li>
          <strong>Correction verified</strong>
          <span>
            {row.trail.correctedAt
              ? date(row.trail.correctedAt)
              : 'No verified correction recorded'}
          </span>
          <span>Approved reductions: {money(row.removedPence)}. A reduction is not a payment.</span>
        </li>
        <li>
          <strong>Payment observation</strong>
          <Status value={row.payment} />
          <span>
            {row.trail.observedAt
              ? date(row.trail.observedAt)
              : 'No saved observation matching the current invoice'}
          </span>
          <span>
            {row.environment === 'demo' ? 'Simulated full paid' : 'Full paid observed'}:{' '}
            {money(row.paidPence)} · outstanding: {money(row.duePence)}
          </span>
        </li>
      </ol>
      <Link href={`/cases/${row.id}`}>Open the case and review its sources</Link>
      {row.citations.map((cite, index) => (
        <Link
          className="trail-source-link"
          key={index}
          href={`/cases/${row.id}?${new URLSearchParams({
            source: cite.documentId,
            finding: row.findingId ?? '',
            quote: String(index),
          })}#source-text`}
        >
          Read cited quote {index + 1} · version {cite.version}
        </Link>
      ))}
    </section>
  );
}

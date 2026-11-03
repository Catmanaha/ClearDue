'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Notice } from './ui';
import { checkRecords, readRecordFile, type ImportedRecord } from '@/domain/import';
import { useIntakeDraftStore, type DraftRecord } from './intake-draft';

const kinds = { agreement: 'Agreement', message: 'Customer message', note: 'Internal note' };
const blankRecord = (): DraftRecord => ({
  key: crypto.randomUUID(),
  label: '',
  kind: 'agreement',
  text: '',
});

export function NewCase({ mode, draftScope }: { mode: string; draftScope: string }) {
  const router = useRouter();
  const draftStore = useIntakeDraftStore();
  const [savedDraft] = useState(() => draftStore.read(draftScope));
  const [requestId, setRequestId] = useState(() => savedDraft?.requestId ?? crypto.randomUUID());
  const [customer, setCustomer] = useState(savedDraft?.customer ?? '');
  const [title, setTitle] = useState(savedDraft?.title ?? '');
  const [invoiceId, setInvoiceId] = useState(savedDraft?.invoiceId ?? '');
  const [records, setRecords] = useState<DraftRecord[]>(savedDraft?.records ?? []);
  const [removed, setRemoved] = useState<{ record: DraftRecord; index: number } | null>(
    savedDraft?.removed ?? null,
  );
  const [review, setReview] = useState(savedDraft?.review ?? false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [uncertain, setUncertain] = useState(savedDraft?.uncertain ?? false);
  const [checkedQueue, setCheckedQueue] = useState(savedDraft?.checkedQueue ?? false);
  const [created, setCreated] = useState('');
  const [fileStatus, setFileStatus] = useState('');
  const locked = useRef(false);
  const mounted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  const dirty = Boolean(customer || title || invoiceId || records.length);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (created || !dirty) draftStore.clear(draftScope);
    else
      draftStore.save(draftScope, {
        requestId,
        customer,
        title,
        invoiceId,
        records,
        removed,
        review,
        uncertain: uncertain || locked.current,
        checkedQueue,
      });
  }, [
    created,
    dirty,
    draftStore,
    draftScope,
    requestId,
    customer,
    title,
    invoiceId,
    records,
    removed,
    review,
    uncertain,
    checkedQueue,
  ]);
  useEffect(() => {
    if (!dirty || created) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, created]);
  function showError(message: string) {
    setError(message);
    requestAnimationFrame(() => errorBox.current?.focus());
  }
  function update(key: string, values: Partial<ImportedRecord>) {
    setRecords((current) =>
      current.map((record) => (record.key === key ? { ...record, ...values } : record)),
    );
  }
  const documents = () =>
    checkRecords(records.map(({ label, kind, text }) => ({ label, kind, text })));
  async function createCase() {
    if (locked.current || uncertain || created) return;
    locked.current = true;
    setBusy(true);
    setError('');
    draftStore.save(draftScope, {
      requestId,
      customer,
      title,
      invoiceId,
      records,
      removed,
      review,
      uncertain: true,
      checkedQueue: false,
    });
    const rememberOutcome = (unconfirmed: boolean) => {
      const current = draftStore.read(draftScope);
      if (current?.requestId === requestId)
        draftStore.save(draftScope, { ...current, uncertain: unconfirmed, checkedQueue: false });
    };
    try {
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          customer: customer.trim(),
          title: title.trim(),
          ...(mode === 'sandbox' ? { invoiceId: invoiceId.trim() } : {}),
          documents: documents(),
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      if (response.status === 409 && data.code === 'INTAKE_CONFLICT') {
        rememberOutcome(true);
        if (!mounted.current) return;
        setUncertain(true);
        showError(
          'This draft has already saved a case with different records. Check the case queue, then discard this draft if you want to start a separate case.',
        );
        return;
      }
      if (!response.ok && response.status < 500) {
        rememberOutcome(false);
        if (!mounted.current) return;
        showError(
          `${data.error || 'The case could not be created.'} Your draft is still here. Edit the records or try again.`,
        );
        return;
      }
      if (!response.ok || typeof data.id !== 'string') throw new Error('Unconfirmed result');
      if (draftStore.read(draftScope)?.requestId === requestId) draftStore.clear(draftScope);
      if (!mounted.current) return;
      setCreated(data.id);
      router.push(`/cases/${encodeURIComponent(data.id)}`);
    } catch {
      rememberOutcome(true);
      if (!mounted.current) return;
      setUncertain(true);
      showError(
        'We could not confirm whether the case was saved. Your draft is still here. Check the case queue in a new tab before creating another case.',
      );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <form
      className="sheet import-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (review) return;
        try {
          if (!customer.trim() || !title.trim() || (mode === 'sandbox' && !invoiceId.trim()))
            throw new Error('Enter the customer, case title and required invoice ID.');
          documents();
          setError('');
          setReview(true);
          requestAnimationFrame(() => heading.current?.focus());
        } catch (error) {
          showError(error instanceof Error ? error.message : 'Check the records.');
        }
      }}
    >
      <div>
        <h2 ref={heading} tabIndex={-1}>
          {review
            ? 'Review the records before creating your case.'
            : 'Start with the complete records.'}
        </h2>
        <p className="muted">
          {review
            ? 'Check the names, record types and full text below. You can investigate after the case is saved.'
            : 'Keep agreements, customer messages and internal notes separate so every finding can point back to its source.'}
        </p>
      </div>
      {savedDraft && (
        <Notice>Your unsaved draft is back. Nothing has been submitted automatically.</Notice>
      )}
      <p className="draft-note">
        Your draft stays in this tab while you move around ClearDue. Refreshing or closing the tab
        clears it.
      </p>
      {dirty && (
        <button
          type="button"
          className="text-button"
          disabled={busy || reading || Boolean(created)}
          onClick={() => {
            if (
              !window.confirm(
                'Discard this draft from this tab? This does not remove any case already saved. Check the case queue first if a save was unconfirmed.',
              )
            )
              return;
            draftStore.clear(draftScope);
            setRequestId(crypto.randomUUID());
            setCustomer('');
            setTitle('');
            setInvoiceId('');
            setRecords([]);
            setRemoved(null);
            setReview(false);
            setUncertain(false);
            setCheckedQueue(false);
            setError('');
            setFileStatus('');
          }}
        >
          Discard this draft
        </button>
      )}
      <fieldset className="intake-fields" disabled={busy || reading || Boolean(created)}>
        {!review ? (
          <>
            <div className="form-row">
              <label>
                Customer
                <input
                  required
                  maxLength={100}
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                />
              </label>
              <label>
                Case title
                <input
                  required
                  maxLength={150}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Questioned social-media charge"
                />
              </label>
            </div>
            {mode === 'sandbox' && (
              <label>
                PayPal sandbox invoice ID
                <input
                  required
                  maxLength={100}
                  value={invoiceId}
                  onChange={(e) => setInvoiceId(e.target.value)}
                  placeholder="INV2-…"
                />
              </label>
            )}
            <section aria-label="Supplied records" className="intake-records">
              <div className="intake-section-heading">
                <h3>Supplied records</h3>
                <span>{records.length} of 12 records</span>
              </div>
              <p className="muted">
                Include dates and sender names in the text when available. Each record can contain
                up to 16,000 characters.
              </p>
              {!records.length && (
                <p>Add an agreement or message, or choose a text / JSON file below.</p>
              )}
              {records.map((record, index) => (
                <fieldset key={record.key} className="intake-record">
                  <legend>Record {index + 1}</legend>
                  <div className="form-row">
                    <label>
                      Record name
                      <input
                        required
                        maxLength={100}
                        value={record.label}
                        onChange={(e) => update(record.key, { label: e.target.value })}
                        placeholder="e.g. Customer reply · 12 October"
                      />
                    </label>
                    <label>
                      Record type
                      <select
                        value={record.kind}
                        onChange={(e) =>
                          update(record.key, { kind: e.target.value as ImportedRecord['kind'] })
                        }
                      >
                        {Object.entries(kinds).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    Complete text
                    <textarea
                      required
                      rows={4}
                      value={record.text}
                      onChange={(e) => update(record.key, { text: e.target.value })}
                      aria-describedby={`count-${record.key}`}
                    />
                  </label>
                  <div className="intake-record-footer">
                    <span
                      id={`count-${record.key}`}
                      className={record.text.length > 16000 ? 'intake-invalid' : 'muted'}
                    >
                      {record.text.length.toLocaleString('en-GB')} / 16,000 characters
                    </span>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setRemoved({ record, index });
                        setRecords(records.filter((r) => r.key !== record.key));
                      }}
                    >
                      Remove record {index + 1}
                    </button>
                  </div>
                </fieldset>
              ))}
              {removed && (
                <div className="intake-actions" role="status">
                  <span>Record removed from this draft.</span>
                  <button
                    type="button"
                    className="text-button"
                    disabled={records.length >= 12}
                    onClick={() => {
                      const next = [...records];
                      next.splice(removed.index, 0, removed.record);
                      setRecords(next);
                      setRemoved(null);
                    }}
                  >
                    Undo removal
                  </button>
                </div>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={records.length >= 12}
                onClick={() => {
                  setRecords([...records, blankRecord()]);
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLInputElement>('.intake-record:last-of-type input')
                      ?.focus(),
                  );
                }}
              >
                <Plus size={16} />
                Add record
              </button>
              <label className="intake-file">
                Or add records from files
                <input
                  type="file"
                  accept=".txt,.json"
                  multiple
                  disabled={records.length >= 12}
                  onChange={async (event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    if (!files.length) return;
                    setReading(true);
                    setError('');
                    setFileStatus('');
                    try {
                      if (files.length > 12 || files.some((file) => file.size > 64000))
                        throw new Error(
                          'Choose up to 12 files, each at most 64,000 bytes. Nothing was added.',
                        );
                      const added: ImportedRecord[] = [];
                      for (const file of files)
                        added.push(
                          ...readRecordFile(file.name, new Uint8Array(await file.arrayBuffer())),
                        );
                      // Validate the whole selection before changing the draft; reject without partial import.
                      checkRecords([
                        ...records.map(({ label, kind, text }) => ({ label, kind, text })),
                        ...added,
                      ]);
                      setRecords([
                        ...records,
                        ...added.map((record) => ({ ...record, key: crypto.randomUUID() })),
                      ]);
                      setFileStatus(
                        `${added.length} records added. Review their types and complete text before continuing.`,
                      );
                    } catch (error) {
                      showError(
                        error instanceof Error
                          ? error.message
                          : 'Files could not be read. Nothing was added.',
                      );
                    } finally {
                      setReading(false);
                    }
                  }}
                />
              </label>
              <p role="status">{reading ? 'Reading files…' : fileStatus}</p>
              <details className="intake-help">
                <summary>Supported files and JSON example</summary>
                <p>
                  Use complete UTF-8 .txt files or a .json array in the format below. Text files
                  start as internal notes: choose the correct type after import. PDF, image and HTML
                  files are not supported.
                </p>
                <pre>
                  {
                    '[{"label":"Customer reply · 12 October","kind":"message","text":"Complete message here."}]'
                  }
                </pre>
                <p>
                  JSON types: agreement, message, note. Up to 12 records. The server checks a
                  32,000-byte limit including the invoice and record metadata; smaller bundles may
                  be needed. Nothing is silently shortened.
                </p>
              </details>
            </section>
          </>
        ) : (
          <section className="intake-preview" aria-label="Record preview">
            <h3>{title.trim()}</h3>
            <p>
              {customer.trim()}
              {mode === 'sandbox' ? ` · ${invoiceId.trim()}` : ''}
            </p>
            <p className="muted">
              {records.length} separate records · Stored as version 1 when created
            </p>
            {records.map((record, index) => (
              <details key={record.key} open>
                <summary>
                  {index + 1}. {record.label.trim()}{' '}
                  <span>
                    · {kinds[record.kind]} · {record.text.length.toLocaleString('en-GB')} characters
                  </span>
                </summary>
                <pre>{record.text}</pre>
              </details>
            ))}
          </section>
        )}
        <Notice>
          {mode === 'demo'
            ? 'This creates a local demo case with a synthetic £1,250 invoice.'
            : 'This reads the selected PayPal sandbox invoice and saves a case.'}{' '}
          Creating a case does not start AI analysis, change an invoice or contact the customer.
        </Notice>
        {error && (
          <div ref={errorBox} tabIndex={-1}>
            <Notice error>{error}</Notice>
          </div>
        )}
        {created ? (
          <p role="status">
            Case saved. <a href={`/cases/${encodeURIComponent(created)}`}>Open your case</a>.
          </p>
        ) : uncertain ? (
          <div className="intake-actions">
            <a href="/" target="_blank" rel="noreferrer">
              Check case queue in a new tab
            </a>
            <span>Submission paused to prevent a duplicate.</span>
            <label className="intake-retry-check">
              <input
                type="checkbox"
                checked={checkedQueue}
                onChange={(event) => setCheckedQueue(event.target.checked)}
              />
              I checked the case queue and could not find this case. Let me review this draft again.
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={!checkedQueue}
              onClick={(event) => {
                event.preventDefault();
                setUncertain(false);
                setCheckedQueue(false);
                setError('');
                setReview(false);
              }}
            >
              Return to draft
            </button>
          </div>
        ) : (
          <div className="intake-actions">
            {review ? (
              <>
                <button
                  type="button"
                  className="button secondary"
                  key="edit-records"
                  onClick={(event) => {
                    event.preventDefault();
                    setReview(false);
                    setError('');
                    requestAnimationFrame(() => heading.current?.focus());
                  }}
                >
                  Edit records
                </button>
                <button key="create-case" type="button" className="button" onClick={createCase}>
                  {busy ? 'Creating case…' : 'Create case'}
                </button>
              </>
            ) : (
              <button
                key="review-records"
                className="button"
                type="submit"
                disabled={!records.length}
              >
                Review records
              </button>
            )}
          </div>
        )}
      </fieldset>
    </form>
  );
}

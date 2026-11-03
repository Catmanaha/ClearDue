'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, MessageSquare, RefreshCw, ShieldCheck } from 'lucide-react';
import { Brand, Notice, Status } from './ui';
import { money } from '@/lib/format';
import type { customerView } from '@/server/workflow';
type View = Awaited<ReturnType<typeof customerView>>;
export function CustomerResolution() {
  const token = useRef('');
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState('');
  const [pollUntil, setPollUntil] = useState(0);
  useEffect(() => {
    if (!pollUntil) return;
    const interval = setInterval(() => {
      if (Date.now() > pollUntil) {
        clearInterval(interval);
        return;
      }
      fetch('/api/customer', {
        headers: { Authorization: `Bearer ${token.current}` },
        cache: 'no-store',
      })
        .then(async (r) => {
          if (r.ok) {
            const next = await r.json();
            setData(next);
            if (next.payment === 'PAID') clearInterval(interval);
          }
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(interval);
  }, [pollUntil]);
  useEffect(() => {
    token.current = window.location.hash.slice(1);
    const controller = new AbortController();
    fetch('/api/customer', {
      headers: { Authorization: `Bearer ${token.current}` },
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/customer', {
        headers: { Authorization: `Bearer ${token.current}` },
        cache: 'no-store',
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed.');
    } finally {
      setBusy(false);
    }
  }
  async function submit(input: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.current}` },
        body: JSON.stringify(input),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSent(
        input.action === 'feedback'
          ? 'Your feedback is saved for the studio. No payment or invoice change was made.'
          : d.message,
      );
      setFeedback(false);
      if (input.action === 'feedback') setMessage('');
      if (input.action === 'demo-payment') setPollUntil(Date.now() + 30000);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="customer-page">
      <header>
        <Brand />
        <span>A clearer way forward.</span>
      </header>
      <main className="customer-main">
        {error && <Notice error>{error}</Notice>}
        {!data ? (
          error ? (
            <button className="button secondary" disabled={busy} onClick={refresh}>
              {busy ? 'Opening…' : 'Try opening again'}
            </button>
          ) : (
            <p role="status">Opening your resolution…</p>
          )
        ) : (
          <>
            {data.mode === 'demo' && (
              <div className="customer-demo">
                Demo workspace · all invoice and payment activity is simulated
              </div>
            )}
            <div className="customer-intro">
              <span className="resolution-mark">
                {data.payment === 'PAID' ? <Check size={32} /> : <ShieldCheck size={32} />}
              </span>
              <h1>
                {data.payment === 'PAID'
                  ? 'All settled. Thank you.'
                  : 'Let’s get this invoice right.'}
              </h1>
              <p>
                {data.studioName} has reviewed your billing conversation.
                <br />
                Here’s the explanation they approved for you.
              </p>
            </div>
            <section className="customer-explanation">
              <h2>A note from your studio</h2>
              <p>{data.explanation}</p>
            </section>
            <section className="sheet customer-invoice">
              <div className="invoice-header">
                <h2>Your current invoice</h2>
                <span>{data.invoiceNumber}</span>
              </div>
              {data.lines.map((line, i) => (
                <div className="customer-line" key={i}>
                  <span>{line.name}</span>
                  <strong>{money(line.totalPence)}</strong>
                </div>
              ))}
              <div className="customer-total">
                <span>Total</span>
                <strong>{money(data.totalPence)}</strong>
              </div>
              <div className="customer-payment">
                <Status value={data.payment} />
                <span>Outstanding {money(data.duePence)}</span>
              </div>
              <p className="fine-print">
                Last checked {new Date(data.observedAt).toLocaleString('en-GB')}. Payment
                confirmation may take a moment.
              </p>
            </section>
            {sent && <Notice>{sent}</Notice>}
            <div className="customer-actions">
              {data.payment !== 'PAID' &&
                (data.mode === 'demo' ? (
                  data.canSimulatePayment ? (
                    <button
                      className="button"
                      disabled={busy || data.payment !== 'UNPAID'}
                      onClick={() => submit({ action: 'demo-payment' })}
                    >
                      Simulate demo buyer payment <ArrowUpRight size={17} />
                    </button>
                  ) : (
                    <Notice>
                      This demo cannot take payments. Payment status updates after a new invoice
                      check.
                    </Notice>
                  )
                ) : data.paymentUrl ? (
                  <a className="button" href={data.paymentUrl} rel="noreferrer" target="_blank">
                    View & pay on PayPal <ArrowUpRight size={17} />
                  </a>
                ) : (
                  <Notice>
                    PayPal has not supplied a supported payment link. Ask the studio to refresh the
                    invoice.
                  </Notice>
                ))}
              <button
                className="button secondary"
                disabled={busy}
                aria-expanded={feedback}
                aria-controls="customer-feedback"
                onClick={() => setFeedback(!feedback)}
              >
                <MessageSquare size={17} />
                This still looks wrong
              </button>
            </div>
            <div id="customer-feedback" hidden={!feedback}>
              <form
                className="sheet import-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  submit({ action: 'feedback', message: form.get('message') });
                }}
              >
                <label>
                  What should the studio look at?
                  <textarea
                    name="message"
                    required
                    maxLength={1000}
                    rows={4}
                    value={message}
                    disabled={busy}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                </label>
                <button className="button secondary" disabled={busy}>
                  Save feedback for the studio
                </button>
              </form>
            </div>
            <button className="text-button customer-refresh" disabled={busy} onClick={refresh}>
              <RefreshCw size={15} />
              {busy ? 'Checking…' : 'Check payment status'}
            </button>
            <p className="customer-assurance">
              <ShieldCheck size={15} />
              {data.mode === 'demo'
                ? 'This is a demo. No real money is taken here. Your feedback never approves invoice changes.'
                : 'PayPal handles test-payment details. Your feedback never approves invoice changes.'}
            </p>
          </>
        )}
      </main>
      <footer>
        ClearDue<span>Fix the reason. Then get paid.</span>
      </footer>
    </div>
  );
}

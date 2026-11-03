import Link from 'next/link';
import {
  ArrowUpRight,
  Check,
  LayoutDashboard,
  ListFilter,
  LockKeyhole,
  Settings2,
} from 'lucide-react';
import type { ReactNode } from 'react';
export const labels: Record<string, string> = {
  NEW: 'Ready to investigate',
  INVESTIGATING: 'Investigating',
  REVIEW: 'Ready for review',
  MANUAL_REVIEW: 'Manual review',
  RESOLVING: 'Correction queued',
  RESOLVED: 'Disagreement resolved',
  UNPAID: 'Unpaid',
  PARTIAL: 'Partially paid',
  PENDING: 'Payment pending',
  PAID: 'Fully paid',
  UNKNOWN: 'Payment unknown',
  UNVERIFIED: 'Unverified payment',
  QUEUED: 'Queued',
  RUNNING: 'Updating invoice',
  SUCCEEDED: 'Verified correction',
  STALE: 'Needs a new review',
  UNSUPPORTED: 'Unsupported invoice',
  RETRYABLE_FAILURE: 'Waiting for another invoice check',
  UNKNOWN_OUTCOME: 'Correction result unconfirmed',
  QUESTIONED_CHARGE: 'Questioned charge',
  MISSING_REFERENCE: 'Missing reference',
  CLAIMED_PAYMENT: 'Payment reported',
  CONFLICT: 'Conflicting evidence',
  NO_CHANGE: 'Approval found',
  NOT_INVESTIGATED: 'Not investigated',
};
export function Status({ value }: { value: string }) {
  return (
    <span
      className={`status ${['PAID', 'SUCCEEDED', 'RESOLVED', 'NO_CHANGE'].includes(value) ? 'good' : ['MANUAL_REVIEW', 'UNKNOWN_OUTCOME', 'CONFLICT', 'STALE', 'PARTIAL', 'PENDING', 'UNSUPPORTED'].includes(value) ? 'warning' : ''}`}
    >
      <span className="status-dot" />
      {labels[value] ?? value.replaceAll('_', ' ').toLowerCase()}
    </span>
  );
}
export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="ClearDue case queue">
      <span className="brand-mark">
        <Check size={23} strokeWidth={2.4} />
      </span>
      ClearDue<span className="brand-period">.</span>
    </Link>
  );
}
export function Shell({
  children,
  active = 'cases',
  mode,
  ai,
  readOnly = false,
}: {
  children: ReactNode;
  active?: string;
  mode: string;
  ai: string;
  readOnly?: boolean;
}) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="workspace-name">
          <span className="avatar">N</span>
          <div>
            Northline Studio<small>Resolution workspace</small>
          </div>
        </div>
        <nav aria-label="Workspace">
          <Link
            className={active === 'cases' ? 'active' : ''}
            aria-current={active === 'cases' ? 'page' : undefined}
            href="/"
          >
            <ListFilter />
            Case queue
          </Link>
          <Link
            className={active === 'analytics' ? 'active' : ''}
            aria-current={active === 'analytics' ? 'page' : undefined}
            href="/analytics"
          >
            <LayoutDashboard />
            Case analytics
          </Link>
          <Link
            className={active === 'setup' ? 'active' : ''}
            aria-current={active === 'setup' ? 'page' : undefined}
            href="/setup"
          >
            <Settings2 />
            Connections
          </Link>
        </nav>
        <div className="sidebar-note">
          <LockKeyhole size={19} />
          <p>
            Every correction starts
            <br />
            with your approval.
          </p>
        </div>
        <div className="owner">
          <span className="avatar">O</span>
          <div>
            {readOnly ? 'Workspace viewer' : 'Workspace owner'}
            <small>{readOnly ? 'Read-only access' : 'Restricted access'}</small>
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <span>Fix the reason. Then get paid.</span>
          <div className="modes">
            <span className={mode === 'demo' ? 'mode-demo' : 'mode-sandbox'}>
              {mode === 'demo' ? 'Demo workspace · simulated payments' : 'PayPal sandbox'}
            </span>
            <span>{ai === 'fixture' ? 'Example analysis · no AI' : 'AI analysis selected'}</span>
          </div>
        </header>
        <main id="main" className="main">
          {children}
        </main>
        <footer className="footer">
          Evidence before action. Approval before change.
          <span>
            Synthetic project data <ArrowUpRight size={13} />
          </span>
        </footer>
      </div>
    </div>
  );
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
export function SetupRequired({
  message,
  signInRequired = false,
}: {
  message: string;
  signInRequired?: boolean;
}) {
  return (
    <div className="standalone">
      <Brand />
      <h1>
        {signInRequired ? 'Sign in to your workspace.' : 'Your workspace needs a connection.'}
      </h1>
      <p>{message}</p>
      {signInRequired ? (
        <p>Only approved workspace users can open these billing conversations.</p>
      ) : (
        <p>
          Try opening the workspace again. If it still cannot open, ask the person who set it up to
          check the connection. Your saved records have not been replaced with example results.
        </p>
      )}
      <Link href="/sign-in" className="button">
        Owner or judge sign in
      </Link>
    </div>
  );
}

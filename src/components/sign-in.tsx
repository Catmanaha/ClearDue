'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brand, Notice } from './ui';
export function SignIn() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="standalone">
      <Brand />
      <h1>
        Your workspace.
        <br />
        Your decisions.
      </h1>
      <p>
        Use the owner or judge account provided for this workspace. Public sign-up is not available.
      </p>
      <form
        method="post"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const f = new FormData(e.currentTarget);
          try {
            const r = await fetch('/api/auth/sign-in/email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: f.get('email'), password: f.get('password') }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.message ?? d.error ?? 'Sign in failed.');
            router.push('/');
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Sign in failed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input type="email" name="email" required autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" name="password" required autoComplete="current-password" />
        </label>
        {error && <Notice error>{error}</Notice>}
        <button className="button" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

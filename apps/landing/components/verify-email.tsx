'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type VerificationState =
  | { kind: 'loading' }
  | { kind: 'ok'; title: string; body: string }
  | { kind: 'error'; message: string };

function serverMessage(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return 'This verification link is invalid or has expired.';
  }
  const message = (data as { message?: string | string[] }).message;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'string' && message.trim()) return message;
  return 'This verification link is invalid or has expired.';
}

export function VerifyEmailClient() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<VerificationState>({ kind: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({
        kind: 'error',
        message: 'This verification link is missing its token.',
      });
      return;
    }

    let cancelled = false;
    fetch(`/api/public/signup/verify?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setState({ kind: 'error', message: serverMessage(data) });
          return;
        }
        const tenantName =
          data && typeof data.tenantName === 'string' ? data.tenantName : '';
        setState({
          kind: 'ok',
          title: 'Email verified',
          body: tenantName
            ? `${tenantName} is verified. We will continue setting up your workspace and email you when it is ready.`
            : 'Your email is verified. We will continue setting up your workspace and email you when it is ready.',
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: 'Could not reach the server. Please try the link again.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === 'loading') {
    return (
      <div className="wizard" aria-live="polite">
        <div className="success-panel">
          <p className="eyebrow">Verifying</p>
          <h2>Checking your link…</h2>
          <p>This only takes a moment.</p>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="wizard">
        <div className="success-panel">
          <h2>Link not valid</h2>
          <div className="notice" role="alert">
            {state.message}
          </div>
          <p>
            Verification links expire after 24 hours. You can request a new one
            from the signup page with the same email.
          </p>
          <Link className="button" href="/signup">
            Back to signup
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="wizard">
      <div className="success-panel">
        <div className="success-mark" aria-hidden>
          ✓
        </div>
        <h2>{state.title}</h2>
        <p>{state.body}</p>
        <Link className="button button--ghost" href="/">
          Back to home
        </Link>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  deriveProvisioningProgress,
  type ProvisioningInfo,
} from '@/lib/provisioning-progress';

interface StatusPayload {
  tenantName?: string;
  urls?: { admin?: string; storefront?: string } | null;
  provisioning?: ProvisioningInfo | null;
}

type VerificationState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'verified';
      tenantName: string;
      status: StatusPayload | null;
      retrying: boolean;
      retryError: string | null;
      pollError: string | null;
    };

function serverMessage(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return 'This verification link is invalid or has expired.';
  }
  const message = (data as { message?: string | string[] }).message;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'string' && message.trim()) return message;
  return 'This verification link is invalid or has expired.';
}

const STEP_ICON: Record<string, string> = {
  done: '✓',
  active: '•',
  failed: '!',
  pending: '',
};

export function VerifyEmailClient() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<VerificationState>({ kind: 'loading' });
  const [pollNonce, setPollNonce] = useState(0);
  const phase = state.kind;

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
          kind: 'verified',
          tenantName,
          status: null,
          retrying: false,
          retryError: null,
          pollError: null,
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

  useEffect(() => {
    if (phase !== 'verified' || !token) return;

    let cancelled = false;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      if (cancelled || stopped) return;
      try {
        const response = await fetch(
          `/api/public/signup/status?token=${encodeURIComponent(token)}`,
        );
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setState((previous) =>
            previous.kind === 'verified'
              ? { ...previous, pollError: serverMessage(data) }
              : previous,
          );
          return;
        }
        const status = data as StatusPayload;
        setState((previous) =>
          previous.kind === 'verified'
            ? {
                ...previous,
                tenantName:
                  typeof status.tenantName === 'string' && status.tenantName
                    ? status.tenantName
                    : previous.tenantName,
                status,
                pollError: null,
              }
            : previous,
        );
        if (
          status.provisioning?.status === 'SUCCEEDED' ||
          status.provisioning?.status === 'FAILED'
        ) {
          stopped = true;
        }
      } catch {
        if (!cancelled) {
          setState((previous) =>
            previous.kind === 'verified'
              ? {
                  ...previous,
                  pollError: 'Still checking — the server is taking a moment.',
                }
              : previous,
          );
        }
      }
    };

    void tick();
    timer = setInterval(() => {
      if (stopped) {
        if (timer) clearInterval(timer);
        return;
      }
      void tick();
    }, 2_000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [phase, token, pollNonce]);

  async function retry() {
    if (state.kind !== 'verified' || state.retrying) return;
    setState({ ...state, retrying: true, retryError: null });
    try {
      const response = await fetch('/api/public/signup/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setState((previous) =>
          previous.kind === 'verified'
            ? {
                ...previous,
                retrying: false,
                retryError: serverMessage(data),
              }
            : previous,
        );
        return;
      }
      setState((previous) =>
        previous.kind === 'verified'
          ? {
              ...previous,
              retrying: false,
              retryError: null,
              status: {
                ...(previous.status ?? {}),
                tenantName: previous.tenantName,
                provisioning:
                  (data as { provisioning?: ProvisioningInfo | null })
                    ?.provisioning ?? previous.status?.provisioning ?? null,
              },
            }
          : previous,
      );
      setPollNonce((value) => value + 1);
    } catch {
      setState((previous) =>
        previous.kind === 'verified'
          ? {
              ...previous,
              retrying: false,
              retryError: 'Could not reach the server. Please try again.',
            }
          : previous,
      );
    }
  }

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

  const progress = deriveProvisioningProgress(
    state.status?.provisioning ?? null,
  );
  const tenantName = state.tenantName || 'Your workspace';
  const title = progress.ready
    ? `${tenantName} is ready`
    : progress.failed
      ? 'Setup needs another try'
      : 'Setting up your workspace';
  const intro = progress.ready
    ? 'Your admin and storefront are live. Sign in with the email and password you used at signup.'
    : progress.failed
      ? 'Your workspace was not finished. Retrying is safe — completed steps are reused.'
      : 'This page updates automatically. You can close it and we will email you when it is ready.';

  return (
    <div className="wizard">
      <div className="success-panel">
        <div
          className={`success-mark${progress.failed ? ' success-mark--danger' : ''}`}
          aria-hidden
        >
          {progress.ready ? '✓' : progress.failed ? '!' : '…'}
        </div>
        <p className="eyebrow">
          {progress.ready ? 'Ready' : progress.failed ? 'Action needed' : 'Provisioning'}
        </p>
        <h2>{title}</h2>
        <p>{intro}</p>

        <ol className="progress-list" aria-live="polite">
          {progress.steps.map((step) => (
            <li
              key={step.key}
              className="progress-step"
              data-state={step.state}
            >
              <span className="progress-dot" aria-hidden>
                {STEP_ICON[step.state]}
              </span>
              <span>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>

        {state.pollError && !progress.failed ? (
          <p className="center-note" role="status">
            {state.pollError}
          </p>
        ) : null}

        {progress.failed ? (
          <div className="notice" role="alert">
            {state.retryError || 'We could not finish the setup.'}
          </div>
        ) : null}

        <div className="progress-actions">
          {progress.ready && state.status?.urls?.admin ? (
            <a className="button" href={state.status.urls.admin}>
              Open admin
            </a>
          ) : null}
          {progress.ready && state.status?.urls?.storefront ? (
            <a className="button button--ghost" href={state.status.urls.storefront}>
              Open storefront
            </a>
          ) : null}
          {progress.failed ? (
            <button
              className="button"
              type="button"
              onClick={retry}
              disabled={state.retrying}
            >
              {state.retrying ? 'Retrying…' : 'Try again'}
            </button>
          ) : null}
        </div>

        <p className="center-note">
          <Link href="/">Back to home</Link>
        </p>
      </div>
    </div>
  );
}

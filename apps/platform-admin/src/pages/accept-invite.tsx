import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { errorMessage } from '../lib/api';
import { useBranding } from '../lib/branding';

const API_BASE = (import.meta.env.VITE_PLATFORM_API_URL || '/api').replace(
  /\/+$/,
  '',
);

export function AcceptInvitePage() {
  const { platformName, logoUrl } = useBranding();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/users/invite/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          password,
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body && typeof body === 'object' && 'message' in body
            ? String((body as { message: unknown }).message)
            : `Invite could not be accepted (${response.status})`;
        throw new Error(message);
      }
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Rebuilt on the login pattern (AI1): the old markup rendered
  // `className="login-form"`, a class that does not exist, so the whole
  // page — labels, inputs, submit — was browser-native.
  return (
    <div className="login-page">
      <section className="login-brand">
        {logoUrl ? (
          <img
            className="brand-logo-img brand-mark--large"
            src={logoUrl}
            alt={`${platformName} logo`}
          />
        ) : (
          <span className="brand-mark brand-mark--large" aria-hidden>
            {platformName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <p className="eyebrow">{platformName}</p>
        <h1>Accept your platform invite.</h1>
        <p>
          Set a password to activate your operator account for the SaaS
          console.
        </p>
      </section>
      <section className="login-panel">
        {done ? (
          <div className="card login-card">
            <p className="eyebrow">Platform invite</p>
            <h2>Invite accepted</h2>
            <p className="muted-note">
              Your account is active. You can now sign in to the platform
              console.
            </p>
            <Link to="/login" className="button button--primary">
              Go to sign in
            </Link>
          </div>
        ) : (
          <form className="card login-card" onSubmit={submit}>
            <p className="eyebrow">Platform invite</p>
            <h2>Set your password</h2>
            <p className="muted-note">
              At least 12 characters. Your name is optional — it defaults
              to the name on the invite.
            </p>
            {!token ? (
              <div className="notice notice--error" role="alert">
                This link has no invite token. Open the link from your invite
                email, or ask a superadmin to resend it.
              </div>
            ) : null}
            {error ? (
              <div className="notice notice--error" role="alert">
                {error}
              </div>
            ) : null}
            <label className="field">
              <span>Name (optional)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="As in the invite"
                autoComplete="name"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={12}
                required
                autoComplete="new-password"
                placeholder="••••••••••••"
              />
            </label>
            <label className="field">
              <span>Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={12}
                required
                autoComplete="new-password"
                placeholder="••••••••••••"
              />
            </label>
            <button
              className="button button--primary"
              type="submit"
              disabled={busy || !token}
            >
              {busy ? 'Accepting…' : 'Accept invite'}
            </button>
            <p className="muted-note">
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
          </form>
        )}
      </section>
    </div>
  );
}

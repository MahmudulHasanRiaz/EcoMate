import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { errorMessage } from '../lib/api';

const API_BASE = (import.meta.env.VITE_PLATFORM_API_URL || '/api').replace(
  /\/+$/,
  '',
);

export function AcceptInvitePage() {
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

  return (
    <div className="login-page">
      <section className="login-brand">
        <span className="brand-mark brand-mark--large" aria-hidden />
        <p className="eyebrow">EcoMate</p>
        <h1>Accept your platform invite.</h1>
        <p>
          Set a password to activate your operator account for the SaaS
          console.
        </p>
      </section>
      <section className="login-form">
        {done ? (
          <>
            <h2>Invite accepted</h2>
            <p>
              Your account is active. You can now sign in to the platform
              console.
            </p>
            <Link to="/login">Go to sign in</Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2>Set your password</h2>
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
            <label>
              Name (optional)
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="As in the invite"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={12}
                required
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={12}
                required
                autoComplete="new-password"
              />
            </label>
            <p className="muted-note">At least 12 characters.</p>
            <button type="submit" disabled={busy || !token}>
              Accept invite
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

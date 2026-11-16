import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth';
import { errorMessage, ApiError } from '../lib/api';

export function LoginPage() {
  const { session, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      await navigate({ to: '/' });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-brand">
        <span className="brand-mark brand-mark--large" aria-hidden />
        <p className="eyebrow">EcoMate</p>
        <h1>Run the platform behind every store.</h1>
        <p>
          Tenants, plans, trials and domains — one operator console, separate
          from every tenant workspace.
        </p>
        <ul>
          <li>Tenant lifecycle and provisioning state</li>
          <li>Plans, subscriptions and trial windows</li>
          <li>Domains, verification and routing health</li>
        </ul>
      </section>

      <section className="login-panel">
        <form className="card login-card" onSubmit={submit}>
          <p className="eyebrow">Platform access</p>
          <h2>Sign in</h2>
          <p className="muted-note">
            Operator accounts only. Tenant users sign in on their own store
            host.
          </p>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••••••"
            />
          </label>
          {error ? (
            <div className="notice notice--error" role="alert">
              {error}
            </div>
          ) : null}
          <button className="button button--primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  );
}

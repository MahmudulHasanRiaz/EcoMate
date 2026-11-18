import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { useAuth, type MfaSetup } from '../auth';
import { QrCode } from '../components/qr-code';
import { useBranding } from '../lib/branding';
import { errorMessage, ApiError } from '../lib/api';
import { groupSecret } from '../lib/mfa';

type Step =
  | 'password'
  | 'code'
  | 'setup'
  | 'setup-code'
  | 'recovery';

export function LoginPage() {
  const { session, login, completeMfa, startMfaSetup, verifyMfaSetup } =
    useAuth();
  const { platformName, logoUrl } = useBranding();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<Step>('password');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Mid-login MFA enrollment stores the session as soon as the setup code
  // verifies — but the user must still see the recovery-codes step before
  // leaving. Without the step check the redirect below fires first and the
  // codes are never shown (they exist — the account page counts them — but
  // the user never gets to save them).
  if (session && step !== 'recovery') return <Navigate to="/" />;

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await login(email.trim(), password);
      if (outcome.kind === 'session') {
        await navigate({ to: '/' });
        return;
      }
      setMfaToken(outcome.mfaToken);
      setCode('');
      if (!outcome.mfaSetupRequired) {
        setStep('code');
        return;
      }
      // SUPERADMIN without MFA: enroll before proceeding.
      const next = await startMfaSetup(outcome.mfaToken);
      setSetup(next);
      setStep('setup');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (busy || !mfaToken) return;
    setBusy(true);
    setError(null);
    try {
      await completeMfa(mfaToken, code.trim());
      await navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitSetupCode(event: FormEvent) {
    event.preventDefault();
    if (busy || !mfaToken) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyMfaSetup(mfaToken, code.trim());
      setRecoveryCodes(result.recoveryCodes);
      setStep('recovery');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function copyText(text: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  }

  function backToPassword() {
    setStep('password');
    setMfaToken(null);
    setSetup(null);
    setCode('');
    setError(null);
  }

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
        {step === 'password' ? (
          <form className="card login-card" onSubmit={submitPassword}>
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
            <button
              className="button button--primary"
              type="submit"
              disabled={busy}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : null}

        {step === 'code' ? (
          <form className="card login-card" onSubmit={submitCode}>
            <p className="eyebrow">Two-factor authentication</p>
            <h2>Enter your code</h2>
            <p className="muted-note">
              Enter the 6-digit code from your authenticator app. Lost your
              device? Use one of your recovery codes instead.
            </p>
            <label className="field">
              <span>Code</span>
              <input
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456 or XXXX-XXXXX"
              />
            </label>
            {error ? (
              <div className="notice notice--error" role="alert">
                {error}
              </div>
            ) : null}
            <div className="button-row">
              <button
                className="button button--primary"
                type="submit"
                disabled={busy}
              >
                {busy ? 'Verifying…' : 'Verify and sign in'}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={backToPassword}
              >
                Back
              </button>
            </div>
          </form>
        ) : null}

        {step === 'setup' && setup ? (
          <div className="card login-card">
            <p className="eyebrow">Two-factor authentication</p>
            <h2>Set up MFA</h2>
            <p className="muted-note">
              Superadmin accounts must use two-factor authentication. Add this
              account to your authenticator app, then enter a code to finish
              signing in.
            </p>
            <p className="muted-note">
              Scan the code with your authenticator app, or enter the key
              manually:
            </p>
            <QrCode
              value={setup.otpauthUrl}
              label="Scan this QR code with your authenticator app"
            />
            <p className="mono">{groupSecret(setup.secret)}</p>
            <div className="button-row">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => copyText(setup.secret)}
              >
                {copied ? 'Copied' : 'Copy key'}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => copyText(setup.otpauthUrl)}
              >
                Copy setup link
              </button>
            </div>
            {error ? (
              <div className="notice notice--error" role="alert">
                {error}
              </div>
            ) : null}
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                setCode('');
                setStep('setup-code');
              }}
            >
              I added it — enter a code
            </button>
          </div>
        ) : null}

        {step === 'setup-code' ? (
          <form className="card login-card" onSubmit={submitSetupCode}>
            <p className="eyebrow">Two-factor authentication</p>
            <h2>Confirm the setup</h2>
            <p className="muted-note">
              Enter the 6-digit code your authenticator app shows for{' '}
              {platformName} to prove the setup works.
            </p>
            <label className="field">
              <span>Code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
              />
            </label>
            {error ? (
              <div className="notice notice--error" role="alert">
                {error}
              </div>
            ) : null}
            <div className="button-row">
              <button
                className="button button--primary"
                type="submit"
                disabled={busy}
              >
                {busy ? 'Verifying…' : 'Verify and sign in'}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setStep('setup')}
              >
                Back
              </button>
            </div>
          </form>
        ) : null}

        {step === 'recovery' ? (
          <div className="card login-card">
            <p className="eyebrow">Two-factor authentication</p>
            <h2>Save your recovery codes</h2>
            <p className="muted-note">
              MFA is on. Keep these codes somewhere safe — each one signs you
              in once if you lose your authenticator. They are shown only this
              once.
            </p>
            <ul className="recovery-codes">
              {recoveryCodes.map((rc) => (
                <li key={rc}>{rc}</li>
              ))}
            </ul>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void navigate({ to: '/' })}
            >
              Continue to the console
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

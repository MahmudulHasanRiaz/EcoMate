import { useEffect, useState } from 'react';
import { useAuth } from '../../auth';
import { ErrorNote } from '../../components/ui';
import { errorMessage, readJson } from '../../lib/api';
import { smtpSourceLabel } from '../../lib/settings';
import type { SettingsSectionProps } from './sections';

export function SmtpSection({
  settings,
  onSaved,
  onError,
}: SettingsSectionProps) {
  const { api, session } = useAuth();
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpFromName, setSmtpFromName] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setSmtpHost(settings.smtp.host);
    setSmtpPort(String(settings.smtp.port));
    setSmtpSecure(settings.smtp.secure);
    setSmtpUser(settings.smtp.user);
    setSmtpPass('');
    setSmtpFrom(settings.smtp.from);
    setSmtpFromName(settings.smtp.fromName ?? '');
  }, [settings]);

  if (!settings) return null;

  async function saveSmtp() {
    // F8: password managers autofill this form with the CONSOLE login
    // (same origin as /login). If the username is the operator's own login
    // email while no SMTP user was ever saved, refuse to save it silently.
    if (
      smtpUser.trim() &&
      session?.user.email &&
      smtpUser.trim().toLowerCase() === session.user.email.toLowerCase() &&
      !settings?.smtp.user
    ) {
      onError(
        'The SMTP username is your own console login email — your password manager may have autofilled it. Check the username and password, then save again.',
      );
      return;
    }
    setBusy('smtp');
    onError('');
    try {
      const body: Record<string, unknown> = {
        host: smtpHost.trim(),
        port: Number(smtpPort),
        secure: smtpSecure,
        user: smtpUser.trim(),
        from: smtpFrom.trim(),
        fromName: smtpFromName.trim(),
      };
      if (smtpPass) body.pass = smtpPass;
      await api('/settings/smtp', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }).then((r) => readJson(r));
      onSaved('SMTP settings saved and applied to outgoing mail.');
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function sendTestEmail() {
    if (!testEmail.trim()) {
      setTestError('Enter an address to send the test email to.');
      return;
    }
    setBusy('smtp-test');
    setTestError(null);
    setTestResult(null);
    try {
      await api('/settings/smtp/test', {
        method: 'POST',
        body: JSON.stringify({ to: testEmail.trim() }),
      }).then((r) => readJson(r));
      setTestResult(`Test email sent to ${testEmail.trim()}.`);
    } catch (err) {
      // R-F7b: the result must show INLINE here in the SMTP section. The
      // page-level error banner lives at the top of the page, far above
      // this section, so a setup error was invisible to an operator
      // scrolled down here — the click appeared to do nothing.
      setTestError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>SMTP and email</h2>
          <p>
            Outgoing mail for verification, welcome and billing messages.{' '}
            {smtpSourceLabel(settings.smtp.source)}
            {settings.smtp.source === 'env'
              ? ' — stored settings apply only when SMTP_HOST is unset.'
              : ''}
          </p>
        </div>
        <span
          className={`badge badge--${settings.smtp.configured ? 'accent' : 'neutral'}`}
        >
          {settings.smtp.configured ? 'Configured' : 'Not configured'}
        </span>
      </div>
      <div className="domain-config-grid">
        <label className="inline-field">
          <span>SMTP host</span>
          <input
            value={smtpHost}
            onChange={(event) => setSmtpHost(event.target.value)}
            placeholder="smtp.example.com"
            aria-label="SMTP host"
          />
        </label>
        <label className="inline-field">
          <span>SMTP port</span>
          <input
            type="number"
            min="1"
            max="65535"
            value={smtpPort}
            onChange={(event) => setSmtpPort(event.target.value)}
            aria-label="SMTP port"
          />
        </label>
        <label className="inline-field">
          <span>SMTP username</span>
          <input
            value={smtpUser}
            onChange={(event) => setSmtpUser(event.target.value)}
            placeholder="Optional"
            aria-label="SMTP username"
            name="smtp-username"
            autoComplete="off"
          />
        </label>
        <label className="inline-field">
          <span>SMTP password</span>
          <input
            type="password"
            value={smtpPass}
            onChange={(event) => setSmtpPass(event.target.value)}
            placeholder="Leave blank to keep the current password"
            aria-label="SMTP password"
            name="smtp-password"
            autoComplete="new-password"
          />
        </label>
        <label className="inline-field">
          <span>Sender name</span>
          <input
            value={smtpFromName}
            onChange={(event) => setSmtpFromName(event.target.value)}
            placeholder="EcoMate"
            aria-label="Sender name"
            maxLength={100}
          />
        </label>
        <label className="inline-field">
          <span>From address</span>
          <input
            type="email"
            value={smtpFrom}
            onChange={(event) => setSmtpFrom(event.target.value)}
            placeholder="no-reply@ecomate.bd"
            aria-label="From address"
          />
        </label>
      </div>
      {/* The TLS flag is not a grid field — it sits below the grid, like
          the flags in the Tax and Landing sections. */}
      <div className="domain-flags">
        <label>
          <input
            type="checkbox"
            checked={smtpSecure}
            onChange={(event) => setSmtpSecure(event.target.checked)}
          />
          Use TLS (port 465)
        </label>
      </div>
      <div className="progress-actions">
        <button
          type="button"
          className="button button--accent"
          onClick={() => void saveSmtp()}
          disabled={!!busy}
        >
          {busy === 'smtp' ? 'Saving…' : 'Save SMTP settings'}
        </button>
      </div>
      {/* Test email is its own sub-section: divider + heading, one
          aligned input+button row, note below (SM1 — the old layout
          scattered the Save button, test input, Send button and note
          across two grids with no separation). */}
      <div className="section-divider" aria-hidden="true" />
      <h3 className="subsection-title">Test email</h3>
      <div className="test-row">
        <label className="inline-field">
          <span>Send a test email to</span>
          <input
            type="email"
            value={testEmail}
            onChange={(event) => setTestEmail(event.target.value)}
            placeholder="you@example.com"
            aria-label="Test email address"
          />
        </label>
        <button
          type="button"
          className="button"
          onClick={() => void sendTestEmail()}
          disabled={!!busy || !testEmail.trim()}
        >
          {busy === 'smtp-test' ? 'Sending…' : 'Send test email'}
        </button>
      </div>
      {!settings.smtp.configured ? (
        <p className="muted-note">
          SMTP is not configured yet — sending will show the setup error
          until it is.
        </p>
      ) : null}
      {testResult ? (
        <p className="muted-note" role="status">
          {testResult}
        </p>
      ) : null}
      {testError ? <ErrorNote message={testError} /> : null}
    </section>
  );
}

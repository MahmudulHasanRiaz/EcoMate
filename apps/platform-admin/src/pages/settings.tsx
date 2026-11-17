import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { ConfirmDialog, ErrorNote, Loading, PageHeader } from '../components/ui';
import { useBranding } from '../lib/branding';
import { errorMessage, readJson } from '../lib/api';
import {
  PAYMENT_METHOD_TYPES,
  paymentMethodLabel,
  smtpSourceLabel,
} from '../lib/settings';
import type { PaymentMethod, PlatformSettings } from '../types';

const MAX_LOGO_BYTES = 200 * 1024;
const MAX_FAVICON_BYTES = 100 * 1024;

/**
 * Reads an uploaded image as a data URL (F11). The data URL is stored in
 * the branding setting — no new storage infra needed. The server caps the
 * stored value at 300_000 characters; these client caps keep uploads
 * comfortably inside it.
 */
function readImageFile(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Choose an image file (PNG, JPG, GIF, WebP or SVG).'));
      return;
    }
    if (file.size > maxBytes) {
      reject(
        new Error(
          `That file is ${Math.round(file.size / 1024)} KB — keep it under ${Math.round(maxBytes / 1024)} KB.`,
        ),
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

type SettingsConfirm =
  | { kind: 'method-toggle'; method: PaymentMethod }
  | { kind: 'method-delete'; method: PaymentMethod }
  | { kind: 'maintenance-enable' }
  | null;

export function SettingsPage() {
  const { api, session } = useAuth();
  const { refresh: refreshBranding } = useBranding();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);

  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  const [trialDays, setTrialDays] = useState('14');
  const [graceDays, setGraceDays] = useState('7');

  const [taxRate, setTaxRate] = useState('0');
  const [taxLabel, setTaxLabel] = useState('');
  const [taxInclusive, setTaxInclusive] = useState(false);

  const [platformName, setPlatformName] = useState('EcoMate');
  const [supportEmail, setSupportEmail] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');
  const [confirm, setConfirm] = useState<SettingsConfirm>(null);

  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');

  const [showMethodForm, setShowMethodForm] = useState(false);
  const [editingMethodId, setEditingMethodId] = useState<string | null>(null);
  const [methodType, setMethodType] = useState('BKASH');
  const [methodName, setMethodName] = useState('');
  const [methodAccountName, setMethodAccountName] = useState('');
  const [methodAccountNumber, setMethodAccountNumber] = useState('');
  const [methodInstructions, setMethodInstructions] = useState('');
  const [methodQrUrl, setMethodQrUrl] = useState('');
  const [methodSortOrder, setMethodSortOrder] = useState('0');

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const [nextSettings, nextMethods] = await Promise.all([
        api('/settings').then((r) => readJson<PlatformSettings>(r)),
        api('/billing/methods').then((r) => readJson<PaymentMethod[]>(r)),
      ]);
      setSettings(nextSettings);
      setMethods(nextMethods);
      setSmtpHost(nextSettings.smtp.host);
      setSmtpPort(String(nextSettings.smtp.port));
      setSmtpSecure(nextSettings.smtp.secure);
      setSmtpUser(nextSettings.smtp.user);
      setSmtpPass('');
      setSmtpFrom(nextSettings.smtp.from);
      setTrialDays(String(nextSettings.trial.trialDays));
      setGraceDays(String(nextSettings.trial.graceDays));
      setTaxRate(String(nextSettings.tax.ratePercent));
      setTaxLabel(nextSettings.tax.label);
      setTaxInclusive(nextSettings.tax.inclusive);
      setPlatformName(nextSettings.branding.platformName);
      setSupportEmail(nextSettings.branding.supportEmail);
      setLogoUrl(nextSettings.branding.logoUrl);
      setFaviconUrl(nextSettings.branding.faviconUrl ?? '');
      setMaintenanceEnabled(nextSettings.maintenance.enabled);
      setMaintenanceMessage(nextSettings.maintenance.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  function reloadWithNotice(message: string) {
    setNotice(message);
    setRefresh((value) => value + 1);
  }

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
      setError(
        'The SMTP username is your own console login email — your password manager may have autofilled it. Check the username and password, then save again.',
      );
      return;
    }
    setBusy('smtp');
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        host: smtpHost.trim(),
        port: Number(smtpPort),
        secure: smtpSecure,
        user: smtpUser.trim(),
        from: smtpFrom.trim(),
      };
      if (smtpPass) body.pass = smtpPass;
      await api('/settings/smtp', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }).then((r) => readJson(r));
      reloadWithNotice('SMTP settings saved and applied to outgoing mail.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function sendTestEmail() {
    if (!testEmail.trim()) {
      setError('Enter an address to send the test email to.');
      return;
    }
    setBusy('smtp-test');
    setError(null);
    setTestResult(null);
    try {
      await api('/settings/smtp/test', {
        method: 'POST',
        body: JSON.stringify({ to: testEmail.trim() }),
      }).then((r) => readJson(r));
      setTestResult(`Test email sent to ${testEmail.trim()}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveTrial() {
    setBusy('trial');
    setError(null);
    setNotice(null);
    try {
      await api('/settings/trial', {
        method: 'PATCH',
        body: JSON.stringify({
          trialDays: Number(trialDays),
          graceDays: Number(graceDays),
        }),
      }).then((r) => readJson(r));
      reloadWithNotice('Trial and grace defaults saved.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveTax() {
    setBusy('tax');
    setError(null);
    setNotice(null);
    try {
      await api('/settings/tax', {
        method: 'PATCH',
        body: JSON.stringify({
          ratePercent: Number(taxRate),
          label: taxLabel.trim(),
          inclusive: taxInclusive,
        }),
      }).then((r) => readJson(r));
      reloadWithNotice('Tax settings saved.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveBranding() {
    setBusy('branding');
    setError(null);
    setNotice(null);
    try {
      await api('/settings/branding', {
        method: 'PATCH',
        body: JSON.stringify({
          platformName: platformName.trim(),
          supportEmail: supportEmail.trim(),
          logoUrl: logoUrl.trim(),
          faviconUrl: faviconUrl.trim(),
        }),
      }).then((r) => readJson(r));
      await refreshBranding();
      reloadWithNotice('Branding saved and applied to this console.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setLogoUrl(await readImageFile(file, MAX_LOGO_BYTES));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function uploadFavicon(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setFaviconUrl(await readImageFile(file, MAX_FAVICON_BYTES));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function saveMaintenance() {
    setBusy('maintenance');
    setError(null);
    setNotice(null);
    try {
      await api('/settings/maintenance', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: maintenanceEnabled,
          message: maintenanceMessage.trim(),
        }),
      }).then((r) => readJson(r));
      reloadWithNotice(
        maintenanceEnabled
          ? 'Maintenance mode enabled. Writes are blocked except settings and auth.'
          : 'Maintenance mode disabled.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function startAddMethod() {
    setEditingMethodId(null);
    setMethodType('BKASH');
    setMethodName('');
    setMethodAccountName('');
    setMethodAccountNumber('');
    setMethodInstructions('');
    setMethodQrUrl('');
    setMethodSortOrder('0');
    setShowMethodForm(true);
  }

  function startEditMethod(method: PaymentMethod) {
    setEditingMethodId(method.id);
    setMethodType(method.type);
    setMethodName(method.name);
    setMethodAccountName(method.accountName ?? '');
    setMethodAccountNumber(method.accountNumber ?? '');
    setMethodInstructions(method.instructions ?? '');
    setMethodQrUrl(method.qrMediaUrl ?? '');
    setMethodSortOrder(String(method.sortOrder));
    setShowMethodForm(true);
  }

  async function saveMethod() {
    if (!methodName.trim()) {
      setError('Give the payment method a name.');
      return;
    }
    setBusy('method');
    setError(null);
    setNotice(null);
    try {
      const body = JSON.stringify({
        type: methodType,
        name: methodName.trim(),
        accountName: methodAccountName.trim(),
        accountNumber: methodAccountNumber.trim(),
        instructions: methodInstructions.trim(),
        qrMediaUrl: methodQrUrl.trim(),
        sortOrder: Number(methodSortOrder),
      });
      if (editingMethodId) {
        await api(`/billing/methods/${editingMethodId}`, {
          method: 'PATCH',
          body,
        }).then((r) => readJson(r));
      } else {
        await api('/billing/methods', { method: 'POST', body }).then((r) =>
          readJson(r),
        );
      }
      setShowMethodForm(false);
      setEditingMethodId(null);
      reloadWithNotice(
        editingMethodId ? 'Payment method updated.' : 'Payment method added.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleMethod(method: PaymentMethod) {
    setBusy(`method-${method.id}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/billing/methods/${method.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !method.isActive }),
      }).then((r) => readJson(r));
      reloadWithNotice(
        method.isActive
          ? `${method.name} deactivated.`
          : `${method.name} activated.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteMethod(method: PaymentMethod) {
    setBusy(`method-${method.id}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/billing/methods/${method.id}`, { method: 'DELETE' }).then(
        (r) => readJson(r),
      );
      reloadWithNotice(`${method.name} deleted.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Platform settings"
        description="Payment methods, mail, trial defaults, tax, branding and maintenance."
      />

      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <div className="notice notice--success" role="status">
          {notice}
        </div>
      ) : null}
      {settings?.maintenance.enabled ? (
        <div className="notice notice--error" role="alert">
          Maintenance mode is ON — writes are blocked except settings and
          auth.
          {settings.maintenance.message
            ? ` ${settings.maintenance.message}`
            : ''}
        </div>
      ) : null}
      {!settings && busy ? <Loading /> : null}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Payment methods</h2>
            <p>
              Methods tenants pay with. Deactivate instead of deleting a method
              that proofs or payments already reference.
            </p>
          </div>
          <button
            type="button"
            className="button button--primary"
            onClick={startAddMethod}
            disabled={!!busy}
          >
            Add method
          </button>
        </div>
        {methods.length === 0 ? (
          <p className="muted-note">
            No payment methods yet. Add one to accept manual payments.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Account</th>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {methods.map((method) => (
                  <tr key={method.id}>
                    <td>{paymentMethodLabel(method.type)}</td>
                    <td>{method.name}</td>
                    <td className="mono">
                      {method.accountNumber ?? method.accountName ?? '—'}
                    </td>
                    <td>{method.sortOrder}</td>
                    <td>
                      <span
                        className={`badge badge--${method.isActive ? 'success' : 'muted'}`}
                      >
                        {method.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button button--sm"
                        onClick={() => startEditMethod(method)}
                        disabled={!!busy}
                      >
                        Edit
                      </button>{' '}
                      <button
                        type="button"
                        className="button button--sm button--ghost"
                        onClick={() => setConfirm({ kind: 'method-toggle', method })}
                        disabled={!!busy}
                      >
                        {method.isActive ? 'Deactivate' : 'Activate'}
                      </button>{' '}
                      <button
                        type="button"
                        className="button button--sm button--danger"
                        onClick={() => setConfirm({ kind: 'method-delete', method })}
                        disabled={!!busy}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {showMethodForm ? (
          <div className="domain-config-grid">
            <label className="inline-field">
              <span>Type</span>
              <select
                value={methodType}
                onChange={(event) => setMethodType(event.target.value)}
                aria-label="Payment method type"
              >
                {PAYMENT_METHOD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {paymentMethodLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-field">
              <span>Name</span>
              <input
                value={methodName}
                onChange={(event) => setMethodName(event.target.value)}
                placeholder="bKash Personal"
                aria-label="Payment method name"
              />
            </label>
            <label className="inline-field">
              <span>Account name</span>
              <input
                value={methodAccountName}
                onChange={(event) => setMethodAccountName(event.target.value)}
                placeholder="Optional"
                aria-label="Account name"
              />
            </label>
            <label className="inline-field">
              <span>Account number</span>
              <input
                value={methodAccountNumber}
                onChange={(event) =>
                  setMethodAccountNumber(event.target.value)
                }
                placeholder="Optional"
                aria-label="Account number"
              />
            </label>
            <label className="inline-field">
              <span>Sort order</span>
              <input
                type="number"
                min="0"
                value={methodSortOrder}
                onChange={(event) => setMethodSortOrder(event.target.value)}
                aria-label="Sort order"
              />
            </label>
            <label className="inline-field">
              <span>QR image URL</span>
              <input
                value={methodQrUrl}
                onChange={(event) => setMethodQrUrl(event.target.value)}
                placeholder="Optional"
                aria-label="QR image URL"
              />
            </label>
            <label className="inline-field">
              <span>Payment instructions</span>
              <input
                value={methodInstructions}
                onChange={(event) =>
                  setMethodInstructions(event.target.value)
                }
                placeholder="Shown to tenants at payment time"
                aria-label="Payment instructions"
              />
            </label>
            <div className="progress-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void saveMethod()}
                disabled={!!busy}
              >
                {busy === 'method'
                  ? 'Saving…'
                  : editingMethodId
                    ? 'Save changes'
                    : 'Add method'}
              </button>{' '}
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setShowMethodForm(false);
                  setEditingMethodId(null);
                }}
                disabled={!!busy}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {settings ? (
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
              className={`badge badge--${settings.smtp.configured ? 'success' : 'warning'}`}
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
              <span>From address</span>
              <input
                value={smtpFrom}
                onChange={(event) => setSmtpFrom(event.target.value)}
                placeholder="no-reply@ecomate.bd"
                aria-label="From address"
              />
            </label>
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
          </div>
          <div className="progress-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void saveSmtp()}
              disabled={!!busy}
            >
              {busy === 'smtp' ? 'Saving…' : 'Save SMTP settings'}
            </button>
          </div>
          <div className="domain-config-grid">
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
            <div className="progress-actions">
              <button
                type="button"
                className="button"
                onClick={() => void sendTestEmail()}
                disabled={!!busy || !testEmail.trim()}
              >
                {busy === 'smtp-test' ? 'Sending…' : 'Send test email'}
              </button>
              {!settings.smtp.configured ? (
                <p className="muted-note">
                  SMTP is not configured yet — sending will show the setup
                  error until it is.
                </p>
              ) : null}
            </div>
          </div>
          {testResult ? (
            <p className="muted-note" role="status">
              {testResult}
            </p>
          ) : null}
        </section>
      ) : null}

      {settings ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Trial and grace defaults</h2>
              <p>
                Applied to new plans and tenants that do not set their own
                values. A plan version&apos;s own values always win.
              </p>
            </div>
          </div>
          <div className="domain-config-grid">
            <label className="inline-field">
              <span>Default trial days</span>
              <input
                type="number"
                min="0"
                max="365"
                value={trialDays}
                onChange={(event) => setTrialDays(event.target.value)}
                aria-label="Default trial days"
              />
            </label>
            <label className="inline-field">
              <span>Default grace days</span>
              <input
                type="number"
                min="0"
                max="90"
                value={graceDays}
                onChange={(event) => setGraceDays(event.target.value)}
                aria-label="Default grace days"
              />
            </label>
          </div>
          <div className="progress-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void saveTrial()}
              disabled={!!busy}
            >
              {busy === 'trial' ? 'Saving…' : 'Save trial defaults'}
            </button>
          </div>
        </section>
      ) : null}

      {settings ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Tax</h2>
              <p>
                Default tax for invoices. It applies to new invoices; the
                label shows on the invoice itself.
              </p>
            </div>
          </div>
          <div className="domain-config-grid">
            <label className="inline-field">
              <span>Tax rate (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={taxRate}
                onChange={(event) => setTaxRate(event.target.value)}
                aria-label="Tax rate percent"
              />
            </label>
            <label className="inline-field">
              <span>Tax label</span>
              <input
                value={taxLabel}
                onChange={(event) => setTaxLabel(event.target.value)}
                placeholder="VAT"
                aria-label="Tax label"
              />
            </label>
            <div className="domain-flags">
              <label>
                <input
                  type="checkbox"
                  checked={taxInclusive}
                  onChange={(event) => setTaxInclusive(event.target.checked)}
                />
                Prices include tax
              </label>
            </div>
          </div>
          <div className="progress-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void saveTax()}
              disabled={!!busy}
            >
              {busy === 'tax' ? 'Saving…' : 'Save tax settings'}
            </button>
          </div>
        </section>
      ) : null}

      {settings ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Branding</h2>
              <p>
                The platform name, logo and favicon appear in this console —
                sidebar, tab title, login page — and in outgoing platform
                emails. Changes apply as soon as you save.
              </p>
            </div>
          </div>
          <div className="domain-config-grid">
            <label className="inline-field">
              <span>Platform name</span>
              <input
                value={platformName}
                onChange={(event) => setPlatformName(event.target.value)}
                aria-label="Platform name"
              />
            </label>
            <label className="inline-field">
              <span>Support email</span>
              <input
                type="email"
                value={supportEmail}
                onChange={(event) => setSupportEmail(event.target.value)}
                placeholder="support@ecomate.bd"
                aria-label="Support email"
              />
            </label>
            <label className="inline-field">
              <span>Logo URL</span>
              {logoUrl.startsWith('data:') ? (
                <span className="muted-note">
                  Uploaded image — see the preview below. Clear it to use a
                  URL again.
                </span>
              ) : (
                <input
                  value={logoUrl}
                  onChange={(event) => setLogoUrl(event.target.value)}
                  placeholder="https://… (optional)"
                  aria-label="Logo URL"
                />
              )}
            </label>
            <label className="inline-field">
              <span>Favicon URL</span>
              {faviconUrl.startsWith('data:') ? (
                <span className="muted-note">
                  Uploaded image — see the preview below. Clear it to use a
                  URL again.
                </span>
              ) : (
                <input
                  value={faviconUrl}
                  onChange={(event) => setFaviconUrl(event.target.value)}
                  placeholder="https://… (optional, falls back to the logo)"
                  aria-label="Favicon URL"
                />
              )}
            </label>
          </div>
          <div className="domain-config-grid" style={{ marginTop: 14 }}>
            <div>
              <p className="muted-note">Logo file (max 200 KB)</p>
              <div className="upload-box">
                {logoUrl ? (
                  <img
                    className="logo-preview"
                    src={logoUrl}
                    alt="Logo preview"
                  />
                ) : null}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  aria-label="Upload a logo file"
                  onChange={(event) => {
                    void uploadLogo(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                {logoUrl ? (
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => setLogoUrl('')}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
            <div>
              <p className="muted-note">Favicon file (max 100 KB)</p>
              <div className="upload-box">
                {faviconUrl ? (
                  <img
                    className="logo-preview logo-preview--favicon"
                    src={faviconUrl}
                    alt="Favicon preview"
                  />
                ) : null}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  aria-label="Upload a favicon file"
                  onChange={(event) => {
                    void uploadFavicon(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                {faviconUrl ? (
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => setFaviconUrl('')}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="progress-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => void saveBranding()}
              disabled={!!busy}
            >
              {busy === 'branding' ? 'Saving…' : 'Save branding'}
            </button>
          </div>
        </section>
      ) : null}

      {settings ? (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Maintenance</h2>
              <p>
                While maintenance is on, the platform API refuses writes
                except sign-in, health, internal sync and these settings.
                Reads keep working.
              </p>
            </div>
          </div>
          <div className="domain-flags">
            <label>
              <input
                type="checkbox"
                checked={maintenanceEnabled}
                onChange={(event) =>
                  setMaintenanceEnabled(event.target.checked)
                }
              />
              Maintenance mode is on
            </label>
          </div>
          <div className="domain-config-grid">
            <label className="inline-field">
              <span>Message shown to API clients</span>
              <input
                value={maintenanceMessage}
                onChange={(event) =>
                  setMaintenanceMessage(event.target.value)
                }
                placeholder="We are upgrading the platform. Please try again soon."
                aria-label="Maintenance message"
              />
            </label>
          </div>
          <div className="progress-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                if (maintenanceEnabled && !settings?.maintenance.enabled) {
                  setConfirm({ kind: 'maintenance-enable' });
                } else {
                  void saveMaintenance();
                }
              }}
              disabled={!!busy}
            >
              {busy === 'maintenance' ? 'Saving…' : 'Save maintenance'}
            </button>
          </div>
        </section>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          open
          title={
            confirm.kind === 'maintenance-enable'
              ? 'Enable maintenance mode?'
              : confirm.kind === 'method-toggle'
                ? confirm.method.isActive
                  ? `Deactivate ${confirm.method.name}?`
                  : `Activate ${confirm.method.name}?`
                : `Delete ${confirm.method.name}?`
          }
          body={
            confirm.kind === 'maintenance-enable'
              ? 'Writes are blocked platform-wide except sign-in, health, internal sync and these settings. Reads keep working.'
              : confirm.kind === 'method-toggle'
                ? confirm.method.isActive
                  ? 'Tenants will no longer see this method when they pay. Existing proofs and payments are unaffected.'
                  : 'Tenants will see this method when they pay an invoice.'
                : 'Methods referenced by proofs or payments cannot be deleted — deactivate them instead.'
          }
          confirmLabel={
            confirm.kind === 'maintenance-enable'
              ? 'Enable maintenance'
              : confirm.kind === 'method-toggle'
                ? confirm.method.isActive
                  ? 'Deactivate'
                  : 'Activate'
                : 'Delete method'
          }
          danger={
            confirm.kind === 'method-delete' ||
            (confirm.kind === 'method-toggle' && confirm.method.isActive)
          }
          busy={
            confirm.kind === 'maintenance-enable'
              ? busy === 'maintenance'
              : busy === `method-${confirm.method.id}`
          }
          onConfirm={async () => {
            const current = confirm;
            setConfirm(null);
            if (current.kind === 'maintenance-enable') await saveMaintenance();
            else if (current.kind === 'method-toggle')
              await toggleMethod(current.method);
            else await deleteMethod(current.method);
          }}
          onClose={() => setConfirm(null)}
        />
      ) : null}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Domains</h2>
            <p>
              Primary, base and fallback domains live on the Domains page so
              there is one place to change them.
            </p>
          </div>
          <Link to="/domains" className="button">
            Open Domains
          </Link>
        </div>
      </section>
    </>
  );
}

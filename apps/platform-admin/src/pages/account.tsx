import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { QrCode } from '../components/qr-code';
import { ErrorNote, Loading, PageHeader, StatusBadge } from '../components/ui';
import { errorMessage, readJson } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { groupSecret } from '../lib/mfa';
import { roleLabel } from '../lib/users';
import type { PlatformUser } from '../types';

interface MfaStatus {
  enabled: boolean;
  required: boolean;
  recoveryCodesRemaining: number;
}

export function AccountPage() {
  const { api, session } = useAuth();
  const [profile, setProfile] = useState<PlatformUser | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaSetup, setMfaSetup] = useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const next = await api('/auth/me').then((r) =>
        readJson<PlatformUser>(r),
      );
      setProfile(next);
      const status = await api('/auth/mfa/status').then((r) =>
        readJson<MfaStatus>(r),
      );
      setMfaStatus(status);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy('password');
    setError(null);
    setNotice(null);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }).then((r) => readJson(r));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice(
        'Password changed. All other sessions were signed out; this session keeps working until its access token expires.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const user = profile ?? session?.user ?? null;

  async function startSetup() {
    setBusy('mfa-setup');
    setError(null);
    setNotice(null);
    setMfaRecoveryCodes([]);
    try {
      const next = await api('/auth/mfa/setup', { method: 'POST' }).then((r) =>
        readJson<{ secret: string; otpauthUrl: string }>(r),
      );
      setMfaSetup(next);
      setMfaCode('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function verifySetup(event: React.FormEvent) {
    event.preventDefault();
    setBusy('mfa-verify');
    setError(null);
    setNotice(null);
    try {
      const result = await api('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ code: mfaCode.trim() }),
      }).then((r) => readJson<{ recoveryCodes: string[] }>(r));
      setMfaRecoveryCodes(result.recoveryCodes);
      setMfaSetup(null);
      setMfaCode('');
      setNotice('Two-factor authentication is now enabled.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function disableMfa(event: React.FormEvent) {
    event.preventDefault();
    setBusy('mfa-disable');
    setError(null);
    setNotice(null);
    try {
      await api('/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ code: mfaCode.trim() }),
      }).then((r) => readJson(r));
      setMfaCode('');
      setNotice('Two-factor authentication is now disabled.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function regenerateCodes(event: React.FormEvent) {
    event.preventDefault();
    setBusy('mfa-codes');
    setError(null);
    setNotice(null);
    try {
      const result = await api('/auth/mfa/recovery-codes', {
        method: 'POST',
        body: JSON.stringify({ code: mfaCode.trim() }),
      }).then((r) => readJson<{ recoveryCodes: string[] }>(r));
      setMfaRecoveryCodes(result.recoveryCodes);
      setMfaCode('');
      setNotice('New recovery codes issued. The old ones no longer work.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
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

  return (
    <div>
      <PageHeader
        eyebrow="Platform"
        title="My account"
        description="Your operator profile and password."
      />

      {notice ? <div className="notice notice--success">{notice}</div> : null}
      {error ? <ErrorNote message={error} /> : null}
      {busy === 'load' && !mfaStatus ? <Loading label="Loading profile…" /> : null}

      {user ? (
        <section className="panel">
          <h2>Profile</h2>
          <dl className="detail-list">
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Name</dt>
            <dd>{user.name}</dd>
            <dt>Role</dt>
            <dd>{roleLabel(user.role)}</dd>
            {user.status ? (
              <>
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={user.status} />
                </dd>
              </>
            ) : null}
            <dt>Last login</dt>
            <dd>{formatDateTime(user.lastLoginAt)}</dd>
          </dl>
        </section>
      ) : null}

      <section className="panel">
        <h2>Two-factor authentication</h2>
        {mfaStatus ? (
          <>
            <p className="muted-note">
              {mfaStatus.enabled
                ? `Enabled. ${mfaStatus.recoveryCodesRemaining} recovery code${mfaStatus.recoveryCodesRemaining === 1 ? '' : 's'} left.`
                : mfaStatus.required
                  ? 'Not enabled yet — superadmin accounts must enroll before they can sign in.'
                  : 'Not enabled. Optional for your role, recommended for everyone with console access.'}
            </p>
            {!mfaStatus.enabled && !mfaSetup ? (
              <div className="form-actions">
                <button type="button" className="button button--primary" onClick={() => void startSetup()} disabled={busy === 'mfa-setup'}>
                  {busy === 'mfa-setup' ? 'Starting…' : 'Set up two-factor authentication'}
                </button>
              </div>
            ) : null}
            {!mfaStatus.enabled && mfaSetup ? (
              <>
                <p className="muted-note">
                  Scan the code with your authenticator app, or add the key
                  manually, then enter a code to confirm:
                </p>
                <QrCode
                  value={mfaSetup.otpauthUrl}
                  label="Scan this QR code with your authenticator app"
                />
                <p className="mono">{groupSecret(mfaSetup.secret)}</p>
                <div className="button-row">
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => copyText(mfaSetup.secret)}
                  >
                    {copied ? 'Copied' : 'Copy key'}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => copyText(mfaSetup.otpauthUrl)}
                  >
                    Copy setup link
                  </button>
                </div>
                <form className="inline-form" onSubmit={verifySetup}>
                  <label>
                    Code from your authenticator app
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      required
                      placeholder="123456"
                    />
                  </label>
                  <div className="form-actions">
                    <button type="submit" className="button button--primary" disabled={busy === 'mfa-verify'}>
                      {busy === 'mfa-verify' ? 'Verifying…' : 'Verify and enable'}
                    </button>
                  </div>
                </form>
              </>
            ) : null}
            {mfaStatus.enabled ? (
              <>
                <form className="inline-form" onSubmit={regenerateCodes}>
                  <label>
                    Current code (to issue new recovery codes)
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                      required
                      placeholder="123456"
                    />
                  </label>
                  <div className="form-actions">
                    <button type="submit" className="button" disabled={busy === 'mfa-codes'}>
                      {busy === 'mfa-codes'
                        ? 'Issuing…'
                        : 'Issue new recovery codes'}
                    </button>
                  </div>
                </form>
                {mfaStatus.required ? (
                  <p className="muted-note">
                    Superadmin accounts must keep MFA enabled. If you lose
                    your device, another superadmin can reset it from the
                    users list.
                  </p>
                ) : (
                  <form className="inline-form" onSubmit={disableMfa}>
                    <div className="form-actions">
                      <button type="submit" className="button button--danger" disabled={busy === 'mfa-disable'}>
                        {busy === 'mfa-disable'
                          ? 'Disabling…'
                          : 'Disable two-factor authentication'}
                      </button>
                    </div>
                    <p className="muted-note">
                      Disabling needs the same code field above.
                    </p>
                  </form>
                )}
              </>
            ) : null}
          </>
        ) : null}
        {mfaRecoveryCodes.length > 0 ? (
          <>
            <p className="muted-note">
              Save these recovery codes somewhere safe — each one signs you in
              once if you lose your authenticator. They are shown only this
              once.
            </p>
            <ul className="mono">
              {mfaRecoveryCodes.map((rc) => (
                <li key={rc}>{rc}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="panel">
        <h2>Change password</h2>
        <p className="muted-note">
          At least 12 characters. Changing your password signs out all other
          sessions.
        </p>
        <form className="inline-form" onSubmit={changePassword}>
          <label>
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={12}
              required
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={12}
              required
              autoComplete="new-password"
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={busy === 'password'}>
              Change password
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

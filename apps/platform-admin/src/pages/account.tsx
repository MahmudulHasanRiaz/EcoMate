import { useLocation } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { QrCode } from '../components/qr-code';
import { ErrorNote, Modal, PageHeader, Skeleton, StatusBadge } from '../components/ui';
import { errorMessage, readJson } from '../lib/api';
import type { BaClientError } from '../lib/ba-auth-errors';
import { baErrorMessage } from '../lib/ba-auth-errors';
import { authClient } from '../lib/better-auth-client';
import { formatDateTime } from '../lib/format';
import { extractTotpSecret, groupSecret } from '../lib/mfa';
import { roleLabel } from '../lib/users';
import type { PlatformUser } from '../types';

interface MfaStatus {
  enabled: boolean;
  required: boolean;
  /** Legacy mode only — BA exposes no backup-code count. */
  recoveryCodesRemaining?: number;
}

/** Throw a readable error when a BA client call came back with `error`. */
function throwBaError(
  error: unknown,
  fallback: string,
): void {
  if (error) throw new Error(baErrorMessage(error as BaClientError, fallback));
}

export function AccountPage() {
  const { api, session, isCentralBa } = useAuth();
  const [profile, setProfile] = useState<PlatformUser | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [mfaSetup, setMfaSetup] = useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  // Central-ba mode: BA's enable/disable/regenerate calls need password
  // proof (not a TOTP code), so the forms ask for a password instead.
  const [setupPassword, setSetupPassword] = useState('');
  const [regenPassword, setRegenPassword] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  // Backup codes issued by `twoFactor.enable`, shown after verify.
  const [pendingBackupCodes, setPendingBackupCodes] = useState<string[]>([]);
  const [mfaCode, setMfaCode] = useState('');
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
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
      if (isCentralBa) {
        // Central-ba mode: GET /auth/mfa/status is 410 (the legacy MFA
        // controller is gated off). /auth/me is the status source — the
        // shim derives mfaEnabled from BA twoFactorEnabled.
        setMfaStatus({
          enabled: next.mfaEnabled ?? false,
          required: next.mfaRequired ?? false,
        });
        return;
      }
      const status = await api('/auth/mfa/status').then((r) =>
        readJson<MfaStatus>(r),
      );
      setMfaStatus(status);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [api, isCentralBa]);

  useEffect(() => {
    void load();
  }, [load]);

  // The account menu links here with a hash (#profile, #password): scroll
  // to the section once the page has rendered. TanStack Router does not
  // scroll to hashes on its own. Depends on the hash too, so clicking
  // "Change password" while already on /account still scrolls.
  const location = useLocation();
  useEffect(() => {
    const hash = location.hash?.slice(1);
    if (!hash) return;
    const target = document.getElementById(hash);
    if (target) target.scrollIntoView({ block: 'start' });
  }, [location.hash, profile, mfaStatus]);

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
        isCentralBa
          ? 'Password changed. All other sessions were signed out; this session keeps working.'
          : 'Password changed. All other sessions were signed out; this session keeps working until its access token expires.',
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
      if (isCentralBa) {
        // BA `twoFactor.enable` needs password proof and returns the
        // TOTP URI + the one-time backup codes in one call.
        if (!setupPassword) {
          setError('Enter your password to start two-factor setup.');
          return;
        }
        const { data, error } = await authClient.twoFactor.enable({
          password: setupPassword,
        });
        throwBaError(error, 'Could not start two-factor setup.');
        if (!data || data.method !== 'totp') {
          throw new Error('Could not start two-factor setup.');
        }
        setPendingBackupCodes(data.backupCodes ?? []);
        setMfaSetup({
          secret: extractTotpSecret(data.totpURI),
          otpauthUrl: data.totpURI,
        });
        setSetupPassword('');
        setMfaCode('');
        return;
      }
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
      if (isCentralBa) {
        // Verifying the code completes enrolment; the backup codes came
        // from `enable` and are shown once here.
        const { error } = await authClient.twoFactor.verifyTotp({
          code: mfaCode.trim(),
        });
        throwBaError(error, 'Invalid code. Please try again.');
        setMfaRecoveryCodes(pendingBackupCodes);
        setPendingBackupCodes([]);
        setMfaSetup(null);
        setMfaCode('');
        setNotice('Two-factor authentication is now enabled.');
        await load();
        return;
      }
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

  // AC3/AC4: disabling MFA is a destructive action — it goes through a
  // danger confirm dialog with its OWN code field. The old form submitted
  // directly from a danger button and shared the regenerate form's code
  // field ("Disabling needs the same code field above").
  async function disableMfa(event: React.FormEvent) {
    event.preventDefault();
    setBusy('mfa-disable');
    setError(null);
    setNotice(null);
    try {
      if (isCentralBa) {
        // BA `twoFactor.disable` needs password proof, not a code.
        // The SUPERADMIN button is hidden by the UI below (server-side
        // enforcement of that rule does not exist on the BA side — see
        // BUILD-SUMMARY).
        const { error } = await authClient.twoFactor.disable({
          password: disablePassword,
        });
        throwBaError(error, 'Could not disable two-factor authentication.');
        setDisablePassword('');
        setDisableOpen(false);
        setNotice('Two-factor authentication is now disabled.');
        await load();
        return;
      }
      await api('/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ code: disableCode.trim() }),
      }).then((r) => readJson(r));
      setDisableCode('');
      setDisableOpen(false);
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
      if (isCentralBa) {
        // BA `generateBackupCodes` needs password proof, not a code.
        if (!regenPassword) {
          setError('Enter your password to issue new recovery codes.');
          return;
        }
        const { data, error } =
          await authClient.twoFactor.generateBackupCodes({
            password: regenPassword,
          });
        throwBaError(error, 'Could not issue new recovery codes.');
        setMfaRecoveryCodes(data?.backupCodes ?? []);
        setRegenPassword('');
        setNotice('New recovery codes issued. The old ones no longer work.');
        await load();
        return;
      }
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
      {busy === 'load' && !mfaStatus ? <Skeleton /> : null}

      {user ? (
        <section className="card" id="profile">
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

      <section className="card">
        <h2>Two-factor authentication</h2>
        {mfaStatus ? (
          <>
            <p className="muted-note">
              {mfaStatus.enabled
                ? mfaStatus.recoveryCodesRemaining !== undefined
                  ? `Enabled. ${mfaStatus.recoveryCodesRemaining} recovery code${mfaStatus.recoveryCodesRemaining === 1 ? '' : 's'} left.`
                  : 'Enabled.'
                : mfaStatus.required
                  ? 'Not enabled yet — superadmin accounts must enroll before they can sign in.'
                  : 'Not enabled. Optional for your role, recommended for everyone with console access.'}
            </p>
            {!mfaStatus.enabled && !mfaSetup ? (
              <div className="form-actions">
                {isCentralBa ? (
                  <label>
                    Your password (to confirm it is you)
                    <input
                      type="password"
                      value={setupPassword}
                      onChange={(e) => setSetupPassword(e.target.value)}
                      autoComplete="current-password"
                      placeholder="••••••••••••"
                    />
                  </label>
                ) : null}
                <button type="button" className="button button--accent" onClick={() => void startSetup()} disabled={busy === 'mfa-setup'}>
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
                    <button type="submit" className="button button--accent" disabled={busy === 'mfa-verify'}>
                      {busy === 'mfa-verify' ? 'Verifying…' : 'Verify and enable'}
                    </button>
                  </div>
                </form>
              </>
            ) : null}
            {mfaStatus.enabled ? (
              <>
                <form className="inline-form" onSubmit={regenerateCodes}>
                  {isCentralBa ? (
                    <label>
                      Your password (to issue new recovery codes)
                      <input
                        type="password"
                        value={regenPassword}
                        onChange={(e) => setRegenPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        placeholder="••••••••••••"
                      />
                    </label>
                  ) : (
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
                  )}
                  <div className="form-actions">
                    <button type="submit" className="button button--accent" disabled={busy === 'mfa-codes'}>
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
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => setDisableOpen(true)}
                    >
                      Disable two-factor authentication
                    </button>
                  </div>
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
            <ul className="recovery-codes">
              {mfaRecoveryCodes.map((rc) => (
                <li key={rc}>{rc}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <Modal
        open={disableOpen}
        title="Disable two-factor authentication?"
        onClose={() => setDisableOpen(false)}
      >
        <p className="muted-note">
          Your account will no longer require a code at sign-in.{' '}
          {isCentralBa
            ? 'Enter your password to confirm.'
            : 'Enter a code from your authenticator app to confirm.'}
        </p>
        <form className="inline-form" onSubmit={disableMfa}>
          {isCentralBa ? (
            <label>
              Your password
              <input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••••••"
              />
            </label>
          ) : (
            <label>
              Current code
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                required
                placeholder="123456"
              />
            </label>
          )}
          <div className="form-actions">
            <button
              type="submit"
              className="button button--danger-solid"
              disabled={
                busy === 'mfa-disable' ||
                (isCentralBa ? !disablePassword.trim() : !disableCode.trim())
              }
            >
              {busy === 'mfa-disable'
                ? 'Disabling…'
                : 'Disable two-factor authentication'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setDisableOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <section className="card" id="password">
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
            <button type="submit" className="button button--accent" disabled={busy === 'password'}>
              Change password
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

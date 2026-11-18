import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../auth';
import { errorMessage, readJson } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { roleLabel } from '../lib/users';
import { ErrorNote, Modal, useToast } from './ui';
import type { PlatformUser } from '../types';

interface MfaStatus {
  enabled: boolean;
  required: boolean;
  recoveryCodesRemaining: number;
}

/**
 * Profile + Change password dialogs (live StackMate: centred ~480px
 * modals reached from the account menu, not pages).
 *
 * DECISION (apply round): the dialogs cover identity + password only.
 * MFA setup / verify / disable + recovery codes stay on the /account
 * page — the QR enrollment flow (scan + manual key + verify + one-time
 * recovery codes) is too large for a 480px dialog, and /account remains
 * the MFA management surface. The Profile dialog's 2FA row links there
 * ("Manage two-factor"), so MFA is one click away, never dropped.
 *
 * Name is READ-ONLY in the Profile dialog: no profile-update endpoint
 * exists (verified — the auth module has no PATCH /auth/me), and the
 * /account page shows it read-only too. Adding name editing is a
 * separate backend decision, not part of this round.
 */
export function ProfileDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { api, session } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<PlatformUser | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setProfile(null);
    setMfaStatus(null);
    Promise.all([
      api('/auth/me').then((r) => readJson<PlatformUser>(r)),
      api('/auth/mfa/status').then((r) => readJson<MfaStatus>(r)),
    ])
      .then(([nextProfile, nextStatus]) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setMfaStatus(nextStatus);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, api]);

  const user = profile ?? session?.user ?? null;

  return (
    <Modal open={open} title="Profile" onClose={onClose}>
      {error ? <ErrorNote message={error} /> : null}
      {user ? (
        <dl className="detail-list">
          <dt>Name</dt>
          <dd>{user.name}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd>{roleLabel(user.role)}</dd>
          {user.status ? (
            <>
              <dt>Status</dt>
              <dd>{user.status}</dd>
            </>
          ) : null}
          <dt>Last login</dt>
          <dd>{formatDateTime(user.lastLoginAt)}</dd>
          <dt>Two-factor auth</dt>
          <dd>
            {mfaStatus ? (
              <>
                <span
                  className={`badge badge--${mfaStatus.enabled ? 'accent' : 'neutral'}`}
                >
                  {mfaStatus.enabled ? 'Enabled' : 'Disabled'}
                </span>{' '}
                {mfaStatus.enabled
                  ? `${mfaStatus.recoveryCodesRemaining} recovery code${mfaStatus.recoveryCodesRemaining === 1 ? '' : 's'} left.`
                  : mfaStatus.required
                    ? 'Required for superadmin accounts.'
                    : 'Optional for your role.'}
              </>
            ) : (
              'Loading…'
            )}
          </dd>
        </dl>
      ) : (
        <p className="muted-note">Loading profile…</p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            onClose();
            void navigate({ to: '/account' });
          }}
        >
          Manage two-factor
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export function ChangePasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { api } = useAuth();
  const { pushToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fresh fields on every open.
  useEffect(() => {
    if (!open) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setBusy(false);
  }, [open ]);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }).then((r) => readJson(r));
      pushToast(
        'Password changed. All other sessions were signed out.',
        'success',
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Change password" onClose={onClose}>
      <p className="muted-note">
        At least 12 characters. Changing your password signs out all other
        sessions.
      </p>
      {error ? <ErrorNote message={error} /> : null}
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
        <div className="form-actions dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button button--accent"
            disabled={busy}
          >
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

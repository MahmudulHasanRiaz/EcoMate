import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { ErrorNote, Loading, PageHeader, StatusBadge } from '../components/ui';
import { errorMessage, readJson } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { roleLabel } from '../lib/users';
import type { PlatformUser } from '../types';

export function AccountPage() {
  const { api, session } = useAuth();
  const [profile, setProfile] = useState<PlatformUser | null>(null);

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

  return (
    <div>
      <PageHeader
        eyebrow="Platform"
        title="My account"
        description="Your operator profile and password."
      />

      {notice ? <div className="notice notice--success">{notice}</div> : null}
      {error ? <ErrorNote message={error} /> : null}
      {busy === 'load' ? <Loading label="Loading profile…" /> : null}

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
            <button type="submit" disabled={busy === 'password'}>
              Change password
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { ConfirmDialog, ErrorNote, PageHeader, Skeleton, StatusBadge } from '../components/ui';
import { errorMessage, readJson } from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  accessLabel,
  PLATFORM_ROLES,
  roleLabel,
  sessionDeviceLabel,
} from '../lib/users';
import type {
  Page,
  PlatformSession,
  PlatformUser,
  PlatformUserInvite,
  RoleMatrixEntry,
} from '../types';

type UserConfirm =
  | { kind: 'reset'; user: PlatformUser }
  | { kind: 'delete'; user: PlatformUser }
  | { kind: 'status'; user: PlatformUser }
  | { kind: 'revoke'; invite: PlatformUserInvite }
  | { kind: 'revokeSession'; user: PlatformUser; session: PlatformSession }
  | { kind: 'resetTotp'; user: PlatformUser }
  | null;

export function UsersPage() {
  const { api, session } = useAuth();
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [invites, setInvites] = useState<PlatformUserInvite[]>([]);
  const [roles, setRoles] = useState<RoleMatrixEntry[]>([]);

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('SUPPORT');
  const [newPassword, setNewPassword] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('SUPPORT');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('SUPPORT');
  const [editStatus, setEditStatus] = useState('ACTIVE');

  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [tempPasswordFor, setTempPasswordFor] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [confirm, setConfirm] = useState<UserConfirm>(null);
  const [totpReason, setTotpReason] = useState('');

  // Per-operator sessions (CMS item 15): one expanded user at a time.
  const [sessionsUser, setSessionsUser] = useState<PlatformUser | null>(null);
  const [sessions, setSessions] = useState<PlatformSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const [nextUsers, nextInvites, nextRoles] = await Promise.all([
        api('/users?limit=100').then((r) =>
          readJson<Page<PlatformUser>>(r),
        ),
        api('/users/invites').then((r) =>
          readJson<{ data: PlatformUserInvite[] }>(r),
        ),
        api('/users/roles').then((r) =>
          readJson<{ roles: RoleMatrixEntry[] }>(r),
        ),
      ]);
      setUsers(nextUsers.data);
      setInvites(nextInvites.data);
      setRoles(nextRoles.roles);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy('create');
    setError(null);
    setNotice(null);
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          email: newEmail.trim(),
          name: newName.trim(),
          role: newRole,
          password: newPassword,
        }),
      }).then((r) => readJson(r));
      setNewEmail('');
      setNewName('');
      setNewPassword('');
      setNotice('Platform user created.');
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    setBusy('invite');
    setError(null);
    setNotice(null);
    try {
      const result = await api('/users/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail.trim(),
          name: inviteName.trim(),
          role: inviteRole,
        }),
      }).then((r) =>
        readJson<{
          delivered: boolean;
          acceptUrl?: string;
          deliveryError?: string;
        }>(r),
      );
      setInviteEmail('');
      setInviteName('');
      setInviteLinkCopied(false);
      if (result.delivered) {
        setInviteLink(null);
        setNotice('Invite sent.');
      } else {
        // The invite is kept server-side and the link is returned so the
        // operator can share it manually until SMTP is configured.
        setInviteLink(result.acceptUrl ?? null);
        setNotice(
          result.deliveryError
            ? `Invite created, but the email could not be sent (${result.deliveryError}). Share the link below manually.`
            : 'Invite created, but the email could not be sent. Share the link below manually.',
        );
      }
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function startEdit(user: PlatformUser) {
    setEditingId(user.id);
    setEditName(user.name);
    setEditRole(user.role);
    setEditStatus(user.status ?? 'ACTIVE');
    setNotice(null);
    setError(null);
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setBusy('edit');
    setError(null);
    setNotice(null);
    try {
      await api(`/users/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim(),
          role: editRole,
          status: editStatus,
        }),
      }).then((r) => readJson(r));
      setEditingId(null);
      setNotice('Platform user updated.');
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleStatus(user: PlatformUser) {
    const next = user.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED';
    setBusy(`status-${user.id}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      }).then((r) => readJson(r));
      setNotice(
        next === 'DISABLED' ? 'Account disabled.' : 'Account enabled.',
      );
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(user: PlatformUser) {
    setBusy(`reset-${user.id}`);
    setError(null);
    setNotice(null);
    setTempPassword(null);
    try {
      const result = await api(`/users/${user.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).then((r) => readJson<{ temporaryPassword: string }>(r));
      setTempPassword(result.temporaryPassword);
      setTempPasswordFor(user.email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteUser(user: PlatformUser) {
    setBusy(`delete-${user.id}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/users/${user.id}`, { method: 'DELETE' }).then((r) =>
        readJson(r),
      );
      setNotice('Platform user deleted.');
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function revokeInvite(invite: PlatformUserInvite) {
    setBusy(`revoke-${invite.id}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/users/invites/${invite.id}`, { method: 'DELETE' }).then(
        (r) => readJson(r),
      );
      setNotice('Invite revoked.');
      setRefresh((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function loadSessions(user: PlatformUser) {
    setSessionsUser(user);
    setSessionsLoading(true);
    setError(null);
    try {
      const result = await api(`/users/${user.id}/sessions`).then((r) =>
        readJson<{ data: PlatformSession[] }>(r),
      );
      setSessions(result.data);
    } catch (err) {
      setError(errorMessage(err));
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }

  async function revokeSession(user: PlatformUser, session: PlatformSession) {
    setBusy(`revoke-session-${session.id}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/users/${user.id}/sessions/${session.id}`, {
        method: 'DELETE',
      }).then((r) => readJson(r));
      setNotice('Session revoked. The device is signed out.');
      await loadSessions(user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function resetTotp(user: PlatformUser, reason: string) {
    setBusy(`reset-totp-${user.id}`);
    setError(null);
    setNotice(null);
    try {
      await api(`/users/${user.id}/totp/reset`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      }).then((r) => readJson(r));
      setNotice(
        `TOTP reset for ${user.email}. They must re-enroll their authenticator at next sign-in.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Platform"
        title="Users & roles"
        description="Operator accounts for the SaaS console. Only superadmins manage users."
      />

      {notice ? <div className="notice notice--success">{notice}</div> : null}
      {error ? <ErrorNote message={error} /> : null}
      {tempPassword ? (
        <div className="notice notice--warning" role="alert">
          Temporary password for {tempPasswordFor}:{' '}
          <code>{tempPassword}</code> — shown once. Share it out of band; the
          user should change it after signing in.{' '}
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => setTempPassword(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {busy === 'load' ? <Skeleton /> : null}

      <section className="card">
        <h2>Platform users</h2>
        {users.length === 0 && busy !== 'load' ? (
          <p className="muted-note">No platform users found.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last login</th>
                  <th>Actions</th>
                </tr>
              </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>{user.name}</td>
                  <td>{roleLabel(user.role)}</td>
                  <td>
                    <StatusBadge status={user.status ?? 'ACTIVE'} />
                  </td>
                  <td>{formatDateTime(user.lastLoginAt)}</td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => startEdit(user)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      disabled={user.id === session?.user.id}
                      onClick={() => setConfirm({ kind: 'status', user })}
                    >
                      {user.status === 'DISABLED' ? 'Enable' : 'Disable'}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      disabled={user.id === session?.user.id}
                      onClick={() => setConfirm({ kind: 'reset', user })}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => void loadSessions(user)}
                    >
                      Sessions
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      disabled={user.id === session?.user.id}
                      title={
                        user.id === session?.user.id
                          ? 'Manage your own MFA from your account page'
                          : 'Clear their TOTP enrollment — they re-enroll at next sign-in'
                      }
                      onClick={() => {
                        setTotpReason('');
                        setConfirm({ kind: 'resetTotp', user });
                      }}
                    >
                      Reset TOTP
                    </button>
                    <button
                      type="button"
                      className="button button--danger button--sm"
                      disabled={
                        user.id === session?.user.id ||
                        user.status !== 'DISABLED'
                      }
                      title={
                        user.status !== 'DISABLED'
                          ? 'Disable the account first'
                          : undefined
                      }
                      onClick={() => setConfirm({ kind: 'delete', user })}
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

        {editingId ? (
          <form className="inline-form" onSubmit={saveEdit}>
            <h3>Edit user</h3>
            <label>
              Name
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
            </label>
            <label>
              Role
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
              >
                {PLATFORM_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
              >
                <option value="ACTIVE">Active</option>
                <option value="DISABLED">Disabled</option>
              </select>
            </label>
            <div className="form-actions">
              <button
                type="submit"
                className="button button--accent"
                disabled={busy === 'edit'}
              >
                Save changes
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setEditingId(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {sessionsUser ? (
        <section className="card">
          <h2>Sessions for {sessionsUser.email}</h2>
          <p className="muted-note">
            One row per signed-in device. Revoking a session signs that
            device out everywhere it refreshed from. Last used tracks the
            last sign-in or token refresh, not the last page view.
          </p>
          {sessionsLoading ? (
            <Skeleton />
          ) : sessions.length === 0 ? (
            <p className="muted-note">No sessions found.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>IP address</th>
                    <th>Last used</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((item) => (
                    <tr key={item.id}>
                      <td title={item.userAgent ?? undefined}>
                        {sessionDeviceLabel(item.userAgent)}
                      </td>
                      <td>{item.ipAddress ?? '—'}</td>
                      <td>{formatDateTime(item.lastUsedAt)}</td>
                      <td>{formatDateTime(item.expiresAt)}</td>
                      <td>
                        <StatusBadge
                          status={item.revoked ? 'REVOKED' : 'ACTIVE'}
                        />
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="button button--danger button--sm"
                          disabled={
                            item.revoked ||
                            busy === `revoke-session-${item.id}`
                          }
                          onClick={() =>
                            setConfirm({
                              kind: 'revokeSession',
                              user: sessionsUser,
                              session: item,
                            })
                          }
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setSessionsUser(null)}
            >
              Close sessions
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>Create user</h2>
        <p className="muted-note">
          Creates an account with a password you set. Prefer invites when the
          person should choose their own password.
        </p>
        <form className="inline-form" onSubmit={createUser}>
          <label>
            Email
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Name
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
          </label>
          <label>
            Role
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              {PLATFORM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={12}
              required
              autoComplete="new-password"
            />
          </label>
          <div className="form-actions">
            <button
              type="submit"
              className="button button--accent"
              disabled={busy === 'create'}
            >
              Create user
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Invite by email</h2>
        <p className="muted-note">
          The invite link is valid for 72 hours. Inviting the same email again
          replaces the pending invite.
        </p>
        <form className="inline-form" onSubmit={sendInvite}>
          <label>
            Email
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Name
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              required
            />
          </label>
          <label>
            Role
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              {PLATFORM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button
              type="submit"
              className="button button--accent"
              disabled={busy === 'invite'}
            >
              Send invite
            </button>
          </div>
        </form>
        {inviteLink ? (
          <div className="notice notice--warning" role="status">
            Invite link (share manually — email is not configured):{' '}
            <code className="break">{inviteLink}</code>{' '}
            <button
              type="button"
              className="button button--sm"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(inviteLink)
                  .then(() => setInviteLinkCopied(true))
                  .catch(() => undefined);
              }}
            >
              {inviteLinkCopied ? 'Copied' : 'Copy link'}
            </button>{' '}
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => setInviteLink(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <h3>Pending invites</h3>
        {invites.length === 0 ? (
          <p className="muted-note">No pending invites.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.email}</td>
                    <td>{invite.name}</td>
                    <td>{roleLabel(invite.role)}</td>
                    <td>{formatDateTime(invite.expiresAt)}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="button button--danger button--sm"
                        onClick={() => setConfirm({ kind: 'revoke', invite })}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Role matrix</h2>
        <p className="muted-note">
          What each role can do, as enforced by the platform API.
        </p>
        {roles.length === 0 ? (
          <p className="muted-note">Role matrix unavailable.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Role</th>
                {roles[0].capabilities.map((cap) => (
                  <th key={cap.area}>{cap.area}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map((entry) => (
                <tr key={entry.role}>
                  <td>
                    <strong>{roleLabel(entry.role)}</strong>
                    <div className="muted-note">{entry.description}</div>
                  </td>
                  {entry.capabilities.map((cap) => (
                    <td key={cap.area} title={cap.note}>
                      {accessLabel(cap.access)}
                    </td>
                  ))}
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirm ? (
        <ConfirmDialog
          open
          title={
            confirm.kind === 'reset'
              ? `Reset password for ${confirm.user.email}?`
              : confirm.kind === 'delete'
                ? `Delete ${confirm.user.email}?`
                : confirm.kind === 'status'
                  ? confirm.user.status === 'DISABLED'
                    ? `Enable ${confirm.user.email}?`
                    : `Disable ${confirm.user.email}?`
                  : confirm.kind === 'revokeSession'
                    ? `Revoke this session for ${confirm.user.email}?`
                    : confirm.kind === 'resetTotp'
                      ? `Reset TOTP for ${confirm.user.email}?`
                      : `Revoke the invite for ${confirm.invite.email}?`
          }
          body={
            confirm.kind === 'reset'
              ? 'All of their sessions will be signed out. A temporary password is shown once — share it out of band.'
              : confirm.kind === 'delete'
                ? 'This cannot be undone. Their audit history is kept, with the actor cleared.'
                : confirm.kind === 'status'
                  ? confirm.user.status === 'DISABLED'
                    ? 'The account can sign in again.'
                    : 'The account is signed out and can no longer sign in until re-enabled.'
                  : confirm.kind === 'revokeSession'
                    ? `The ${sessionDeviceLabel(confirm.session.userAgent)} session (${confirm.session.ipAddress ?? 'unknown IP'}) is signed out immediately.`
                    : confirm.kind === 'resetTotp'
                      ? (
                          <span>
                            Their authenticator enrollment and recovery codes
                            are cleared and all of their sessions are signed
                            out. They must enroll a new authenticator at next
                            sign-in.
                            <label className="inline-field">
                              <span>
                                Reason (optional, kept in the audit log)
                              </span>
                              <textarea
                                aria-label="Reason"
                                value={totpReason}
                                maxLength={500}
                                rows={2}
                                onChange={(e) =>
                                  setTotpReason(e.target.value)
                                }
                                placeholder="e.g. Lost authenticator device"
                              />
                            </label>
                          </span>
                        )
                      : 'The invite link stops working immediately.'
          }
          confirmLabel={
            confirm.kind === 'reset'
              ? 'Reset password'
              : confirm.kind === 'delete'
                ? 'Delete user'
                : confirm.kind === 'status'
                  ? confirm.user.status === 'DISABLED'
                    ? 'Enable account'
                    : 'Disable account'
                  : confirm.kind === 'revokeSession'
                    ? 'Revoke session'
                    : confirm.kind === 'resetTotp'
                      ? 'Reset TOTP'
                      : 'Revoke invite'
          }
          danger={
            confirm.kind === 'delete' ||
            confirm.kind === 'revokeSession' ||
            confirm.kind === 'resetTotp' ||
            (confirm.kind === 'status' &&
              confirm.user.status !== 'DISABLED')
          }
          busy={
            confirm.kind === 'revoke'
              ? busy === `revoke-${confirm.invite.id}`
              : confirm.kind === 'reset'
                ? busy === `reset-${confirm.user.id}`
                : confirm.kind === 'delete'
                  ? busy === `delete-${confirm.user.id}`
                  : confirm.kind === 'revokeSession'
                    ? busy === `revoke-session-${confirm.session.id}`
                    : confirm.kind === 'resetTotp'
                      ? busy === `reset-totp-${confirm.user.id}`
                      : busy === `status-${confirm.user.id}`
          }
          onConfirm={async () => {
            const current = confirm;
            const reason = totpReason;
            setConfirm(null);
            if (current.kind === 'reset') await resetPassword(current.user);
            else if (current.kind === 'delete') await deleteUser(current.user);
            else if (current.kind === 'status') await toggleStatus(current.user);
            else if (current.kind === 'revokeSession')
              await revokeSession(current.user, current.session);
            else if (current.kind === 'resetTotp')
              await resetTotp(current.user, reason);
            else await revokeInvite(current.invite);
          }}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

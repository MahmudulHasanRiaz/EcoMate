import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { ErrorNote, Loading, PageHeader, StatusBadge } from '../components/ui';
import { errorMessage, readJson } from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  accessLabel,
  PLATFORM_ROLES,
  roleLabel,
} from '../lib/users';
import type {
  Page,
  PlatformUser,
  PlatformUserInvite,
  RoleMatrixEntry,
} from '../types';

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
      }).then((r) => readJson<{ delivered: boolean }>(r));
      setInviteEmail('');
      setInviteName('');
      setNotice(
        result.delivered
          ? 'Invite sent.'
          : 'Invite created, but email is not configured — the link was logged on the server.',
      );
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
    if (
      !window.confirm(
        `Reset the password for ${user.email}? All of their sessions will be signed out.`,
      )
    ) {
      return;
    }
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
    if (
      !window.confirm(
        `Delete ${user.email}? This cannot be undone. Their audit history is kept, with the actor cleared.`,
      )
    ) {
      return;
    }
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
          <button type="button" onClick={() => setTempPassword(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {busy === 'load' ? <Loading label="Loading users…" /> : null}

      <section className="panel">
        <h2>Platform users</h2>
        {users.length === 0 && busy !== 'load' ? (
          <p className="muted-note">No platform users found.</p>
        ) : (
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
                    <button type="button" onClick={() => startEdit(user)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={user.id === session?.user.id}
                      onClick={() => void toggleStatus(user)}
                    >
                      {user.status === 'DISABLED' ? 'Enable' : 'Disable'}
                    </button>
                    <button
                      type="button"
                      disabled={user.id === session?.user.id}
                      onClick={() => void resetPassword(user)}
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      disabled={
                        user.id === session?.user.id ||
                        user.status !== 'DISABLED'
                      }
                      title={
                        user.status !== 'DISABLED'
                          ? 'Disable the account first'
                          : undefined
                      }
                      onClick={() => void deleteUser(user)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
              <button type="submit" disabled={busy === 'edit'}>
                Save changes
              </button>
              <button type="button" onClick={() => setEditingId(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="panel">
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
            <button type="submit" disabled={busy === 'create'}>
              Create user
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
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
            <button type="submit" disabled={busy === 'invite'}>
              Send invite
            </button>
          </div>
        </form>

        {invites.length > 0 ? (
          <>
            <h3>Pending invites</h3>
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
                        onClick={() => void revokeInvite(invite)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </section>

      <section className="panel">
        <h2>Role matrix</h2>
        <p className="muted-note">
          What each role can do, as enforced by the platform API.
        </p>
        {roles.length === 0 ? (
          <p className="muted-note">Role matrix unavailable.</p>
        ) : (
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
        )}
      </section>
    </div>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import {
  createUser,
  deleteUser,
  getStoredUser,
  listUsers,
  type AuthUser,
  updateUser,
} from '../api';
import { PageHeader, Panel } from '../components/ui';

export default function UsersPage() {
  const me = getStoredUser();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setUsers(await listUsers());
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.detail || String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (me?.role !== 'admin') {
    return (
      <div>
        <PageHeader title="Users" lede="Only the household admin can manage accounts." />
        <Panel title="Access denied">Ask your admin to invite you or grant admin rights.</Panel>
      </div>
    );
  }

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createUser({ email, password, displayName, role });
      setEmail('');
      setPassword('');
      setDisplayName('');
      setRole('member');
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not create user');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (user: AuthUser) => {
    if (!confirm(`Remove ${user.email}?`)) return;
    try {
      await deleteUser(user.id);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not delete user');
    }
  };

  const toggleActive = async (user: AuthUser) => {
    try {
      await updateUser(user.id, { active: !user.active });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not update user');
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Users"
        lede="Add your wife, doctor, or caregivers. Everyone who signs in shares the household dashboard."
      />

      {error ? <div className="banner error">{error}</div> : null}

      <Panel title="Add user" subtitle="They will sign in with this email and password">
        <form className="form" onSubmit={onCreate}>
          <label>
            Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Wife / Doctor" />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Temporary password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </form>
      </Panel>

      <Panel title="Household accounts" subtitle={`${users.length} user(s)`}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.displayName}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.active === false ? 'Disabled' : 'Active'}</td>
                  <td className="row-actions">
                    {u.id !== me?.id ? (
                      <>
                        <button className="btn ghost" type="button" onClick={() => toggleActive(u)}>
                          {u.active === false ? 'Enable' : 'Disable'}
                        </button>
                        <button className="btn ghost danger" type="button" onClick={() => onRemove(u)}>
                          Remove
                        </button>
                      </>
                    ) : (
                      <span className="muted">You</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import {
  createUser,
  deleteUser,
  getStoredUser,
  listUsers,
  type AuthUser,
  updateUser,
} from '../api';
import { PageHeader, Panel } from '../components/ui'
import { useLocale } from '../i18n';

export default function UsersPage() {
  const { t } = useLocale();
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
        <PageHeader title={t('users.title')} lede={t('users.lede')} />
        <Panel title={t('users.accessDenied')}>Ask your admin to invite you or grant admin rights.</Panel>
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
        eyebrow={t('users.eyebrow')}
        title={t('users.title')}
        lede={t('users.lede')}
      />

      {error ? <div className="banner error">{error}</div> : null}

      <Panel title={t('users.addUser')} subtitle={t('users.addUser')}>
        <form className="form" onSubmit={onCreate}>
          <label>
            Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Wife / Doctor" />
          </label>
          <label>
            {t('users.email')}
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
            {t('users.role')}
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">{t('common.member')}</option>
              <option value="admin">{t('common.admin')}</option>
            </select>
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : t('users.createUser')}
          </button>
        </form>
      </Panel>

      <Panel title={t('users.household')} subtitle={`${users.length} user(s)`}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('users.name')}</th>
                <th>{t('users.email')}</th>
                <th>{t('users.role')}</th>
                <th>{t('users.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.displayName}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.active === false ? t('users.disabled') : t('users.active')}</td>
                  <td className="row-actions">
                    {u.id !== me?.id ? (
                      <>
                        <button className="btn ghost" type="button" onClick={() => toggleActive(u)}>
                          {u.active === false ? t('users.enable') : t('users.disable')}
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

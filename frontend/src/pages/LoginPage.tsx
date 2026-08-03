import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getApiBase, isLoggedIn, login, setApiBase } from '../api';
import { useLocale } from '../i18n';

export default function LoginPage() {
  const nav = useNavigate();
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (isLoggedIn()) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setApiBase(apiUrl.trim());
      await login(email.trim(), password);
      nav('/', { replace: true });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : t('login.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <img className="brand-mark" src="/brand-logo.png" alt={t('brand.name')} width={44} height={44} />
          <div>
            <strong>{t('brand.name')}</strong>
            <div className="brand-sub">{t('login.subtitle')}</div>
          </div>
        </div>

        <label>
          {t('login.email')}
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          {t('login.password')}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>
        <label>
          {t('login.apiUrl')}
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
        </label>

        {error ? <div className="login-error">{error}</div> : null}

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? t('common.loading') : t('login.submit')}
        </button>
        <p className="login-hint">{t('login.hint')}</p>
      </form>
    </div>
  );
}

import { type ReactNode, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { clearSession, getStoredUser, isLoggedIn } from './api';
import ComposeModal from './components/ComposeModal';
import { useLocale } from './i18n';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import MealsPage from './pages/MealsPage';
import ReportsPage from './pages/ReportsPage';
import ShareReportPage from './pages/ShareReportPage';
import SportsPage from './pages/SportsPage';
import InjuriesPage from './pages/InjuriesPage';
import MentalPage from './pages/MentalPage';
import MorningPage from './pages/MorningPage';
import SettingsPage from './pages/SettingsPage';
import UnderstandingPage from './pages/UnderstandingPage';
import UsersPage from './pages/UsersPage';

function Protected({ children }: { children: ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppShell() {
  const user = getStoredUser();
  const { t } = useLocale();
  const [composeOpen, setComposeOpen] = useState(false);

  const links = [
    { to: '/', label: t('nav.dashboard'), end: true as boolean | undefined },
    { to: '/meals', label: t('nav.meals') },
    { to: '/sports', label: t('nav.sports') },
    { to: '/mental', label: t('nav.mental') },
    { to: '/morning', label: t('nav.morning') },
    { to: '/injuries', label: t('nav.injuries') },
    { to: '/reports', label: t('nav.reports') },
    { to: '/understanding', label: t('nav.understanding'), special: true },
    ...(user?.role === 'admin' ? [{ to: '/users', label: t('nav.users') }] : []),
    { to: '/settings', label: t('nav.settings') },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="/brand-logo.png" alt={t('brand.name')} width={44} height={44} />
          <div>
            <strong>{t('brand.name')}</strong>
            <div className="brand-sub">{t('brand.tagline')}</div>
          </div>
        </div>
        <nav>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                [l.special ? 'nav-life-review' : '', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="label">{t('nav.signedIn')}</div>
          <p>
            {user?.displayName || user?.email || 'User'}
            {user?.role === 'admin' ? ' · admin' : ''}
          </p>
          <button
            type="button"
            className="btn ghost light"
            onClick={() => {
              clearSession();
              window.location.href = '/login';
            }}
          >
            {t('nav.signOut')}
          </button>
          <div className="label" style={{ marginTop: 16 }}>
            {t('nav.reminder')}
          </div>
          <p>{t('nav.reminderBody')}</p>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/meals" element={<MealsPage />} />
          <Route path="/sports" element={<SportsPage />} />
          <Route path="/mental" element={<MentalPage />} />
          <Route path="/morning" element={<MorningPage />} />
          <Route path="/injuries" element={<InjuriesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/understanding" element={<UnderstandingPage />} />
          {/* Life Review superseded by Understanding */}
          <Route path="/life-review" element={<Navigate to="/understanding" replace />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      <button
        type="button"
        className="fab"
        aria-label={t('fab.add')}
        onClick={() => setComposeOpen(true)}
      >
        +
      </button>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSaved={() => window.location.reload()}
      />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/share/:token" element={<ShareReportPage />} />
      <Route
        path="/*"
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      />
    </Routes>
  );
}

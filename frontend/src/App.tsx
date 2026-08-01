import { type ReactNode, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { clearSession, getStoredUser, isLoggedIn } from './api';
import ComposeModal from './components/ComposeModal';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import MealsPage from './pages/MealsPage';
import ReportsPage from './pages/ReportsPage';
import ShareReportPage from './pages/ShareReportPage';
import SportsPage from './pages/SportsPage';
import InjuriesPage from './pages/InjuriesPage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';

function Protected({ children }: { children: ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppShell() {
  const user = getStoredUser();
  const [composeOpen, setComposeOpen] = useState(false);

  const links = [
    { to: '/', label: 'Dashboard', end: true as boolean | undefined },
    { to: '/meals', label: 'Meals' },
    { to: '/sports', label: 'Sports' },
    { to: '/injuries', label: 'Injuries' },
    { to: '/reports', label: 'Reports' },
    ...(user?.role === 'admin' ? [{ to: '/users', label: 'Users' }] : []),
    { to: '/settings', label: 'Settings' },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="/brand-logo.png" alt="Health Companion" width={44} height={44} />
          <div>
            <strong>Health Companion</strong>
            <div className="brand-sub">Diabetes insights</div>
          </div>
        </div>
        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="label">Signed in</div>
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
            Sign out
          </button>
          <div className="label" style={{ marginTop: 16 }}>
            Reminder
          </div>
          <p>
            Meal estimates and suggestions are not medical advice. Confirm carbs when you can.
          </p>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/meals" element={<MealsPage />} />
          <Route path="/sports" element={<SportsPage />} />
          <Route path="/injuries" element={<InjuriesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      <button
        type="button"
        className="fab"
        aria-label="Add entry"
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

import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  unit,
  foot,
  footIcon,
  badge,
  accent = 'teal',
}: {
  label: string;
  value: string | number;
  unit?: string;
  foot?: string;
  /** Optional source icon (e.g. Samsung Health). */
  footIcon?: string;
  badge?: { text: string; tone?: 'default' | 'warn' | 'good' };
  accent?: 'teal' | 'amber' | 'blue' | 'green' | 'rose';
}) {
  return (
    <div className={`stat-card accent-${accent}`}>
      <div className="stat-top">
        <div className="stat-label">{label}</div>
        {badge ? (
          <span className={`stat-badge ${badge.tone === 'warn' ? 'warn' : badge.tone === 'good' ? 'good' : ''}`}>
            {badge.text}
          </span>
        ) : null}
      </div>
      <div className="stat-value">
        {value}
        {unit ? <span className="stat-unit">{unit}</span> : null}
      </div>
      {foot || footIcon ? (
        <div className="stat-foot">
          {footIcon ? <img src={footIcon} alt="" className="stat-foot-icon" /> : null}
          {foot ? <span>{foot}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function TirRing({ value }: { value: number | null }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const r = 58;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const color = value == null ? '#cbd5e1' : pct >= 70 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div className="ring-wrap">
      <div className="ring-box">
        <svg width="160" height="160" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
          <circle
            cx="80"
            cy="80"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            transform="rotate(-90 80 80)"
          />
        </svg>
        <div className="ring-center">
          <strong>{value == null ? '—' : `${Math.round(pct)}%`}</strong>
          <span>time in range</span>
        </div>
      </div>
    </div>
  );
}

export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.id} type="button" className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ChartTooltipBox({ active, payload, label, unit = '' }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: '#0f172a',
        color: '#fff',
        borderRadius: 10,
        padding: '8px 10px',
        fontSize: 12,
        boxShadow: '0 8px 20px rgba(15,23,42,0.25)',
      }}
    >
      <div style={{ opacity: 0.7, marginBottom: 4 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ fontWeight: 700 }}>
          {p.name}: {typeof p.value === 'number' ? Math.round(p.value * 10) / 10 : p.value}
          {unit}
        </div>
      ))}
    </div>
  );
}

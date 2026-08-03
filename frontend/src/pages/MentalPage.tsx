import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  deleteCaffeineLog,
  fetchCaffeineLogs,
  fetchDashboard,
  fetchDayCheckIns,
  fetchStressLogs,
} from '../api';
import { PageHeader, Panel, StatCard } from '../components/ui'
import { useLocale } from '../i18n';

const MOOD_SCALE: Record<string, number> = {
  terrible: 1,
  low: 2,
  ok: 3,
  good: 4,
  great: 5,
};

const INTENSITY_SCALE: Record<string, number> = {
  low: 1,
  ok: 2,
  high: 3,
};

const TASK_SCALE: Record<string, number> = {
  stuck: 1,
  slow: 2,
  ok: 3,
  easy: 4,
};

const MOOD_LABELS = ['', 'Terrible', 'Low', 'OK', 'Good', 'Great'];
const INTENSITY_LABELS = ['', 'Low', 'OK', 'High'];
const TASK_LABELS = ['', 'Stuck', 'Slow', 'OK', 'Easy'];

function AdhdTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div
      style={{
        background: '#0f172a',
        color: '#fff',
        borderRadius: 10,
        padding: '8px 10px',
        fontSize: 12,
        boxShadow: '0 8px 20px rgba(15,23,42,0.25)',
        maxWidth: 260,
      }}
    >
      <div style={{ opacity: 0.7, marginBottom: 6 }}>{label}</div>
      <div style={{ fontWeight: 700 }}>Mood: {row.moodLabel || '—'}</div>
      <div style={{ fontWeight: 700 }}>Focus: {row.focusLabel || '—'}</div>
      <div style={{ fontWeight: 700 }}>Overwhelm: {row.overwhelmLabel || '—'}</div>
      <div style={{ fontWeight: 700 }}>Restlessness: {row.restlessnessLabel || '—'}</div>
      <div style={{ fontWeight: 700 }}>Task start: {row.taskLabel || '—'}</div>
      <div style={{ fontWeight: 700 }}>Impulsivity: {row.impulsivityLabel || '—'}</div>
      {row.medicationTaken || row.hyperfocus || row.sleepHours != null ? (
        <div style={{ marginTop: 6, opacity: 0.85 }}>
          {[
            row.medicationTaken ? 'Meds' : null,
            row.hyperfocus ? 'Hyperfocus' : null,
            row.sleepHours != null ? `Sleep ${row.sleepHours}h` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      ) : null}
    </div>
  );
}

export default function MentalPage() {
  const { t } = useLocale();
  const [dash, setDash] = useState<any>(null);
  const [caffeine, setCaffeine] = useState<any[]>([]);
  const [stress, setStress] = useState<any[]>([]);
  const [checkIns, setCheckIns] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetchDashboard(),
      fetchCaffeineLogs(),
      fetchStressLogs(),
      fetchDayCheckIns(42),
    ])
      .then(([d, caf, str, days]) => {
        setDash(d);
        setCaffeine(Array.isArray(caf) ? caf : []);
        setStress(Array.isArray(str) ? str : []);
        setCheckIns(Array.isArray(days) ? days : []);
        setError(null);
      })
      .catch((e) => setError(String(e?.response?.data?.detail || e.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const adhdChart = useMemo(() => {
    const byDate = new Map<string, any>();
    for (const row of checkIns) {
      if (!row?.date) continue;
      if (!byDate.has(row.date)) byDate.set(row.date, row);
    }
    return [...byDate.values()]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((row) => {
        const mood = MOOD_SCALE[row.mood] ?? null;
        const focus = MOOD_SCALE[row.focus] ?? null;
        const overwhelm = INTENSITY_SCALE[row.overwhelm] ?? null;
        const restlessness = INTENSITY_SCALE[row.restlessness] ?? null;
        const task = TASK_SCALE[row.taskInitiation] ?? null;
        const impulsivity = INTENSITY_SCALE[row.impulsivity] ?? null;
        return {
          date: String(row.date).slice(5),
          fullDate: row.date,
          mood,
          focus,
          overwhelm,
          restlessness,
          task,
          impulsivity,
          moodLabel: row.moodLabel || MOOD_LABELS[mood ?? 0] || row.mood,
          focusLabel: row.focusLabel || MOOD_LABELS[focus ?? 0] || row.focus,
          overwhelmLabel:
            row.overwhelmLabel || INTENSITY_LABELS[overwhelm ?? 0] || row.overwhelm,
          restlessnessLabel:
            row.restlessnessLabel || INTENSITY_LABELS[restlessness ?? 0] || row.restlessness,
          taskLabel: row.taskInitiationLabel || TASK_LABELS[task ?? 0] || row.taskInitiation,
          impulsivityLabel:
            row.impulsivityLabel || INTENSITY_LABELS[impulsivity ?? 0] || row.impulsivity,
          medicationTaken: !!row.medicationTaken,
          hyperfocus: !!row.hyperfocus,
          sleepHours: row.sleepHours,
        };
      });
  }, [checkIns]);

  const checkIn = dash?.todayDayCheckIn;
  const energy = dash?.todayEnergyScore;
  const todayCaf = dash?.todayCaffeineLogs || [];
  const todayMg = dash?.todayCaffeineMg ?? 0;
  const samsungStress = (dash?.todayStressLogs || []).find((s: any) => s.source === 'samsung_energy');
  const manualStress = (dash?.todayStressLogs || []).filter((s: any) => s.source !== 'samsung_energy');

  const removeCaf = async (id: string) => {
    if (!window.confirm(t('mental.deleteCaffeine'))) return;
    try {
      await deleteCaffeineLog(id);
      load();
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t('mental.eyebrow')}
        title={t('mental.title')}
        lede="Mood & ADHD check-in, caffeine, manual stress, and Samsung Energy Score (readiness proxy — continuous stress isn’t available to third-party apps)."
        actions={
          <button className="btn secondary" type="button" onClick={load}>
            Refresh
          </button>
        }
      />

      {error ? <p className="error">{error}</p> : null}
      {loading && !dash ? <p className="muted">{t('common.loading')}</p> : null}

      <div className="stat-grid">
        <StatCard
          label={t('mental.energyScore')}
          value={energy != null ? Math.round(energy) : '—'}
          foot="Samsung Health readiness"
          footIcon={energy != null ? '/icons/icon-samsung.png' : undefined}
          accent="teal"
        />
        <StatCard
          label={t('mental.caffeineToday')}
          value={todayMg || '—'}
          unit={todayMg ? 'mg' : undefined}
          foot={todayCaf.length ? `${todayCaf.length} drink(s)` : t('mental.useCaffeine')}
          accent="amber"
        />
        <StatCard
          label={t('mental.focus')}
          value={checkIn?.focusLabel || checkIn?.focus || '—'}
          foot={checkIn ? 'From today’s check-in' : t('mental.logCheckIn')}
          accent="blue"
        />
        <StatCard
          label={t('mental.overwhelm')}
          value={checkIn?.overwhelmLabel || checkIn?.overwhelm || '—'}
          foot={
            checkIn?.medicationTaken
              ? t('mental.medsTaken')
              : checkIn?.hyperfocus
                ? t('mental.hyperfocus')
                : t('mental.adhdCheckIn')
          }
          accent="rose"
        />
      </div>

      <Panel
        title={t('mental.adhdByDay')}
        subtitle="Focus, mood, task start (higher better) · overwhelm, restlessness, impulsivity (lower better)"
      >
        {adhdChart.length === 0 ? (
          <p className="muted">
            No check-ins yet. Use + → Check-in for a few days and the trend will show here.
          </p>
        ) : (
          <div className="chart-wrap tall">
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={adhdChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[1, 5]}
                  ticks={[1, 2, 3, 4, 5]}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip content={<AdhdTooltip />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="focus"
                  name={t('mental.focus')} stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="mood"
                  name={t('mental.mood')} stroke="#0d9488"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="task"
                  name={t('mental.taskStart')} stroke="#7c3aed"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="overwhelm"
                  name={t('mental.overwhelm')} stroke="#e11d48"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="restlessness"
                  name={t('mental.restlessness')} stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="impulsivity"
                  name={t('mental.impulsivity')} stroke="#64748b"
                  strokeWidth={2}
                  strokeDasharray="2 3"
                  dot={{ r: 3 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Scale: mood/focus 1–5 · overwhelm/restlessness/impulsivity 1–3 · task start 1–4. Hover a
              day for labels.
            </p>
          </div>
        )}
      </Panel>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <Panel title={t('mental.todayCheckIn')} subtitle={t('compose.checkinBlurb')}>
          {!checkIn ? (
            <p className="muted">{t('mental.noCheckInYet')}</p>
          ) : (
            <div className="meal-list">
              <div className="meal-row">
                <div>
                  <strong>
                    Mood {checkIn.moodLabel || checkIn.mood} · woke{' '}
                    {checkIn.wakeQualityLabel || checkIn.wakeQuality}
                  </strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Focus {checkIn.focusLabel || checkIn.focus || '—'} · restlessness{' '}
                    {checkIn.restlessnessLabel || checkIn.restlessness || '—'} · overwhelm{' '}
                    {checkIn.overwhelmLabel || checkIn.overwhelm || '—'}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Task start {checkIn.taskInitiationLabel || checkIn.taskInitiation || '—'} ·
                    impulsivity {checkIn.impulsivityLabel || checkIn.impulsivity || '—'}
                    {checkIn.sleepHours != null ? ` · sleep ${checkIn.sleepHours}h` : ''}
                    {checkIn.medicationTaken ? ' · meds' : ''}
                    {checkIn.hyperfocus ? ' · hyperfocus' : ''}
                  </div>
                  {checkIn.notes ? (
                    <div className="muted" style={{ fontSize: 12 }}>{checkIn.notes}</div>
                  ) : null}
                </div>
                <span className="stat-badge">Check-in</span>
              </div>
            </div>
          )}
        </Panel>

        <Panel title={t('mental.stressToday')} subtitle={t('mental.stressToday')}>
          {!samsungStress && manualStress.length === 0 ? (
            <p className="muted">Sync Activity for Energy Score, or log stress with +.</p>
          ) : (
            <div className="meal-list">
              {samsungStress ? (
                <div className="meal-row">
                  <div>
                    <strong>{samsungStress.levelLabel || samsungStress.level}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Score {samsungStress.score ?? '—'} · Samsung Energy Score
                    </div>
                  </div>
                  <span className="stat-badge good">Samsung</span>
                </div>
              ) : null}
              {manualStress.map((s: any) => (
                <div key={s.id} className="meal-row">
                  <div>
                    <strong>{s.levelLabel || s.level}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {s.score != null ? `Score ${s.score}` : t('mental.manual')}
                      {s.notes ? ` · ${s.notes}` : ''}
                    </div>
                  </div>
                  <span
                    className={`stat-badge ${
                      s.level === 'calm' ? 'good' : s.level === 'high' ? 'bad' : ''
                    }`}
                  >
                    {s.levelLabel || s.level}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <Panel title={t('mental.caffeineToday')} subtitle={t('compose.caffeineBlurb')}>
          {todayCaf.length === 0 ? (
            <p className="muted">Nothing logged. Use + → Caffeine.</p>
          ) : (
            <div className="meal-list">
              {todayCaf.map((c: any) => (
                <div key={c.id} className="meal-row">
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <img src="/icons/icon-caffeine.png" alt="" width={36} height={36} style={{ borderRadius: 9 }} />
                    <div>
                      <strong>{c.drinkLabel || c.drink}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {c.caffeineMg} mg{c.time ? ` · ${c.time}` : ''}
                        {c.notes ? ` · ${c.notes}` : ''}
                      </div>
                    </div>
                  </div>
                  <button type="button" className="btn ghost" onClick={() => removeCaf(c.id)}>
                    {t('common.delete')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={t('mental.recentCaffeine')} subtitle={t('mental.recentCaffeine')}>
          {caffeine.length === 0 ? (
            <p className="muted">{t('mental.noHistory')}</p>
          ) : (
            <div className="meal-list">
              {caffeine.slice(0, 12).map((c: any) => (
                <div key={c.id} className="meal-row">
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <img src="/icons/icon-caffeine.png" alt="" width={36} height={36} style={{ borderRadius: 9 }} />
                    <div>
                      <strong>{c.drinkLabel || c.drink}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {c.date} · {c.caffeineMg} mg
                      </div>
                    </div>
                  </div>
                  <span className="stat-badge">{c.caffeineMg} mg</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t('mental.recentStress')} subtitle={t('mental.recentStress')}>
        {stress.length === 0 ? (
          <p className="muted">{t('mental.noStress')}</p>
        ) : (
          <div className="meal-list">
            {stress.slice(0, 14).map((s: any) => (
              <div key={s.id} className="meal-row">
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <img
                    src={
                      s.source === 'samsung_energy'
                        ? '/icons/icon-samsung.png'
                        : '/icons/icon-stress.png'
                    }
                    alt=""
                    width={36}
                    height={36}
                    style={{ borderRadius: 9 }}
                  />
                  <div>
                    <strong>{s.levelLabel || s.level}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {s.date}
                      {s.score != null ? ` · ${s.score}` : ''}
                      {s.source === 'samsung_energy' ? ' · Samsung Energy' : ' · Manual'}
                    </div>
                  </div>
                </div>
                <span
                  className={`stat-badge ${
                    s.level === 'calm' ? 'good' : s.level === 'high' ? 'bad' : ''
                  }`}
                >
                  {s.sourceLabel || s.source || t('mental.manual')}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {adhdChart.length > 0 ? (
        <Panel title={t('mental.checkInHistory')} subtitle={t('mental.newestFirst')}>
          <div className="meal-list">
            {[...checkIns]
              .sort((a, b) => String(b.date).localeCompare(String(a.date)))
              .slice(0, 14)
              .map((c: any) => (
                <div key={c.id} className="meal-row">
                  <div>
                    <strong>
                      {c.date} · focus {c.focusLabel || c.focus || '—'} · overwhelm{' '}
                      {c.overwhelmLabel || c.overwhelm || '—'}
                    </strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Mood {c.moodLabel || c.mood} · task{' '}
                      {c.taskInitiationLabel || c.taskInitiation || '—'}
                      {c.medicationTaken ? ' · meds' : ''}
                      {c.hyperfocus ? ' · hyperfocus' : ''}
                    </div>
                  </div>
                  <span className="stat-badge">Check-in</span>
                </div>
              ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

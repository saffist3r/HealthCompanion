import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchActivity, fetchCareVisits, fetchSportMatches, fetchWeekly } from '../api';
import { ChartTooltipBox, PageHeader, Panel, StatCard } from '../components/ui'
import { useLocale } from '../i18n';

const SPORT_ICON_KEYS = new Set(['padel', 'gym', 'running', 'cycling', 'swimming', 'walking']);

function sportIconSrc(sport?: string | null, result?: string | null): string {
  const key = (sport || '').toLowerCase();
  if (key === 'gym' || result === 'completed') return '/icons/icon-gym.png';
  if (SPORT_ICON_KEYS.has(key)) return `/icons/icon-${key}.png`;
  if (result === 'win' || result === 'loss' || result === 'draw') return `/icons/icon-${result}.png`;
  return '/icons/icon-padel.png';
}

export default function SportsPage() {
  const { t } = useLocale();
  const [days, setDays] = useState<any[]>([]);
  const [weekly, setWeekly] = useState<any>(null);
  const [care, setCare] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchActivity(21), fetchWeekly(), fetchCareVisits(), fetchSportMatches()])
      .then(([activity, week, careVisits, sportMatches]) => {
        setDays(Array.isArray(activity) ? activity : []);
        setWeekly(week);
        setCare(Array.isArray(careVisits) ? careVisits : []);
        setMatches(Array.isArray(sportMatches) ? sportMatches : []);
      })
      .catch((e) => setError(String(e?.response?.data?.detail || e.message || e)))
      .finally(() => setLoading(false));
  }, []);

  const chartData = useMemo(() => {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map((d) => {
      const workouts = d.workouts || [];
      const workoutMin = workouts.reduce(
        (s: number, w: any) => s + (Number(w.durationMin) || 0),
        0
      );
      return {
        date: String(d.date).slice(5),
        steps: d.steps || 0,
        workoutMin,
        calories: d.caloriesBurned || 0,
        sessions: workouts.length,
      };
    });
  }, [days]);

  const allWorkouts = useMemo(() => {
    const out: any[] = [];
    for (const d of days) {
      for (const w of d.workouts || []) {
        out.push({
          date: d.date,
          name: w.name || 'Workout',
          durationMin: w.durationMin || 0,
          calories: w.calories,
          sportType: w.sportType,
        });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [days]);

  const totals = weekly?.totals || {};
  const localToday = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);
  const today = days.find((d) => d.date === localToday);
  const energyDays = useMemo(
    () =>
      [...days]
        .filter((d) => d.energyScore != null)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [days]
  );

  return (
    <div>
      <PageHeader
        eyebrow={t('sports.eyebrow')}
        title={t('sports.title')}
        lede={t('sports.lede')}
      />

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">{t('sports.loading')}</p> : null}

      <div className="stat-grid">
        <StatCard
          label={t('sports.stepsToday')}
          value={(today?.steps ?? 0).toLocaleString()}
          accent="green"
          badge={
            (today?.steps ?? 0) >= 8000
              ? { text: t('sports.goalZone'), tone: 'good' }
              : (today?.steps ?? 0) > 0
                ? { text: t('sports.inProgress') }
                : undefined
          }
        />
        <StatCard
          label={t('sports.workoutMinToday')}
          value={(today?.workouts || []).reduce(
            (s: number, w: any) => s + (Number(w.durationMin) || 0),
            0
          )}
          unit="min"
          accent="blue"
          foot={`${(today?.workouts || []).length} session(s)`}
        />
        <StatCard
          label={t('sports.activeKcalToday')}
          value={today?.caloriesBurned != null ? Math.round(today.caloriesBurned) : '—'}
          accent="amber"
        />
        <StatCard
          label={t('sports.weekSteps')}
          value={(totals.totalSteps ?? 0).toLocaleString()}
          accent="green"
        />
        <StatCard
          label={t('sports.weekWorkouts')}
          value={totals.workoutCount ?? 0}
          accent="blue"
          foot={`${totals.workoutMinutes ?? 0} min total`}
        />
        <StatCard
          label={t('sports.padelWeek')}
          value={`${totals.padelWins ?? 0}W–${totals.padelLosses ?? 0}L`}
          accent="green"
          foot={`${totals.sportMatchCount ?? matches.length} session(s)`}
        />
        <StatCard
          label={t('sports.gymWeek')}
          value={totals.gymSessionCount ?? 0}
          accent="blue"
          foot={`${totals.gymMinutes ?? 0} min`}
        />
        <StatCard
          label={t('sports.hyposWeek')}
          value={totals.hypoEventCount ?? 0}
          accent={(totals.hypoEventCount || 0) > 0 ? 'rose' : 'green'}
          foot="Episodes <70 mg/dL"
        />
        <StatCard
          label={t('sports.careVisits')}
          value={totals.careVisitCount ?? care.length}
          accent="teal"
        />
        <StatCard
          label={t('sports.energyToday')}
          value={today?.energyScore != null ? Math.round(today.energyScore) : '—'}
          accent="amber"
          foot="Samsung Health"
          footIcon={today?.energyScore != null ? '/icons/icon-samsung.png' : undefined}
        />        <StatCard
          label={t('sports.weekActiveKcal')}
          value={totals.activeCalories ?? 0}
          accent="amber"
        />
      </div>

      <div className="grid-2">
        <Panel title={t('sports.stepsWorkout')} subtitle={t('sports.stepsWorkout')}>
          {chartData.length === 0 ? (
            <div className="empty-state">
              <div className="big">🏃</div>
              <div>
                No activity yet. On the phone, open <strong>Activity</strong>, connect Health Connect,
                then tap <strong>Sync today to reports</strong>.
              </div>
            </div>
          ) : (
            <div className="chart-wrap tall">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E3350" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#8CA0BC', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fill: '#8CA0BC', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: '#8CA0BC', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltipBox />} />
                  <Legend />
                  <Bar
                    yAxisId="left"
                    dataKey="steps"
                    name="Steps"
                    fill="#00E5FF"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={28}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="workoutMin"
                    name="Workout min"
                    stroke="#00E5FF"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title={t('sports.activeCalories')} subtitle={t('sports.activeCalories')}>
          {chartData.length === 0 ? (
            <p className="muted">Sync activity from the phone to populate this chart.</p>
          ) : (
            <div className="chart-wrap tall">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E3350" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#8CA0BC', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#8CA0BC', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltipBox unit=" kcal" />} />
                  <Bar dataKey="calories" name="Active kcal" fill="#FFB547" radius={[8, 8, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <Panel title={t('sports.recentWorkouts')} subtitle={t('sports.recentWorkouts')}>
        {allWorkouts.length === 0 ? (
          <div className="empty-state">
            <div className="big">🏅</div>
            <div>No workouts synced yet. Record exercise in Samsung Health, then sync from the phone.</div>
          </div>
        ) : (
          <div className="meal-list">
            {allWorkouts.slice(0, 15).map((w, i) => (
              <div key={`${w.date}-${i}`} className="meal-row">
                <div>
                  <strong>{w.name}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {w.date}
                    {w.sportType ? ` · ${w.sportType}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="macros">{w.durationMin} min</div>
                  {w.calories != null ? (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {w.calories} kcal
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid-2">
        <Panel title={t('sports.careVisits')} subtitle={t('sports.careVisits')}>
          {care.length === 0 ? (
            <p className="muted">No care visits yet. Log Kiné / Ostéo / Podologue from Activity.</p>
          ) : (
            <div className="meal-list">
              {care.slice(0, 15).map((v) => (
                <div key={v.id} className="meal-row">
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <img
                      src={`/icons/icon-${v.kind === 'other' ? 'care-other' : v.kind}.png`}
                      alt=""
                      width={40}
                      height={40}
                      style={{ borderRadius: 10 }}
                    />
                    <div>
                      <strong>{v.label || v.kindLabel || v.kind}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {v.date}
                        {v.notes ? ` · ${v.notes}` : ''}
                      </div>
                    </div>
                  </div>
                  <span className="stat-badge">{v.kindLabel || v.kind}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={t('sports.sessions')} subtitle={t('compose.sportBlurb')}>
          {matches.length === 0 ? (
            <p className="muted">{t('sports.noSessions')}</p>
          ) : (
            <div className="meal-list">
              {matches.slice(0, 15).map((m) => (
                <div key={m.id} className="meal-row">
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <img
                      src={sportIconSrc(m.sport, m.result)}
                      alt=""
                      width={40}
                      height={40}
                      style={{ borderRadius: 10 }}
                    />
                    <div>
                      <strong className="capitalize">{m.sport || 'padel'}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {[
                          m.date,
                          m.time,
                          m.durationMin != null ? `${m.durationMin} min` : null,
                          m.intensity ? `intensity ${m.intensity}` : null,
                          m.score || null,
                          m.notes || null,
                          m.opponent ? `vs ${m.opponent}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`stat-badge ${
                      m.result === 'win' || m.result === 'completed'
                        ? 'good'
                        : m.result === 'loss'
                          ? 'bad'
                          : ''
                    }`}
                  >
                    {m.result}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title={t('sports.energyScore')}
        subtitle="Daily readiness from Samsung Health. Continuous Stress isn’t exposed to third-party apps."
        action={
          <img
            src="/icons/icon-samsung.png"
            alt="Samsung Health"
            width={28}
            height={28}
            style={{ borderRadius: 8 }}
          />
        }
      >
        {energyDays.length === 0 ? (
          <p className="muted">
            No Energy Score synced yet. On the phone: Connect Samsung Health → Sync today to reports.
          </p>
        ) : (
          <div className="meal-list">
            {energyDays.slice(0, 20).map((d) => (
              <div key={d.id || d.date} className="meal-row">
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <img
                    src="/icons/icon-samsung.png"
                    alt=""
                    width={40}
                    height={40}
                    style={{ borderRadius: 10 }}
                  />
                  <div>
                    <strong>{Math.round(d.energyScore)}</strong>
                    <div className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <img src="/icons/icon-samsung.png" alt="" width={14} height={14} style={{ borderRadius: 3 }} />
                      {d.date} · Samsung Health
                    </div>
                  </div>
                </div>
                <span className="stat-badge good">Energy</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

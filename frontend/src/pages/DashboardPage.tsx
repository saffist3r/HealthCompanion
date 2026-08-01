import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Link } from 'react-router-dom';
import {
  fetchDashboard,
  fetchGlucoseHistory,
  fetchGlycemiaEvents,
  getApiBase,
  type GlycemiaChartEvent,
} from '../api';
import MealDetailModal from '../components/MealDetailModal';
import { ChartTooltipBox, PageHeader, Panel, Segmented, StatCard, TirRing } from '../components/ui';

type GlycemiaRange = 12 | 24 | 48;

const EVENT_COLORS: Record<GlycemiaChartEvent['type'], string> = {
  meal: '#f59e0b',
  insulin: '#3b82f6',
  pump: '#ef4444',
};

function eventColor(type: GlycemiaChartEvent['type']) {
  return EVENT_COLORS[type] || '#64748b';
}

function nearestMgDl(
  readings: Array<{ valueMgDl: number; timestamp: number }>,
  ts: number
): number {
  if (!readings.length) return 140;
  let best = readings[0];
  let bestDist = Math.abs(readings[0].timestamp - ts);
  for (const r of readings) {
    const d = Math.abs(r.timestamp - ts);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return Math.min(300, Math.max(50, Math.round(best.valueMgDl)));
}

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartMode, setChartMode] = useState<'carbs' | 'glucose' | 'steps'>('glucose');
  const [selectedMeal, setSelectedMeal] = useState<any | null>(null);
  const [glycemiaRange, setGlycemiaRange] = useState<GlycemiaRange>(12);
  const [glycemiaReadings, setGlycemiaReadings] = useState<
    Array<{ valueMgDl: number; timestamp: number }>
  >([]);
  const [glycemiaEvents, setGlycemiaEvents] = useState<GlycemiaChartEvent[]>([]);
  const [showEvents, setShowEvents] = useState(true);
  const [glycemiaLoading, setGlycemiaLoading] = useState(false);

  const load = () => {
    setLoading(true);
    fetchDashboard()
      .then(setData)
      .catch((e) => setError(String(e?.response?.data?.detail || e.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setGlycemiaLoading(true);
    Promise.all([fetchGlucoseHistory(glycemiaRange), fetchGlycemiaEvents(glycemiaRange)])
      .then(([hist, ev]) => {
        if (cancelled) return;
        setGlycemiaReadings(hist.readings || []);
        setGlycemiaEvents(ev.events || []);
      })
      .catch(() => {
        if (cancelled) return;
        setGlycemiaReadings([]);
        setGlycemiaEvents([]);
      })
      .finally(() => {
        if (!cancelled) setGlycemiaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [glycemiaRange]);

  const chartData = useMemo(() => {
    const weekly = data?.weeklyReport?.days || [];
    return weekly.map((d: any) => ({
      date: String(d.date).slice(5),
      carbs: d.nutrition?.macros?.carbsG ?? 0,
      protein: d.nutrition?.macros?.proteinG ?? 0,
      steps: d.activity?.steps ?? 0,
      tir: d.glucose?.timeInRangePct ?? null,
    }));
  }, [data]);

  const glycemiaChartData = useMemo(() => {
    return (glycemiaReadings || []).map((r) => {
      const d = new Date(r.timestamp);
      return {
        t: r.timestamp,
        label: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
        mgDl: Math.round(r.valueMgDl),
      };
    });
  }, [glycemiaReadings]);

  const eventMarkers = useMemo(() => {
    if (!showEvents) return [];
    return (glycemiaEvents || [])
      .filter((e) => e.timestamp != null)
      .map((e) => ({
        ...e,
        t: e.timestamp,
        mgDl: nearestMgDl(glycemiaReadings, e.timestamp),
        timeLabel: new Date(e.timestamp).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        }),
      }));
  }, [glycemiaEvents, glycemiaReadings, showEvents]);

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Overview" title="Today" lede="Loading…" />
        <div className="stat-grid loading-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="stat-card">
              <div className="skeleton" style={{ width: '40%', marginBottom: 18 }} />
              <div className="skeleton" style={{ width: '55%', height: 28 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader eyebrow="Overview" title="Dashboard" />
        <div className="panel">
          <p className="error">{error}</p>
          <button className="btn" type="button" onClick={load} style={{ marginTop: 12 }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const tir = data.timeInRangePct;
  const energyScore = data.todayEnergyScore ?? data.sports?.todayEnergyScore ?? null;
  const fromSamsung = data.todayActivitySource === 'samsung_health';
  const activitySource =
    data.todayActivitySource === 'samsung_health'
      ? 'Samsung Health'
      : data.todayActivitySource === 'watch'
        ? 'Watch'
        : data.todayActivitySource === 'health_connect'
          ? 'Health Connect'
          : null;
  const activityFootIcon =
    data.todayActivitySource === 'samsung_health'
      ? '/icons/icon-samsung.png'
      : data.todayActivitySource === 'watch'
        ? '/icons/icon-watch.png'
        : undefined;
  const calTargets = data.calorieTargets;
  const calBalance = data.calorieBalance;
  const intakeKcal = Math.round(data.todayCaloriesKcal || 0);
  const targetKcal = calTargets?.targetKcal;
  const maintenanceKcal = calTargets?.maintenanceKcal;
  const remaining =
    calBalance?.remainingToTarget != null
      ? Math.round(calBalance.remainingToTarget)
      : targetKcal != null
        ? targetKcal - intakeKcal
        : null;
  const insights = [
    ...(data.dailyReport?.insights || []),
    ...(data.weeklyReport?.insights || []).slice(0, 2),
  ];
  const warnings = data.dailyReport?.warnings || [];
  const meals = data.recentMeals || [];
  const matches = data.todaySportMatches || [];
  const care = data.todayCareVisits || [];
  const injuries = data.todayInjuries || [];
  const workouts = data.todayWorkouts || [];
  const pumpEvents = data.todayPumpEvents || [];

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Today"
        lede="Glucose, meals, and activity — use + to log."
        actions={
          <button className="btn secondary" type="button" onClick={load}>
            Refresh
          </button>
        }
      />

      <div className="stat-grid dash-primary-grid">
        <StatCard
          label="Avg glucose"
          value={data.glucoseAvgMgDl != null ? data.glucoseAvgMgDl : '—'}
          unit={data.glucoseAvgMgDl != null ? 'mg/dL' : undefined}
          accent="amber"
          foot="From CapAPS sync"
        />
        <StatCard
          label="Time in range"
          value={tir != null ? `${Math.round(tir)}%` : '—'}
          accent={tir != null && tir < 50 ? 'rose' : 'green'}
          badge={
            tir == null
              ? undefined
              : tir >= 70
                ? { text: 'On track', tone: 'good' }
                : tir >= 50
                  ? { text: 'Watch', tone: 'warn' }
                  : { text: 'Low TIR', tone: 'warn' }
          }
          foot="Target 70–180 mg/dL"
        />
        <StatCard
          label="Calories"
          value={intakeKcal}
          unit="kcal"
          accent="teal"
          badge={
            remaining == null
              ? undefined
              : remaining >= 0
                ? { text: `${remaining} left`, tone: 'good' }
                : { text: `${Math.abs(remaining)} over`, tone: 'warn' }
          }
          foot={
            targetKcal != null
              ? `Target ${targetKcal} · maint. ${maintenanceKcal}`
              : `${data.todayCarbsG ?? 0}g carbs · ${data.mealCount || 0} meal${(data.mealCount || 0) === 1 ? '' : 's'}`
          }
        />
        <StatCard
          label="Weight"
          value={data.weight?.weightKg ?? calTargets?.weightKg ?? '—'}
          unit={data.weight?.weightKg != null || calTargets?.weightKg != null ? 'kg' : undefined}
          accent="blue"
          foot={
            calTargets?.bmi != null
              ? `BMI ${calTargets.bmi} · deficit −${calTargets.deficitKcal}`
              : 'Log weight in Settings'
          }
        />
        <StatCard
          label="Steps"
          value={Number(data.todaySteps || 0).toLocaleString()}
          accent="green"
          foot={activitySource || 'Sync from phone Activity'}
          footIcon={activityFootIcon}
        />
        <StatCard
          label="Energy"
          value={energyScore != null ? Math.round(energyScore) : '—'}
          accent="amber"
          foot={energyScore != null ? 'Samsung Health readiness' : 'Sync Activity on phone'}
          footIcon={energyScore != null || fromSamsung ? '/icons/icon-samsung.png' : undefined}
        />        <StatCard
          label="Hypos"
          value={data.todayHypoEventCount ?? 0}
          accent={(data.todayHypoEventCount || 0) > 0 ? 'rose' : 'green'}
          foot={
            (data.todayHypoEventCount || 0) > 0
              ? 'Episodes below 70 mg/dL'
              : 'No hypo episodes today'
          }
        />
        <StatCard
          label="Insulin"
          value={data.todayInsulinDeliveredU ?? 0}
          unit="U"
          accent="blue"
          foot={
            (data.todayPumpEventCount || 0) > 0
              ? `${data.todayPumpEventCount} pump event${data.todayPumpEventCount === 1 ? '' : 's'} today`
              : 'From CapAPS notifications'
          }
        />
      </div>

      <Panel
        title="Glycemia"
        subtitle={`Continuous CGM · last ${glycemiaRange} hours`}
        action={
          <div className="glycemia-actions">
            <button
              type="button"
              className={`btn secondary compact ${showEvents ? 'on' : ''}`}
              onClick={() => setShowEvents((v) => !v)}
              title="Show meals, insulin, and pump alerts on the chart"
            >
              Events {showEvents ? 'on' : 'off'}
            </button>
            <Segmented
              value={String(glycemiaRange)}
              onChange={(id) => setGlycemiaRange(Number(id) as GlycemiaRange)}
              options={[
                { id: '12', label: '12h' },
                { id: '24', label: '24h' },
                { id: '48', label: '48h' },
              ]}
            />
          </div>
        }
      >
        <div className="chart-wrap tall">
          {glycemiaLoading ? (
            <p className="muted">Loading chart…</p>
          ) : glycemiaChartData.length < 2 ? (
            <p className="muted">Not enough glucose samples in this window yet. Sync CapAPS from the phone.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={glycemiaChartData}>
                <defs>
                  <linearGradient id="glycemiaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0d9488" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#0d9488" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                  }
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  domain={[50, 300]}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  unit=" "
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0]?.payload;
                    const ts = typeof label === 'number' ? label : p?.t;
                    const nearEvents = showEvents
                      ? eventMarkers.filter((e) => Math.abs(e.t - (ts || 0)) < 8 * 60 * 1000)
                      : [];
                    return (
                      <div className="chart-tooltip-box">
                        <div className="chart-tooltip-label">
                          {p?.label ||
                            (ts
                              ? new Date(ts).toLocaleTimeString(undefined, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '')}
                        </div>
                        <div>
                          Glucose: <strong>{p?.mgDl}</strong> mg/dL
                        </div>
                        {nearEvents.map((e) => (
                          <div key={e.id} style={{ color: eventColor(e.type), marginTop: 4 }}>
                            {e.type === 'meal' ? 'Meal' : e.type === 'insulin' ? 'Insulin' : 'Pump'}:{' '}
                            {e.label}
                            {e.detail ? ` · ${e.detail}` : ''}
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <ReferenceArea y1={70} y2={180} fill="#10b981" fillOpacity={0.08} ifOverflow="extendDomain" />
                {showEvents
                  ? eventMarkers.map((e) => (
                      <ReferenceLine
                        key={e.id}
                        x={e.t}
                        stroke={eventColor(e.type)}
                        strokeDasharray="4 3"
                        strokeOpacity={0.75}
                        strokeWidth={e.type === 'insulin' ? 1.5 : 1.25}
                      />
                    ))
                  : null}
                <Area
                  type="monotone"
                  dataKey="mgDl"
                  name="Glucose"
                  stroke="#0d9488"
                  fill="url(#glycemiaFill)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        {showEvents ? (
          <div className="glycemia-legend">
            <span>
              <i style={{ background: EVENT_COLORS.meal }} /> Meal
            </span>
            <span>
              <i style={{ background: EVENT_COLORS.insulin }} /> Insulin
            </span>
            <span>
              <i style={{ background: EVENT_COLORS.pump }} /> Pump alert
            </span>
            <span className="muted">
              {eventMarkers.length} event{eventMarkers.length === 1 ? '' : 's'} in window
            </span>
          </div>
        ) : null}
      </Panel>
      <div className="grid-2">
        <Panel
          title="This week"
          subtitle="Glucose quality, carbs, or steps"
          action={
            <Segmented
              value={chartMode}
              onChange={(id) => setChartMode(id as typeof chartMode)}
              options={[
                { id: 'glucose', label: 'Glucose' },
                { id: 'carbs', label: 'Carbs' },
                { id: 'steps', label: 'Steps' },
              ]}
            />
          }
        >
          <div className="chart-wrap tall">
            <ResponsiveContainer width="100%" height={280}>
              {chartMode === 'carbs' ? (
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltipBox unit="g" />} />
                  <Bar dataKey="carbs" name="Carbs" fill="#0d9488" radius={[8, 8, 0, 0]} maxBarSize={32} />
                  <Line type="monotone" dataKey="protein" name="Protein" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                </ComposedChart>
              ) : chartMode === 'glucose' ? (
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="tirDash" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltipBox unit="%" />} />
                  <Area
                    type="monotone"
                    dataKey="tir"
                    name="TIR"
                    stroke="#059669"
                    fill="url(#tirDash)"
                    strokeWidth={2.5}
                    connectNulls
                  />
                </AreaChart>
              ) : (
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltipBox />} />
                  <Bar dataKey="steps" name="Steps" fill="#0ea5e9" radius={[8, 8, 0, 0]} maxBarSize={32} />
                </ComposedChart>
              )}
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Glucose band" subtitle="70–180 mg/dL">
          <TirRing value={tir} />
          <p className="muted" style={{ textAlign: 'center', marginTop: 8 }}>
            Avg {data.glucoseAvgMgDl != null ? `${data.glucoseAvgMgDl} mg/dL` : '—'}
          </p>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Insights" subtitle="Today’s report">
          {warnings.length === 0 && insights.length === 0 ? (
            <p className="muted">No notes yet for today.</p>
          ) : (
            <>
              <ul className="insight-list">
                {insights.slice(0, 8).map((i: string, idx: number) => (
                  <li key={idx}>{i}</li>
                ))}
              </ul>
              {warnings.map((w: any, idx: number) => (
                <div key={idx} className={`warn warn-${w.severity}`}>
                  <strong>{w.title}</strong>
                  <p>{w.message}</p>
                </div>
              ))}
            </>
          )}
        </Panel>

        <Panel
          title="Today’s log"
          subtitle="Meals, sport, care, injuries"
          action={
            <Link className="dash-link" to="/injuries">
              Injuries
            </Link>
          }
        >
          {meals.length === 0 &&
          workouts.length === 0 &&
          matches.length === 0 &&
          care.length === 0 &&
          injuries.length === 0 ? (
            <p className="muted">Nothing logged yet. Use + to add an entry.</p>
          ) : (
            <div className="meal-list">
              {meals.slice(0, 4).map((m: any) => (
                <button
                  key={m.id}
                  type="button"
                  className="meal-row meal-row-button"
                  onClick={() => setSelectedMeal(m)}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left' }}>
                    {m.photoUrl ? (
                      <img
                        src={`${getApiBase().replace(/\/$/, '')}${m.photoUrl}`}
                        alt=""
                        width={40}
                        height={40}
                        style={{ borderRadius: 10, objectFit: 'cover' }}
                      />
                    ) : null}
                    <div>
                      <strong className="capitalize">{m.mealType}</strong>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {Math.round(m.macros?.caloriesKcal || 0)} kcal · C {m.macros?.carbsG ?? 0}g · P{' '}
                        {m.macros?.proteinG ?? 0}g · F {m.macros?.fatG ?? 0}g
                      </div>
                    </div>
                  </div>
                  <span className="stat-badge">{new Date(m.eatenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </button>
              ))}
              {workouts.map((w: any, i: number) => (
                <div key={`wo-${i}`} className="meal-row">
                  <div>
                    <strong>{w.name || 'Workout'}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>{w.durationMin || 0} min</div>
                  </div>
                  <span className="stat-badge good">Workout</span>
                </div>
              ))}
              {matches.map((m: any) => (
                <div key={m.id} className="meal-row">
                  <div>
                    <strong className="capitalize">
                      {(m.sport || 'sport').toString()}
                      {m.result && m.result !== 'completed' ? ` · ${m.result}` : ''}
                    </strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {[
                        m.time,
                        m.durationMin != null ? `${m.durationMin} min` : null,
                        m.score,
                        m.notes,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
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
                    {m.result || m.sport}
                  </span>
                </div>
              ))}
              {care.map((c: any) => (
                <div key={c.id} className="meal-row">
                  <div>
                    <strong>{c.kindLabel || c.kind}</strong>
                    {c.label ? <div className="muted" style={{ fontSize: 12 }}>{c.label}</div> : null}
                  </div>
                  <span className="stat-badge">Care</span>
                </div>
              ))}
              {injuries.map((inj: any) => (
                <div key={inj.id} className="meal-row">
                  <div>
                    <strong>{inj.title || inj.bodyAreaLabel || inj.injuryTypeLabel || 'Injury'}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {inj.todayPain
                        ? `Pain ${inj.todayPain.painScore}/10`
                        : inj.statusLabel || inj.status}
                      {inj.exerciseNotes ? ` · ${String(inj.exerciseNotes).slice(0, 40)}` : ''}
                    </div>
                  </div>
                  <span className="stat-badge">Injury</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Pump log events"
        subtitle="Insulin deliveries & CapAPS alerts from the phone"
      >
        {pumpEvents.length === 0 ? (
          <p className="muted">No pump notifications synced yet today.</p>
        ) : (
          <div className="meal-list">
                    {[...pumpEvents].reverse().slice(0, 12).map((e: any) => (
              <div key={e.id} className="meal-row">
                <div>
                  <strong>{e.kindLabel || e.kind}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {e.kind === 'insulin_delivered' && e.units != null
                      ? `Delivered ${e.units} U of insulin`
                      : e.message && e.message !== e.kindLabel
                        ? e.message
                        : e.title && e.title !== e.kindLabel
                          ? e.title
                          : e.units != null
                            ? `${e.units} U`
                            : '—'}
                  </div>
                </div>
                <span
                  className={`stat-badge ${
                    e.kind === 'insulin_delivered'
                      ? 'good'
                      : e.kind === 'low' || e.kind === 'urgent_low' || e.kind === 'reservoir'
                        ? 'warn'
                        : ''
                  }`}
                >
                  {e.kind === 'insulin_delivered' && e.units != null ? `${e.units} U` : e.time || '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <MealDetailModal
        meal={selectedMeal}
        onClose={() => setSelectedMeal(null)}
        onSaved={(updated) => {
          load();
          if ((updated as { deleted?: boolean } | null)?.deleted) {
            setSelectedMeal(null);
            return;
          }
          setSelectedMeal(updated);
        }}
      />
    </div>
  );
}

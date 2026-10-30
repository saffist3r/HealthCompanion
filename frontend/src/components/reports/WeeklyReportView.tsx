import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltipBox, Panel, StatCard } from '../ui';
import { useLocale } from '../../i18n';
import type { GlucoseTargets } from './types';

// Weekly report body (totals, per-day charts, insights).
type WeeklyReportViewProps = {
  weekly: any;
  weekChart: any[];
  glucoseTargets: GlucoseTargets;
};

export function WeeklyReportView({ weekly, weekChart, glucoseTargets }: WeeklyReportViewProps) {
  const { t } = useLocale();
  return (
    <>
      <div className="stat-grid">
        <StatCard
          label={t('reports.weekMeals')}
          value={weekly.totals.mealCount}
          accent="teal"
          foot={`${weekly.weekStart} → ${weekly.weekEnd}`}
        />
        <StatCard
          label={t('reports.calories')}
          value={Math.round(weekly.totals.macros.caloriesKcal || 0)}
          unit="kcal"
          accent="amber"
        />
        <StatCard
          label={t('reports.totalCarbs')}
          value={Math.round(weekly.totals.macros.carbsG)}
          unit="g"
          accent="teal"
        />
        <StatCard
          label={t('reports.avgGlucose')}
          value={weekly.totals.avgGlucoseMgDl ?? '—'}
          unit={weekly.totals.avgGlucoseMgDl != null ? 'mg/dL' : undefined}
          accent="amber"
        />
        <StatCard
          label={t('reports.avgTir')}
          value={weekly.totals.avgTimeInRangePct != null ? `${weekly.totals.avgTimeInRangePct}%` : '—'}
          accent="green"
          badge={
            weekly.totals.avgTimeInRangePct != null &&
            weekly.totals.avgTimeInRangePct >= glucoseTargets.goal
              ? { text: t('reports.strongWeek'), tone: 'good' }
              : undefined
          }
        />
        <StatCard
          label={t('reports.totalSteps')}
          value={weekly.totals.totalSteps.toLocaleString()}
          accent="blue"
        />
        <StatCard
          label={t('reports.workouts')}
          value={weekly.totals.workoutCount ?? 0}
          accent="blue"
          foot={`${weekly.totals.workoutMinutes ?? 0} min`}
        />
        <StatCard
          label={t('reports.activeKcal')}
          value={weekly.totals.activeCalories ?? 0}
          accent="amber"
        />
        <StatCard
          label={t('reports.careVisits')}
          value={weekly.totals.careVisitCount ?? 0}
          accent="teal"
        />
        <StatCard
          label={t('reports.padel')}
          value={`${weekly.totals.padelWins ?? 0}W–${weekly.totals.padelLosses ?? 0}L`}
          accent="green"
          foot={`${weekly.totals.sportMatchCount ?? 0} match(es)`}
        />
        <StatCard
          label={t('reports.stress')}
          value={weekly.totals.stressLogCount ?? 0}
          accent="amber"
          foot={
            (weekly.totals.stressHighCount ?? 0) > 0
              ? `${weekly.totals.stressHighCount} high`
              : t('reports.checkIns')
          }
        />
        <StatCard
          label={t('reports.proteinTotal')}
          value={Math.round(weekly.totals.macros.proteinG)}
          unit="g"
          accent="blue"
        />
      </div>

      <div className="grid-2">
        <Panel title={t('reports.macrosByDay')} subtitle="Carbs vs protein vs fat (g)">
          <div className="chart-wrap tall">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={weekChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E3350" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#8CA0BC', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8CA0BC', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltipBox unit="g" />} />
                <Legend />
                <Bar dataKey="carbs" name={t('reports.carbs')} stackId="a" fill="#22D3EE" radius={[0, 0, 0, 0]} />
                <Bar dataKey="protein" name={t('reports.protein')} stackId="a" fill="#00E5FF" />
                <Bar dataKey="fat" name={t('reports.fat')} stackId="a" fill="#FFB547" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title={t('reports.glucoseSports')} subtitle="Avg glucose, steps, and workout minutes">
          <div className="chart-wrap tall">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={weekChart}>
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
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="avg"
                  name={t('reports.avgGlucose')} stroke="#FFB547"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="steps"
                  name={t('reports.steps')} stroke="#00E5FF"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="workoutMin"
                  name={t('reports.workoutMin')} stroke="#22D3EE"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {(weekly.workouts || []).length > 0 ? (
        <Panel title={t('reports.workoutsWeek')} subtitle={t('reports.workoutsWeek')}>
          <div className="meal-list">
            {weekly.workouts.map((w: any, i: number) => (
              <div key={i} className="meal-row">
                <div>
                  <strong>{w.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {w.date} · {w.durationMin} min
                    {w.calories != null ? ` · ${w.calories} kcal` : ''}
                  </div>
                </div>
                <span className="stat-badge good">Sport</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {(weekly.careVisits || []).length > 0 ||
      (weekly.sportMatches || []).length > 0 ||
      (weekly.stressLogs || []).length > 0 ||
      (weekly.dayCheckIns || []).length > 0 ? (
        <div className="grid-2">
          <Panel title="Care visits this week" subtitle={t('compose.careBlurb')}>
            {(weekly.careVisits || []).length === 0 ? (
              <p className="muted">None logged.</p>
            ) : (
              <div className="meal-list">
                {weekly.careVisits.map((v: any) => (
                  <div key={v.id} className="meal-row">
                    <div>
                      <strong>{v.label || v.kindLabel || v.kind}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>{v.date}</div>
                    </div>
                    <span className="stat-badge">{v.kindLabel || v.kind}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title={t('reports.matchesWeek')} subtitle={t('reports.padelResults')}>
            {(weekly.sportMatches || []).length === 0 ? (
              <p className="muted">None logged.</p>
            ) : (
              <div className="meal-list">
                {weekly.sportMatches.map((m: any) => (
                  <div key={m.id} className="meal-row">
                    <div>
                      <strong>{(m.sport || 'match').toString()}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {m.date}
                        {m.time ? ` · ${m.time}` : ''}
                        {m.durationMin != null ? ` · ${m.durationMin} min` : ''}
                        {m.score ? ` · ${m.score}` : ''}
                      </div>
                    </div>
                    <span
                      className={`stat-badge ${
                        m.result === 'win' ? 'good' : m.result === 'loss' ? 'bad' : ''
                      }`}
                    >
                      {m.result}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          {(weekly.stressLogs || []).length > 0 ? (
            <Panel title={t('reports.stressWeek')} subtitle={t('reports.checkIns')}>
              <div className="meal-list">
                {weekly.stressLogs.map((s: any) => (
                  <div key={s.id} className="meal-row">
                    <div>
                      <strong>{s.levelLabel || s.level}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {s.date}
                        {s.score != null ? ` · score ${s.score}` : ''}
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
            </Panel>
          ) : null}
          {(weekly.dayCheckIns || []).length > 0 ? (
            <Panel title={t('reports.moodWeek')} subtitle="Daily check-ins">
              <div className="meal-list">
                {weekly.dayCheckIns.map((c: any) => (
                  <div key={c.id} className="meal-row">
                    <div>
                      <strong>
                        {c.moodLabel || c.mood} · woke {c.wakeQualityLabel || c.wakeQuality}
                      </strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {c.date}
                        {c.notes ? ` · ${c.notes}` : ''}
                      </div>
                    </div>
                    <span className="stat-badge">Check-in</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}

      <Panel title={t('reports.tirByDay')} subtitle={t('reports.tirByDay')}>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={weekChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E3350" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#8CA0BC', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#8CA0BC', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltipBox unit="%" />} />
              <Bar dataKey="tir" name="TIR %" fill="#2EF2B5" radius={[8, 8, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title={t('reports.weeklyInsights')}>
        <ul className="insight-list">
          {weekly.insights.map((i: string, idx: number) => (
            <li key={idx}>{i}</li>
          ))}
        </ul>
      </Panel>
    </>
  );
}


import { Panel, StatCard, TirRing } from '../ui';
import { useLocale } from '../../i18n';
import type { GlucoseTargets } from './types';

// Daily report body (stats, charts, glucose episodes, meals, AI debrief).
type DailyReportViewProps = {
  daily: any;
  glucoseTargets: GlucoseTargets;
};

export function DailyReportView({ daily, glucoseTargets }: DailyReportViewProps) {
  const { t } = useLocale();
  return (
    <>
      <div className="stat-grid">
        <StatCard
          label={t('reports.meals')}
          value={daily.nutrition.mealCount}
          accent="teal"
          foot={daily.date}
        />
        <StatCard
          label={t('reports.calories')}
          value={Math.round(daily.nutrition.macros.caloriesKcal || 0)}
          unit="kcal"
          accent="amber"
          badge={
            daily.calorieBalance?.remainingToTarget == null
              ? undefined
              : daily.calorieBalance.remainingToTarget >= 0
                ? { text: `${Math.round(daily.calorieBalance.remainingToTarget)} left`, tone: 'good' }
                : {
                    text: `${Math.abs(Math.round(daily.calorieBalance.remainingToTarget))} over`,
                    tone: 'warn',
                  }
          }
          foot={
            daily.calorieTargets
              ? `Target ${daily.calorieTargets.targetKcal} · maint. ${daily.calorieTargets.maintenanceKcal}`
              : undefined
          }
        />
        <StatCard
          label={t('reports.weight')}
          value={daily.weight?.weightKg ?? daily.calorieTargets?.weightKg ?? '—'}
          unit={
            daily.weight?.weightKg != null || daily.calorieTargets?.weightKg != null
              ? 'kg'
              : undefined
          }
          accent="blue"
          foot={
            daily.calorieTargets?.bmi != null ? `BMI ${daily.calorieTargets.bmi}` : undefined
          }
        />
        <StatCard label={t('reports.carbs')} value={daily.nutrition.macros.carbsG} unit="g" accent="teal" />
        <StatCard label={t('reports.protein')} value={daily.nutrition.macros.proteinG} unit="g" accent="blue" />
        <StatCard label={t('reports.fat')} value={daily.nutrition.macros.fatG} unit="g" accent="amber" />
        <StatCard
          label={t('reports.avgGlucose')}
          value={daily.glucose.avgMgDl ?? '—'}
          unit={daily.glucose.avgMgDl != null ? 'mg/dL' : undefined}
          accent="amber"
          foot={`Low ${daily.glucose.lowCount} · High ${daily.glucose.highCount}`}
        />
        <StatCard
          label={t('reports.hypoglycemia')}
          value={daily.glucose.hypoEventCount ?? 0}
          accent={(daily.glucose.hypoEventCount || 0) > 0 ? 'rose' : 'green'}
          badge={
            (daily.glucose.hypoEventCount || 0) > 0
              ? { text: t('reports.hypoEpisodes', { low: glucoseTargets.low }), tone: 'warn' }
              : { text: t('reports.clear'), tone: 'good' }
          }
          foot={
            daily.glucose.minMgDl != null ? `Min ${daily.glucose.minMgDl} mg/dL` : undefined
          }
        />
        <StatCard
          label={t('reports.steps')}
          value={(daily.activity?.steps ?? 0).toLocaleString()}
          accent="green"
          foot={
            daily.activity?.source === 'samsung_health'
              ? 'Samsung Health'
              : daily.activity?.source
                ? `Via ${daily.activity.source}`
                : undefined
          }
          footIcon={
            daily.activity?.source === 'samsung_health'
              ? '/icons/icon-samsung.png'
              : daily.activity?.source === 'watch'
                ? '/icons/icon-watch.png'
                : undefined
          }
        />
        <StatCard
          label={t('reports.energyScore')}
          value={
            daily.activity?.energyScore != null
              ? Math.round(daily.activity.energyScore)
              : '—'
          }
          accent="amber"
          foot={t('reports.energyHelp')}
          footIcon={
            daily.activity?.energyScore != null || daily.activity?.source === 'samsung_health'
              ? '/icons/icon-samsung.png'
              : undefined
          }
        />            <StatCard
          label={t('reports.workoutMin')}
          value={(daily.activity?.workouts || []).reduce(
            (s: number, w: any) => s + (Number(w.durationMin) || 0),
            0
          )}
          unit="min"
          accent="blue"
          foot={`${(daily.activity?.workouts || []).length} session(s)`}
        />
        <StatCard
          label={t('reports.activeKcal')}
          value={
            daily.activity?.caloriesBurned != null
              ? Math.round(daily.activity.caloriesBurned)
              : '—'
          }
          accent="amber"
        />
      </div>

      {(daily.meals || []).length > 0 ? (
        <Panel title={t('reports.mealsThatDay')} subtitle={t('reports.mealsThatDayHelp')}>
          <div className="meal-list">
            {daily.meals.map((m: any) => (
              <div key={m.id || `${m.mealType}-${m.eatenAt}`} className="meal-row">
                <div>
                  <strong className="capitalize">{m.mealType || 'meal'}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {[
                      m.eatenAt
                        ? new Date(m.eatenAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : null,
                      m.macros?.caloriesKcal != null
                        ? `${Math.round(m.macros.caloriesKcal)} kcal`
                        : null,
                      m.macros?.carbsG != null ? `C ${m.macros.carbsG}g` : null,
                      m.macros?.proteinG != null ? `P ${m.macros.proteinG}g` : null,
                      m.macros?.fatG != null ? `F ${m.macros.fatG}g` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {m.aiSummary || m.notes ? (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {m.aiSummary || m.notes}
                    </div>
                  ) : null}
                </div>
                <span className="stat-badge">{m.mealType || 'meal'}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {(daily.activity?.workouts || []).length > 0 ? (
        <Panel title={t('reports.workoutsToday')} subtitle={t('reports.syncedPhone')}>
          <div className="meal-list">
            {daily.activity.workouts.map((w: any, i: number) => (
              <div key={i} className="meal-row">
                <div>
                  <strong>{w.name || 'Workout'}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {w.durationMin || 0} min
                    {w.calories != null ? ` · ${w.calories} kcal` : ''}
                  </div>
                </div>
                <span className="stat-badge good">Sport</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {(daily.careVisits || []).length > 0 ||
      (daily.sportMatches || []).length > 0 ||
      (daily.stressLogs || []).length > 0 ||
      (daily.injuries || []).length > 0 ||
      daily.dayCheckIn ||
      (daily.caffeineLogs || []).length > 0 ? (
        <div className="grid-2">
          <Panel title={t('reports.careVisits')} subtitle={t('compose.careBlurb')}>
            {(daily.careVisits || []).length === 0 ? (
              <p className="muted">{t('reports.noneToday')}</p>
            ) : (
              <div className="meal-list">
                {daily.careVisits.map((v: any) => (
                  <div key={v.id} className="meal-row">
                    <div>
                      <strong>{v.label || v.kindLabel || v.kind}</strong>
                      {v.notes ? (
                        <div className="muted" style={{ fontSize: 12 }}>{v.notes}</div>
                      ) : null}
                    </div>
                    <span className="stat-badge">{v.kindLabel || v.kind}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title={t('reports.sportSessions')} subtitle="Padel, gym, run, swim…">
            {(daily.sportMatches || []).length === 0 ? (
              <p className="muted">{t('reports.noneToday')}</p>
            ) : (
              <div className="meal-list">
                {daily.sportMatches.map((m: any) => (
                  <div key={m.id} className="meal-row">
                    <div>
                      <strong className="capitalize">{(m.sport || 'match').toString()}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {[
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
          {(daily.injuries || []).length > 0 ? (
            <Panel title={t('reports.injuriesPain')} subtitle={t('reports.injuriesPain')}>
              <div className="meal-list">
                {daily.injuries.map((inj: any) => (
                  <div key={inj.id} className="meal-row">
                    <div>
                      <strong>
                        {inj.title || inj.bodyAreaLabel || inj.injuryTypeLabel || 'Injury'}
                      </strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {[
                          inj.injuryTypeLabel || inj.injuryType,
                          inj.bodyAreaLabel || inj.bodyArea,
                          inj.startedOn ? `since ${inj.startedOn}` : null,
                          inj.exerciseNotes
                            ? `exercises: ${String(inj.exerciseNotes).slice(0, 60)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <span className="stat-badge">
                      {inj.todayPain
                        ? `${inj.todayPain.painScore}/10`
                        : inj.status || 'open'}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
          <Panel
            title={t('reports.hypoglycemia')}
            subtitle={t('dashboard.hyposHelp', { low: glucoseTargets.low })}
          >
            {(daily.glucose.hypoEvents || []).length === 0 ? (
              <p className="muted">{t('reports.noHypos')}</p>
            ) : (
              <div className="meal-list">
                {daily.glucose.hypoEvents.map((h: any, i: number) => (
                  <div key={i} className="meal-row">
                    <div>
                      <strong>Low {h.minMgDl} mg/dL</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {new Date(h.startedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {h.durationMin > 0 ? ` · ${h.durationMin} min` : ''}
                        {h.readingCount ? ` · ${h.readingCount} reading(s)` : ''}
                      </div>
                    </div>
                    <span className="stat-badge warn">Hypo</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title={t('reports.pumpEvents')} subtitle={t('reports.pumpEvents')}>
            {(daily.pumpEvents || []).length === 0 ? (
              <p className="muted">{t('reports.noPump')}</p>
            ) : (
              <div className="meal-list">
                {[...(daily.pumpEvents || [])].reverse().map((e: any) => (
                  <div key={e.id} className="meal-row">
                    <div>
                      <strong>{e.kindLabel || e.kind}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {e.kind === 'insulin_delivered' && e.units != null
                          ? `Delivered ${e.units} U of insulin`
                          : e.message && e.message !== e.kindLabel
                            ? e.message
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
                      {e.kind === 'insulin_delivered' && e.units != null
                        ? `${e.units} U`
                        : e.time || '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          {(daily.stressLogs || []).length > 0 ? (
            <Panel title={t('reports.stress')} subtitle={t('reports.checkIns')}>
              <div className="meal-list">
                {daily.stressLogs.map((s: any) => (
                  <div key={s.id} className="meal-row">
                    <div>
                      <strong>{s.levelLabel || s.level}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {s.score != null ? `Score ${s.score}` : t('reports.noScore')}
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
            </Panel>
          ) : null}
          {daily.dayCheckIn ? (
            <Panel title={t('reports.moodAdhd')} subtitle={t('reports.dailyCheckIn')}>
              <div className="meal-list">
                <div className="meal-row">
                  <div>
                    <strong>
                      Mood {daily.dayCheckIn.moodLabel || daily.dayCheckIn.mood} · focus{' '}
                      {daily.dayCheckIn.focusLabel || daily.dayCheckIn.focus || '—'}
                    </strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Woke {daily.dayCheckIn.wakeQualityLabel || daily.dayCheckIn.wakeQuality}
                      {' · '}
                      overwhelm {daily.dayCheckIn.overwhelmLabel || daily.dayCheckIn.overwhelm || '—'}
                      {' · '}
                      task {daily.dayCheckIn.taskInitiationLabel || daily.dayCheckIn.taskInitiation || '—'}
                      {daily.dayCheckIn.medicationTaken ? ' · meds' : ''}
                      {daily.dayCheckIn.hyperfocus ? ' · hyperfocus' : ''}
                      {daily.dayCheckIn.notes ? ` · ${daily.dayCheckIn.notes}` : ''}
                    </div>
                  </div>
                  <span className="stat-badge">Check-in</span>
                </div>
              </div>
            </Panel>
          ) : null}
          {(daily.caffeineLogs || []).length > 0 ? (
            <Panel
              title={t('reports.caffeine')}
              subtitle={`${(daily.caffeineLogs || []).reduce(
                (s: number, c: any) => s + (c.caffeineMg || 0),
                0
              )} mg today`}
            >
              <div className="meal-list">
                {daily.caffeineLogs.map((c: any) => (
                  <div key={c.id} className="meal-row">
                    <div>
                      <strong>{c.drinkLabel || c.drink}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {c.caffeineMg} mg{c.time ? ` · ${c.time}` : ''}
                      </div>
                    </div>
                    <span className="stat-badge">{c.caffeineMg} mg</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}

      <div className="grid-2">
        <Panel
          title={t('reports.glucoseQuality')}
          subtitle={t('dashboard.glucoseBandSub', {
            low: glucoseTargets.low,
            high: glucoseTargets.high,
            goal: glucoseTargets.goal,
          })}
        >
          <TirRing value={daily.glucose.timeInRangePct} goalPct={glucoseTargets.goal} />
          <div className="legend" style={{ justifyContent: 'center', marginTop: 8 }}>
            <span>Min {daily.glucose.minMgDl ?? '—'} · Max {daily.glucose.maxMgDl ?? '—'}</span>
          </div>
        </Panel>
        <Panel title={t('reports.insights')} subtitle={t('reports.fromToday')}>
          <ul className="insight-list">
            {daily.insights.map((i: string, idx: number) => (
              <li key={idx}>{i}</li>
            ))}
          </ul>
          {daily.warnings.map((w: any, idx: number) => (
            <div key={idx} className={`warn warn-${w.severity}`}>
              <strong>{w.title}</strong>
              <p>{w.message}</p>
            </div>
          ))}
        </Panel>
      </div>

      {(daily.glucose?.readings || []).length > 0 ? (
        <Panel title={t('reports.glucoseHistory')} subtitle={t('reports.glucoseHistoryHelp')}>
          <div className="meal-list">
            {(daily.glucose.readings as Array<{ timestamp: number; mgDl: number }>)
              .slice(0, 48)
              .map((r, i) => (
                <div key={i} className="meal-row">
                  <div>
                    <strong>
                      {new Date(r.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {Math.round(r.mgDl)} mg/dL
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
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
import {
  fetchDaily,
  fetchWeekly,
  downloadDailyPdf,
  emailDailyReport,
  createDailyShare,
  fetchDebriefs,
  fetchDebrief,
  type DailyShare,
  type DayDebriefSummary,
  type DayDebriefDetail,
} from '../api';
import { ChartTooltipBox, PageHeader, Panel, Segmented, StatCard, TirRing } from '../components/ui';
import { useLocale } from '../i18n';

export default function ReportsPage() {
  const { t, locale } = useLocale();
  const [mode, setMode] = useState<'daily' | 'weekly'>('daily');
  const [daily, setDaily] = useState<any>(null);
  const [weekly, setWeekly] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [share, setShare] = useState<DailyShare | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [debriefs, setDebriefs] = useState<DayDebriefSummary[]>([]);
  const [openDebriefDate, setOpenDebriefDate] = useState<string | null>(null);
  const [openDebrief, setOpenDebrief] = useState<DayDebriefDetail | null>(null);
  const [debriefBusy, setDebriefBusy] = useState(false);
  const [directorsCopied, setDirectorsCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const run = mode === 'daily' ? fetchDaily() : fetchWeekly();
    run
      .then((data) => {
        if (mode === 'daily') setDaily(data);
        else setWeekly(data);
      })
      .catch((e) => setError(String(e?.response?.data?.detail || e.message || e)))
      .finally(() => setLoading(false));
  }, [mode]);

  useEffect(() => {
    fetchDebriefs(30)
      .then(setDebriefs)
      .catch(() => setDebriefs([]));
  }, [mode, emailNote]);

  const reportDate = daily?.date;

  const glucoseTargets = useMemo(() => {
    const gt =
      daily?.glucoseTargets ||
      weekly?.days?.[0]?.glucoseTargets ||
      weekly?.glucoseTargets ||
      {};
    return {
      low: Number(gt.tirLowMgDl ?? 70),
      high: Number(gt.tirHighMgDl ?? 180),
      goal: Number(gt.tirGoalPct ?? 70),
    };
  }, [daily, weekly]);

  const refreshDebriefs = () => {
    fetchDebriefs(30)
      .then(setDebriefs)
      .catch(() => setDebriefs([]));
  };

  const downloadPdf = async () => {
    setPdfBusy(true);
    setError(null);
    try {
      await downloadDailyPdf(reportDate);
      refreshDebriefs();
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setPdfBusy(false);
    }
  };

  const emailPdf = async () => {
    setEmailBusy(true);
    setError(null);
    setEmailNote(null);
    try {
      const res = await emailDailyReport(reportDate);
      setEmailNote(
        t('reports.emailed', { date: res.date, to: res.to || 'the configured recipient' })
      );
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setEmailBusy(false);
    }
  };

  const openShare = async () => {
    setShareBusy(true);
    setError(null);
    setShareNote(null);
    try {
      const res = await createDailyShare(reportDate);
      setShare(res);
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareLink = async () => {
    if (!share?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(share.shareUrl);
      setShareNote(t('reports.linkCopied'));
    } catch {
      setShareNote(share.shareUrl);
    }
  };

  const copyDirectorsCut = async () => {
    const text = weekly?.directorsCut;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setDirectorsCopied(true);
      window.setTimeout(() => setDirectorsCopied(false), 2000);
    } catch {
      /* fallback */
    }
  };

  const openArchiveDebrief = async (date: string) => {
    if (openDebriefDate === date) {
      setOpenDebriefDate(null);
      setOpenDebrief(null);
      return;
    }
    setDebriefBusy(true);
    setError(null);
    try {
      const detail = await fetchDebrief(date);
      setOpenDebriefDate(date);
      setOpenDebrief(detail);
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setDebriefBusy(false);
    }
  };

  const weekChart = useMemo(() => {
    if (!weekly?.days) return [];
    return weekly.days.map((d: any) => ({
      date: d.date.slice(5),
      carbs: d.nutrition?.macros?.carbsG ?? 0,
      protein: d.nutrition?.macros?.proteinG ?? 0,
      fat: d.nutrition?.macros?.fatG ?? 0,
      steps: d.activity?.steps ?? 0,
      workoutMin: (d.activity?.workouts || []).reduce(
        (s: number, w: any) => s + (Number(w.durationMin) || 0),
        0
      ),
      tir: d.glucose?.timeInRangePct,
      avg: d.glucose?.avgMgDl,
      meals: d.nutrition?.mealCount ?? 0,
    }));
  }, [weekly]);

  return (
    <div>
      <PageHeader
        eyebrow={t('reports.eyebrow')}
        title={t('reports.title')}
        lede={t('settings.languageHelp')}
        actions={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Segmented
              value={mode}
              onChange={(id) => setMode(id as 'daily' | 'weekly')}
              options={[
                { id: 'daily', label: t('reports.daily') },
                { id: 'weekly', label: t('reports.weekly') },
              ]}
            />
            <button
              className="btn secondary"
              type="button"
              disabled={pdfBusy || loading || mode !== 'daily'}
              onClick={downloadPdf}
            >
              {pdfBusy ? t('common.loading') : t('reports.downloadPdf')}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={shareBusy || loading || mode !== 'daily'}
              onClick={openShare}
            >
              {shareBusy ? t('common.loading') : t('reports.share')}
            </button>
            <button
              className="btn"
              type="button"
              disabled={emailBusy || loading || mode !== 'daily'}
              onClick={emailPdf}
            >
              {emailBusy ? t('common.loading') : t('reports.email')}
            </button>
          </div>
        }
      />

      {error ? <p className="error">{error}</p> : null}
      {emailNote ? <p className="muted">{emailNote}</p> : null}
      {loading ? <p className="muted">Loading report…</p> : null}

      {share ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-label={t('reports.shareTitle')}>
          <button type="button" className="modal-backdrop" aria-label={t('common.close')} onClick={() => setShare(null)} />
          <div className="modal-sheet share-modal">
            <div className="modal-head">
              <h2>{t('reports.shareTitle')}</h2>
              <button type="button" className="btn ghost" onClick={() => setShare(null)}>
                {t('common.close')}
              </button>
            </div>
            <p className="muted">Scan to open the report for {share.date}. Link stays valid for 30 days.</p>
            <div className="share-qr-wrap">
              <img src={share.qrUrl} alt={t('reports.qrAlt')} width={220} height={220} />
            </div>
            <p className="share-url">{share.shareUrl}</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn" onClick={copyShareLink}>
                Copy link
              </button>
              <a className="btn secondary" href={share.shareUrl} target="_blank" rel="noreferrer">
                Open link
              </a>
            </div>
            {shareNote ? <p className="muted">{shareNote}</p> : null}
          </div>
        </div>
      ) : null}

      {mode === 'daily' && daily && !loading ? (
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
        </>
      ) : null}

      {mode === 'weekly' && weekly && !loading ? (
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

          {weekly.directorsCut ? (
            <Panel
              title="Director's cut"
              subtitle="Your week as a screenplay — spoilers included"
              action={
                <button type="button" className="btn secondary compact" onClick={copyDirectorsCut}>
                  {directorsCopied ? 'Copied!' : "Copy director's cut"}
                </button>
              }
            >
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  lineHeight: 1.55,
                  margin: 0,
                  color: 'var(--text, inherit)',
                }}
              >
                {weekly.directorsCut}
              </pre>
            </Panel>
          ) : null}

          <div className="grid-2">
            <Panel title={t('reports.macrosByDay')} subtitle="Carbs vs protein vs fat (g)">
              <div className="chart-wrap tall">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={weekChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltipBox unit="g" />} />
                    <Legend />
                    <Bar dataKey="carbs" name={t('reports.carbs')} stackId="a" fill="#0d9488" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="protein" name={t('reports.protein')} stackId="a" fill="#0ea5e9" />
                    <Bar dataKey="fat" name={t('reports.fat')} stackId="a" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title={t('reports.glucoseSports')} subtitle="Avg glucose, steps, and workout minutes">
              <div className="chart-wrap tall">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={weekChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fill: '#64748b', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltipBox />} />
                    <Legend />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="avg"
                      name={t('reports.avgGlucose')} stroke="#d97706"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="steps"
                      name={t('reports.steps')} stroke="#0ea5e9"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="workoutMin"
                      name={t('reports.workoutMin')} stroke="#0d9488"
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltipBox unit="%" />} />
                  <Bar dataKey="tir" name="TIR %" fill="#10b981" radius={[8, 8, 0, 0]} maxBarSize={40} />
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
      ) : null}

      <Panel title={t('reports.archive')} subtitle={t('reports.archiveHelp')}>
        {debriefs.length === 0 ? (
          <p className="muted">{t('reports.noArchive')}</p>
        ) : (
          <div className="meal-list">
            {debriefs.map((d) => (
              <div key={d.id}>
                <button
                  type="button"
                  className="meal-row"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: 'none',
                    background: openDebriefDate === d.date ? 'var(--surface-2, #f1f5f9)' : 'transparent',
                  }}
                  onClick={() => openArchiveDebrief(d.date)}
                  disabled={debriefBusy}
                >
                  <div>
                    <strong>{d.date}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {d.headline || t('reports.dayOverview')}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {t('reports.archiveLocale', {
                        locale: d.locale === 'fr' ? t('locale.fr') : t('locale.en'),
                      })}
                    </div>
                  </div>
                  <span className="stat-badge">{d.source}</span>
                </button>
                {openDebriefDate === d.date && openDebrief ? (
                  <div
                    style={{
                      margin: '0 0 12px',
                      padding: 12,
                      borderRadius: 10,
                      background: 'var(--surface-2, #f1f5f9)',
                    }}
                  >
                    <p style={{ marginTop: 0, lineHeight: 1.5 }}>{openDebrief.summary}</p>
                    {(openDebrief.highlights || []).length > 0 ? (
                      <>
                        <strong style={{ fontSize: 13 }}>Highlights</strong>
                        <ul className="insight-list">
                          {openDebrief.highlights.map((h, i) => (
                            <li key={i}>{h}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {(openDebrief.tomorrowTips || []).length > 0 ? (
                      <>
                        <strong style={{ fontSize: 13 }}>Tips</strong>
                        <ul className="insight-list">
                          {openDebrief.tomorrowTips.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import {
  generateUnderstanding,
  type UnderstandingCategory,
  type UnderstandingFinding,
  type UnderstandingMedicalCheck,
  type UnderstandingReport,
  type UnderstandingSeverity,
} from '../api';
import { ChartTooltipBox, Segmented } from '../components/ui';
import LifeReviewHeroVisual from '../components/lifeReview/LifeReviewHeroVisual';
import { useCountUp, useReveal } from '../components/lifeReview/useReveal';
import { useLocale } from '../i18n';
import '../styles/life-review.css';

const WINDOWS = [
  { id: '1', label: '1d' },
  { id: '7', label: '7d' },
  { id: '14', label: '14d' },
  { id: '30', label: '30d' },
] as const;

const LOADING_STEPS = [
  'understanding.loadingGlucose',
  'understanding.loadingMeals',
  'understanding.loadingLifestyle',
  'understanding.loadingCharts',
  'understanding.loadingMedical',
  'understanding.loadingWriting',
] as const;

type ChartPoint = { tMin: number; mgDl: number };
type MealExample = {
  id?: string;
  date?: string;
  mealType?: string;
  carbsG?: number;
  deltaMgDl?: number;
  flags?: string[];
  summary?: string;
  timing?: string;
  lagMin?: number | null;
  bolusMarkerMin?: number;
  chartSeries?: ChartPoint[];
};
type StressExample = {
  date?: string;
  time?: string | null;
  followUpTirPct?: number | null;
  followUpHigh?: boolean;
  chartSeries?: ChartPoint[];
};
type DayChartRow = {
  date?: string;
  tirPct?: number | null;
  mealCount?: number;
  hypoCount?: number;
};

function severityRank(s: UnderstandingSeverity): number {
  return s === 'high' ? 0 : s === 'medium' ? 1 : 2;
}

function categoryLabel(cat: UnderstandingCategory, t: (k: any) => string): string {
  const map: Record<UnderstandingCategory, string> = {
    estimation: t('understanding.catEstimation'),
    timing: t('understanding.catTiming'),
    stress: t('understanding.catStress'),
    logging: t('understanding.catLogging'),
    glucose: t('understanding.catGlucose'),
    lifestyle: t('understanding.catLifestyle'),
  };
  return map[cat] || cat;
}

function StatCard({ label, value, animate }: { label: string; value: string; animate: boolean }) {
  const display = useCountUp(value, animate);
  return (
    <div className="lr-stat">
      <div className="lr-stat__label">{label}</div>
      <div className="lr-stat__value">{display}</div>
    </div>
  );
}

function RevealBlock({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const { ref, className: revealClass } = useReveal();
  return (
    <div ref={ref} className={`${revealClass} ${className}`.trim()}>
      {children}
    </div>
  );
}

function MealCurveChart({
  series,
  bolusMin,
  tirLow = 70,
  tirHigh = 180,
}: {
  series: ChartPoint[];
  bolusMin?: number | null;
  tirLow?: number;
  tirHigh?: number;
}) {
  if (!series.length) return <p className="muted und-chart-empty">No CGM series</p>;
  return (
    <div className="und-chart">
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="undGluLr" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#22D3EE" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E3350" vertical={false} />
          <XAxis dataKey="tMin" tick={{ fill: '#8CA0BC', fontSize: 11 }} axisLine={false} tickLine={false} unit="m" />
          <YAxis domain={['auto', 'auto']} tick={{ fill: '#8CA0BC', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<ChartTooltipBox unit=" mg/dL" />} />
          <ReferenceLine y={tirLow} stroke="#8CA0BC" strokeDasharray="4 4" />
          <ReferenceLine y={tirHigh} stroke="#8CA0BC" strokeDasharray="4 4" />
          <ReferenceLine x={0} stroke="#E6F4FF" strokeOpacity={0.35} />
          {typeof bolusMin === 'number' ? (
            <ReferenceLine x={bolusMin} stroke="#FF4D6D" strokeDasharray="3 3" />
          ) : null}
          <Area type="monotone" dataKey="mgDl" name="Glucose" stroke="#2EF2B5" fill="url(#undGluLr)" strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function UnderstandingPage() {
  const { t } = useLocale();
  const [windowDays, setWindowDays] = useState('14');
  const [report, setReport] = useState<UnderstandingReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!busy) return;
    setProgress(0);
    const stepTimer = window.setInterval(() => {
      setStepIdx((i) => (i + 1) % LOADING_STEPS.length);
    }, 2200);
    const progTimer = window.setInterval(() => {
      setProgress((p) => Math.min(p + 4 + Math.random() * 6, 92));
    }, 400);
    return () => {
      window.clearInterval(stepTimer);
      window.clearInterval(progTimer);
    };
  }, [busy]);

  const run = async () => {
    setBusy(true);
    setError(null);
    setStepIdx(0);
    try {
      const days = Number(windowDays) || 14;
      const result = await generateUnderstanding(days);
      setProgress(100);
      await new Promise((r) => setTimeout(r, 350));
      setReport(result);
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const findings = useMemo(() => {
    const list = report?.analysis?.findings || [];
    return [...list].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  }, [report]);

  const signals = report?.signals || {};
  const mealGlucose = (signals.mealGlucose || {}) as Record<string, unknown>;
  const bolusTiming = (signals.bolusTiming || {}) as Record<string, unknown>;
  const stressGlucose = (signals.stressGlucose || {}) as Record<string, unknown>;
  const lifestyle = (signals.lifestyle || {}) as Record<string, any>;
  const totals = (report?.totals || {}) as Record<string, unknown>;
  const mealExamples = (signals.mealExamples || []) as MealExample[];
  const bolusExamples = ((bolusTiming.examples || []) as MealExample[]).filter(
    (e) => (e.chartSeries || []).length > 0 || e.timing
  );
  const stressExamples = (stressGlucose.examples || []) as StressExample[];
  const dayCharts = (signals.dayCharts || []) as DayChartRow[];
  const medicalChecks = report?.analysis?.medicalChecks || [];

  const stats = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [];
    if (totals.meanGlucoseMgDl != null) {
      items.push({ label: t('understanding.statMean'), value: `${totals.meanGlucoseMgDl}` });
    }
    if (totals.estimatedA1cPct != null) {
      items.push({ label: t('understanding.statA1c'), value: `${totals.estimatedA1cPct}%` });
    }
    if (totals.avgTimeInRangePct != null) {
      items.push({ label: t('understanding.statTir'), value: `${totals.avgTimeInRangePct}%` });
    }
    if (mealGlucose.analyzedMeals != null || totals.mealCount != null) {
      items.push({
        label: t('understanding.statMeals'),
        value: String(mealGlucose.analyzedMeals ?? totals.mealCount),
      });
    }
    if (totals.totalSteps != null) {
      items.push({
        label: t('understanding.statSteps'),
        value: Number(totals.totalSteps).toLocaleString(),
      });
    }
    if (totals.sportMatchCount != null && Number(totals.sportMatchCount) > 0) {
      items.push({ label: t('understanding.statSports'), value: String(totals.sportMatchCount) });
    }
    return items;
  }, [totals, mealGlucose, t]);

  const bolusCompare = useMemo(() => {
    const late = bolusTiming.lateAvgDeltaMgDl;
    const onTime = bolusTiming.onTimeAvgDeltaMgDl;
    if (late == null && onTime == null) return [];
    return [
      { label: t('understanding.chartOnTime'), delta: Number(onTime ?? 0) },
      { label: t('understanding.chartLate'), delta: Number(late ?? 0) },
    ];
  }, [bolusTiming.lateAvgDeltaMgDl, bolusTiming.onTimeAvgDeltaMgDl, t]);

  const bolusScatter = useMemo(() => {
    return ((bolusTiming.examples || []) as MealExample[])
      .filter((e) => typeof e.lagMin === 'number' && e.deltaMgDl != null)
      .map((e) => ({
        lagMin: e.lagMin as number,
        deltaMgDl: e.deltaMgDl as number,
        carbsG: e.carbsG || 10,
      }));
  }, [bolusTiming.examples]);

  const dataPills = [
    t('understanding.pillGlucose'),
    t('understanding.pillMeals'),
    t('understanding.pillBolus'),
    t('understanding.pillSport'),
    t('understanding.pillStress'),
    t('understanding.pillMood'),
    t('understanding.pillCaffeine'),
    t('understanding.pillPain'),
  ];

  const showResults = !busy && report;
  const heroLabel = `${windowDays}d`;

  return (
    <div className="life-review-page und-lr-page">
      <section className="lr-hero">
        <div className="lr-hero__mesh" aria-hidden />
        <div className="lr-hero__particles" aria-hidden />
        <div className="lr-hero__content">
          <div className="lr-eyebrow">
            <span className="lr-eyebrow__pulse" aria-hidden />
            {t('understanding.eyebrow')}
          </div>
          <h1>{t('understanding.title')}</h1>
          <p className="lr-hero__lede">{t('understanding.lede')}</p>
          <div className="lr-pills">
            {dataPills.map((pill) => (
              <span key={pill} className="lr-pill">
                {pill}
              </span>
            ))}
          </div>
          <div className="und-hero-controls">
            <Segmented value={windowDays} options={[...WINDOWS]} onChange={setWindowDays} />
            <button type="button" className="lr-cta" disabled={busy} onClick={() => void run()}>
              {busy ? (
                <>
                  <span className="lr-cta__icon" aria-hidden />
                  {t('understanding.generating')}
                </>
              ) : report ? (
                t('understanding.regenerate')
              ) : (
                t('understanding.generate')
              )}
            </button>
          </div>
        </div>
        <div className="lr-hero__visual-wrap">
          <LifeReviewHeroVisual active={busy || !!report} label={heroLabel} />
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}

      {busy ? (
        <div className="lr-loading" role="status" aria-live="polite">
          <div className="lr-loading__steps">
            {LOADING_STEPS.map((_, i) => (
              <div
                key={i}
                className={[
                  'lr-loading__step',
                  i < stepIdx ? 'lr-loading__step--done' : '',
                  i === stepIdx ? 'lr-loading__step--current' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
            ))}
          </div>
          <div className="lr-loading__bar-wrap">
            <div className="lr-loading__bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="lr-loading__status" key={stepIdx}>
            {t(LOADING_STEPS[stepIdx])}
          </p>
          <p className="lr-loading__hint">{t('understanding.generatingHelp')}</p>
        </div>
      ) : null}

      {!busy && !report ? (
        <div className="lr-empty">
          <div className="lr-empty__icon" aria-hidden>
            ✦
          </div>
          <p>{t('understanding.emptyBody')}</p>
        </div>
      ) : null}

      {showResults ? (
        <div className="lr-results" key={report.generatedAt || report.periodEnd}>
          <RevealBlock>
            <span className="lr-period-badge">
              {report.periodStart} → {report.periodEnd}
            </span>
            <h2 className="lr-headline">{report.analysis.headline}</h2>
          </RevealBlock>

          {stats.length > 0 ? (
            <RevealBlock className="lr-stats">
              {stats.map((s) => (
                <StatCard key={s.label} label={s.label} value={s.value} animate />
              ))}
            </RevealBlock>
          ) : null}

          <RevealBlock>
            <div className="lr-summary">{report.analysis.executiveSummary}</div>
          </RevealBlock>

          {/* Lifestyle signal strip */}
          {(lifestyle.sports || lifestyle.caffeine || lifestyle.checkIns || lifestyle.injuries) && (
            <RevealBlock className="lr-verdicts">
              {lifestyle.sports?.matchCount > 0 || lifestyle.activity?.workoutCount > 0 ? (
                <article className="lr-verdict lr-verdict--lifestyle">
                  <div className="lr-verdict__glow" aria-hidden />
                  <div className="lr-verdict__icon">👟</div>
                  <div className="lr-verdict__title">{t('understanding.pillSport')}</div>
                  <p className="lr-verdict__body">
                    {t('understanding.lifestyleSportBody', {
                      sports: Number(lifestyle.sports?.matchCount || 0),
                      gym: Number(lifestyle.activity?.workoutCount || lifestyle.sports?.gymSessionCount || 0),
                      steps: Number(lifestyle.activity?.totalSteps || totals.totalSteps || 0).toLocaleString(),
                    })}
                  </p>
                </article>
              ) : null}
              {lifestyle.checkIns?.count > 0 || lifestyle.caffeine?.drinkCount > 0 ? (
                <article className="lr-verdict lr-verdict--mood">
                  <div className="lr-verdict__glow" aria-hidden />
                  <div className="lr-verdict__icon">✨</div>
                  <div className="lr-verdict__title">{t('understanding.pillMood')}</div>
                  <p className="lr-verdict__body">
                    {t('understanding.lifestyleMoodBody', {
                      checkins: Number(lifestyle.checkIns?.count || 0),
                      moodLow: Number(lifestyle.checkIns?.moodLowCount || 0),
                      caffeine: Number(lifestyle.caffeine?.mgTotal || 0),
                    })}
                  </p>
                </article>
              ) : null}
              {lifestyle.injuries?.uniqueCount > 0 || lifestyle.care?.visitCount > 0 ? (
                <article className="lr-verdict lr-verdict--glucose">
                  <div className="lr-verdict__glow" aria-hidden />
                  <div className="lr-verdict__icon">🩹</div>
                  <div className="lr-verdict__title">{t('understanding.pillPain')}</div>
                  <p className="lr-verdict__body">
                    {t('understanding.lifestylePainBody', {
                      injuries: Number(lifestyle.injuries?.uniqueCount || 0),
                      pain: lifestyle.injuries?.avgPainScore != null ? String(lifestyle.injuries.avgPainScore) : '—',
                      care: Number(lifestyle.care?.visitCount || 0),
                    })}
                  </p>
                </article>
              ) : null}
            </RevealBlock>
          )}

          {dayCharts.length > 1 ? (
            <RevealBlock>
              <section className="lr-section">
                <h3 className="lr-section__title">{t('understanding.dayOverviewTitle')}</h3>
                <p className="lr-section__sub">{t('understanding.dayOverviewHelp')}</p>
                <div className="und-chart und-chart--tall">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={dayCharts}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E3350" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: '#8CA0BC', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => String(v).slice(5)}
                      />
                      <YAxis tick={{ fill: '#8CA0BC', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltipBox />} />
                      <Bar dataKey="tirPct" name="TIR %" fill="#22D3EE" radius={[6, 6, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="hypoCount" name="Hypos" fill="#FF4D6D" radius={[6, 6, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </RevealBlock>
          ) : null}

          {mealExamples.length ? (
            <RevealBlock>
              <section className="lr-section">
                <h3 className="lr-section__title">{t('understanding.examplesTitle')}</h3>
                <p className="lr-section__sub">{t('understanding.examplesHelp')}</p>
                <div className="und-example-grid">
                  {mealExamples.map((ex, idx) => (
                    <div key={ex.id || idx} className="und-example-card">
                      <div className="und-example-card__head">
                        <strong>
                          {ex.date} · {ex.mealType || 'meal'}
                        </strong>
                        <span>
                          {ex.carbsG != null ? `${ex.carbsG}g` : '—'} · Δ{ex.deltaMgDl ?? '—'}
                        </span>
                      </div>
                      {ex.summary ? <p className="muted und-example-sum">{ex.summary}</p> : null}
                      <MealCurveChart series={ex.chartSeries || []} />
                    </div>
                  ))}
                </div>
              </section>
            </RevealBlock>
          ) : null}

          {(bolusCompare.length > 0 || bolusScatter.length > 0) && (
            <RevealBlock>
              <section className="lr-section">
                <h3 className="lr-section__title">{t('understanding.bolusTitle')}</h3>
                <p className="lr-section__sub">{t('understanding.bolusHelp')}</p>
                <div className="grid-2 und-bolus-grid">
                  {bolusCompare.length ? (
                    <div className="und-chart">
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={bolusCompare}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1E3350" vertical={false} />
                          <XAxis dataKey="label" tick={{ fill: '#8CA0BC', fontSize: 12 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: '#8CA0BC', fontSize: 12 }} axisLine={false} tickLine={false} />
                          <Tooltip content={<ChartTooltipBox unit=" mg/dL" />} />
                          <Bar dataKey="delta" name="Avg peak Δ" fill="#FF4D6D" radius={[8, 8, 0, 0]} maxBarSize={48} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : null}
                  {bolusScatter.length ? (
                    <div className="und-chart">
                      <ResponsiveContainer width="100%" height={200}>
                        <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1E3350" />
                          <XAxis type="number" dataKey="lagMin" name="Lag" unit="m" tick={{ fill: '#8CA0BC', fontSize: 11 }} />
                          <YAxis type="number" dataKey="deltaMgDl" name="Δ" unit=" mg/dL" tick={{ fill: '#8CA0BC', fontSize: 11 }} />
                          <ZAxis type="number" dataKey="carbsG" range={[40, 160]} />
                          <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                          <ReferenceLine x={15} stroke="#FFB547" strokeDasharray="4 4" />
                          <Scatter data={bolusScatter} fill="#00E5FF" />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  ) : null}
                </div>
                {bolusExamples.length ? (
                  <div className="und-example-grid" style={{ marginTop: 14 }}>
                    {bolusExamples.slice(0, 4).map((ex, idx) => (
                      <div key={ex.id || idx} className="und-example-card">
                        <div className="und-example-card__head">
                          <strong>
                            {ex.date} · {ex.timing || 'bolus'}
                          </strong>
                          <span>
                            lag {ex.lagMin ?? '—'}m · Δ{ex.deltaMgDl ?? '—'}
                          </span>
                        </div>
                        <MealCurveChart series={ex.chartSeries || []} bolusMin={ex.bolusMarkerMin ?? ex.lagMin} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            </RevealBlock>
          )}

          {stressExamples.some((e) => (e.chartSeries || []).length > 0) ? (
            <RevealBlock>
              <section className="lr-section">
                <h3 className="lr-section__title">{t('understanding.stressTitle')}</h3>
                <p className="lr-section__sub">{t('understanding.stressHelp')}</p>
                <div className="und-example-grid">
                  {stressExamples
                    .filter((e) => (e.chartSeries || []).length > 0)
                    .slice(0, 4)
                    .map((ex, idx) => (
                      <div key={`${ex.date}-${ex.time}-${idx}`} className="und-example-card">
                        <div className="und-example-card__head">
                          <strong>
                            {ex.date} {ex.time || ''}
                          </strong>
                          <span>
                            {ex.followUpTirPct != null ? `TIR ${ex.followUpTirPct}%` : '—'}
                            {ex.followUpHigh ? ' · high' : ''}
                          </span>
                        </div>
                        <MealCurveChart series={ex.chartSeries || []} />
                      </div>
                    ))}
                </div>
              </section>
            </RevealBlock>
          ) : null}

          {medicalChecks.length ? (
            <RevealBlock>
              <section className="lr-section">
                <h3 className="lr-section__title">{t('understanding.medicalTitle')}</h3>
                <p className="lr-section__sub">{t('understanding.medicalHelp')}</p>
                <div className="lr-split und-med-split">
                  {medicalChecks.map((c: UnderstandingMedicalCheck) => (
                    <div key={c.patternId} className={`lr-card und-med-card und-med-card--${c.status}`}>
                      <div className="lr-card__title">
                        <span className={`und-med-status und-med-status--${c.status}`}>
                          {t(`understanding.med.${c.status}` as any)}
                        </span>{' '}
                        {c.title}
                      </div>
                      <p>{c.explanation}</p>
                      {c.scienceBrief ? (
                        <div className="und-med-science">
                          <div className="und-med-science__label">{t('understanding.scienceLabel')}</div>
                          <p>{c.scienceBrief}</p>
                        </div>
                      ) : null}
                      {c.sources?.length ? (
                        <ul className="und-med-sources">
                          {c.sources.map((s) => (
                            <li key={s.url}>
                              <a href={s.url} target="_blank" rel="noopener noreferrer">
                                {s.title}
                              </a>
                              {s.publisher ? (
                                <span className="und-med-sources__pub"> · {s.publisher}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {c.caveat ? <p className="muted und-med-caveat">{c.caveat}</p> : null}
                    </div>
                  ))}
                </div>
              </section>
            </RevealBlock>
          ) : null}

          {findings.length > 0 ? (
            <RevealBlock className="lr-split">
              <div className="lr-card lr-card--concerns">
                <div className="lr-card__title">{t('understanding.findingsTitle')}</div>
                <ul className="lr-list">
                  {findings.map((f: UnderstandingFinding) => (
                    <li key={f.id}>
                      <strong>
                        [{t(`understanding.sev.${f.severity}` as any)} · {categoryLabel(f.category, t)}]
                      </strong>{' '}
                      {f.title}
                      {f.detail ? ` — ${f.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
              {report.analysis.correlations?.length ? (
                <div className="lr-card lr-card--wins">
                  <div className="lr-card__title">{t('understanding.correlationsTitle')}</div>
                  <ul className="lr-list">
                    {report.analysis.correlations.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </RevealBlock>
          ) : null}

          {report.analysis.whatToWatch?.length ? (
            <RevealBlock>
              <section className="lr-section">
                <h3 className="lr-section__title">{t('understanding.watchTitle')}</h3>
                {report.analysis.whatToWatch.map((p, i) => (
                  <div key={i} className="lr-priority" style={{ animationDelay: `${i * 0.08}s` }}>
                    <span className="lr-priority__num">{i + 1}</span>
                    <span>{p}</span>
                  </div>
                ))}
              </section>
            </RevealBlock>
          ) : null}

          {report.analysis.dataGaps?.length ? (
            <RevealBlock>
              <section className="lr-section">
                <h3 className="lr-section__title">{t('understanding.gapsTitle')}</h3>
                <ul className="lr-list">
                  {report.analysis.dataGaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </section>
            </RevealBlock>
          ) : null}

          <p className="lr-disclaimer">{t('understanding.disclaimer')}</p>
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { generateLifeAssessment, type LifeAssessment } from '../api';
import LifeReviewHeroVisual from '../components/lifeReview/LifeReviewHeroVisual';
import { useCountUp, useReveal } from '../components/lifeReview/useReveal';
import { useLocale } from '../i18n';
import '../styles/life-review.css';

const LOADING_STEPS = [
  'lifeReview.loadingGlucose',
  'lifeReview.loadingMeals',
  'lifeReview.loadingActivity',
  'lifeReview.loadingMood',
  'lifeReview.loadingPatterns',
  'lifeReview.loadingWriting',
] as const;

function StatCard({
  label,
  value,
  animate,
}: {
  label: string;
  value: string;
  animate: boolean;
}) {
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

export default function LifeReviewPage() {
  const { t } = useLocale();
  const [assessment, setAssessment] = useState<LifeAssessment | null>(null);
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
      const result = await generateLifeAssessment(7);
      setProgress(100);
      await new Promise((r) => setTimeout(r, 350));
      setAssessment(result);
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const totals = assessment?.totals as Record<string, unknown> | undefined;

  const stats = useMemo(() => {
    if (!totals) return [];
    const items: Array<{ label: string; value: string }> = [];
    if (totals.avgTimeInRangePct != null) {
      items.push({ label: t('lifeReview.statTir'), value: `${totals.avgTimeInRangePct}%` });
    }
    if (totals.totalSteps != null) {
      items.push({
        label: t('lifeReview.statSteps'),
        value: Number(totals.totalSteps).toLocaleString(),
      });
    }
    if (totals.mealCount != null) {
      items.push({ label: t('lifeReview.statMeals'), value: String(totals.mealCount) });
    }
    if (totals.workoutCount != null) {
      items.push({ label: t('lifeReview.statWorkouts'), value: String(totals.workoutCount) });
    }
    return items;
  }, [totals, t]);

  const dataPills = [
    t('lifeReview.pillGlucose'),
    t('lifeReview.pillMeals'),
    t('lifeReview.pillSteps'),
    t('lifeReview.pillMood'),
    t('lifeReview.pillStress'),
    t('lifeReview.pillSport'),
  ];

  const showResults = !busy && assessment;

  return (
    <div className="life-review-page">
      <section className="lr-hero">
        <div className="lr-hero__mesh" aria-hidden />
        <div className="lr-hero__particles" aria-hidden />
        <div className="lr-hero__content">
          <div className="lr-eyebrow">
            <span className="lr-eyebrow__pulse" aria-hidden />
            {t('lifeReview.eyebrow')}
          </div>
          <h1>{t('lifeReview.title')}</h1>
          <p className="lr-hero__lede">{t('lifeReview.lede')}</p>
          <div className="lr-pills">
            {dataPills.map((pill) => (
              <span key={pill} className="lr-pill">
                {pill}
              </span>
            ))}
          </div>
          <button type="button" className="lr-cta" disabled={busy} onClick={run}>
            {busy ? (
              <>
                <span className="lr-cta__icon" aria-hidden />
                {t('lifeReview.generating')}
              </>
            ) : assessment ? (
              t('lifeReview.regenerate')
            ) : (
              t('lifeReview.generate')
            )}
          </button>
        </div>
        <div className="lr-hero__visual-wrap">
          <LifeReviewHeroVisual active={busy || !!assessment} />
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
          <p className="lr-loading__hint">{t('lifeReview.loadingHint')}</p>
        </div>
      ) : null}

      {!busy && !assessment ? (
        <div className="lr-empty">
          <div className="lr-empty__icon" aria-hidden>
            ✦
          </div>
          <p>{t('lifeReview.empty')}</p>
        </div>
      ) : null}

      {showResults ? (
        <div className="lr-results" key={assessment.generatedAt || assessment.periodEnd}>
          <RevealBlock>
            <span className="lr-period-badge">
              {assessment.periodStart} → {assessment.periodEnd}
            </span>
            <h2 className="lr-headline">{assessment.headline}</h2>
          </RevealBlock>

          {stats.length > 0 ? (
            <RevealBlock className="lr-stats">
              {stats.map((s) => (
                <StatCard key={s.label} label={s.label} value={s.value} animate />
              ))}
            </RevealBlock>
          ) : null}

          <RevealBlock>
            <div className="lr-summary">{assessment.honestSummary}</div>
          </RevealBlock>

          {(assessment.glucoseVerdict ||
            assessment.lifestyleVerdict ||
            assessment.moodVerdict) && (
            <RevealBlock className="lr-verdicts">
              {assessment.glucoseVerdict ? (
                <article className="lr-verdict lr-verdict--glucose">
                  <div className="lr-verdict__glow" aria-hidden />
                  <div className="lr-verdict__icon">💧</div>
                  <div className="lr-verdict__title">{t('reports.glucoseVerdict')}</div>
                  <p className="lr-verdict__body">{assessment.glucoseVerdict}</p>
                </article>
              ) : null}
              {assessment.lifestyleVerdict ? (
                <article className="lr-verdict lr-verdict--lifestyle">
                  <div className="lr-verdict__glow" aria-hidden />
                  <div className="lr-verdict__icon">👟</div>
                  <div className="lr-verdict__title">{t('reports.lifestyleVerdict')}</div>
                  <p className="lr-verdict__body">{assessment.lifestyleVerdict}</p>
                </article>
              ) : null}
              {assessment.moodVerdict ? (
                <article className="lr-verdict lr-verdict--mood">
                  <div className="lr-verdict__glow" aria-hidden />
                  <div className="lr-verdict__icon">✨</div>
                  <div className="lr-verdict__title">{t('reports.moodVerdict')}</div>
                  <p className="lr-verdict__body">{assessment.moodVerdict}</p>
                </article>
              ) : null}
            </RevealBlock>
          )}

          {(assessment.wins.length > 0 || assessment.concerns.length > 0) && (
            <RevealBlock className="lr-split">
              {assessment.wins.length > 0 ? (
                <div className="lr-card lr-card--wins">
                  <div className="lr-card__title">{t('reports.lifeWins')}</div>
                  <ul className="lr-list">
                    {assessment.wins.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {assessment.concerns.length > 0 ? (
                <div className="lr-card lr-card--concerns">
                  <div className="lr-card__title">{t('reports.lifeConcerns')}</div>
                  <ul className="lr-list">
                    {assessment.concerns.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </RevealBlock>
          )}

          {assessment.patterns.length > 0 ? (
            <RevealBlock>
              <section className="lr-section">
                <h3 className="lr-section__title">{t('reports.lifePatterns')}</h3>
                <p className="lr-section__sub">{t('reports.lifePatternsHelp')}</p>
                <ul className="lr-list">
                  {assessment.patterns.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </section>
            </RevealBlock>
          ) : null}

          {assessment.priorities.length > 0 ? (
            <RevealBlock>
              <section className="lr-section">
                <h3 className="lr-section__title">{t('reports.lifePriorities')}</h3>
                <p className="lr-section__sub">{t('lifeReview.prioritiesSub')}</p>
                {assessment.priorities.map((p, i) => (
                  <div key={i} className="lr-priority" style={{ animationDelay: `${i * 0.08}s` }}>
                    <span className="lr-priority__num">{i + 1}</span>
                    <span>{p}</span>
                  </div>
                ))}
              </section>
            </RevealBlock>
          ) : null}

          <p className="lr-disclaimer">{t('reports.lifeReviewDisclaimer')}</p>
        </div>
      ) : null}
    </div>
  );
}

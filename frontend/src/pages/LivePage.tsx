import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchSharedLiveView, type LiveView } from '../api';
import { useLocale } from '../i18n';
import { ARROW_GLYPH, liveText } from '../components/live/liveText';

const REFRESH_MS = 60_000;
const ALERT_MINUTES = 20;
const MMOL = 18.0182;

const ZONE_COLOR: Record<string, string> = {
  urgentLow: '#FF1F4B',
  low: '#FF4D6D',
  inRange: '#2EF2B5',
  high: '#FFB547',
  veryHigh: '#FF4D6D',
  unknown: '#5B6B82',
};

function fmtValue(mgDl: number, unit: string) {
  return unit.toLowerCase() === 'mg/dl' ? String(Math.round(mgDl)) : (mgDl / MMOL).toFixed(1);
}

function fmtDelta(ratePerMin: number | null, unit: string) {
  if (ratePerMin == null) return null;
  const mg = ratePerMin * 5;
  const mgUnit = unit.toLowerCase() === 'mg/dl';
  const v = mgUnit ? Math.round(mg) : Math.round((mg / MMOL) * 10) / 10;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
  return `${sign}${mgUnit ? Math.abs(v) : Math.abs(v).toFixed(1)}`;
}

export default function LivePage() {
  const { token = '' } = useParams();
  const { locale, setLocale } = useLocale();
  const tx = liveText(locale);
  const [data, setData] = useState<LiveView | null>(null);
  const [error, setError] = useState(false);
  const [clock, setClock] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setData(await fetchSharedLiveView(token));
      setError(false);
    } catch {
      setError(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const poll = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setClock(Date.now()), 15_000);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const name = data?.patient?.displayName || '';
  const insight = data?.insight;
  const current = data?.current;
  const unit = data?.unit || 'mg/dL';
  // Age from the reading's own timestamp so it keeps counting between refreshes
  const ageMin = current ? Math.max(0, Math.floor((clock - current.timestamp) / 60_000)) : 0;
  const stale = !!insight?.isStale || (current ? clock - current.timestamp > 15 * 60_000 : false);
  const zone = stale ? 'unknown' : insight?.zone || 'unknown';
  const color = ZONE_COLOR[zone];

  const alert = useMemo(() => {
    if (!insight || !current || stale) return null;
    if (insight.zone === 'urgentLow') return { text: tx.urgentLow, color: ZONE_COLOR.urgentLow };
    if (insight.minutesToLow != null && insight.minutesToLow <= ALERT_MINUTES)
      return { text: tx.lowIn(Math.max(1, insight.minutesToLow)), color: ZONE_COLOR.low };
    if (insight.minutesToHigh != null && insight.minutesToHigh <= ALERT_MINUTES)
      return { text: tx.highIn(Math.max(1, insight.minutesToHigh)), color: ZONE_COLOR.high };
    return null;
  }, [insight, current, stale, tx]);

  // The browser tab shows the live value too
  useEffect(() => {
    if (current) {
      const arrow = !stale && insight ? ARROW_GLYPH[insight.arrow] : '';
      document.title = `${fmtValue(current.mgDl, unit)} ${arrow} · ${name || 'Health Companion'}`;
    }
  }, [current, insight, unit, name, stale]);

  if (error && !data) {
    return (
      <div className="live-page">
        <p className="live-gone">{tx.gone}</p>
      </div>
    );
  }

  const delta = insight ? fmtDelta(insight.ratePerMin, unit) : null;
  const statusParts = [
    !stale && insight && insight.arrow !== 'none' ? tx.arrow[insight.arrow] : null,
    !stale && delta ? `${delta} ${tx.perFive}` : null,
    current ? tx.ago(ageMin) : null,
  ].filter(Boolean);

  return (
    <div className="live-page" style={{ ['--zone' as string]: color }}>
      <header className="live-header">
        <div className="live-brand">
          <img src="/brand-logo.png" alt="" width={36} height={36} />
          <div>
            <h1>{name ? tx.title(name) : 'Health Companion'}</h1>
            <p className="live-pulse">
              <span className="live-dot" /> {tx.live}
              {data ? ` · ${tx.updated(new Date(data.now).toLocaleTimeString(locale === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }))}` : ''}
            </p>
          </div>
        </div>
        <div className="segmented">
          {(['fr', 'en'] as const).map((l) => (
            <button key={l} type="button" className={locale === l ? 'on' : ''} onClick={() => setLocale(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <section className={`live-hero${stale ? ' is-stale' : ''}`}>
        {current ? (
          <>
            <div className="live-reading">
              <span className="live-value">{fmtValue(current.mgDl, unit)}</span>
              <span className="live-unit">{unit}</span>
              {!stale && insight && insight.arrow !== 'none' ? (
                <span className="live-arrow" aria-label={tx.arrow[insight.arrow]}>
                  {ARROW_GLYPH[insight.arrow]}
                </span>
              ) : null}
            </div>
            <p className="live-zone">{tx.zone[zone]}</p>
            <p className="live-status">{statusParts.join('  ·  ')}</p>
            {alert ? (
              <p className="live-alert" style={{ ['--alert-color' as string]: alert.color }}>
                {alert.text}
              </p>
            ) : null}
            {stale ? <p className="live-stale">{tx.stale(ageMin)}</p> : null}
          </>
        ) : (
          <p className="muted">{data ? tx.waiting : '…'}</p>
        )}
      </section>

      {data && data.readings.length > 1 ? (
        <section className="live-card">
          <p className="live-label">{tx.chart}</p>
          <LiveChart data={data} color={color} nowLabel={tx.now} />
        </section>
      ) : null}

      {data ? (
        <section className="live-stats">
          <Stat label={tx.tir} value={data.today.timeInRangePct != null ? `${data.today.timeInRangePct}%` : '—'} />
          <Stat label={tx.avg} value={data.today.avgMgDl != null ? `${fmtValue(data.today.avgMgDl, unit)}` : '—'} hint={data.today.avgMgDl != null ? unit : undefined} />
          <Stat label={tx.carbs} value={`${data.today.carbsG} g`} hint={tx.meals(data.today.mealCount)} />
          <Stat label={tx.insulin} value={`${data.today.insulinU} U`} />
        </section>
      ) : null}

      {data ? (
        <section className="live-card live-recent">
          <div>
            <p className="live-label">{tx.lastMeal}</p>
            <p>
              {data.lastMeal
                ? `${tx.meal[data.lastMeal.mealType] || tx.meal.other} · ${data.lastMeal.carbsG} g · ${tx.ago(Math.floor((clock - data.lastMeal.timestamp) / 60_000))}`
                : tx.none}
            </p>
          </div>
          <div>
            <p className="live-label">{tx.lastInsulin}</p>
            <p>
              {data.lastInsulin
                ? `${data.lastInsulin.units != null ? `${data.lastInsulin.units} U · ` : ''}${tx.ago(Math.floor((clock - data.lastInsulin.timestamp) / 60_000))}`
                : tx.none}
            </p>
          </div>
        </section>
      ) : null}

      <p className="live-footer">{tx.footer}</p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="live-stat">
      <p className="live-label">{label}</p>
      <p className="live-stat-value">{value}</p>
      {hint ? <p className="live-stat-hint">{hint}</p> : null}
    </div>
  );
}

/** 12 h trace with the target band and the 30-minute forecast. */
function LiveChart({ data, color, nowLabel }: { data: LiveView; color: string; nowLabel: string }) {
  const W = 600;
  const H = 180;
  const yMin = 40;
  const yMax = 300;
  const end = data.now + 30 * 60_000;
  const start = data.now - 12 * 3_600_000;
  const x = (ts: number) => ((ts - start) / (end - start)) * W;
  const y = (mg: number) => H - ((Math.min(Math.max(mg, yMin), yMax) - yMin) / (yMax - yMin)) * H;
  const pts = data.readings.filter((r) => r.timestamp >= start);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.timestamp).toFixed(1)},${y(p.mgDl).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  const forecast =
    last && data.insight.prediction.length && !data.insight.isStale
      ? [last, ...data.insight.prediction].map((p, i) => `${i ? 'L' : 'M'}${x(p.timestamp).toFixed(1)},${y(p.mgDl).toFixed(1)}`).join(' ')
      : '';
  const { lowMgDl, highMgDl } = data.targets;
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="live-chart" role="img" aria-label="Glucose, last 12 hours">
      <rect x={0} y={y(highMgDl)} width={W} height={y(lowMgDl) - y(highMgDl)} fill="rgba(46,242,181,0.08)" />
      <line x1={0} x2={W} y1={y(highMgDl)} y2={y(highMgDl)} stroke="rgba(46,242,181,0.35)" strokeDasharray="4 6" />
      <line x1={0} x2={W} y1={y(lowMgDl)} y2={y(lowMgDl)} stroke="rgba(255,77,109,0.4)" strokeDasharray="4 6" />
      <line x1={x(data.now)} x2={x(data.now)} y1={0} y2={H} stroke="#1E3350" />
      {line ? <path d={line} fill="none" stroke="#00E5FF" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" /> : null}
      {forecast ? <path d={forecast} fill="none" stroke="#9D8CFF" strokeWidth={2} strokeDasharray="5 5" /> : null}
      {last ? (
        <>
          <circle cx={x(last.timestamp)} cy={y(last.mgDl)} r={10} fill={color} opacity={0.25} />
          <circle cx={x(last.timestamp)} cy={y(last.mgDl)} r={4.5} fill="#fff" />
        </>
      ) : null}
      <text x={0} y={H + 15} className="live-axis">−12h</text>
      <text x={x(data.now)} y={H + 15} textAnchor="end" className="live-axis">{nowLabel}</text>
    </svg>
  );
}

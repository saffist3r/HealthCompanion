import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { useLocale } from '../../i18n';
import { careText, type CareText } from './careText';
import { causeText, type BolusTiming, type Cause, type CauseText, type FoundPattern } from './causeText';

export type CareSummary = {
  period: { days: number; from: string; to: string; generatedAt: number };
  glucose: {
    readingCount: number;
    bandsPct: Record<'veryLow' | 'low' | 'inRange' | 'high' | 'veryHigh', number> | null;
    meanMgDl: number | null;
    gmiPct: number | null;
    cvPct: number | null;
    daysWithData: number;
    hourly: Array<{ hour: number; n: number; p5?: number; p25?: number; p50?: number; p75?: number; p95?: number }>;
    targets?: { low: number; high: number };
  };
  hypos: {
    count: number;
    overnightCount: number;
    below54Count: number;
    events: Array<{
      startedAt: number;
      date: string;
      time: string;
      minMgDl: number;
      durationMin: number;
      overnight: boolean;
      mealBefore: { minutesBefore: number; mealType: string; carbsG: number } | null;
      insulinBeforeU: number | null;
      sportSameDay: string[] | null;
      causes?: Cause[];
    }>;
    patterns?: Pattern[];
  };
  highs?: {
    count: number;
    events: Array<{ startedAt: number; date: string; time: string; peakMgDl: number; durationMin: number; causes: Cause[] }>;
    patterns: Pattern[];
  };
  bolusTiming?: BolusTiming;
  patternsFound?: { lookbackDays: number; daysWithData: number; patterns: FoundPattern[] };
  carbRatio?: number | null;
  insulin: { avgDailyU: number | null; daysWithData: number };
  carbs: { avgDailyG: number | null; daysLogged: number };
  activity: { avgSteps: number | null; sportSessions: number };
  daily: Array<{
    date: string;
    carbsG: number;
    insulinU: number;
    mealCount: number;
    steps: number | null;
    meanMgDl: number | null;
    inRangePct: number | null;
    hypoCount: number;
  }>;
  pain: Array<{
    title: string;
    bodyArea: string;
    status: string;
    logCount: number;
    avgPain: number | null;
    latestPain: number | null;
    maxPain: number | null;
    trend: 'better' | 'worse' | 'stable' | null;
  }>;
  wellbeing: {
    checkInDays: number;
    moodCounts: Record<string, number>;
    avgSleepHours: number | null;
    medicationTakenDays: number;
    stressLogs: number;
    highStressLogs: number;
  };
  patient?: { displayName: string };
  share?: { label: string; note: string | null; expiresAt: number };
};

const BAND_COLORS = {
  veryLow: '#991b1b',
  low: '#FF4D6D',
  inRange: '#2EF2B5',
  high: '#FFB547',
  veryHigh: '#FFB547',
} as const;

/** Consensus goals (Battelino 2019) for type 1 diabetes. */
const BAND_GOALS: Record<keyof typeof BAND_COLORS, { op: '<' | '>'; pct: number }> = {
  veryLow: { op: '<', pct: 1 },
  low: { op: '<', pct: 4 },
  inRange: { op: '>', pct: 70 },
  high: { op: '<', pct: 25 },
  veryHigh: { op: '<', pct: 5 },
};

function meetsGoal(key: keyof typeof BAND_COLORS, value: number): boolean {
  const g = BAND_GOALS[key];
  return g.op === '<' ? value < g.pct : value > g.pct;
}

type Pattern = { code: string; count: number; of: number };

/** Strongest contributor in bold, the rest listed after it. */
function Causes({ causes, cx }: { causes?: Cause[]; cx: CauseText }) {
  if (!causes?.length) return <span className="muted">—</span>;
  const [first, ...rest] = causes;
  const none = first.code.startsWith('noLoggedCause');
  return (
    <div className="care-causes">
      <div className={none ? 'muted' : ''}>
        {none ? null : <span className="care-cause-tag">{cx.likely}</span>}
        {none ? cx.cause(first) : <strong>{cx.cause(first)}</strong>}
      </div>
      {rest.length ? (
        <ul>
          {rest.map((c) => (
            <li key={c.code}>{cx.cause(c)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PatternList({ items, cx }: { items?: Pattern[]; cx: CauseText }) {
  if (!items?.length) return <p className="muted">{cx.noPatterns}</p>;
  return (
    <ul className="care-patterns">
      {items.map((p) => (
        <li key={p.code} className={p.code.startsWith('noLoggedCause') ? 'muted' : ''}>
          <span>{cx.pattern[p.code] || p.code}</span>
          <span className="care-pattern-bar" aria-hidden="true">
            <span style={{ width: `${Math.round((p.count / Math.max(1, p.of)) * 100)}%` }} />
          </span>
          <span className="care-pattern-count">{cx.ofEpisodes(p.count, p.of)}</span>
        </li>
      ))}
    </ul>
  );
}

function fmtDuration(min: number) {
  return min >= 90 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
}

function fmtDate(d: string, locale: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function Metric({ label, value, unit, hint, tone }: { label: string; value: string; unit?: string; hint?: string; tone?: 'good' | 'warn' }) {
  return (
    <div className={`care-metric ${tone ?? ''}`}>
      <div className="care-metric-label">{label}</div>
      <div className="care-metric-value">
        {value}
        {unit ? <span>{unit}</span> : null}
      </div>
      {hint ? <div className="care-metric-hint">{hint}</div> : null}
    </div>
  );
}

function TirBar({ bands, tx }: { bands: NonNullable<CareSummary['glucose']['bandsPct']>; tx: CareText }) {
  const order = ['veryHigh', 'high', 'inRange', 'low', 'veryLow'] as const;
  return (
    <div className="care-tir">
      <div className="care-tir-bar" role="img" aria-label={tx.tirTitle}>
        {order.map((k) =>
          bands[k] > 0 ? <div key={k} style={{ flexGrow: bands[k], background: BAND_COLORS[k] }} /> : null
        )}
      </div>
      <table className="care-tir-table">
        <tbody>
          {order.map((k) => (
            <tr key={k}>
              <td>
                <span className="dot" style={{ background: BAND_COLORS[k] }} /> {tx.bands[k]}
              </td>
              <td className="num">
                <strong>{bands[k]}%</strong>
              </td>
              <td className={`goal ${meetsGoal(k, bands[k]) ? 'ok' : 'miss'}`}>
                {tx.goal} {BAND_GOALS[k].op} {BAND_GOALS[k].pct}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TypicalDay({ hourly, tx }: { hourly: CareSummary['glucose']['hourly']; tx: CareText }) {
  const data = hourly.map((h) => ({
    hour: `${String(h.hour).padStart(2, '0')}h`,
    outer: h.n ? [h.p5, h.p95] : null,
    inner: h.n ? [h.p25, h.p75] : null,
    median: h.n ? h.p50 : null,
  }));
  return (
    <div className="care-agp">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={2} />
          <YAxis domain={[40, 300]} ticks={[54, 70, 180, 250]} tick={{ fontSize: 11 }} />
          <ReferenceLine y={70} stroke="#FF4D6D" strokeDasharray="4 4" />
          <ReferenceLine y={180} stroke="#FFB547" strokeDasharray="4 4" />
          <Area dataKey="outer" stroke="none" fill="#99f6e4" fillOpacity={0.45} isAnimationActive={false} name="5–95%" />
          <Area dataKey="inner" stroke="none" fill="#2dd4bf" fillOpacity={0.55} isAnimationActive={false} name="25–75%" />
          <Line dataKey="median" stroke="#2EF2B5" strokeWidth={2.5} dot={false} isAnimationActive={false} name={tx.median} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="care-caption">{tx.agpCaption}</p>
    </div>
  );
}

export default function CareSummaryView({ data }: { data: CareSummary }) {
  const { locale } = useLocale();
  const tx = careText(locale);
  const cx = causeText(locale);
  const g = data.glucose;
  const coverage = data.period.days ? Math.round((g.daysWithData / (data.daily.length || 1)) * 100) : 0;
  const tir = g.bandsPct?.inRange ?? null;
  const below70 = g.bandsPct ? Math.round((g.bandsPct.low + g.bandsPct.veryLow) * 10) / 10 : null;
  const painActive = data.pain.filter((p) => p.logCount || p.status === 'active');
  const w = data.wellbeing;
  const moodOrder = ['great', 'good', 'ok', 'low', 'terrible'];

  return (
    <div className="care-view">
      {data.share?.note ? (
        <section className="care-section care-note">
          <h2>{tx.discuss}</h2>
          <p>{data.share.note}</p>
        </section>
      ) : null}

      <section className="care-section">
        <h2>{tx.glucoseTitle}</h2>
        <div className="care-metrics">
          <Metric
            label={tx.tir}
            value={tir != null ? `${tir}` : '—'}
            unit="%"
            hint={`${tx.goal} > 70%`}
            tone={tir == null ? undefined : tir >= 70 ? 'good' : 'warn'}
          />
          <Metric
            label={tx.below70}
            value={below70 != null ? `${below70}` : '—'}
            unit="%"
            hint={`${tx.goal} < 4%`}
            tone={below70 == null ? undefined : below70 < 4 ? 'good' : 'warn'}
          />
          <Metric label={tx.mean} value={g.meanMgDl != null ? `${g.meanMgDl}` : '—'} unit="mg/dL" />
          <Metric label={tx.gmi} value={g.gmiPct != null ? `${g.gmiPct}` : '—'} unit="%" hint={tx.gmiHint} />
          <Metric
            label={tx.cv}
            value={g.cvPct != null ? `${g.cvPct}` : '—'}
            unit="%"
            hint={`${tx.goal} ≤ 36%`}
            tone={g.cvPct == null ? undefined : g.cvPct <= 36 ? 'good' : 'warn'}
          />
          <Metric label={tx.coverage} value={`${coverage}`} unit="%" hint={tx.coverageHint(g.daysWithData, data.daily.length)} />
        </div>
        {g.bandsPct ? (
          <div className="care-two-col">
            <div>
              <h3>{tx.tirTitle}</h3>
              <TirBar bands={g.bandsPct} tx={tx} />
            </div>
            <div>
              <h3>{tx.agpTitle}</h3>
              <TypicalDay hourly={g.hourly} tx={tx} />
            </div>
          </div>
        ) : (
          <p className="muted">{tx.noGlucose}</p>
        )}
      </section>

      {data.patternsFound ? (
        <section className="care-section">
          <h2>{cx.foundTitle}</h2>
          <p className="muted">{cx.foundLede(data.patternsFound.lookbackDays, data.patternsFound.daysWithData)}</p>
          {data.patternsFound.patterns.length ? (
            <ol className="care-found">
              {data.patternsFound.patterns.map((p) => (
                <li key={p.code}>{cx.found(p)}</li>
              ))}
            </ol>
          ) : (
            <p className="muted">{cx.foundNone}</p>
          )}
        </section>
      ) : null}

      <section className="care-section">
        <h2>
          {tx.hyposTitle} <span className="care-count">{data.hypos.count}</span>
        </h2>
        <p className="muted">
          {tx.hyposSummary(data.hypos.count, data.hypos.overnightCount, data.hypos.below54Count)}
        </p>
        {data.hypos.events.length ? (
          <div className="table-wrap">
            <table className="data-table care-table">
              <thead>
                <tr>
                  <th>{tx.when}</th>
                  <th className="num">{tx.lowest}</th>
                  <th className="num">{tx.duration}</th>
                  <th>{cx.contributors}</th>
                </tr>
              </thead>
              <tbody>
                {data.hypos.events.map((h) => {
                  const ctx: string[] = [];
                  if (h.mealBefore) ctx.push(tx.mealBefore(h.mealBefore.mealType, h.mealBefore.carbsG, h.mealBefore.minutesBefore));
                  if (h.insulinBeforeU) ctx.push(tx.insulinBefore(h.insulinBeforeU));
                  if (h.sportSameDay?.length) ctx.push(tx.sportSameDay(h.sportSameDay.join(', ')));
                  return (
                    <tr key={h.startedAt}>
                      <td>
                        {fmtDate(h.date, locale)} · {h.time}
                        {h.overnight ? <span className="care-tag">{tx.night}</span> : null}
                      </td>
                      <td className={`num ${h.minMgDl < 54 ? 'care-danger' : ''}`}>{Math.round(h.minMgDl)}</td>
                      <td className="num">{h.durationMin} min</td>
                      <td>
                        <Causes causes={h.causes} cx={cx} />
                        {ctx.length ? <div className="muted small care-context">{ctx.join(' · ')}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {data.highs ? (
        <section className="care-section">
          <h2>
            {cx.highsTitle} <span className="care-count care-count-high">{data.highs.count}</span>
          </h2>
          <p className="muted">{cx.highsSummary(data.highs.count, data.glucose.targets?.high ?? 180)}</p>
          {data.highs.events.length ? (
            <div className="table-wrap">
              <table className="data-table care-table">
                <thead>
                  <tr>
                    <th>{tx.when}</th>
                    <th className="num">{cx.peak}</th>
                    <th className="num">{tx.duration}</th>
                    <th>{cx.contributors}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.highs.events.map((h) => (
                    <tr key={h.startedAt}>
                      <td>
                        {fmtDate(h.date, locale)} · {h.time}
                      </td>
                      <td className={`num ${h.peakMgDl > 250 ? 'care-danger' : 'care-warn'}`}>{h.peakMgDl}</td>
                      <td className="num">{fmtDuration(h.durationMin)}</td>
                      <td>
                        <Causes causes={h.causes} cx={cx} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {data.highs || data.hypos.patterns ? (
        <section className="care-section">
          <h2>{cx.patternsTitle}</h2>
          <div className="care-two-col">
            <div>
              <h3>{cx.hypoPatterns}</h3>
              <PatternList items={data.hypos.patterns} cx={cx} />
            </div>
            <div>
              <h3>{cx.highPatterns}</h3>
              <PatternList items={data.highs?.patterns} cx={cx} />
            </div>
          </div>
          {data.bolusTiming ? (
            <>
              <h3>{cx.bolusTitle}</h3>
              <p>{cx.bolusLine(data.bolusTiming)}</p>
            </>
          ) : null}
          {data.carbRatio ? <p className="muted">{cx.ratioLine(data.carbRatio)}</p> : null}
          <p className="muted small">{cx.caveat}</p>
        </section>
      ) : null}

      <section className="care-section">
        <h2>{tx.dailyTitle}</h2>
        <div className="care-metrics">
          <Metric label={tx.insulinAvg} value={data.insulin.avgDailyU != null ? `${data.insulin.avgDailyU}` : '—'} unit="U" hint={tx.daysOfData(data.insulin.daysWithData)} />
          <Metric label={tx.carbsAvg} value={data.carbs.avgDailyG != null ? `${data.carbs.avgDailyG}` : '—'} unit="g" hint={tx.daysOfData(data.carbs.daysLogged)} />
          <Metric label={tx.steps} value={data.activity.avgSteps != null ? data.activity.avgSteps.toLocaleString() : '—'} />
          <Metric label={tx.sport} value={`${data.activity.sportSessions}`} />
        </div>
        <div className="table-wrap">
          <table className="data-table care-table">
            <thead>
              <tr>
                <th>{tx.day}</th>
                <th className="num">{tx.tir}</th>
                <th className="num">{tx.mean}</th>
                <th className="num">{tx.hypos}</th>
                <th className="num">{tx.insulin}</th>
                <th className="num">{tx.carbs}</th>
                <th className="num">{tx.steps}</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.date}>
                  <td>{fmtDate(d.date, locale)}</td>
                  <td className="num">{d.inRangePct != null ? `${Math.round(d.inRangePct)}%` : '—'}</td>
                  <td className="num">{d.meanMgDl ?? '—'}</td>
                  <td className={`num ${d.hypoCount ? 'care-danger' : ''}`}>{d.hypoCount || '—'}</td>
                  <td className="num">{d.insulinU ? `${d.insulinU} U` : '—'}</td>
                  <td className="num">{d.mealCount ? `${d.carbsG} g` : '—'}</td>
                  <td className="num">{d.steps != null ? d.steps.toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="care-two-col">
        <section className="care-section">
          <h2>{tx.painTitle}</h2>
          {painActive.length ? (
            <table className="data-table care-table">
              <thead>
                <tr>
                  <th>{tx.injury}</th>
                  <th className="num">{tx.avgPain}</th>
                  <th className="num">{tx.latest}</th>
                  <th>{tx.trend}</th>
                </tr>
              </thead>
              <tbody>
                {painActive.map((p) => (
                  <tr key={p.title + p.bodyArea}>
                    <td>
                      {p.title}
                      <div className="muted small">{p.bodyArea}</div>
                    </td>
                    <td className="num">{p.avgPain != null ? `${p.avgPain}/10` : '—'}</td>
                    <td className="num">{p.latestPain != null ? `${p.latestPain}/10` : '—'}</td>
                    <td>{p.trend ? tx.trends[p.trend] : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">{tx.noPain}</p>
          )}
        </section>

        <section className="care-section">
          <h2>{tx.wellbeingTitle}</h2>
          {w.checkInDays ? (
            <>
              <div className="care-mood">
                {moodOrder.map((m) =>
                  w.moodCounts[m] ? (
                    <span key={m} className={`care-mood-chip mood-${m}`}>
                      {tx.moods[m]} × {w.moodCounts[m]}
                    </span>
                  ) : null
                )}
              </div>
              <ul className="care-list">
                <li>{tx.checkIns(w.checkInDays)}</li>
                {w.avgSleepHours != null ? <li>{tx.sleep(w.avgSleepHours)}</li> : null}
                {w.medicationTakenDays ? <li>{tx.meds(w.medicationTakenDays, w.checkInDays)}</li> : null}
                {w.stressLogs ? <li>{tx.stress(w.highStressLogs, w.stressLogs)}</li> : null}
              </ul>
            </>
          ) : (
            <p className="muted">{tx.noWellbeing}</p>
          )}
        </section>
      </div>
    </div>
  );
}

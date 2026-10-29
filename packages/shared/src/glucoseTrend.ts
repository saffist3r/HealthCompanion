/**
 * CGM trend engine shared by the phone and web apps. It mirrors the watch's
 * GlucoseTrendEngine.kt so all three show the same arrow, forecast and alerts.
 *
 * Why not "last minus first": readings arrive every 1–5 min with sensor noise and the
 * phone sometimes re-posts the same value, so a first/last comparison flips on noise and
 * ignores how long the change took. Here the rate is a recency-weighted least-squares
 * slope over the last ~10 minutes (wider when readings are sparse), classified with the
 * standard CGM rate bands, and the forecast damps that rate so it doesn't overshoot.
 */

/** One CGM reading in mg/dL. */
export interface GlucoseSample {
  mgDl: number;
  timestamp: number;
}

/** CGM-style trend arrows (same rate bands as Dexcom / Libre, in mg/dL per minute). */
export type TrendArrow =
  | 'doubleUp'
  | 'singleUp'
  | 'fortyFiveUp'
  | 'flat'
  | 'fortyFiveDown'
  | 'singleDown'
  | 'doubleDown'
  | 'none';

export type GlucoseZone = 'urgentLow' | 'low' | 'inRange' | 'high' | 'veryHigh' | 'unknown';

export interface GlucoseInsight {
  current: GlucoseSample | null;
  ageMs: number;
  isStale: boolean;
  /** Smoothed rate of change, mg/dL per minute (null when it can't be estimated). */
  ratePerMin: number | null;
  arrow: TrendArrow;
  /** 0..1 — how well the recent readings fit a straight line and how many there are. */
  confidence: number;
  zone: GlucoseZone;
  /** Projected readings every 5 min for the next {@link PREDICTION_MINUTES}. */
  prediction: GlucoseSample[];
  predicted20Min: number | null;
  /** Minutes until the projection crosses the low threshold (falling), within the horizon. */
  minutesToLow: number | null;
  /** Minutes until the projection crosses the high threshold (rising), within the horizon. */
  minutesToHigh: number | null;
  /** Share of readings in range over the history passed in, 0..100. */
  timeInRangePct: number | null;
}

export const STALE_AFTER_MS = 15 * 60 * 1000;
export const PREDICTION_MINUTES = 30;

const FIT_WINDOW_MS = 10 * 60 * 1000;
const FIT_WINDOW_SPARSE_MS = 35 * 60 * 1000;
const MIN_FIT_SPAN_MS = 4 * 60 * 1000;
const MERGE_WITHIN_MS = 45_000;
/** Recent readings count more: weight halves every ~3.5 min. */
const RECENCY_TAU_MIN = 5;
/** Glucose rarely changes faster than this; larger slopes are sensor glitches. */
const MAX_RATE = 6;
/** Forecast damping: the projected rate decays with this time constant (min). */
const DAMPING_TAU_MIN = 35;
/** Ignore crossings when the trend is basically flat. */
const MIN_ALERT_RATE = 0.4;
const URGENT_LOW_MG_DL = 54;
const VERY_HIGH_MG_DL = 250;

export const EMPTY_GLUCOSE_INSIGHT: GlucoseInsight = {
  current: null,
  ageMs: 0,
  isStale: true,
  ratePerMin: null,
  arrow: 'none',
  confidence: 0,
  zone: 'unknown',
  prediction: [],
  predicted20Min: null,
  minutesToLow: null,
  minutesToHigh: null,
  timeInRangePct: null,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function analyzeGlucose(
  history: GlucoseSample[],
  nowMs: number,
  lowMgDl = 70,
  highMgDl = 180,
): GlucoseInsight {
  const samples = sanitizeGlucose(history);
  const current = samples[samples.length - 1];
  if (!current) return EMPTY_GLUCOSE_INSIGHT;
  const ageMs = Math.max(0, nowMs - current.timestamp);
  const isStale = ageMs > STALE_AFTER_MS;
  const timeInRangePct = timeInRange(samples, lowMgDl, highMgDl);
  const zone = glucoseZone(current.mgDl, lowMgDl, highMgDl);

  const fit = isStale ? null : fitRate(samples, current);
  if (!fit) {
    return {
      ...EMPTY_GLUCOSE_INSIGHT,
      current,
      ageMs,
      isStale,
      zone,
      timeInRangePct,
    };
  }

  const rate = fit.rate;
  // Forecast from the latest reading (what the user sees), not the fitted line.
  const prediction: GlucoseSample[] = [];
  for (let step = 1; step <= PREDICTION_MINUTES / 5; step++) {
    const minutes = step * 5;
    prediction.push({
      mgDl: projectGlucose(current.mgDl, rate, minutes),
      timestamp: current.timestamp + minutes * 60_000,
    });
  }
  const minutesToLow =
    rate <= -MIN_ALERT_RATE && current.mgDl >= lowMgDl ? minutesUntil(current.mgDl, rate, lowMgDl) : null;
  const minutesToHigh =
    rate >= MIN_ALERT_RATE && current.mgDl <= highMgDl ? minutesUntil(current.mgDl, rate, highMgDl) : null;

  return {
    current,
    ageMs,
    isStale: false,
    ratePerMin: rate,
    arrow: trendArrowFor(rate),
    confidence: fit.confidence,
    zone,
    prediction,
    predicted20Min: projectGlucose(current.mgDl, rate, 20),
    minutesToLow,
    minutesToHigh,
    timeInRangePct,
  };
}

export function trendArrowFor(ratePerMin: number): TrendArrow {
  if (ratePerMin >= 3) return 'doubleUp';
  if (ratePerMin >= 2) return 'singleUp';
  if (ratePerMin >= 1) return 'fortyFiveUp';
  if (ratePerMin > -1) return 'flat';
  if (ratePerMin > -2) return 'fortyFiveDown';
  if (ratePerMin > -3) return 'singleDown';
  return 'doubleDown';
}

export function glucoseZone(mgDl: number, lowMgDl = 70, highMgDl = 180): GlucoseZone {
  if (mgDl < URGENT_LOW_MG_DL) return 'urgentLow';
  if (mgDl < lowMgDl) return 'low';
  if (mgDl <= highMgDl) return 'inRange';
  if (mgDl <= VERY_HIGH_MG_DL) return 'high';
  return 'veryHigh';
}

/** Damped projection: v0 + r·τ·(1 − e^(−t/τ)), clamped to what sensors report. */
export function projectGlucose(currentMgDl: number, ratePerMin: number, minutes: number): number {
  const travelled = ratePerMin * DAMPING_TAU_MIN * (1 - Math.exp(-minutes / DAMPING_TAU_MIN));
  return clamp(currentMgDl + travelled, 39, 401);
}

function minutesUntil(currentMgDl: number, ratePerMin: number, targetMgDl: number): number | null {
  // Solve v0 + r·τ·(1 − e^(−t/τ)) = target for t.
  const needed = targetMgDl - currentMgDl;
  const ratio = 1 - needed / (ratePerMin * DAMPING_TAU_MIN);
  if (ratio <= 0 || ratio >= 1 + 1e-9) return Math.abs(needed) < 1e-9 ? 0 : null;
  const minutes = -DAMPING_TAU_MIN * Math.log(ratio);
  return minutes >= 0 && minutes <= PREDICTION_MINUTES ? Math.trunc(minutes) : null;
}

function fitRate(samples: GlucoseSample[], current: GlucoseSample): { rate: number; confidence: number } | null {
  let window = samples.filter((s) => s.timestamp >= current.timestamp - FIT_WINDOW_MS);
  if (window.length < 3) {
    window = samples.filter((s) => s.timestamp >= current.timestamp - FIT_WINDOW_SPARSE_MS);
  }
  if (window.length < 2) return null;
  const spanMs = current.timestamp - window[0].timestamp;
  if (spanMs < MIN_FIT_SPAN_MS) return null;

  const xs = window.map((s) => (s.timestamp - current.timestamp) / 60_000); // minutes, ≤ 0
  const ys = window.map((s) => s.mgDl);
  const ws = xs.map((x) => Math.exp(x / RECENCY_TAU_MIN));
  const wSum = ws.reduce((a, b) => a + b, 0);
  const xMean = xs.reduce((a, x, i) => a + ws[i] * x, 0) / wSum;
  const yMean = ys.reduce((a, y, i) => a + ws[i] * y, 0) / wSum;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - xMean;
    sxx += ws[i] * dx * dx;
    sxy += ws[i] * dx * (ys[i] - yMean);
  }
  if (sxx <= 1e-9) return null;
  const rate = clamp(sxy / sxx, -MAX_RATE, MAX_RATE);

  let residual = 0;
  for (let i = 0; i < xs.length; i++) {
    const fitted = yMean + rate * (xs[i] - xMean);
    residual += ws[i] * (ys[i] - fitted) * (ys[i] - fitted);
  }
  const rms = Math.sqrt(residual / wSum);
  const fitQuality = clamp(1 - rms / 12, 0, 1);
  const countFactor = Math.min(window.length / 4, 1);
  const spanFactor = Math.min(spanMs / (10 * 60_000), 1);
  return { rate, confidence: fitQuality * countFactor * (0.5 + 0.5 * spanFactor) };
}

/** Oldest → newest, plausible values only, near-duplicate re-posts merged (latest wins). */
export function sanitizeGlucose(history: GlucoseSample[]): GlucoseSample[] {
  const sorted = history
    .filter((s) => s.timestamp > 0 && s.mgDl >= 20 && s.mgDl <= 600)
    .sort((a, b) => a.timestamp - b.timestamp);
  const out: GlucoseSample[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.timestamp - last.timestamp < MERGE_WITHIN_MS) {
      out[out.length - 1] = s;
    } else {
      out.push(s);
    }
  }
  return out;
}

function timeInRange(samples: GlucoseSample[], lowMgDl: number, highMgDl: number): number | null {
  if (samples.length < 3) return null;
  const inRange = samples.filter((s) => s.mgDl >= lowMgDl && s.mgDl <= highMgDl).length;
  return Math.round((inRange * 100) / samples.length);
}

/** Arrow glyph, as CGM apps draw it. */
export const TREND_ARROW_GLYPH: Record<TrendArrow, string> = {
  doubleUp: '⇈',
  singleUp: '↑',
  fortyFiveUp: '↗',
  flat: '→',
  fortyFiveDown: '↘',
  singleDown: '↓',
  doubleDown: '⇊',
  none: '',
};

export const TREND_ARROW_LABEL: Record<TrendArrow, string> = {
  doubleUp: 'Rising fast',
  singleUp: 'Rising',
  fortyFiveUp: 'Rising slowly',
  flat: 'Stable',
  fortyFiveDown: 'Falling slowly',
  singleDown: 'Falling',
  doubleDown: 'Falling fast',
  none: '',
};

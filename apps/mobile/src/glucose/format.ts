import type { GlucoseInsight, GlycemiaUnit } from '@health-companion/shared';

/** Same lead time as the watch face's alert chip. */
export const ALERT_MINUTES = 20;

const MMOL = 18.0182;

export function formatGlucose(mgDl: number, unit: GlycemiaUnit): string {
  return unit === 'mg/dL' ? String(Math.round(mgDl)) : (mgDl / MMOL).toFixed(1);
}

export function formatDelta5Min(insight: GlucoseInsight, unit: GlycemiaUnit): string | null {
  if (insight.ratePerMin == null) return null;
  const mg = insight.ratePerMin * 5;
  const v = unit === 'mg/dL' ? Math.round(mg) : Math.round((mg / MMOL) * 10) / 10;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
  return `${sign}${unit === 'mg/dL' ? Math.abs(v) : Math.abs(v).toFixed(1)}/5 min`;
}

export type TrendAlert = { text: string; level: 'urgent' | 'low' | 'high' | 'stale' };

/** The one alert worth showing right now, in the watch's wording. */
export function trendAlert(insight: GlucoseInsight): TrendAlert | null {
  if (!insight.current) return null;
  if (insight.isStale) return { text: 'No recent reading', level: 'stale' };
  if (insight.zone === 'urgentLow') return { text: 'Urgent low', level: 'urgent' };
  const low = insight.minutesToLow;
  if (low != null && low <= ALERT_MINUTES) return { text: `Low in ~${Math.max(1, low)} min`, level: 'low' };
  const high = insight.minutesToHigh;
  if (high != null && high <= ALERT_MINUTES) return { text: `High in ~${Math.max(1, high)} min`, level: 'high' };
  return null;
}

export function ageLabel(ageMs: number): string {
  const min = Math.floor(ageMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

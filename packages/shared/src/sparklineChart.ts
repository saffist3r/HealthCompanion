import {
  SPARKLINE_WINDOW_MS,
  SPARKLINE_Y_MAX_MG_DL,
  SPARKLINE_Y_MIN_MG_DL,
  type SparklinePoint,
} from './sparkline';
import { analyzeGlucose } from './glucoseTrend';

export interface SparklineLayout {
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
}

const DEFAULT_LAYOUT: SparklineLayout = {
  width: 280,
  height: 100,
  paddingLeft: 4,
  paddingRight: 4,
  paddingTop: 8,
  paddingBottom: 20,
};

export function toSparklinePoints(
  readings: { value: number; unit: string; timestamp: number }[],
  toMgDl: (value: number, unit: string) => number,
  now = Date.now(),
  windowMs = SPARKLINE_WINDOW_MS
): SparklinePoint[] {
  const start = now - windowMs;
  return readings
    .filter((r) => r.timestamp >= start && r.timestamp <= now)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((r) => ({
      valueMgDl: toMgDl(r.value, r.unit as 'mg/dL' | 'mmol/L'),
      timestamp: r.timestamp,
    }));
}

export function sparklinePath(
  points: SparklinePoint[],
  layout: Partial<SparklineLayout> = {},
  now = Date.now(),
  windowMs = SPARKLINE_WINDOW_MS
): string {
  if (points.length < 2) return '';
  const l = { ...DEFAULT_LAYOUT, ...layout };
  const plotW = l.width - l.paddingLeft - l.paddingRight;
  const plotH = l.height - l.paddingTop - l.paddingBottom;
  const windowStart = now - windowMs;

  const coords = points.map((p) => {
    const xFrac = (p.timestamp - windowStart) / windowMs;
    const x = l.paddingLeft + Math.min(1, Math.max(0, xFrac)) * plotW;
    const yNorm =
      (p.valueMgDl - SPARKLINE_Y_MIN_MG_DL) / (SPARKLINE_Y_MAX_MG_DL - SPARKLINE_Y_MIN_MG_DL);
    const y = l.paddingTop + plotH - Math.min(1, Math.max(0, yNorm)) * plotH;
    return { x, y };
  });

  return coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
}

export function sparklineBandY(
  mgDl: number,
  layout: Partial<SparklineLayout> = {}
): number {
  const l = { ...DEFAULT_LAYOUT, ...layout };
  const plotH = l.height - l.paddingTop - l.paddingBottom;
  const yNorm = (mgDl - SPARKLINE_Y_MIN_MG_DL) / (SPARKLINE_Y_MAX_MG_DL - SPARKLINE_Y_MIN_MG_DL);
  return l.paddingTop + plotH - Math.min(1, Math.max(0, yNorm)) * plotH;
}

/** X position for a timestamp inside the sparkline window. */
export function sparklineX(
  timestamp: number,
  layout: Partial<SparklineLayout> = {},
  now = Date.now(),
  windowMs = SPARKLINE_WINDOW_MS
): number {
  const l = { ...DEFAULT_LAYOUT, ...layout };
  const plotW = l.width - l.paddingLeft - l.paddingRight;
  const windowStart = now - windowMs;
  const xFrac = (timestamp - windowStart) / windowMs;
  return l.paddingLeft + Math.min(1, Math.max(0, xFrac)) * plotW;
}

/** Coarse direction from the CGM trend engine (null when stale or too few readings). */
export function sparklineTrend(points: SparklinePoint[], nowMs = Date.now()): 'up' | 'down' | 'flat' | null {
  const { arrow } = analyzeGlucose(
    points.map((p) => ({ mgDl: p.valueMgDl, timestamp: p.timestamp })),
    nowMs,
  );
  if (arrow === 'none') return null;
  if (arrow === 'flat') return 'flat';
  return arrow.endsWith('Up') ? 'up' : 'down';
}

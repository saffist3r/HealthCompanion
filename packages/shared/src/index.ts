export * from './background';
export * from './sparkline';
export * from './sparklineChart';
export * from './nutrition';
export * from './reports';
export * from './healthMetrics';
export * from './lifestyle';
export * from './injuries';
export * from './pump';

export type GlycemiaUnit = 'mmol/L' | 'mg/dL';

export type GlycemiaStatusLabel = 'Low' | 'In range' | 'High' | 'Very high';

export const DEFAULT_TIR_LOW_MGDL = 70;
export const DEFAULT_TIR_HIGH_MGDL = 180;

/**
 * Convert reading to mg/dL for range comparison.
 */
export function toMgDl(value: number, unit: GlycemiaUnit): number {
  return unit === 'mg/dL' ? value : value * 18.0182;
}

/**
 * Get status label for a glycemia reading.
 */
export function getGlycemiaStatusLabel(
  reading: GlycemiaReading,
  range?: { low?: number; high?: number }
): GlycemiaStatusLabel {
  const mgDl = toMgDl(reading.value, reading.unit);
  const low = range?.low ?? DEFAULT_TIR_LOW_MGDL;
  const high = range?.high ?? DEFAULT_TIR_HIGH_MGDL;
  if (mgDl < low) return 'Low';
  if (mgDl <= high) return 'In range';
  if (mgDl <= 250) return 'High';
  return 'Very high';
}

/**
 * Get status color hex for a glycemia reading.
 */
export function getGlycemiaStatusColor(
  reading: GlycemiaReading,
  range?: { low?: number; high?: number }
): string {
  const mgDl = toMgDl(reading.value, reading.unit);
  const low = range?.low ?? DEFAULT_TIR_LOW_MGDL;
  const high = range?.high ?? DEFAULT_TIR_HIGH_MGDL;
  if (mgDl < low) return '#E57373';
  if (mgDl <= high) return '#81C784';
  if (mgDl <= 250) return '#FFB74D';
  return '#E57373';
}

export interface GlycemiaReading {
  value: number;
  unit: GlycemiaUnit;
  timestamp: number;
}

/** CapAPS Fx / CamAPS FX app package ID patterns (mmol/L and mg/dL variants) */
export const CAPAPS_FX_PACKAGE_IDS = [
  'com.camdiab.fx_alert.mmoll',
  'com.camdiab.fx_alert.mgdl',
  'com.camdiab.fx_alert.mmoll.ca',
  'com.camdiab.fx_alert',
  'com.camdiab',
] as const;

/** Path for Wear OS Data Layer sync */
export const GLYCEMIA_DATA_PATH = '/health_companion/glycemia';

/** Minimum plausible glucose (~0.4 mmol/L). Values at or below 0 are always rejected. */
export const MIN_PLAUSIBLE_GLUCOSE_MG_DL = 7;

const INSULIN_KEYWORDS =
  /\b(bolus|insulin|insuline|injected|injection|injecté|injectee|units?|unités?|carbs?|glucides?|meal|repas|correction|delivered|delivré|prime|iob)\b/i;

const INSULIN_DOSE_PATTERN = /\d+\.?\d*\s*(?:U|IU|units?|unités?)\b/i;

const GLUCOSE_CONTEXT_PATTERN =
  /\b(BG|blood\s*glucose|glucose|glycémie|glycemie|CGM|sensor|mmol|mg\s*\/\s*d[lL])\b/i;

/**
 * True when notification text is mainly about insulin / bolus / carbs, not a glucose reading.
 */
export function isLikelyInsulinNotification(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  // Mixed glucose + bolus in one line: still allow glucose parsing.
  if (GLUCOSE_CONTEXT_PATTERN.test(t) && hasExplicitGlucoseUnit(t)) return false;
  if (INSULIN_DOSE_PATTERN.test(t)) return true;
  if (INSULIN_KEYWORDS.test(t) && !GLUCOSE_CONTEXT_PATTERN.test(t)) return true;
  return false;
}

/**
 * Reject 0.0 and other non-physical values (real CGM can be very low, e.g. 0.4 mmol/L).
 */
export function isPlausibleGlucoseValue(value: number, unit: GlycemiaUnit): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  const mgDl = toMgDl(value, unit);
  return mgDl >= MIN_PLAUSIBLE_GLUCOSE_MG_DL && mgDl <= 600;
}

/**
 * Only treat text as glucose when a real unit appears (avoids bolus / insulin lines like "3.2 U"
 * or labels such as "BG:" without a unit, which CapAPS may reuse with insulin doses).
 */
export function hasExplicitGlucoseUnit(text: string): boolean {
  const t = text ?? '';
  return (
    /\bmg\s*\/\s*d[lL]\b/i.test(t) ||
    /\bmg\s*d[lL]\b/i.test(t) ||
    /\bmmol\s*\/\s*[lL]\b/i.test(t) ||
    /\d+\.?\d*\s+mmol\b/i.test(t)
  );
}

interface GlucoseMatch {
  value: number;
  unit: GlycemiaUnit;
  index: number;
}

function findGlucoseMatches(text: string): GlucoseMatch[] {
  const matches: GlucoseMatch[] = [];
  for (const { regex, unit, groupIndex } of BG_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const raw = match[groupIndex];
      const value = parseFloat(raw);
      if (Number.isNaN(value)) continue;
      if (!isPlausibleGlucoseValue(value, unit)) continue;
      const slice = text.slice(Math.max(0, match.index - 24), match.index + match[0].length + 24);
      if (INSULIN_DOSE_PATTERN.test(slice) && !GLUCOSE_CONTEXT_PATTERN.test(slice)) continue;
      matches.push({ value, unit, index: match.index });
    }
  }
  return matches;
}

function selectBestGlucoseMatch(text: string, matches: GlucoseMatch[]): GlucoseMatch | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const scored = matches.map((m) => {
    const slice = text.slice(Math.max(0, m.index - 32), m.index + 32);
    let score = 0;
    if (GLUCOSE_CONTEXT_PATTERN.test(slice)) score += 10;
    if (/\bmmol\s*\/\s*[lL]\b/i.test(slice) || /\bmg\s*\/\s*d[lL]\b/i.test(slice)) score += 5;
    if (INSULIN_KEYWORDS.test(slice)) score -= 8;
    if (INSULIN_DOSE_PATTERN.test(slice)) score -= 12;
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 0 ? scored[0].m : matches[0];
}

/**
 * Regex patterns to extract blood glucose from notification text.
 * Each pattern requires an explicit mg/dL or mmol/L (or mmol) next to the number — never bare numbers.
 */
const BG_PATTERNS: Array<{
  regex: RegExp;
  unit: GlycemiaUnit;
  groupIndex: number;
}> = [
  { regex: /(\d+\.?\d*)\s*mmol\/L/i, unit: 'mmol/L', groupIndex: 1 },
  { regex: /(\d+\.?\d*)\s*mg\s*\/\s*d[lL]/i, unit: 'mg/dL', groupIndex: 1 },
  { regex: /(\d+\.?\d*)\s*mg\/d[lL]/i, unit: 'mg/dL', groupIndex: 1 },
  { regex: /(\d+\.?\d*)\s*mmol\b/i, unit: 'mmol/L', groupIndex: 1 },
  { regex: /(\d+\.?\d*)\s*mg\s*d[lL]\b/i, unit: 'mg/dL', groupIndex: 1 },
];

/**
 * Parse notification text to extract a glycemia reading.
 * Ignores insulin/bolus notifications and requires an explicit glucose unit.
 */
export function parseGlycemiaFromNotification(text: string): GlycemiaReading | null {
  const normalized = text?.trim() ?? '';
  if (!normalized || !hasExplicitGlucoseUnit(normalized)) return null;
  if (isLikelyInsulinNotification(normalized)) return null;

  const best = selectBestGlucoseMatch(normalized, findGlucoseMatches(normalized));
  if (!best) return null;

  return {
    value: best.value,
    unit: best.unit,
    timestamp: Date.now(),
  };
}

/**
 * Try each notification field on its own first so insulin titles are not merged with glucose body text.
 */
export function parseGlycemiaFromNotificationParts(parts: string[]): GlycemiaReading | null {
  for (const part of parts) {
    const trimmed = part?.trim() ?? '';
    if (!trimmed) continue;
    const reading = parseGlycemiaFromNotification(trimmed);
    if (reading) return reading;
  }

  const combined = parts.map((p) => p?.trim()).filter(Boolean).join(' ');
  if (!combined || isLikelyInsulinNotification(combined)) return null;
  return parseGlycemiaFromNotification(combined);
}

/**
 * Check if a package ID belongs to CapAPS Fx.
 */
export function isCapAPSFxPackage(packageId: string): boolean {
  if (!packageId || typeof packageId !== 'string') return false;
  const pkg = packageId.trim();
  if (pkg.startsWith('com.camdiab')) return true;
  return CAPAPS_FX_PACKAGE_IDS.some((id) =>
    pkg === id || pkg.startsWith(id + '.')
  );
}

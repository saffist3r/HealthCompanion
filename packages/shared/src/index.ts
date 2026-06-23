export * from './background';
export * from './sparkline';
export * from './sparklineChart';

export type GlycemiaUnit = 'mmol/L' | 'mg/dL';

export type GlycemiaStatusLabel = 'Low' | 'In range' | 'High' | 'Very high';

/**
 * Convert reading to mg/dL for range comparison.
 */
export function toMgDl(value: number, unit: GlycemiaUnit): number {
  return unit === 'mg/dL' ? value : value * 18.0182;
}

/**
 * Get status label for a glycemia reading.
 */
export function getGlycemiaStatusLabel(reading: GlycemiaReading): GlycemiaStatusLabel {
  const mgDl = toMgDl(reading.value, reading.unit);
  if (mgDl < 70) return 'Low';
  if (mgDl <= 180) return 'In range';
  if (mgDl <= 250) return 'High';
  return 'Very high';
}

/**
 * Get status color hex for a glycemia reading.
 */
export function getGlycemiaStatusColor(reading: GlycemiaReading): string {
  const mgDl = toMgDl(reading.value, reading.unit);
  if (mgDl < 70) return '#E57373';
  if (mgDl <= 180) return '#81C784';
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
 * Tries multiple patterns; returns the first valid match.
 */
export function parseGlycemiaFromNotification(text: string): GlycemiaReading | null {
  const normalized = text?.trim() ?? '';
  if (!normalized || !hasExplicitGlucoseUnit(normalized)) return null;

  for (const { regex, unit, groupIndex } of BG_PATTERNS) {
    const match = normalized.match(regex);
    if (!match) continue;

    const raw = match[groupIndex];
    const value = parseFloat(raw);
    if (Number.isNaN(value) || value < 0 || value > 600) continue;

    return {
      value,
      unit,
      timestamp: Date.now(),
    };
  }

  return null;
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

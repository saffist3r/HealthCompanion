/** CapAPS / CamAPS FX pump & alert notifications parsed from Android notification text. */

export type PumpEventKind =
  | 'insulin_delivered'
  | 'high'
  | 'low'
  | 'urgent_low'
  | 'reservoir'
  | 'battery'
  | 'occlusion'
  | 'sensor'
  | 'alert'
  | 'other';

export interface PumpLogEvent {
  kind: PumpEventKind;
  title: string;
  message: string;
  /** Insulin units when kind is insulin_delivered */
  units?: number;
  /** Insulin on board (U) when CapAPS includes it */
  iob?: number;
  /** Carbs on board (g) when CapAPS includes it */
  cob?: number;
  packageId?: string;
  timestamp: number;
  rawText: string;
  /** Android StatusBarNotification key when available (stable across updates). */
  notificationKey?: string;
}

/** Stable content fingerprint so lingering CapAPS notifications are not logged twice. */
export function pumpEventFingerprint(event: Pick<PumpLogEvent, 'kind' | 'units' | 'message' | 'notificationKey'>): string {
  if (event.notificationKey) {
    return `key:${event.notificationKey}`;
  }
  const units =
    event.units != null && Number.isFinite(event.units)
      ? String(Math.round(event.units * 1000) / 1000)
      : '';
  const msg = (event.message || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${event.kind}|${units}|${msg}`;
}

/**
 * True when two events are the same logical CapAPS alert (lingering / re-posted notification).
 * Insulin uses a longer window because sticky "delivered" notices are often refreshed.
 */
export function isSamePumpEvent(
  a: Pick<PumpLogEvent, 'kind' | 'units' | 'message' | 'timestamp' | 'notificationKey'>,
  b: Pick<PumpLogEvent, 'kind' | 'units' | 'message' | 'timestamp' | 'notificationKey'>,
  now = Date.now()
): boolean {
  if (a.notificationKey && b.notificationKey && a.notificationKey === b.notificationKey) {
    return true;
  }
  if (pumpEventFingerprint(a) !== pumpEventFingerprint(b)) return false;
  const windowMs = a.kind === 'insulin_delivered' ? 90 * 60 * 1000 : 15 * 60 * 1000;
  return Math.abs(a.timestamp - b.timestamp) <= windowMs;
}

export const PUMP_EVENT_KIND_LABELS: Record<PumpEventKind, string> = {
  insulin_delivered: 'Insulin delivered',
  high: 'High glucose',
  low: 'Low glucose',
  urgent_low: 'Urgent low',
  reservoir: 'Reservoir',
  battery: 'Battery',
  occlusion: 'Occlusion',
  sensor: 'Sensor',
  alert: 'Alert',
  other: 'Pump event',
};

/** Noise from Android Notification extras dumps (class names, packages, style keys). */
const ANDROID_NOISE =
  /\b(?:android\.app\.Notification(?:\$\w+)?|androidx\.core\.app\.NotificationCompat(?:\$\w+)?|com\.camdiab[\w.]*)\b/gi;

const JUNK_TITLES = /^(information|info|notification|camaps(?:\s*fx)?|alert|message)$/i;

const DELIVERED_PATTERNS: RegExp[] = [
  // "Delivered 1.7 U of insulin" / "Delivered 1,7 units of insulin"
  /delivered\s+(\d+[.,]?\d*)\s*(?:U|IU|units?|unités?)?\s*(?:of\s+)?insulin/i,
  /(\d+[.,]?\d*)\s*(?:U|IU|units?|unités?)?\s*(?:of\s+)?insulin\s+have\s+been\s+delivered/i,
  /(\d+[.,]?\d*)\s*(?:U|IU|units?|unités?)\s+(?:of\s+)?insulin\b/i,
  /insulin\s+(?:delivered|delivery)[:\s]+(\d+[.,]?\d*)\s*(?:U|IU|units?)?/i,
  /(\d+[.,]?\d*)\s*(?:U|IU)\s+(?:bolus|correction)?\s*(?:delivered|delivery)/i,
  /(?:bolus|correction)\s+(?:of\s+)?(\d+[.,]?\d*)\s*(?:U|IU|units?)/i,
  /(\d+[.,]?\d*)\s*(?:U|IU|units?|unités?)\s+(?:have\s+been\s+)?(?:delivered|inject(?:ed|é|ee)?)/i,
];

const KIND_RULES: Array<{ kind: PumpEventKind; pattern: RegExp }> = [
  { kind: 'urgent_low', pattern: /\b(urgent\s*low|très\s*basse|tres\s*basse|severe\s*hypo)\b/i },
  { kind: 'low', pattern: /\b(low\s*glucose|glucose\s*low|hypo(?:glycemia)?|glycémie\s*basse|glycemie\s*basse)\b/i },
  { kind: 'high', pattern: /\b(high\s*glucose|glucose\s*high|hyper(?:glycemia)?|glycémie\s*haute|glycemie\s*haute)\b/i },
  {
    kind: 'reservoir',
    pattern: /\b(reservoir|réservoir|reservoir\s*empty|réservoir\s*vide|empty\s*reservoir|low\s*reservoir|réservoir\s*bas)\b/i,
  },
  { kind: 'battery', pattern: /\b(battery|batterie|pump\s*battery|low\s*battery)\b/i },
  { kind: 'occlusion', pattern: /\b(occlusion|occluded|blocked|obstruction|canula|cannula)\b/i },
  { kind: 'sensor', pattern: /\b(sensor\s*(?:error|fail|expired|ended)|capteur|transmitter)\b/i },
  {
    kind: 'alert',
    pattern: /\b(alarm|alert|warning|erreur|error|attention)\b/i,
  },
];

function parseUnits(raw: string): number | undefined {
  const n = parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 80) return undefined;
  return Math.round(n * 1000) / 1000;
}

/** Strip Android framework junk and collapse whitespace. */
export function sanitizeNotificationText(text: string): string {
  return (text ?? '')
    .replace(ANDROID_NOISE, ' ')
    .replace(/[·|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupePhrases(text: string): string {
  const parts = text
    .split(/\s*[·|]\s*|\.\s+/)
    .map((p) => p.trim().replace(/\.+$/, ''))
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    if (JUNK_TITLES.test(p)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join('. ');
}

function extractInsulinDelivered(text: string): { units?: number } | null {
  for (const re of DELIVERED_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) {
      const units = parseUnits(m[1]);
      if (units != null) return { units };
      return {};
    }
  }
  if (/\binsulin/i.test(text) && /\b(delivered|delivery|inject)/i.test(text)) {
    const dose = text.match(/(\d+[.,]?\d*)\s*(?:U|IU|units?|unités?)\b/i);
    if (dose?.[1]) {
      const units = parseUnits(dose[1]);
      if (units != null) return { units };
    }
    return {};
  }
  return null;
}

/** Pull IOB / COB when CapAPS surfaces them in notification text. */
export function extractIobCob(text: string): { iob?: number; cob?: number } {
  const out: { iob?: number; cob?: number } = {};
  const iob =
    text.match(/\bIOB[:\s]+(\d+[.,]?\d*)\s*(?:U|IU|units?)?/i) ||
    text.match(/\b(\d+[.,]?\d*)\s*(?:U|IU)\s+IOB\b/i) ||
    text.match(/\binsulin\s+on\s+board[:\s]+(\d+[.,]?\d*)/i);
  const cob =
    text.match(/\bCOB[:\s]+(\d+[.,]?\d*)\s*(?:g|grams?)?/i) ||
    text.match(/\b(\d+[.,]?\d*)\s*g\s+COB\b/i) ||
    text.match(/\bcarbs?\s+on\s+board[:\s]+(\d+[.,]?\d*)/i);
  if (iob?.[1]) {
    const n = parseFloat(iob[1].replace(',', '.'));
    if (Number.isFinite(n) && n >= 0 && n < 100) out.iob = Math.round(n * 100) / 100;
  }
  if (cob?.[1]) {
    const n = parseFloat(cob[1].replace(',', '.'));
    if (Number.isFinite(n) && n >= 0 && n < 500) out.cob = Math.round(n * 10) / 10;
  }
  return out;
}

function detectKind(text: string): PumpEventKind | null {
  if (extractInsulinDelivered(text)) return 'insulin_delivered';
  for (const rule of KIND_RULES) {
    if (rule.pattern.test(text)) return rule.kind;
  }
  return null;
}

function formatUnits(units: number): string {
  return Number.isInteger(units) ? String(units) : String(units);
}

/** Human-readable one-liner for UI / storage. */
function summarizeEvent(kind: PumpEventKind, units: number | undefined, cleaned: string): string {
  if (kind === 'insulin_delivered' && units != null) {
    return `Delivered ${formatUnits(units)} U of insulin`;
  }
  if (kind === 'insulin_delivered') {
    return 'Insulin delivered';
  }

  // Prefer a short meaningful phrase from cleaned text
  const short = dedupePhrases(cleaned);
  if (short && short.length <= 120 && !JUNK_TITLES.test(short)) {
    return short.length > 100 ? `${short.slice(0, 97)}…` : short;
  }
  return PUMP_EVENT_KIND_LABELS[kind];
}

/**
 * Parse a CapAPS / CamAPS notification into a pump log event.
 * Returns null for routine glucose ticks that are not alerts or insulin.
 */
export function parsePumpLogFromNotification(
  text: string,
  opts?: { title?: string; packageId?: string; timestamp?: number }
): PumpLogEvent | null {
  const cleanedTitle = sanitizeNotificationText(opts?.title ?? '');
  const cleanedBody = sanitizeNotificationText(text ?? '');
  const combined = dedupePhrases([cleanedTitle, cleanedBody].filter(Boolean).join('. '));
  if (!combined) return null;

  const kind = detectKind(combined);
  const board = extractIobCob(combined);
  if (!kind && (board.iob != null || board.cob != null)) {
    const bits = [
      board.iob != null ? `IOB ${formatUnits(board.iob)} U` : null,
      board.cob != null ? `COB ${board.cob} g` : null,
    ].filter(Boolean);
    return {
      kind: 'other',
      title: 'IOB / COB',
      message: bits.join(' · '),
      iob: board.iob,
      cob: board.cob,
      packageId: opts?.packageId,
      timestamp: opts?.timestamp ?? Date.now(),
      rawText: combined,
    };
  }
  if (!kind) return null;

  const delivered = kind === 'insulin_delivered' ? extractInsulinDelivered(combined) : null;
  const units = delivered?.units;
  let message = summarizeEvent(kind, units, combined);
  if (board.iob != null || board.cob != null) {
    const bits = [
      board.iob != null ? `IOB ${formatUnits(board.iob)} U` : null,
      board.cob != null ? `COB ${board.cob} g` : null,
    ].filter(Boolean);
    message = `${message} · ${bits.join(' · ')}`;
  }

  return {
    kind,
    title: PUMP_EVENT_KIND_LABELS[kind],
    message,
    units,
    iob: board.iob,
    cob: board.cob,
    packageId: opts?.packageId,
    timestamp: opts?.timestamp ?? Date.now(),
    rawText: message,
  };
}

/**
 * Prefer useful human fields; ignore Android extras dumps when possible.
 */
export function parsePumpLogFromNotificationParts(
  parts: string[],
  opts?: { packageId?: string; timestamp?: number }
): PumpLogEvent | null {
  const cleaned = parts
    .map((p) => sanitizeNotificationText(p ?? ''))
    .filter(Boolean)
    .filter((p) => !ANDROID_NOISE.test(p) || /\binsulin|delivered|reservoir|battery|glucose|hypo|occlusion|sensor/i.test(p));

  // Reset lastIndex after /g tests above
  ANDROID_NOISE.lastIndex = 0;

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const p of cleaned) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    if (JUNK_TITLES.test(p)) continue;
    seen.add(key);
    unique.push(p);
  }

  if (unique.length === 0) {
    const fallback = sanitizeNotificationText(parts.join(' '));
    return parsePumpLogFromNotification(fallback, {
      packageId: opts?.packageId,
      timestamp: opts?.timestamp,
    });
  }

  // Try each useful chunk first (cleaner matches), then join
  for (const chunk of unique) {
    const ev = parsePumpLogFromNotification(chunk, {
      packageId: opts?.packageId,
      timestamp: opts?.timestamp,
    });
    if (ev) return ev;
  }

  return parsePumpLogFromNotification(unique.join('. '), {
    packageId: opts?.packageId,
    timestamp: opts?.timestamp,
  });
}

/**
 * One timeline of everything logged: meals, insulin and pump events, check-ins, stress,
 * caffeine, sport, care visits, pain and weight. Each source loads independently, so one
 * failing endpoint only drops its own entries.
 */
import type { MealEntry } from '@health-companion/shared';
import {
  absoluteUploadUrl,
  fetchCaffeineLogs,
  fetchCareVisits,
  fetchDayCheckIn,
  fetchGlycemiaEvents,
  fetchInjuries,
  fetchSportMatches,
  fetchStressLogs,
  fetchWeightHistory,
  listMeals,
} from '../api/client';
import { HUD, type IconName } from '../ui/hud';

export type LogKind = 'meal' | 'insulin' | 'mood' | 'activity' | 'pain' | 'body';

export type TimelineItem = {
  id: string;
  ts: number;
  kind: LogKind;
  icon: IconName;
  color: string;
  title: string;
  subtitle?: string | null;
  /** Meals open the meal sheet. */
  meal?: MealEntry & { resolvedPhotoUrl?: string | null };
};

export const LOG_FILTERS: { kind: LogKind | 'all'; label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'meal', label: 'Meals' },
  { kind: 'insulin', label: 'Insulin' },
  { kind: 'mood', label: 'Mood' },
  { kind: 'activity', label: 'Activity' },
  { kind: 'pain', label: 'Pain' },
  { kind: 'body', label: 'Body' },
];

const KIND_STYLE: Record<LogKind, { color: string }> = {
  meal: { color: HUD.amber },
  insulin: { color: HUD.cyan },
  mood: { color: HUD.violet },
  activity: { color: HUD.mint },
  pain: { color: HUD.red },
  body: { color: HUD.inkSoft },
};

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "2026-10-29" + "08:30" in local time; falls back to createdAt, then noon. */
function tsFrom(date: string, time?: string | null, createdAt?: number | null): number {
  if (time && /^\d{1,2}:\d{2}/.test(time)) {
    const t = new Date(`${date}T${time.length === 4 ? `0${time}` : time.slice(0, 5)}:00`).getTime();
    if (Number.isFinite(t)) return t;
  }
  if (createdAt) return createdAt;
  return new Date(`${date}T12:00:00`).getTime();
}

function cap(s?: string | null): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function settled<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

function mealItem(m: MealEntry, photo?: string | null): TimelineItem {
  const carbs = Math.round(m.macros?.carbsG ?? 0);
  const kcal = Math.round(m.macros?.caloriesKcal ?? 0);
  return {
    id: `meal-${m.id}`,
    ts: m.eatenAt || m.createdAt,
    kind: 'meal',
    icon: 'restaurant-outline',
    color: KIND_STYLE.meal.color,
    title: `${cap(m.mealType) || 'Meal'} · ${carbs} g carbs`,
    subtitle: [kcal ? `${kcal} kcal` : null, m.warnings?.length ? `${m.warnings.length} warning${m.warnings.length === 1 ? '' : 's'}` : null]
      .filter(Boolean)
      .join(' · ') || null,
    meal: { ...m, resolvedPhotoUrl: photo ?? null },
  };
}

/** Everything logged in roughly the last `days` days, newest first. */
export async function loadTimeline(days = 7): Promise<TimelineItem[]> {
  const since = Date.now() - days * 86_400_000;
  const checkInDates = Array.from({ length: Math.min(days, 7) }, (_, i) => localDateKey(new Date(Date.now() - i * 86_400_000)));

  const [meals, events, stress, caffeine, sport, care, weights, injuries, checkIns] = await Promise.all([
    settled(listMeals(), [] as MealEntry[]),
    settled(fetchGlycemiaEvents(Math.min(days * 24, 168)), []),
    settled(fetchStressLogs(), []),
    settled(fetchCaffeineLogs(), []),
    settled(fetchSportMatches(), []),
    settled(fetchCareVisits(), []),
    settled(fetchWeightHistory(30), []),
    settled(fetchInjuries('all'), []),
    Promise.all(checkInDates.map((d) => settled(fetchDayCheckIn(d), null))),
  ]);

  const items: TimelineItem[] = [];

  const photos = await Promise.all(meals.map((m) => settled(absoluteUploadUrl(m.photoUrl), null as string | null)));
  meals.forEach((m, i) => items.push(mealItem(m, photos[i])));

  for (const e of events) {
    if (e.type === 'meal') continue; // meals come from the meal log, with photos
    const insulin = e.type === 'insulin' || e.kind === 'insulin_delivered';
    items.push({
      id: `ev-${e.id}`,
      ts: e.timestamp,
      kind: 'insulin',
      icon: insulin ? 'water-outline' : 'hardware-chip-outline',
      color: insulin ? HUD.cyan : HUD.muted,
      title: insulin && e.units != null ? `Insulin · ${Math.round(e.units * 10) / 10} U` : e.label,
      // Pump details often just restate the dose ("Delivered 6.9 U of insulin")
      subtitle:
        e.detail && e.detail !== e.label && !(insulin && /delivered\s+[\d.,]+\s*u/i.test(e.detail)) ? e.detail : null,
    });
  }

  for (const c of checkIns) {
    if (!c) continue;
    items.push({
      id: `checkin-${c.id}`,
      ts: tsFrom(c.date, '10:00'),
      kind: 'mood',
      icon: 'happy-outline',
      color: KIND_STYLE.mood.color,
      title: `Check-in · ${c.moodLabel || cap(String(c.mood))}`,
      subtitle: c.wakeQualityLabel ? `Woke ${c.wakeQualityLabel.toLowerCase()}` : null,
    });
  }

  for (const s of stress) {
    items.push({
      id: `stress-${s.id}`,
      ts: tsFrom(s.date, s.time, s.createdAt),
      kind: 'mood',
      icon: 'pulse-outline',
      color: KIND_STYLE.mood.color,
      title: `Stress · ${s.levelLabel || cap(String(s.level))}${s.score != null ? ` (${s.score})` : ''}`,
      subtitle: s.sourceLabel || null,
    });
  }

  for (const c of caffeine) {
    items.push({
      id: `caffeine-${c.id}`,
      ts: tsFrom(c.date, c.time, c.createdAt),
      kind: 'mood',
      icon: 'cafe-outline',
      color: HUD.amber,
      title: `${c.drinkLabel || cap(String(c.drink))} · ${Math.round(c.caffeineMg)} mg`,
    });
  }

  for (const m of sport) {
    items.push({
      id: `sport-${m.id}`,
      ts: tsFrom(m.date, m.time, m.createdAt),
      kind: 'activity',
      icon: 'tennisball-outline',
      color: KIND_STYLE.activity.color,
      title: `${cap(m.sport)}${m.durationMin ? ` · ${m.durationMin} min` : ''}`,
      subtitle: [m.result ? cap(String(m.result)) : null, m.score || null].filter(Boolean).join(' · ') || null,
    });
  }

  for (const v of care) {
    items.push({
      id: `care-${v.id}`,
      ts: tsFrom(v.date, v.time, v.createdAt),
      kind: 'activity',
      icon: 'medkit-outline',
      color: HUD.violet,
      title: `${v.kindLabel || cap(String(v.kind))}${v.label ? ` · ${v.label}` : ''}`,
      subtitle: v.notes || null,
    });
  }

  for (const inj of injuries) {
    const p = inj.latestPain;
    if (!p) continue;
    items.push({
      id: `pain-${p.id}`,
      ts: tsFrom(p.date, null, p.createdAt),
      kind: 'pain',
      icon: 'bandage-outline',
      color: KIND_STYLE.pain.color,
      title: `${inj.title || inj.bodyAreaLabel || 'Pain'} · ${p.painScore}/10`,
      subtitle: p.relatedActivityLabel || null,
    });
  }

  for (const w of weights) {
    items.push({
      id: `weight-${w.date}`,
      ts: tsFrom(w.date, '08:00'),
      kind: 'body',
      icon: 'barbell-outline',
      color: KIND_STYLE.body.color,
      title: `Weight · ${Math.round(w.weightKg * 10) / 10} kg`,
      subtitle: w.notes || null,
    });
  }

  const sorted = items.filter((i) => Number.isFinite(i.ts) && i.ts >= since).sort((a, b) => b.ts - a.ts);
  return collapseRepeats(sorted);
}

/** Pumps repeat the same alert (e.g. "reservoir is empty") every few minutes: show it once, with a count. */
function collapseRepeats(items: TimelineItem[]): TimelineItem[] {
  const out: (TimelineItem & { repeat?: number })[] = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    const same =
      prev &&
      !it.meal &&
      prev.kind === it.kind &&
      prev.title === it.title &&
      prev.subtitle === it.subtitle &&
      dayLabel(prev.ts) === dayLabel(it.ts) &&
      prev.ts - it.ts < 3 * 3_600_000;
    if (same) {
      prev.repeat = (prev.repeat || 1) + 1;
    } else {
      out.push({ ...it });
    }
  }
  return out.map(({ repeat, ...it }) => (repeat ? { ...it, title: `${it.title} ×${repeat}` } : it));
}

export function dayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Group items (newest first) into day sections. */
export function groupByDay(items: TimelineItem[]): { day: string; items: TimelineItem[] }[] {
  const out: { day: string; items: TimelineItem[] }[] = [];
  for (const it of items) {
    const day = dayLabel(it.ts);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, items: [it] });
  }
  return out;
}

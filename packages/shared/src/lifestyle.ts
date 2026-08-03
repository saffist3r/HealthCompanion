/** Care visits, sport matches, stress, mental health, and caffeine. */

export type CareVisitKind = 'kine' | 'osteo' | 'podologue' | 'other';

export type SportKind =
  | 'padel'
  | 'gym'
  | 'running'
  | 'cycling'
  | 'swimming'
  | 'walking'
  | 'other';

export type SportIntensity = 'easy' | 'moderate' | 'hard' | 'max';

export type SportMatchResult = 'win' | 'loss' | 'draw' | 'completed';

export type StressLevel = 'calm' | 'ok' | 'high';

export type StressSource = 'manual' | 'samsung_energy';

export type MoodLevel = 'terrible' | 'low' | 'ok' | 'good' | 'great';

export type WakeQuality = 'rough' | 'groggy' | 'ok' | 'fresh' | 'energized';

export type FocusLevel = MoodLevel;

export type AdhdIntensity = 'low' | 'ok' | 'high';

export type TaskInitiation = 'stuck' | 'slow' | 'ok' | 'easy';

export type CaffeineDrink =
  | 'espresso'
  | 'double_espresso'
  | 'coffee'
  | 'iced_coffee'
  | 'green_tea'
  | 'black_tea';

export interface CareVisit {
  id: string;
  date: string;
  time?: string | null;
  kind: CareVisitKind;
  kindLabel?: string;
  label?: string | null;
  notes?: string | null;
  createdAt?: number | null;
}

export interface SportMatch {
  id: string;
  date: string;
  time?: string | null;
  sport: string;
  result: SportMatchResult;
  score: string;
  durationMin?: number | null;
  opponent?: string | null;
  intensity?: SportIntensity | string | null;
  notes?: string | null;
  createdAt?: number | null;
}

export interface StressLog {
  id: string;
  date: string;
  time?: string | null;
  level: StressLevel;
  levelLabel?: string;
  score?: number | null;
  source?: StressSource | string;
  sourceLabel?: string;
  notes?: string | null;
  createdAt?: number | null;
}

export interface DayCheckIn {
  id: string;
  date: string;
  mood: MoodLevel | string;
  moodLabel?: string;
  wakeQuality: WakeQuality | string;
  wakeQualityLabel?: string;
  focus?: FocusLevel | string;
  focusLabel?: string;
  restlessness?: AdhdIntensity | string;
  restlessnessLabel?: string;
  overwhelm?: AdhdIntensity | string;
  overwhelmLabel?: string;
  taskInitiation?: TaskInitiation | string;
  taskInitiationLabel?: string;
  impulsivity?: AdhdIntensity | string;
  impulsivityLabel?: string;
  medicationTaken?: boolean;
  hyperfocus?: boolean;
  sleepHours?: number | null;
  notes?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface CaffeineLog {
  id: string;
  date: string;
  time?: string | null;
  drink: CaffeineDrink | string;
  drinkLabel?: string;
  caffeineMg: number;
  notes?: string | null;
  createdAt?: number | null;
}

export const CARE_KIND_OPTIONS: Array<{ kind: CareVisitKind; label: string }> = [
  { kind: 'kine', label: 'Kiné' },
  { kind: 'osteo', label: 'Ostéo' },
  { kind: 'podologue', label: 'Podologue' },
  { kind: 'other', label: 'Other' },
];

export const SPORT_KIND_OPTIONS: Array<{ kind: SportKind; label: string }> = [
  { kind: 'padel', label: 'Padel' },
  { kind: 'gym', label: 'Gym' },
  { kind: 'running', label: 'Running' },
  { kind: 'cycling', label: 'Cycling' },
  { kind: 'swimming', label: 'Swimming' },
  { kind: 'walking', label: 'Walking' },
  { kind: 'other', label: 'Other' },
];

export const SPORT_INTENSITY_OPTIONS: Array<{ value: SportIntensity; label: string }> = [
  { value: 'easy', label: 'Easy' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'hard', label: 'Hard' },
  { value: 'max', label: 'Max' },
];

/** Sports that use win/loss/draw + score instead of completed + intensity. */
export const COMPETITIVE_SPORT_KINDS = new Set<string>(['padel']);

export function isCompetitiveSport(sport?: string | null): boolean {
  return COMPETITIVE_SPORT_KINDS.has((sport || '').toLowerCase());
}

export const STRESS_LEVEL_OPTIONS: Array<{ level: StressLevel; label: string }> = [
  { level: 'calm', label: 'Calm' },
  { level: 'ok', label: 'OK' },
  { level: 'high', label: 'High' },
];

export const MOOD_OPTIONS: Array<{ value: MoodLevel; label: string }> = [
  { value: 'terrible', label: 'Terrible' },
  { value: 'low', label: 'Low' },
  { value: 'ok', label: 'OK' },
  { value: 'good', label: 'Good' },
  { value: 'great', label: 'Great' },
];

export const WAKE_QUALITY_OPTIONS: Array<{ value: WakeQuality; label: string }> = [
  { value: 'rough', label: 'Rough' },
  { value: 'groggy', label: 'Groggy' },
  { value: 'ok', label: 'OK' },
  { value: 'fresh', label: 'Fresh' },
  { value: 'energized', label: 'Energized' },
];

export const FOCUS_OPTIONS = MOOD_OPTIONS;

export const ADHD_INTENSITY_OPTIONS: Array<{ value: AdhdIntensity; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'ok', label: 'OK' },
  { value: 'high', label: 'High' },
];

export const TASK_INITIATION_OPTIONS: Array<{ value: TaskInitiation; label: string }> = [
  { value: 'stuck', label: 'Stuck' },
  { value: 'slow', label: 'Slow' },
  { value: 'ok', label: 'OK' },
  { value: 'easy', label: 'Easy' },
];

/** Typical caffeine mg per drink (can be overridden when logging). */
export const CAFFEINE_MG_DEFAULTS: Record<CaffeineDrink, number> = {
  espresso: 63,
  double_espresso: 125,
  coffee: 95,
  iced_coffee: 150,
  green_tea: 28,
  black_tea: 47,
};

export const CAFFEINE_DRINK_OPTIONS: Array<{
  value: CaffeineDrink;
  label: string;
  mg: number;
}> = [
  { value: 'espresso', label: 'Espresso', mg: 63 },
  { value: 'double_espresso', label: 'Double espresso', mg: 125 },
  { value: 'coffee', label: 'Coffee', mg: 95 },
  { value: 'iced_coffee', label: 'Iced coffee', mg: 150 },
  { value: 'green_tea', label: 'Green tea', mg: 28 },
  { value: 'black_tea', label: 'Black tea', mg: 47 },
];

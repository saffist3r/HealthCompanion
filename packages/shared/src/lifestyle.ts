/** Care visits, sport matches, and stress check-ins. */

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

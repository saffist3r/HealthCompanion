import type { Macros } from './nutrition';

/** Minimal reading shape to avoid circular imports with index.ts */
export interface GlucosePoint {
  value: number;
  unit: 'mg/dL' | 'mmol/L';
  timestamp: number;
}

export interface DayMacrosSummary {
  date: string; // YYYY-MM-DD
  macros: Macros;
  mealCount: number;
}

export interface GlucoseReadingPoint {
  timestamp: number;
  mgDl: number;
}

export interface GlucoseDaySummary {
  date: string;
  readingCount: number;
  avgMgDl: number | null;
  minMgDl: number | null;
  maxMgDl: number | null;
  timeInRangePct: number | null; // personal TIR band (default 70–180 mg/dL)
  lowCount: number;
  highCount: number;
  hypoEventCount?: number;
  hypoEvents?: HypoEvent[];
  hyperEventCount?: number;
  hyperEvents?: HypoEvent[];
  /** Full-day CGM samples for charts / RAG archive (may be downsampled). */
  readings?: GlucoseReadingPoint[];
}

export interface HypoEvent {
  startedAt: number;
  endedAt: number;
  minMgDl: number;
  readingCount: number;
  durationMin: number;
  date?: string;
}

export interface ActivityDaySummary {
  date: string;
  steps: number;
  activeMinutes?: number;
  caloriesBurned?: number;
  workouts?: Array<{ name: string; durationMin: number; calories?: number }>;
}

export interface CareVisitSummary {
  id: string;
  date: string;
  time?: string | null;
  kind: string;
  kindLabel?: string;
  label?: string | null;
  notes?: string | null;
}

export interface SportMatchSummary {
  id: string;
  date: string;
  time?: string | null;
  sport: string;
  result: string;
  score: string;
  durationMin?: number | null;
  opponent?: string | null;
  intensity?: string | null;
  notes?: string | null;
}

export interface InjuryPainSummary {
  id: string;
  injuryId: string;
  date: string;
  painScore: number;
  relatedActivityKind?: string | null;
  relatedActivityLabel?: string | null;
  notes?: string | null;
}

export interface InjurySummary {
  id: string;
  title: string;
  injuryType: string;
  injuryTypeLabel?: string;
  bodyArea: string;
  bodyAreaLabel?: string;
  startedOn: string;
  status: string;
  healedOn?: string | null;
  relatedActivityKinds?: string[];
  relatedActivityLabels?: string[];
  exerciseNotes?: string | null;
  notes?: string | null;
  todayPain?: InjuryPainSummary | null;
  latestPain?: InjuryPainSummary | null;
}

export interface DailyReport {
  date: string;
  generatedAt: number;
  nutrition: DayMacrosSummary;
  glucose: GlucoseDaySummary;
  activity: ActivityDaySummary | null;
  careVisits?: CareVisitSummary[];
  sportMatches?: SportMatchSummary[];
  injuries?: InjurySummary[];
  stressLogs?: Array<{
    id: string;
    date: string;
    level: string;
    levelLabel?: string;
    score?: number | null;
    notes?: string | null;
  }>;
  dayCheckIn?: {
    id: string;
    date: string;
    mood: string;
    moodLabel?: string;
    wakeQuality: string;
    wakeQualityLabel?: string;
    focus?: string;
    focusLabel?: string;
    restlessness?: string;
    restlessnessLabel?: string;
    overwhelm?: string;
    overwhelmLabel?: string;
    taskInitiation?: string;
    taskInitiationLabel?: string;
    impulsivity?: string;
    impulsivityLabel?: string;
    medicationTaken?: boolean;
    hyperfocus?: boolean;
    sleepHours?: number | null;
    notes?: string | null;
  } | null;
  caffeineLogs?: Array<{
    id: string;
    date: string;
    time?: string | null;
    drink: string;
    drinkLabel?: string;
    caffeineMg: number;
    notes?: string | null;
  }>;
  pumpEvents?: Array<{
    id: string;
    kind: string;
    kindLabel?: string;
    title: string;
    message: string;
    units?: number | null;
    timestamp: number;
    time?: string | null;
  }>;
  /** Copy-paste briefing for an external AI agent covering the full day. */
  agentPrompt?: string;
  insights: string[];
  warnings: Array<{ title: string; message: string; severity: 'info' | 'caution' | 'alert' }>;
}

export interface WeeklyReport {
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string;
  generatedAt: number;
  days: DailyReport[];
  totals: {
    macros: Macros;
    mealCount: number;
    avgGlucoseMgDl: number | null;
    avgTimeInRangePct: number | null;
    totalSteps: number;
    careVisitCount?: number;
    sportMatchCount?: number;
    padelWins?: number;
    padelLosses?: number;
    stressLogCount?: number;
    stressHighCount?: number;
    dayCheckInCount?: number;
    moodLowCount?: number;
    wakeRoughCount?: number;
    focusLowCount?: number;
    overwhelmHighCount?: number;
    caffeineDrinkCount?: number;
    caffeineMgTotal?: number;
  };
  careVisits?: CareVisitSummary[];
  sportMatches?: SportMatchSummary[];
  stressLogs?: DailyReport['stressLogs'];
  dayCheckIns?: NonNullable<DailyReport['dayCheckIn']>[];
  caffeineLogs?: DailyReport['caffeineLogs'];
  insights: string[];
}

/** AI-generated honest review of the last N days of tracked life data. */
export interface LifeAssessment {
  periodStart: string;
  periodEnd: string;
  dayCount: number;
  headline: string;
  honestSummary: string;
  wins: string[];
  concerns: string[];
  patterns: string[];
  priorities: string[];
  glucoseVerdict?: string;
  lifestyleVerdict?: string;
  moodVerdict?: string;
  source: 'gemini' | 'fallback';
  locale?: string;
  note?: string;
  totals?: WeeklyReport['totals'];
  generatedAt?: number;
}

export type UnderstandingSeverity = 'high' | 'medium' | 'low';
export type UnderstandingCategory =
  | 'estimation'
  | 'timing'
  | 'stress'
  | 'logging'
  | 'glucose'
  | 'lifestyle';

export interface UnderstandingFinding {
  id: string;
  severity: UnderstandingSeverity;
  category: UnderstandingCategory;
  title: string;
  detail: string;
  evidence: string[];
  exampleIds?: string[];
}

export type MedicalCheckStatus = 'established' | 'plausible' | 'weak' | 'not_supported';

export interface UnderstandingScienceSource {
  title: string;
  url: string;
  publisher?: string;
}

export interface UnderstandingMedicalCheck {
  patternId: string;
  claim?: string;
  category?: string;
  observed?: Record<string, unknown>;
  status: MedicalCheckStatus;
  confidence: 'high' | 'medium' | 'low';
  title: string;
  explanation: string;
  /** Short scientific physiology paragraph (Gemini + curated library). */
  scienceBrief?: string;
  sources?: UnderstandingScienceSource[];
  caveat?: string;
}

export interface UnderstandingAnalysis {
  headline: string;
  executiveSummary: string;
  findings: UnderstandingFinding[];
  medicalChecks?: UnderstandingMedicalCheck[];
  correlations: string[];
  whatToWatch: string[];
  dataGaps: string[];
  source: 'gemini' | 'fallback';
  locale?: string;
  note?: string;
}

/** Forensic pattern report: signals + Gemini (or fallback) synthesis. */
export interface UnderstandingReport {
  periodStart: string;
  periodEnd: string;
  dayCount: number;
  totals?: Record<string, unknown>;
  signals: Record<string, unknown>;
  analysis: UnderstandingAnalysis;
  generatedAt?: number;
}

export function toDateKey(ts: number, timeZone = 'local'): string {
  const d = new Date(ts);
  if (timeZone === 'utc') return d.toISOString().slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function summarizeGlucoseDay(
  date: string,
  readings: GlucosePoint[],
  toMgDl: (value: number, unit: 'mg/dL' | 'mmol/L') => number,
  range?: { low?: number; high?: number }
): GlucoseDaySummary {
  const low = range?.low ?? 70;
  const high = range?.high ?? 180;
  if (readings.length === 0) {
    return {
      date,
      readingCount: 0,
      avgMgDl: null,
      minMgDl: null,
      maxMgDl: null,
      timeInRangePct: null,
      lowCount: 0,
      highCount: 0,
    };
  }
  const mg = readings.map((r) => toMgDl(r.value, r.unit));
  const sum = mg.reduce((a, b) => a + b, 0);
  const inRange = mg.filter((v) => v >= low && v <= high).length;
  return {
    date,
    readingCount: mg.length,
    avgMgDl: Math.round((sum / mg.length) * 10) / 10,
    minMgDl: Math.round(Math.min(...mg) * 10) / 10,
    maxMgDl: Math.round(Math.max(...mg) * 10) / 10,
    timeInRangePct: Math.round((inRange / mg.length) * 1000) / 10,
    lowCount: mg.filter((v) => v < low).length,
    highCount: mg.filter((v) => v > high).length,
  };
}

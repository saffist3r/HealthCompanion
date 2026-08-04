import type {
  DailyReport,
  MealAnalysisResult,
  MealEntry,
  MealType,
  Macros,
  FoodItem,
  DiabetesWarning,
  WeeklyReport,
  GlycemiaReading,
} from '@health-companion/shared';
import { getApiBaseUrl } from './config';
import { getDeviceId } from './deviceId';
import { clearAuthSession, getAccessToken } from './auth';

export class ApiAuthError extends Error {
  constructor(message = 'Please sign in to continue') {
    super(message);
    this.name = 'ApiAuthError';
  }
}

async function headers(json = true): Promise<Record<string, string>> {
  const deviceId = await getDeviceId();
  const token = await getAccessToken();
  if (!token) {
    throw new ApiAuthError();
  }
  const h: Record<string, string> = {
    'X-Device-Id': deviceId,
    Authorization: `Bearer ${token}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function base(): Promise<string> {
  return getApiBaseUrl();
}

async function readError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({} as any));
  if (res.status === 401) {
    await clearAuthSession();
    return 'Session expired. Please sign in again.';
  }
  return (
    (typeof data?.error === 'string' && data.error) ||
    (typeof data?.detail === 'string' && data.detail) ||
    `Request failed (${res.status})`
  );
}

async function ensureOk(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      await clearAuthSession();
      throw new ApiAuthError('Session expired. Please sign in again.');
    }
    const msg =
      (typeof data?.error === 'string' && data.error) ||
      (typeof data?.detail === 'string' && data.detail) ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export async function apiHealth(): Promise<{
  ok: boolean;
  geminiConfigured?: boolean;
  openaiConfigured?: boolean;
  aiProvider?: string;
  auth?: string;
}> {
  const res = await fetch(`${await base()}/health`);
  if (!res.ok) throw new Error(`API health ${res.status}`);
  return res.json();
}

export async function analyzeMealPhoto(params: {
  uri: string;
  notes?: string;
  glucoseMgDl?: number | null;
}): Promise<{ analysis: MealAnalysisResult; photoPath: string; photoUrl: string }> {
  const form = new FormData();
  form.append('photo', {
    uri: params.uri,
    name: 'meal.jpg',
    type: 'image/jpeg',
  } as unknown as Blob);
  if (params.notes) form.append('notes', params.notes);
  if (params.glucoseMgDl != null) form.append('glucoseMgDl', String(params.glucoseMgDl));
  form.append('hourLocal', String(new Date().getHours()));

  const res = await fetch(`${await base()}/meals/analyze`, {
    method: 'POST',
    headers: await headers(false),
    body: form,
  });
  return ensureOk(res);
}

export async function saveMeal(input: {
  eatenAt?: number;
  mealType: MealType;
  items: FoodItem[];
  macros: Macros;
  photoPath?: string;
  notes?: string;
  aiSummary?: string;
  carbEstimateNote?: string;
  warnings?: DiabetesWarning[];
  suggestions?: string[];
  glucoseMgDl?: number | null;
  source?: string;
}): Promise<MealEntry> {
  const res = await fetch(`${await base()}/meals`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(input),
  });
  return ensureOk(res);
}

export async function listMeals(date?: string): Promise<MealEntry[]> {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(`${await base()}/meals${q}`, { headers: await headers() });
  const data = await ensureOk(res);
  return data.meals;
}

export async function deleteMeal(mealId: string): Promise<void> {
  const res = await fetch(`${await base()}/meals/${mealId}`, {
    method: 'DELETE',
    headers: await headers(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export type MealGlucoseStory = {
  ready?: boolean;
  blurb?: string;
  reason?: string;
  baselineMgDl?: number;
  peakMgDl?: number;
  deltaMgDl?: number;
  timeToPeakMin?: number;
  returnToRangeMin?: number | null;
  stillAboveRange?: boolean;
};

export type SimilarMeal = {
  id: string;
  eatenAt: number;
  date?: string;
  mealType?: string;
  carbsG?: number;
  score?: number;
  wouldAgain?: number | null;
  aiSummary?: string | null;
  glucoseStory?: MealGlucoseStory | null;
};

export type MealDetail = MealEntry & {
  wouldAgain?: number | null;
  wouldAgainNote?: string | null;
  relatedHypoStartedAt?: number | null;
  glucoseStory?: MealGlucoseStory | null;
  similarMeals?: SimilarMeal[];
};

export async function fetchMeal(mealId: string): Promise<MealDetail> {
  const res = await fetch(`${await base()}/meals/${mealId}`, { headers: await headers() });
  const data = await ensureOk(res);
  return data.meal as MealDetail;
}

export async function updateMeal(
  mealId: string,
  payload: {
    mealType?: string;
    notes?: string | null;
    aiSummary?: string | null;
    carbEstimateNote?: string | null;
    eatenAt?: string;
    wouldAgain?: number | null;
    wouldAgainNote?: string | null;
    macros?: {
      carbsG: number;
      proteinG: number;
      fatG: number;
      fiberG?: number;
      caloriesKcal?: number;
      sugarG?: number;
    };
  }
): Promise<MealEntry> {
  const res = await fetch(`${await base()}/meals/${mealId}`, {
    method: 'PATCH',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  return ensureOk(res);
}

export type DeviceCarePayload = {
  cannulaChangedAt?: number | null;
  sensorStartedAt?: number | null;
  cannulaDay?: number | null;
  sensorDay?: number | null;
  siteChangeSuggested?: boolean;
  sensorAging?: boolean;
};

export type BodyProfileResponse = {
  profile: {
    heightCm: number;
    sex: string;
    ageYears: number;
    activity: string;
    deficitKcal: number;
    locale?: 'en' | 'fr';
    tirLowMgDl?: number;
    tirHighMgDl?: number;
    tirGoalPct?: number;
    dailyCarbTargetG?: number;
    updatedAt?: number | null;
  } & DeviceCarePayload;
  latestWeight: { date: string; weightKg: number; notes?: string } | null;
  targets: {
    bmrKcal: number;
    maintenanceKcal: number;
    targetKcal: number;
    deficitKcal: number;
    bmi: number;
    weightKg: number;
    heightCm: number;
    formula: string;
    activityFactor?: number;
  } | null;
};

export async function fetchBodyProfile(): Promise<BodyProfileResponse> {
  const res = await fetch(`${await base()}/health-data/body-profile`, { headers: await headers() });
  return ensureOk(res);
}

export async function markDeviceCare(payload: {
  markCannulaChanged?: boolean;
  markSensorStarted?: boolean;
  cannulaChangedAt?: number;
  sensorStartedAt?: number;
}): Promise<{ ok: boolean; profile: BodyProfileResponse['profile'] }> {
  const res = await fetch(`${await base()}/health-data/body-profile/device-care`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  return ensureOk(res);
}

export async function syncGlucose(readings: GlycemiaReading[]): Promise<number> {
  const token = await getAccessToken();
  if (!token) return 0; // background sync stays quiet until signed in
  const res = await fetch(`${await base()}/glucose/sync`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ readings }),
  });
  const data = await ensureOk(res);
  return data.inserted ?? 0;
}

export async function fetchGlucoseHistory(hours = 12): Promise<GlycemiaReading[]> {
  const token = await getAccessToken();
  if (!token) return [];
  const res = await fetch(`${await base()}/glucose/history?hours=${hours}`, {
    headers: await headers(),
  });
  const data = await ensureOk(res);
  const readings = (data.readings || []) as Array<{
    value: number;
    unit: string;
    timestamp: number;
  }>;
  return readings.map((r) => ({
    value: r.value,
    unit: (r.unit === 'mmol/L' ? 'mmol/L' : 'mg/dL') as GlycemiaReading['unit'],
    timestamp: r.timestamp,
  }));
}

export type GlycemiaChartEvent = {
  id: string;
  type: 'meal' | 'insulin' | 'pump';
  timestamp: number;
  label: string;
  detail?: string | null;
  carbsG?: number | null;
  units?: number | null;
  kind?: string | null;
};

export async function fetchGlycemiaEvents(hours = 12): Promise<GlycemiaChartEvent[]> {
  const token = await getAccessToken();
  if (!token) return [];
  const res = await fetch(`${await base()}/glucose/events?hours=${hours}`, {
    headers: await headers(),
  });
  const data = await ensureOk(res);
  return (data.events || []) as GlycemiaChartEvent[];
}

export async function syncPumpEvents(events: import('@health-companion/shared').PumpLogEvent[]): Promise<number> {
  const token = await getAccessToken();
  if (!token) return 0;
  const res = await fetch(`${await base()}/pump/sync`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({
      events: events.map((e) => ({
        kind: e.kind,
        title: e.title,
        message: e.message,
        units: e.units ?? null,
        packageId: e.packageId ?? null,
        timestamp: e.timestamp,
        rawText: e.rawText,
      })),
    }),
  });
  const data = await ensureOk(res);
  return data.inserted ?? 0;
}

export async function fetchDailyReport(date?: string): Promise<DailyReport> {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(`${await base()}/reports/daily${q}`, { headers: await headers() });
  return ensureOk(res);
}

export type DailyVoiceBriefing = {
  date: string;
  transcript: string;
  mimeType: string;
  audioBase64: string;
  source: string;
};

/** Tunisian Darija Gemini voice briefing for Saff. */
export async function fetchDailyVoiceBriefing(date?: string): Promise<DailyVoiceBriefing> {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(`${await base()}/reports/daily/voice${q}`, {
    method: 'POST',
    headers: await headers(),
  });
  return ensureOk(res);
}

export type DailyVoiceVideo = {
  date: string;
  transcript: string;
  background: string;
  mimeType: string;
  videoBase64: string;
  audioMimeType?: string;
  audioBase64?: string;
  source: string;
};

/** Reb3i stock-still talking clip + Darija TTS (Ken Burns; usually under ~1 min). */
export async function fetchDailyVoiceVideo(date?: string): Promise<DailyVoiceVideo> {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(`${await base()}/reports/daily/voice-video${q}`, {
    method: 'POST',
    headers: await headers(),
  });
  return ensureOk(res);
}

export async function fetchDashboard(): Promise<any> {
  const res = await fetch(`${await base()}/reports/dashboard`, { headers: await headers() });
  return ensureOk(res);
}

export async function fetchWeeklyReport(date?: string): Promise<WeeklyReport> {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(`${await base()}/reports/weekly${q}`, { headers: await headers() });
  return ensureOk(res);
}

export async function syncActivity(payload: {
  date: string;
  steps: number;
  activeMinutes?: number;
  caloriesBurned?: number;
  workouts?: unknown[];
  source?: string;
  energyScore?: number;
}): Promise<void> {
  const res = await fetch(`${await base()}/health-data/activity`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  await ensureOk(res);
}

export async function fetchCareVisits(date?: string) {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(`${await base()}/health-data/care-visits${q}`, {
    headers: await headers(),
  });
  const data = await ensureOk(res);
  return (data.careVisits || []) as import('@health-companion/shared').CareVisit[];
}

export async function createCareVisit(payload: {
  date: string;
  time?: string;
  kind: import('@health-companion/shared').CareVisitKind;
  label?: string;
  notes?: string;
}) {
  const res = await fetch(`${await base()}/health-data/care-visits`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  const data = await ensureOk(res);
  return data.careVisit as import('@health-companion/shared').CareVisit;
}

export async function deleteCareVisit(id: string) {
  const res = await fetch(`${await base()}/health-data/care-visits/${id}`, {
    method: 'DELETE',
    headers: await headers(),
  });
  await ensureOk(res);
}

export async function fetchSportMatches(date?: string) {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(`${await base()}/health-data/sport-matches${q}`, {
    headers: await headers(),
  });
  const data = await ensureOk(res);
  return (data.sportMatches || []) as import('@health-companion/shared').SportMatch[];
}

export async function createSportMatch(payload: {
  date: string;
  time?: string;
  sport?: string;
  result: import('@health-companion/shared').SportMatchResult;
  score?: string;
  durationMin?: number;
  opponent?: string;
  intensity?: import('@health-companion/shared').SportIntensity;
  notes?: string;
}) {
  const res = await fetch(`${await base()}/health-data/sport-matches`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  const data = await ensureOk(res);
  return data.sportMatch as import('@health-companion/shared').SportMatch;
}

export async function deleteSportMatch(id: string) {
  const res = await fetch(`${await base()}/health-data/sport-matches/${id}`, {
    method: 'DELETE',
    headers: await headers(),
  });
  await ensureOk(res);
}

export async function logWeight(payload: {
  date: string;
  weightKg: number;
  notes?: string;
}): Promise<{ weight: { date: string; weightKg: number; notes?: string } }> {
  const res = await fetch(`${await base()}/health-data/weight`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  return ensureOk(res);
}

export async function fetchWeightHistory(limit = 60) {
  const res = await fetch(
    `${await base()}/health-data/weight?limit=${encodeURIComponent(String(limit))}`,
    { headers: await headers() }
  );
  const data = await ensureOk(res);
  return (data.weights || []) as Array<{ date: string; weightKg: number; notes?: string }>;
}

export async function fetchInjuries(status: 'active' | 'open' | 'healed' | 'all' = 'open') {
  const res = await fetch(
    `${await base()}/health-data/injuries?status=${encodeURIComponent(status)}`,
    { headers: await headers() }
  );
  const data = await ensureOk(res);
  return (data.injuries || []) as import('@health-companion/shared').Injury[];
}

export async function createInjury(payload: {
  title?: string;
  injuryType: string;
  bodyArea: string;
  bodyAreaOther?: string;
  startedOn: string;
  status?: string;
  relatedActivityKinds?: string[];
  exerciseNotes?: string;
  notes?: string;
}) {
  const res = await fetch(`${await base()}/health-data/injuries`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  const data = await ensureOk(res);
  return data.injury as import('@health-companion/shared').Injury;
}

export async function updateInjury(
  id: string,
  payload: {
    title?: string;
    injuryType?: string;
    bodyArea?: string;
    bodyAreaOther?: string | null;
    startedOn?: string;
    status?: string;
    healedOn?: string | null;
    relatedActivityKinds?: string[];
    exerciseNotes?: string | null;
    notes?: string | null;
  }
) {
  const res = await fetch(`${await base()}/health-data/injuries/${id}`, {
    method: 'PATCH',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  const data = await ensureOk(res);
  return data.injury as import('@health-companion/shared').Injury;
}

export async function deleteInjury(id: string) {
  const res = await fetch(`${await base()}/health-data/injuries/${id}`, {
    method: 'DELETE',
    headers: await headers(),
  });
  await ensureOk(res);
}

export async function logInjuryPain(
  injuryId: string,
  payload: {
    date: string;
    painScore: number;
    relatedActivityKind?: string;
    notes?: string;
  }
) {
  const res = await fetch(`${await base()}/health-data/injuries/${injuryId}/pain`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  return ensureOk(res);
}

export async function fetchStressLogs(date?: string) {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(`${await base()}/health-data/stress-logs${q}`, {
    headers: await headers(),
  });
  const data = await ensureOk(res);
  return (data.stressLogs || []) as import('@health-companion/shared').StressLog[];
}

export async function createStressLog(payload: {
  date: string;
  time?: string;
  level: import('@health-companion/shared').StressLevel;
  score?: number;
  notes?: string;
}) {
  const res = await fetch(`${await base()}/health-data/stress-logs`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  const data = await ensureOk(res);
  return data.stressLog as import('@health-companion/shared').StressLog;
}

export async function deleteStressLog(id: string) {
  const res = await fetch(`${await base()}/health-data/stress-logs/${id}`, {
    method: 'DELETE',
    headers: await headers(),
  });
  await ensureOk(res);
}

export async function fetchDayCheckIn(date: string) {
  const res = await fetch(
    `${await base()}/health-data/day-checkins?date=${encodeURIComponent(date)}`,
    { headers: await headers() }
  );
  const data = await ensureOk(res);
  return (data.dayCheckIn || null) as import('@health-companion/shared').DayCheckIn | null;
}

export async function upsertDayCheckIn(payload: {
  date: string;
  mood: import('@health-companion/shared').MoodLevel;
  wakeQuality: import('@health-companion/shared').WakeQuality;
  focus?: import('@health-companion/shared').FocusLevel;
  restlessness?: import('@health-companion/shared').AdhdIntensity;
  overwhelm?: import('@health-companion/shared').AdhdIntensity;
  taskInitiation?: import('@health-companion/shared').TaskInitiation;
  impulsivity?: import('@health-companion/shared').AdhdIntensity;
  medicationTaken?: boolean;
  hyperfocus?: boolean;
  sleepHours?: number;
  notes?: string;
}) {
  const res = await fetch(`${await base()}/health-data/day-checkins`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  const data = await ensureOk(res);
  return data.dayCheckIn as import('@health-companion/shared').DayCheckIn;
}

export async function deleteDayCheckIn(id: string) {
  const res = await fetch(`${await base()}/health-data/day-checkins/${id}`, {
    method: 'DELETE',
    headers: await headers(),
  });
  await ensureOk(res);
}

export async function fetchCaffeineLogs(date?: string) {
  const q = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(`${await base()}/health-data/caffeine-logs${q}`, {
    headers: await headers(),
  });
  const data = await ensureOk(res);
  return (data.caffeineLogs || []) as import('@health-companion/shared').CaffeineLog[];
}

export async function createCaffeineLog(payload: {
  date: string;
  time?: string;
  drink: import('@health-companion/shared').CaffeineDrink;
  caffeineMg?: number;
  notes?: string;
}) {
  const res = await fetch(`${await base()}/health-data/caffeine-logs`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(payload),
  });
  const data = await ensureOk(res);
  return data.caffeineLog as import('@health-companion/shared').CaffeineLog;
}

export async function deleteCaffeineLog(id: string) {
  const res = await fetch(`${await base()}/health-data/caffeine-logs/${id}`, {
    method: 'DELETE',
    headers: await headers(),
  });
  await ensureOk(res);
}

export async function absoluteUploadUrl(photoUrl?: string): Promise<string | undefined> {
  if (!photoUrl) return undefined;
  if (photoUrl.startsWith('http')) return photoUrl;
  return `${await base()}${photoUrl}`;
}

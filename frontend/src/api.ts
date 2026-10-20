import axios from 'axios';

const DEVICE_KEY = 'hc_device_id';
const API_KEY = 'hc_api_url';
const TOKEN_KEY = 'hc_access_token';
const USER_KEY = 'hc_user';

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  active?: boolean;
  createdAt?: number | null;
};

export function getApiBase(): string {
  return (
    localStorage.getItem(API_KEY) ||
    import.meta.env.VITE_API_URL ||
    'http://localhost:8000'
  );
}

/** Origin + `/api`: every backend route lives under this prefix. */
export function getApiRoot(): string {
  return `${getApiBase().replace(/\/$/, '')}/api`;
}

export function setApiBase(url: string) {
  localStorage.setItem(API_KEY, url.replace(/\/$/, ''));
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function setDeviceId(id: string) {
  localStorage.setItem(DEVICE_KEY, id.trim());
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLoggedIn(): boolean {
  return Boolean(getToken());
}

export const api = axios.create();

api.interceptors.request.use((config) => {
  config.baseURL = getApiRoot();
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Device id still used for phone-originated writes; web reads use JWT only
  config.headers['X-Device-Id'] = getDeviceId();
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && !String(err?.config?.url || '').includes('/auth/login')) {
      clearSession();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export async function login(email: string, password: string) {
  const { data } = await api.post('/auth/login', { email, password });
  setSession(data.accessToken, data.user);
  return data.user as AuthUser;
}

export async function fetchMe() {
  const { data } = await api.get('/auth/me');
  const user: AuthUser = {
    id: data.id,
    email: data.email,
    displayName: data.displayName,
    role: data.role,
  };
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export async function listUsers() {
  const { data } = await api.get('/users');
  return data.users as AuthUser[];
}

export async function createUser(input: {
  email: string;
  password: string;
  displayName?: string;
  role?: string;
}) {
  const { data } = await api.post('/users', input);
  return data.user as AuthUser;
}

export async function deleteUser(userId: string) {
  await api.delete(`/users/${userId}`);
}

export async function updateUser(
  userId: string,
  patch: { displayName?: string; role?: string; active?: boolean; password?: string }
) {
  const { data } = await api.patch(`/users/${userId}`, patch);
  return data.user as AuthUser;
}

export async function fetchDashboard() {
  const { data } = await api.get('/reports/dashboard');
  return data;
}

export async function fetchGlucoseHistory(hours = 12) {
  const { data } = await api.get('/glucose/history', { params: { hours } });
  return data as {
    readings: Array<{ value: number; unit: string; timestamp: number; valueMgDl: number }>;
    from: number | null;
    to: number | null;
    hours: number;
    count: number;
  };
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

export async function fetchGlycemiaEvents(hours = 12) {
  const { data } = await api.get('/glucose/events', { params: { hours } });
  return data as {
    events: GlycemiaChartEvent[];
    from: number | null;
    to: number | null;
    hours: number;
    count: number;
  };
}

export async function fetchMeals() {
  const { data } = await api.get('/meals');
  return data.meals as any[];
}

export async function fetchMeal(mealId: string) {
  const { data } = await api.get(`/meals/${mealId}`);
  return data.meal as any;
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
) {
  const { data } = await api.patch(`/meals/${mealId}`, payload);
  return data;
}

export async function deleteMeal(mealId: string) {
  await api.delete(`/meals/${mealId}`);
}

export async function fetchDaily(date?: string) {
  const { data } = await api.get('/reports/daily', { params: date ? { date } : {} });
  return data;
}

export type DailyVoiceBriefing = {
  date: string;
  transcript: string;
  mimeType: string;
  audioBase64: string;
  source: string;
};

/** Tunisian Darija Gemini voice briefing (Reb3i → Saff; script + TTS WAV). */
export async function fetchDailyVoiceBriefing(date?: string): Promise<DailyVoiceBriefing> {
  const { data } = await api.post(
    '/reports/daily/voice',
    null,
    { params: date ? { date } : {}, timeout: 300_000 }
  );
  return data as DailyVoiceBriefing;
}

export type DailyVoiceVideo = {
  date: string;
  transcript: string;
  background: 'beach' | 'padel' | 'cafe' | string;
  mimeType: string;
  videoBase64: string;
  audioMimeType?: string;
  audioBase64?: string;
  source: string;
};

/** Reb3i stock-still talking clip + Darija TTS (Ken Burns; can take a few minutes). */
export async function fetchDailyVoiceVideo(date?: string): Promise<DailyVoiceVideo> {
  const { data } = await api.post(
    '/reports/daily/voice-video',
    null,
    { params: date ? { date } : {}, timeout: 300_000 }
  );
  return data as DailyVoiceVideo;
}

export async function fetchWeekly() {
  const { data } = await api.get('/reports/weekly');
  return data;
}

export type DayDebriefSummary = {
  id: string;
  date: string;
  headline: string;
  source: string;
  locale?: 'en' | 'fr' | string;
  createdAt?: number | null;
  updatedAt?: number | null;
};

export type DayDebriefDetail = DayDebriefSummary & {
  summary: string;
  highlights: string[];
  watchouts: string[];
  tomorrowTips: string[];
  agentPrompt: string;
  facts: Record<string, unknown>;
};

export async function fetchDebriefs(limit = 30) {
  const { data } = await api.get('/reports/debriefs', { params: { limit } });
  return (data.debriefs || []) as DayDebriefSummary[];
}

export async function fetchDebrief(date: string) {
  const { data } = await api.get(`/reports/debriefs/${encodeURIComponent(date)}`);
  return data as DayDebriefDetail;
}

export async function fetchRagArchive(limit = 30) {
  const { data } = await api.get('/reports/rag-archive', { params: { limit } });
  return data as {
    debriefs: DayDebriefSummary[];
    workoutPlans: Array<{
      id: string;
      title: string;
      focus?: string | null;
      durationMin?: number | null;
      exercises: Array<{ name: string }>;
      basedOn?: string | null;
    }>;
  };
}

export type LifeAssessment = {
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
  totals?: Record<string, unknown>;
  generatedAt?: number;
};

export async function generateLifeAssessment(days = 7) {
  const { data } = await api.post('/reports/life-assessment', null, { params: { days } });
  return data as LifeAssessment;
}

export async function downloadRagArchive(format: 'json' | 'zip' = 'zip', limit = 200) {
  try {
    const { data, headers } = await api.get('/reports/rag-archive/export', {
      params: { format, limit },
      responseType: 'blob',
    });
    const contentType = String(headers['content-type'] || '');
    if (contentType.includes('application/json') && format === 'zip') {
      const text = await (data as Blob).text();
      const parsed = JSON.parse(text);
      throw new Error(parsed.detail || 'Archive export failed');
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const ext = format === 'json' ? 'json' : 'zip';
    const blob =
      data instanceof Blob
        ? data
        : new Blob([data], { type: format === 'json' ? 'application/json' : 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `health-companion-rag-archive-${stamp}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err: any) {
    const blob = err?.response?.data;
    if (blob instanceof Blob) {
      try {
        const text = await blob.text();
        const parsed = JSON.parse(text);
        throw new Error(parsed.detail || text || 'Archive download failed');
      } catch (inner) {
        if (inner instanceof Error && inner.message !== 'Archive download failed') throw inner;
      }
    }
    throw err;
  }
}

export async function downloadDailyPdf(date?: string) {
  try {
    const { data, headers } = await api.get('/reports/daily/pdf', {
      params: date ? { date } : {},
      responseType: 'blob',
    });
    const contentType = String(headers['content-type'] || '');
    if (contentType.includes('application/json')) {
      const text = await (data as Blob).text();
      const parsed = JSON.parse(text);
      throw new Error(parsed.detail || 'PDF generation failed');
    }
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const day = date || new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `health-companion-${day}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err: any) {
    const blob = err?.response?.data;
    if (blob instanceof Blob) {
      try {
        const text = await blob.text();
        const parsed = JSON.parse(text);
        throw new Error(parsed.detail || text || 'PDF download failed');
      } catch (inner) {
        if (inner instanceof Error && inner.message !== 'PDF download failed') throw inner;
      }
    }
    throw err;
  }
}

export async function emailDailyReport(date?: string) {
  const { data } = await api.post('/reports/daily/email', null, {
    params: date ? { date } : {},
  });
  return data as { ok: boolean; date: string; to?: string; headline?: string; shareUrl?: string };
}

export type DailyShare = {
  token: string;
  date: string;
  shareUrl: string;
  pdfUrl: string;
  qrUrl: string;
  expiresAt?: number | null;
};

export async function createDailyShare(date?: string) {
  const { data } = await api.post('/reports/daily/share', null, {
    params: date ? { date } : {},
  });
  return data as DailyShare;
}

export async function fetchActivity(limit = 30) {
  const { data } = await api.get('/health-data/activity', { params: { limit } });
  return (data.activity || []) as any[];
}

export async function fetchCareVisits(date?: string) {
  const { data } = await api.get('/health-data/care-visits', { params: date ? { date } : {} });
  return (data.careVisits || []) as any[];
}

export async function fetchSportMatches(date?: string) {
  const { data } = await api.get('/health-data/sport-matches', { params: date ? { date } : {} });
  return (data.sportMatches || []) as any[];
}

export async function fetchStressLogs(date?: string) {
  const { data } = await api.get('/health-data/stress-logs', { params: date ? { date } : {} });
  return (data.stressLogs || []) as any[];
}

export async function createCareVisit(payload: {
  date: string;
  time?: string;
  kind: 'kine' | 'osteo' | 'podologue' | 'other';
  label?: string;
  notes?: string;
}) {
  const { data } = await api.post('/health-data/care-visits', payload);
  return data.careVisit;
}

export async function createSportMatch(payload: {
  date: string;
  time?: string;
  sport?: string;
  result: 'win' | 'loss' | 'draw' | 'completed';
  score?: string;
  durationMin?: number;
  opponent?: string;
  intensity?: 'easy' | 'moderate' | 'hard' | 'max';
  notes?: string;
}) {
  const { data } = await api.post('/health-data/sport-matches', payload);
  return data.sportMatch;
}

export async function createStressLog(payload: {
  date: string;
  time?: string;
  level: 'calm' | 'ok' | 'high';
  score?: number;
  notes?: string;
}) {
  const { data } = await api.post('/health-data/stress-logs', payload);
  return data.stressLog;
}

export async function fetchDayCheckIn(date: string) {
  const { data } = await api.get('/health-data/day-checkins', { params: { date } });
  return (data.dayCheckIn || null) as {
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
}

export async function fetchDayCheckIns(limit = 30) {
  const { data } = await api.get('/health-data/day-checkins', { params: { limit } });
  return (data.dayCheckIns || []) as Array<{
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
  }>;
}

export async function upsertDayCheckIn(payload: {
  date: string;
  mood: 'terrible' | 'low' | 'ok' | 'good' | 'great';
  wakeQuality: 'rough' | 'groggy' | 'ok' | 'fresh' | 'energized';
  focus?: 'terrible' | 'low' | 'ok' | 'good' | 'great';
  restlessness?: 'low' | 'ok' | 'high';
  overwhelm?: 'low' | 'ok' | 'high';
  taskInitiation?: 'stuck' | 'slow' | 'ok' | 'easy';
  impulsivity?: 'low' | 'ok' | 'high';
  medicationTaken?: boolean;
  hyperfocus?: boolean;
  sleepHours?: number;
  notes?: string;
}) {
  const { data } = await api.post('/health-data/day-checkins', payload);
  return data.dayCheckIn;
}

export async function fetchCaffeineLogs(date?: string) {
  const { data } = await api.get('/health-data/caffeine-logs', { params: date ? { date } : {} });
  return (data.caffeineLogs || []) as any[];
}

export async function createCaffeineLog(payload: {
  date: string;
  time?: string;
  drink:
    | 'espresso'
    | 'double_espresso'
    | 'coffee'
    | 'iced_coffee'
    | 'green_tea'
    | 'black_tea';
  caffeineMg?: number;
  notes?: string;
}) {
  const { data } = await api.post('/health-data/caffeine-logs', payload);
  return data.caffeineLog;
}

export async function deleteCaffeineLog(id: string) {
  await api.delete(`/health-data/caffeine-logs/${id}`);
}

export async function createManualMeal(payload: {
  date: string;
  mealType?: string;
  carbsG: number;
  proteinG: number;
  fatG: number;
  caloriesKcal?: number;
  notes?: string;
}) {
  const eatenAt = new Date(`${payload.date}T12:00:00`).toISOString();
  const estimated = Math.round(payload.carbsG * 4 + payload.proteinG * 4 + payload.fatG * 9);
  const caloriesKcal =
    payload.caloriesKcal != null && payload.caloriesKcal > 0
      ? Math.round(payload.caloriesKcal)
      : estimated;
  const { data } = await api.post('/meals', {
    eatenAt,
    mealType: payload.mealType || 'other',
    macros: {
      carbsG: payload.carbsG,
      proteinG: payload.proteinG,
      fatG: payload.fatG,
      fiberG: 0,
      caloriesKcal,
    },
    notes: payload.notes,
    aiSummary: payload.notes || 'Manual meal',
    source: 'manual',
    items: [],
  });
  return data;
}

export async function fetchBodyProfile() {
  const { data } = await api.get('/health-data/body-profile');
  return data as {
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
      cannulaChangedAt?: number | null;
      sensorStartedAt?: number | null;
      cannulaDay?: number | null;
      sensorDay?: number | null;
      siteChangeSuggested?: boolean;
      sensorAging?: boolean;
    };
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
}

export async function updateBodyProfile(payload: {
  heightCm: number;
  sex: 'male' | 'female';
  ageYears: number;
  activity: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  deficitKcal: number;
  locale?: 'en' | 'fr';
  tirLowMgDl?: number;
  tirHighMgDl?: number;
  tirGoalPct?: number;
  dailyCarbTargetG?: number;
}) {
  const { data } = await api.put('/health-data/body-profile', payload);
  return data;
}

export async function markDeviceCare(payload: {
  markCannulaChanged?: boolean;
  markSensorStarted?: boolean;
}) {
  const { data } = await api.post('/health-data/body-profile/device-care', payload);
  return data as { ok: boolean; profile: NonNullable<Awaited<ReturnType<typeof fetchBodyProfile>>['profile']> };
}

export async function logWeight(payload: { date: string; weightKg: number; notes?: string }) {
  const { data } = await api.post('/health-data/weight', payload);
  return data;
}

export async function fetchWeightHistory(limit = 60) {
  const { data } = await api.get('/health-data/weight', { params: { limit } });
  return (data.weights || []) as Array<{ date: string; weightKg: number; notes?: string }>;
}

export async function fetchInjuries(status: 'active' | 'open' | 'healed' | 'all' = 'open') {
  const { data } = await api.get('/health-data/injuries', { params: { status } });
  return (data.injuries || []) as import('./injuries').Injury[];
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
  const { data } = await api.post('/health-data/injuries', payload);
  return data.injury as import('./injuries').Injury;
}

export async function updateInjury(
  id: string,
  payload: Record<string, unknown>
) {
  const { data } = await api.patch(`/health-data/injuries/${id}`, payload);
  return data.injury as import('./injuries').Injury;
}

export async function deleteInjury(id: string) {
  await api.delete(`/health-data/injuries/${id}`);
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
  const { data } = await api.post(`/health-data/injuries/${injuryId}/pain`, payload);
  return data;
}

export async function pingHealth() {
  const { data } = await api.get('/health');
  return data;
}

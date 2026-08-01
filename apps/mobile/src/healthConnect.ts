import { Linking, Platform } from 'react-native';
import { toDateKey } from '@health-companion/shared';
import { getSamsungTodaySteps } from './samsungHealth';
import { getWatchTodaySteps } from './watchSteps';

export type HealthConnectStatus =
  | 'unsupported'
  | 'unavailable'
  | 'ready'
  | 'denied'
  | 'error';

export type ActivitySnapshot = {
  date: string;
  steps: number;
  steps7d: number;
  recordCountToday: number;
  caloriesBurned?: number;
  heartRateBpm?: number;
  energyScore?: number;
  energyScoreDate?: string;
  energyScoreNote?: string;
  stepsSource?: 'samsung_health' | 'watch' | 'health_connect';
  workouts: Array<{ name: string; durationMin: number; calories?: number }>;
  sources: string[];
  granted: string[];
  warning?: string;
};

let HealthConnect: typeof import('react-native-health-connect') | null = null;

async function loadSdk() {
  if (Platform.OS !== 'android') return null;
  if (HealthConnect) return HealthConnect;
  try {
    HealthConnect = await import('react-native-health-connect');
    return HealthConnect;
  } catch {
    return null;
  }
}

function rangeEndingNow(daysBack: number) {
  const end = new Date();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.max(0, daysBack - 1));
  return {
    operator: 'between' as const,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

export async function getHealthConnectStatus(): Promise<HealthConnectStatus> {
  if (Platform.OS !== 'android') return 'unsupported';
  const sdk = await loadSdk();
  if (!sdk) return 'unavailable';
  try {
    const available = await sdk.initialize();
    return available ? 'ready' : 'unavailable';
  } catch {
    return 'error';
  }
}

export async function requestHealthPermissions(): Promise<boolean> {
  const sdk = await loadSdk();
  if (!sdk) return false;
  const available = await sdk.initialize();
  if (!available) {
    throw new Error('Health Connect is not available on this device');
  }

  try {
    const { PermissionsAndroid } = await import('react-native');
    if (PermissionsAndroid?.PERMISSIONS?.ACTIVITY_RECOGNITION) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
    }
  } catch {
    /* optional */
  }

  const granted = await sdk.requestPermission([
    { accessType: 'read', recordType: 'Steps' },
    { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
    { accessType: 'read', recordType: 'TotalCaloriesBurned' },
    { accessType: 'read', recordType: 'Distance' },
    { accessType: 'read', recordType: 'ExerciseSession' },
    { accessType: 'read', recordType: 'HeartRate' },
  ]);
  return Array.isArray(granted) ? granted.length > 0 : Boolean(granted);
}

export async function openHealthConnectApp(): Promise<void> {
  const sdk = await loadSdk();
  if (sdk?.openHealthConnectSettings) {
    sdk.openHealthConnectSettings();
    return;
  }
  await Linking.openSettings();
}

export async function openHealthConnectData(): Promise<void> {
  const sdk = await loadSdk();
  if (sdk?.openHealthConnectDataManagement) {
    sdk.openHealthConnectDataManagement();
    return;
  }
  await openHealthConnectApp();
}

export async function openSamsungHealth(): Promise<void> {
  try {
    await Linking.sendIntent('android.intent.action.MAIN', [
      { key: 'package', value: 'com.sec.android.app.shealth' },
    ] as any);
  } catch {
    await Linking.openURL('samsunghealth://settings').catch(() =>
      Linking.openURL('market://details?id=com.sec.android.app.shealth').catch(() =>
        Linking.openSettings()
      )
    );
  }
}

async function grantedLabels(sdk: NonNullable<typeof HealthConnect>): Promise<string[]> {
  try {
    const granted = await sdk.getGrantedPermissions();
    return (granted || []).map((p: any) => `${p.accessType}:${p.recordType}`);
  } catch {
    return [];
  }
}

async function aggregateSteps(
  sdk: NonNullable<typeof HealthConnect>,
  timeRangeFilter: { operator: 'between'; startTime: string; endTime: string }
): Promise<{ steps: number; sources: string[] }> {
  const result = (await sdk.aggregateRecord({
    recordType: 'Steps',
    timeRangeFilter,
  })) as { COUNT_TOTAL?: number; dataOrigins?: string[] };

  return {
    steps: Math.round(Number(result.COUNT_TOTAL || 0)),
    sources: (result.dataOrigins || []).map(String).filter(Boolean),
  };
}

async function countStepRecords(
  sdk: NonNullable<typeof HealthConnect>,
  timeRangeFilter: { operator: 'between'; startTime: string; endTime: string }
): Promise<{ total: number; count: number; sources: string[] }> {
  let pageToken: string | undefined;
  let total = 0;
  let count = 0;
  const sources = new Set<string>();
  do {
    const page = (await sdk.readRecords('Steps', {
      timeRangeFilter,
      pageSize: 1000,
      pageToken,
    })) as {
      records?: Array<{ count?: number; metadata?: { dataOrigin?: string } }>;
      pageToken?: string;
    };
    for (const r of page.records || []) {
      total += Number(r.count || 0);
      count += 1;
      if (r.metadata?.dataOrigin) sources.add(String(r.metadata.dataOrigin));
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return { total: Math.round(total), count, sources: [...sources] };
}

async function aggregateActiveCalories(
  sdk: NonNullable<typeof HealthConnect>,
  timeRangeFilter: { operator: 'between'; startTime: string; endTime: string }
): Promise<number | undefined> {
  try {
    const result = (await sdk.aggregateRecord({
      recordType: 'ActiveCaloriesBurned',
      timeRangeFilter,
    })) as { ACTIVE_CALORIES_TOTAL?: { inKilocalories?: number } };
    const kcal = result.ACTIVE_CALORIES_TOTAL?.inKilocalories;
    return typeof kcal === 'number' && kcal > 0 ? Math.round(kcal) : undefined;
  } catch {
    return undefined;
  }
}

async function aggregateHeartRate(
  sdk: NonNullable<typeof HealthConnect>,
  timeRangeFilter: { operator: 'between'; startTime: string; endTime: string }
): Promise<number | undefined> {
  try {
    const result = (await sdk.aggregateRecord({
      recordType: 'HeartRate',
      timeRangeFilter,
    })) as { BPM_AVG?: number };
    const bpm = result.BPM_AVG;
    return typeof bpm === 'number' && bpm > 0 ? Math.round(bpm) : undefined;
  } catch {
    return undefined;
  }
}

export async function readTodayActivity(): Promise<ActivitySnapshot> {
  const date = toDateKey(Date.now());
  const samsung = await getSamsungTodaySteps();
  const watch = !samsung?.available ? await getWatchTodaySteps() : null;

  let steps = 0;
  let stepsSource: ActivitySnapshot['stepsSource'];
  let sources: string[] = [];
  let warning: string | undefined;

  if (samsung?.available) {
    steps = samsung.steps;
    stepsSource = 'samsung_health';
    sources = ['samsung_health'];
  } else if (watch?.available) {
    steps = watch.steps;
    stepsSource = 'watch';
    sources = ['watch'];
  }

  const energyScore =
    typeof samsung?.energyScore === 'number' && Number.isFinite(samsung.energyScore)
      ? samsung.energyScore
      : undefined;
  const energyScoreDate = samsung?.energyScoreDate;
  const energyScoreNote = samsung?.energyScoreNote;

  const sdk = await loadSdk();
  if (!sdk) {
    if (!stepsSource) {
      warning =
        'Connect Samsung Health (or keep the watch face active) to load steps.';
    }
    return {
      date,
      steps,
      steps7d: 0,
      recordCountToday: 0,
      energyScore,
      energyScoreDate,
      energyScoreNote,
      caloriesBurned:
        typeof samsung?.caloriesBurned === 'number' ? samsung.caloriesBurned : undefined,
      stepsSource,
      workouts: [],
      sources,
      granted: [],
      warning,
    };
  }

  await sdk.initialize();
  const today = rangeEndingNow(1);
  const week = rangeEndingNow(7);
  const granted = await grantedLabels(sdk);

  let steps7d = 0;
  let recordCountToday = 0;

  try {
    const [todayAgg, weekAgg, todayRecords] = await Promise.all([
      aggregateSteps(sdk, today),
      aggregateSteps(sdk, week),
      countStepRecords(sdk, today),
    ]);
    steps7d = weekAgg.steps;
    recordCountToday = todayRecords.count;
    const hcSteps = todayAgg.steps || todayRecords.total;
    const hcSources = [...new Set([...todayAgg.sources, ...todayRecords.sources, ...weekAgg.sources])];

    if (!stepsSource && hcSteps > 0) {
      steps = hcSteps;
      stepsSource = 'health_connect';
      sources = hcSources;
    } else if (stepsSource) {
      sources = [...new Set([...sources, ...hcSources])];
    } else {
      sources = hcSources;
    }
  } catch (e) {
    if (!stepsSource) warning = String((e as Error)?.message || e);
  }

  if (!stepsSource && !warning) {
    warning =
      'No steps yet. Tap Connect Samsung Health (enable Developer mode in Samsung Health if needed).';
  }

  const [hcCalories, heartRateBpm] = await Promise.all([
    aggregateActiveCalories(sdk, today),
    aggregateHeartRate(sdk, today),
  ]);
  const caloriesBurned =
    typeof samsung?.caloriesBurned === 'number' && Number.isFinite(samsung.caloriesBurned)
      ? samsung.caloriesBurned
      : hcCalories;

  const workouts: Array<{ name: string; durationMin: number; calories?: number }> = [];
  try {
    const sessions = (await sdk.readRecords('ExerciseSession', {
      timeRangeFilter: today,
      pageSize: 100,
    })) as {
      records?: Array<{
        exerciseType?: number;
        title?: string;
        startTime: string;
        endTime: string;
      }>;
    };
    for (const s of sessions.records || []) {
      const durationMin = Math.max(
        1,
        Math.round((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000)
      );
      workouts.push({
        name: s.title || `Workout ${s.exerciseType ?? ''}`.trim(),
        durationMin,
      });
    }
  } catch {
    /* optional */
  }

  return {
    date,
    steps,
    steps7d,
    recordCountToday,
    caloriesBurned,
    heartRateBpm,
    energyScore,
    energyScoreDate,
    energyScoreNote,
    stepsSource,
    workouts,
    sources,
    granted,
    warning,
  };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, DeviceEventEmitter, NativeModules, type AppStateStatus } from 'react-native';
import type { GlycemiaReading } from '@health-companion/shared';
import { syncGlucose } from './api/client';
import { getAccessToken } from './api/auth';

const PENDING_KEY = '@health_companion/glucose_pending_sync';
const HISTORY_KEY = '@health_companion/history';
const LATEST_KEY = '@health_companion/latest_glycemia';
const MAX_PENDING = 500;
const AUTO_SYNC_MS = 5 * 60 * 1000;

export const GLYCEMIA_UPDATED_EVENT = 'glycemia-updated';

const GlycemiaStorage = NativeModules.GlycemiaStorage as
  | { getLastGlycemia?: () => Promise<string | null> }
  | undefined;

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let syncInFlight: Promise<number> | null = null;
let autoSyncStarted = false;

async function loadPending(): Promise<GlycemiaReading[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function savePending(readings: GlycemiaReading[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(readings.slice(0, MAX_PENDING)));
}

function dedupe(readings: GlycemiaReading[]): GlycemiaReading[] {
  const seen = new Set<string>();
  const out: GlycemiaReading[] = [];
  for (const r of readings) {
    if (typeof r?.value !== 'number' || !r.unit || !r.timestamp) continue;
    const key = `${r.timestamp}:${r.value}:${r.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function loadLocalHistory(): Promise<GlycemiaReading[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as GlycemiaReading[]) : [];
  } catch {
    return [];
  }
}

async function loadLatestReading(): Promise<GlycemiaReading | null> {
  try {
    let raw = await AsyncStorage.getItem(LATEST_KEY);
    if (!raw && GlycemiaStorage?.getLastGlycemia) {
      raw = await GlycemiaStorage.getLastGlycemia();
    }
    if (!raw) return null;
    return JSON.parse(raw) as GlycemiaReading;
  } catch {
    return null;
  }
}

/** Queue locally if offline / unsigned-in; flush when possible. */
async function enqueue(reading: GlycemiaReading): Promise<void> {
  const pending = await loadPending();
  const next = dedupe([reading, ...pending]);
  await savePending(next);
}

/**
 * Push a CapAPS reading to the web API immediately.
 * Safe to call from headless notification tasks.
 */
export async function pushGlucoseToCloud(reading: GlycemiaReading): Promise<void> {
  DeviceEventEmitter.emit(GLYCEMIA_UPDATED_EVENT, reading);
  try {
    const { evaluateGlucoseNudges, checkMissedGlucose } = await import('./pushNudges');
    void evaluateGlucoseNudges(reading);
    void checkMissedGlucose();
  } catch {
    /* nudges optional in headless */
  }

  const token = await getAccessToken();
  if (!token) {
    await enqueue(reading);
    return;
  }

  await enqueue(reading);
  try {
    const pending = await loadPending();
    await syncGlucose(pending);
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    // Keep pending for flushGlucosePending()
  }
}

/** Retry any readings that failed or were queued before sign-in. */
export async function flushGlucosePending(): Promise<number> {
  return syncLocalGlucoseToCloud();
}

/**
 * Upload latest + local history + pending queue to the web API.
 * Deduped server-side by timestamp/value.
 */
export async function syncLocalGlucoseToCloud(): Promise<number> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const token = await getAccessToken();
    if (!token) return 0;

    const [pending, history, latest] = await Promise.all([
      loadPending(),
      loadLocalHistory(),
      loadLatestReading(),
    ]);
    const batch = dedupe([
      ...(latest ? [latest] : []),
      ...history,
      ...pending,
    ]);
    if (batch.length === 0) return 0;

    try {
      const inserted = await syncGlucose(batch);
      await AsyncStorage.removeItem(PENDING_KEY);
      if (__DEV__) {
        console.log('[HealthCompanion] Glucose auto-sync ok', { count: batch.length, inserted });
      }
      return inserted;
    } catch (e) {
      if (__DEV__) {
        console.log('[HealthCompanion] Glucose auto-sync failed', e);
      }
      return 0;
    }
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

/**
 * Sync immediately, then every 5 minutes while the app process is alive.
 * Also syncs when returning to the foreground.
 */
export function startGlucoseAutoSync(intervalMs: number = AUTO_SYNC_MS): void {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  const tick = () => {
    syncLocalGlucoseToCloud().catch(() => {});
  };

  tick();
  autoSyncTimer = setInterval(tick, intervalMs);

  appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') tick();
  });
}

export function stopGlucoseAutoSync(): void {
  autoSyncStarted = false;
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  appStateSub?.remove();
  appStateSub = null;
}

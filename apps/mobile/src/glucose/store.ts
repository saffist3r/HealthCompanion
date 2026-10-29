/**
 * Phone-side glucose state: the latest CamAPS reading and the local history, merged with the
 * cloud. Shared by Home and the Glucose detail screen; the foreground catch-up runs app-wide
 * so the watch and cloud stay current whichever screen is open.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import {
  analyzeGlucose,
  GLYCEMIA_24H_MS,
  MAX_GLYCEMIA_HISTORY,
  toMgDl,
  type GlucoseInsight,
  type GlycemiaReading,
} from '@health-companion/shared';
import { fetchGlucoseHistory } from '../api/client';
import { flushGlucosePending, GLYCEMIA_UPDATED_EVENT, pushGlucoseToCloud } from '../glucoseCloudSync';
import { sendGlycemiaToWatch } from '../wearSync';

const LOCAL_HISTORY_MS = GLYCEMIA_24H_MS * 2;
const GLYCEMIA_ASYNC_KEY = '@health_companion/latest_glycemia';
const HISTORY_KEY = '@health_companion/history';
const MAX_HISTORY = MAX_GLYCEMIA_HISTORY;
const GlycemiaStorage = NativeModules.GlycemiaStorage;

export async function loadLatestGlycemia(): Promise<GlycemiaReading | null> {
  try {
    let best: GlycemiaReading | null = null;
    const asyncRaw = await AsyncStorage.getItem(GLYCEMIA_ASYNC_KEY);
    if (asyncRaw) {
      try {
        best = JSON.parse(asyncRaw) as GlycemiaReading;
      } catch {
        /* ignore */
      }
    }
    // Native CapAPS extract writes SharedPreferences; prefer whichever reading is newer.
    if (GlycemiaStorage?.getLastGlycemia) {
      const nativeRaw = await GlycemiaStorage.getLastGlycemia();
      if (nativeRaw) {
        try {
          const native = JSON.parse(nativeRaw) as GlycemiaReading;
          if (!best || (native.timestamp || 0) >= (best.timestamp || 0)) {
            best = native;
            // Keep AsyncStorage in sync so cloud flush / meal capture see it
            await AsyncStorage.setItem(GLYCEMIA_ASYNC_KEY, JSON.stringify(native));
            try {
              await pushGlucoseToCloud(native);
            } catch {
              /* queued by pushGlucoseToCloud on failure */
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return best;
  } catch {
    return null;
  }
}

export async function loadHistory(): Promise<GlycemiaReading[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as GlycemiaReading[];
    if (!Array.isArray(arr)) return [];
    const cutoff = Date.now() - LOCAL_HISTORY_MS;
    return arr.filter((r) => r.timestamp >= cutoff).slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

export function mergeHistory(local: GlycemiaReading[], cloud: GlycemiaReading[]): GlycemiaReading[] {
  const byTs = new Map<number, GlycemiaReading>();
  for (const r of [...cloud, ...local]) {
    if (!r?.timestamp || !Number.isFinite(r.value)) continue;
    const key = Math.round(r.timestamp / 1000) * 1000;
    if (!byTs.has(key)) byTs.set(key, r);
  }
  return Array.from(byTs.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_HISTORY);
}

export async function appendToHistory(reading: GlycemiaReading): Promise<void> {
  const history = await loadHistory();
  const filtered = history.filter((r) => Math.abs(r.timestamp - reading.timestamp) > 5000);
  const updated = [reading, ...filtered].slice(0, MAX_HISTORY);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

export async function removeFromHistory(timestamp: number): Promise<void> {
  const history = await loadHistory();
  const updated = history.filter((r) => r.timestamp !== timestamp);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

export async function saveHistory(history: GlycemiaReading[]): Promise<void> {
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

/** Local history merged with the cloud's, saved back locally. Falls back to local on failure. */
export async function loadMergedHistory(hours: number): Promise<GlycemiaReading[]> {
  const local = await loadHistory();
  try {
    const merged = mergeHistory(local, await fetchGlucoseHistory(hours));
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return local;
  }
}

/**
 * When the app comes to the foreground, pick up any reading the native extractor stored while JS
 * was asleep and pass it on to the watch and the cloud. Returns a stop function.
 */
export function startGlucoseForegroundCatchUp(): () => void {
  const sub = AppState.addEventListener('change', async (state) => {
    if (state !== 'active') return;
    const reading = await loadLatestGlycemia();
    if (reading) {
      await appendToHistory(reading);
      sendGlycemiaToWatch(reading, await loadHistory()).catch(() => {});
      pushGlucoseToCloud(reading).catch(() => {});
      DeviceEventEmitter.emit(GLYCEMIA_UPDATED_EVENT, reading);
    }
    flushGlucosePending().catch(() => {});
  });
  return () => sub.remove();
}

export type NotificationAccess = 'unknown' | 'authorized' | 'denied';

export async function notificationAccessStatus(): Promise<NotificationAccess> {
  if (Platform.OS !== 'android') return 'authorized';
  try {
    return ((await RNAndroidNotificationListener?.getPermissionStatus?.()) ?? 'unknown') as NotificationAccess;
  } catch {
    return 'unknown';
  }
}

export function requestNotificationAccess() {
  RNAndroidNotificationListener?.requestPermission?.();
}

/** Readings as mg/dL samples for the trend engine. */
export function toSamples(history: GlycemiaReading[]) {
  return history.map((r) => ({ mgDl: toMgDl(r.value, r.unit), timestamp: r.timestamp }));
}

/** Live glucose for a screen: latest reading, merged history and the CGM insight. */
export function useGlucose(hours = 12) {
  const [latest, setLatest] = useState<GlycemiaReading | null>(null);
  const [history, setHistory] = useState<GlycemiaReading[]>([]);
  const [access, setAccess] = useState<NotificationAccess>('unknown');
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    setAccess(await notificationAccessStatus());
    const reading = await loadLatestGlycemia();
    if (reading) {
      await appendToHistory(reading);
      pushGlucoseToCloud(reading).catch(() => {});
    }
    setLatest(reading);
    setHistory(await loadMergedHistory(Math.max(hours, 24)));
    setNow(Date.now());
    flushGlucosePending().catch(() => {});
  }, [hours]);

  useEffect(() => {
    void refresh();
    const sub = DeviceEventEmitter.addListener(GLYCEMIA_UPDATED_EVENT, async (reading: GlycemiaReading) => {
      setLatest(reading);
      await appendToHistory(reading);
      setHistory(await loadHistory());
      setNow(Date.now());
    });
    // Keep "2 min ago" and staleness honest while the screen stays open.
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      sub.remove();
      clearInterval(tick);
    };
  }, [refresh]);

  const insight: GlucoseInsight = useMemo(() => {
    const all = latest ? [latest, ...history] : history;
    return analyzeGlucose(toSamples(all), now);
  }, [latest, history, now]);

  return { latest, history, insight, access, refresh, now };
}

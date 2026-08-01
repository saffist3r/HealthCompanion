import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, DeviceEventEmitter, type AppStateStatus } from 'react-native';
import {
  pumpEventFingerprint,
  type PumpLogEvent,
} from '@health-companion/shared';
import { syncPumpEvents } from './api/client';
import { getAccessToken } from './api/auth';

const PENDING_KEY = '@health_companion/pump_pending_sync';
const HISTORY_KEY = '@health_companion/pump_history';
const SEEN_KEY = '@health_companion/pump_seen_fingerprints';
const MAX_PENDING = 500;
const MAX_HISTORY = 200;
const MAX_SEEN = 400;
const AUTO_SYNC_MS = 5 * 60 * 1000;
/** Sticky insulin notices: ignore identical content for 90 minutes. */
const INSULIN_SEEN_TTL_MS = 90 * 60 * 1000;
const DEFAULT_SEEN_TTL_MS = 15 * 60 * 1000;

export const PUMP_LOG_UPDATED_EVENT = 'pump-log-updated';

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let syncInFlight: Promise<number> | null = null;
let autoSyncStarted = false;

type SeenEntry = { fingerprint: string; timestamp: number; kind: string };

async function loadPending(): Promise<PumpLogEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function savePending(events: PumpLogEvent[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(events.slice(0, MAX_PENDING)));
}

async function loadSeen(): Promise<SeenEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveSeen(entries: SeenEntry[]): Promise<void> {
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(entries.slice(0, MAX_SEEN)));
}

function ttlForKind(kind: string): number {
  return kind === 'insulin_delivered' ? INSULIN_SEEN_TTL_MS : DEFAULT_SEEN_TTL_MS;
}

function pruneSeen(entries: SeenEntry[], now = Date.now()): SeenEntry[] {
  return entries.filter((e) => now - e.timestamp <= ttlForKind(e.kind || 'other'));
}

/** Returns true if this event was already recorded recently (lingering CapAPS notice). */
export async function wasPumpEventSeenRecently(event: PumpLogEvent): Promise<boolean> {
  const fingerprint = pumpEventFingerprint(event);
  const now = Date.now();
  const seen = pruneSeen(await loadSeen(), now);
  const hit = seen.find((e) => e.fingerprint === fingerprint);
  if (!hit) return false;
  return now - hit.timestamp <= ttlForKind(event.kind);
}

async function markPumpEventSeen(event: PumpLogEvent): Promise<void> {
  const fingerprint = pumpEventFingerprint(event);
  const now = Date.now();
  const seen = pruneSeen(await loadSeen(), now).filter((e) => e.fingerprint !== fingerprint);
  seen.unshift({ fingerprint, timestamp: event.timestamp || now, kind: event.kind });
  await saveSeen(seen);
}

function dedupe(events: PumpLogEvent[]): PumpLogEvent[] {
  const seen = new Set<string>();
  const out: PumpLogEvent[] = [];
  for (const e of events) {
    if (!e?.kind || !e.timestamp) continue;
    const key = pumpEventFingerprint(e);
    // Prefer earliest occurrence of the same lingering notice
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

async function appendLocalHistory(event: PumpLogEvent): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const history = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(history) ? history : [];
    const next = dedupe([event, ...list]).slice(0, MAX_HISTORY);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

async function enqueue(event: PumpLogEvent): Promise<void> {
  const pending = await loadPending();
  await savePending(dedupe([event, ...pending]));
}

/** Push a CapAPS pump/alert notification to the web API. */
export async function pushPumpEventToCloud(event: PumpLogEvent): Promise<void> {
  if (await wasPumpEventSeenRecently(event)) {
    return;
  }
  await markPumpEventSeen(event);

  DeviceEventEmitter.emit(PUMP_LOG_UPDATED_EVENT, event);
  await appendLocalHistory(event);

  const token = await getAccessToken();
  if (!token) {
    await enqueue(event);
    return;
  }

  await enqueue(event);
  try {
    const pending = await loadPending();
    await syncPumpEvents(pending);
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    // Keep pending for flush
  }
}

export async function flushPumpPending(): Promise<number> {
  return syncLocalPumpToCloud();
}

export async function syncLocalPumpToCloud(): Promise<number> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const token = await getAccessToken();
    if (!token) return 0;

    const pending = await loadPending();
    // Prefer pending only; history is local UI cache. Re-send a small recent slice if pending empty
    // so a fresh login can catch up without replaying every old duplicate.
    let batch = dedupe(pending);
    if (batch.length === 0) {
      try {
        const raw = await AsyncStorage.getItem(HISTORY_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        const history = Array.isArray(arr) ? (arr as PumpLogEvent[]) : [];
        const cutoff = Date.now() - 36 * 60 * 60 * 1000;
        batch = dedupe(history.filter((e) => (e.timestamp || 0) >= cutoff)).slice(0, 80);
      } catch {
        batch = [];
      }
    }
    if (batch.length === 0) return 0;

    const inserted = await syncPumpEvents(batch);
    await AsyncStorage.removeItem(PENDING_KEY);
    return inserted;
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

export function startPumpAutoSync(intervalMs = AUTO_SYNC_MS): void {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  const tick = () => {
    syncLocalPumpToCloud().catch(() => {});
  };
  tick();
  autoSyncTimer = setInterval(tick, intervalMs);

  const onAppState = (state: AppStateStatus) => {
    if (state === 'active') tick();
  };
  appStateSub = AppState.addEventListener('change', onAppState);
}

export function stopPumpAutoSync(): void {
  autoSyncStarted = false;
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  appStateSub?.remove();
  appStateSub = null;
}

import { AppState, type AppStateStatus } from 'react-native';
import { toDateKey } from '@health-companion/shared';
import { syncActivity } from './api/client';
import { getAccessToken } from './api/auth';
import { readTodayActivity } from './healthConnect';

const AUTO_SYNC_MS = 15 * 60 * 1000;

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let syncInFlight: Promise<boolean> | null = null;
let autoSyncStarted = false;

/** Read Samsung/HC today snapshot and push steps + energy score to the cloud. */
export async function syncActivityToCloud(): Promise<boolean> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const token = await getAccessToken();
    if (!token) return false;

    const snap = await readTodayActivity();
    if (!snap.stepsSource && snap.energyScore == null && !(snap.steps > 0)) {
      return false;
    }

    await syncActivity({
      date: snap.date || toDateKey(Date.now()),
      steps: snap.steps || 0,
      activeMinutes: snap.activeMinutes,
      caloriesBurned: snap.caloriesBurned,
      workouts: snap.workouts || [],
      source: snap.stepsSource || 'samsung_health',
      energyScore: snap.energyScore,
    });
    return true;
  })();

  try {
    return await syncInFlight;
  } catch {
    return false;
  } finally {
    syncInFlight = null;
  }
}

export function startActivityAutoSync(intervalMs = AUTO_SYNC_MS): void {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  const tick = () => {
    syncActivityToCloud().catch(() => {});
  };
  tick();
  autoSyncTimer = setInterval(tick, intervalMs);

  const onAppState = (state: AppStateStatus) => {
    if (state === 'active') tick();
  };
  appStateSub = AppState.addEventListener('change', onAppState);
}

export function stopActivityAutoSync(): void {
  autoSyncStarted = false;
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  appStateSub?.remove();
  appStateSub = null;
}

import { AppState, type AppStateStatus } from 'react-native';
import { toDateKey } from '@health-companion/shared';
import { syncActivity } from './api/client';
import { getAccessToken } from './api/auth';
import { readActivityForDate, readTodayActivity } from './healthConnect';

const AUTO_SYNC_MS = 15 * 60 * 1000;

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let syncInFlight: Promise<boolean> | null = null;
let autoSyncStarted = false;
let lastBackfillAt = 0;

function dateKeyDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return toDateKey(d.getTime());
}

/** Read Samsung/HC today snapshot and push steps + workouts + energy score to the cloud. */
export async function syncActivityToCloud(): Promise<boolean> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const token = await getAccessToken();
    if (!token) return false;

    const snap = await readTodayActivity();
    if (
      !snap.stepsSource &&
      snap.energyScore == null &&
      !(snap.steps > 0) &&
      !(snap.workouts?.length > 0)
    ) {
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

/** Backfill recent days from Samsung (fixes under-counted workouts like Aug 27). */
export async function syncRecentActivityToCloud(daysBack = 7): Promise<{
  synced: number;
  totalWorkoutMin: number;
}> {
  const token = await getAccessToken();
  if (!token) return { synced: 0, totalWorkoutMin: 0 };

  let synced = 0;
  let totalWorkoutMin = 0;
  for (let i = 0; i < daysBack; i++) {
    const date = dateKeyDaysAgo(i);
    try {
      const snap = await readActivityForDate(date);
      if (
        !snap.stepsSource &&
        snap.energyScore == null &&
        !(snap.steps > 0) &&
        !(snap.workouts?.length > 0)
      ) {
        continue;
      }
      await syncActivity({
        date: snap.date,
        steps: snap.steps || 0,
        activeMinutes: snap.activeMinutes,
        caloriesBurned: snap.caloriesBurned,
        workouts: snap.workouts || [],
        source: snap.stepsSource || 'samsung_health',
        energyScore: snap.energyScore,
      });
      synced += 1;
      totalWorkoutMin += (snap.workouts || []).reduce(
        (s, w) => s + (Number(w.durationMin) || 0),
        0
      );
    } catch {
      /* skip day */
    }
  }
  return { synced, totalWorkoutMin };
}

export function startActivityAutoSync(intervalMs = AUTO_SYNC_MS): void {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  const tick = () => {
    syncActivityToCloud().catch(() => {});
    // Once per 6h, re-pull last week so historical Samsung exercise gaps get corrected.
    const now = Date.now();
    if (now - lastBackfillAt > 6 * 60 * 60 * 1000) {
      lastBackfillAt = now;
      syncRecentActivityToCloud(7).catch(() => {});
    }
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

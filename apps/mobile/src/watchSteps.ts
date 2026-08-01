import { NativeModules, Platform } from 'react-native';
import { toDateKey } from '@health-companion/shared';

type WatchStepsResult = {
  available: boolean;
  steps: number;
  date: string;
  timestamp: number;
};

const Native = NativeModules.HealthCompanionWear as
  | { getLatestWatchSteps?: () => Promise<WatchStepsResult> }
  | undefined;

/** Today's steps last published by the Wear OS watch face. */
export async function getWatchTodaySteps(): Promise<WatchStepsResult | null> {
  if (Platform.OS !== 'android' || !Native?.getLatestWatchSteps) return null;
  try {
    const result = await Native.getLatestWatchSteps();
    if (!result?.available) return null;
    const today = toDateKey(Date.now());
    if (result.date && result.date !== today) {
      return { ...result, steps: 0, available: false };
    }
    return result;
  } catch {
    return null;
  }
}

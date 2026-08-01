import { NativeModules, Platform } from 'react-native';

type TodayActivity = {
  available: boolean;
  steps: number;
  date: string;
  source: string;
  energyScore?: number;
  energyScoreDate?: string;
  energyScoreGranted?: boolean;
  energyScoreNote?: string;
  caloriesBurned?: number;
};

const Native = NativeModules.SamsungHealth as
  | {
      isAvailable: () => Promise<boolean>;
      requestPermissions: () => Promise<{ granted: boolean; count: number }>;
      getTodayActivity: () => Promise<TodayActivity>;
    }
  | undefined;

export async function isSamsungHealthAvailable(): Promise<boolean> {
  if (Platform.OS !== 'android' || !Native?.isAvailable) return false;
  try {
    return Boolean(await Native.isAvailable());
  } catch {
    return false;
  }
}

export async function connectSamsungHealth(): Promise<boolean> {
  if (Platform.OS !== 'android' || !Native?.requestPermissions) return false;
  try {
    const result = await Native.requestPermissions();
    return Boolean(result?.granted);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    const message = err?.message || String(e);
    const wrapped = new Error(message) as Error & { code?: string };
    wrapped.code = err?.code;
    throw wrapped;
  }
}

export async function getSamsungTodaySteps(): Promise<TodayActivity | null> {
  if (Platform.OS !== 'android' || !Native?.getTodayActivity) return null;
  try {
    const result = await Native.getTodayActivity();
    if (!result?.available) return null;
    return result;
  } catch {
    return null;
  }
}

/** Local pre-bolus timer — reminds you to eat after insulin is already on board. */

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const PREFS_KEY = 'hc.preBolus.minutes.v1';
const NOTIF_ID = 'hc-prebolus-timer';

export const PRE_BOLUS_OPTIONS_MIN = [10, 15, 20] as const;
export type PreBolusMinutes = (typeof PRE_BOLUS_OPTIONS_MIN)[number];

export async function getPreBolusMinutes(): Promise<PreBolusMinutes> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    const n = Number(raw);
    if (PRE_BOLUS_OPTIONS_MIN.includes(n as PreBolusMinutes)) return n as PreBolusMinutes;
  } catch {
    /* ignore */
  }
  return 15;
}

export async function setPreBolusMinutes(min: PreBolusMinutes): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, String(min));
}

export async function cancelPreBolusTimer(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIF_ID);
  } catch {
    /* ignore */
  }
}

/** Schedule a one-shot "eat now" ping after `minutes` (default from prefs). */
export async function startPreBolusTimer(minutes?: number): Promise<number> {
  const mins = minutes ?? (await getPreBolusMinutes());
  await cancelPreBolusTimer();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('meals', {
      name: 'Meals',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Notification permission needed for pre-bolus timer');
  }
  const seconds = Math.max(60, Math.round(mins * 60));
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_ID,
    content: {
      title: 'Pre-bolus timer done',
      body: 'Insulin has a head start. Food may enter the chat now.',
      data: { hcNudge: true, kind: 'preBolus', screen: 'Meals' },
      ...(Platform.OS === 'android' ? { channelId: 'meals' } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      repeats: false,
    },
  });
  return mins;
}

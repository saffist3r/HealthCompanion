import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ENABLED_KEY = 'hc.morningReminder.enabled';
const NOTIFICATION_ID_KEY = 'hc.morningReminder.notificationId';

export const MORNING_REMINDER_HOUR = 10;
export const MORNING_REMINDER_MINUTE = 30;
export const MORNING_REMINDER_DATA = { screen: 'MorningLog' as const };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('morning-checkin', {
    name: 'Morning check-in',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0d9488',
  });
}

export async function getMorningReminderEnabled(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(ENABLED_KEY);
  // Default on — user can disable in Settings.
  if (raw == null) return true;
  return raw === '1';
}

export async function setMorningReminderEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    await AsyncStorage.setItem(ENABLED_KEY, '0');
    await cancelMorningReminder();
    return false;
  }
  const ok = await scheduleMorningReminder();
  return ok;
}

export async function requestMorningReminderPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  const already = (current as { granted?: boolean; status?: string }).granted
    || (current as { status?: string }).status === 'granted';
  if (already) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return Boolean(
    (asked as { granted?: boolean }).granted || (asked as { status?: string }).status === 'granted'
  );
}

export async function cancelMorningReminder(): Promise<void> {
  const existing = await AsyncStorage.getItem(NOTIFICATION_ID_KEY);
  if (existing) {
    await Notifications.cancelScheduledNotificationAsync(existing);
    await AsyncStorage.removeItem(NOTIFICATION_ID_KEY);
  }
  // Also clear any leftover matching content.
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((n) => (n.content.data as { screen?: string } | undefined)?.screen === 'MorningLog')
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

export async function scheduleMorningReminder(): Promise<boolean> {
  await ensureAndroidChannel();
  const granted = await requestMorningReminderPermission();
  if (!granted) {
    await AsyncStorage.setItem(ENABLED_KEY, '0');
    await cancelMorningReminder();
    return false;
  }

  await cancelMorningReminder();

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Morning check-in',
      body: "Log today's mental check-in and weight.",
      data: MORNING_REMINDER_DATA,
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: 'morning-checkin' } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: MORNING_REMINDER_HOUR,
      minute: MORNING_REMINDER_MINUTE,
      channelId: Platform.OS === 'android' ? 'morning-checkin' : undefined,
    },
  });

  await AsyncStorage.setItem(NOTIFICATION_ID_KEY, id);
  await AsyncStorage.setItem(ENABLED_KEY, '1');
  return true;
}

/** Call when signed in: keep schedule in sync with preference. */
export async function syncMorningReminderOnLaunch(): Promise<void> {
  const enabled = await getMorningReminderEnabled();
  if (!enabled) {
    await cancelMorningReminder();
    return;
  }
  await scheduleMorningReminder();
}

export function isMorningReminderResponse(
  data: unknown
): data is { screen: 'MorningLog' } {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as { screen?: string }).screen === 'MorningLog'
  );
}

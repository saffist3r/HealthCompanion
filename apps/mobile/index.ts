import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';
import RNAndroidNotificationListener, {
  RNAndroidNotificationListenerHeadlessJsName,
} from 'react-native-android-notification-listener';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parseGlycemiaFromNotification,
  isCapAPSFxPackage,
} from '@health-companion/shared';

import App from './App';
import { sendGlycemiaToWatch } from './src/wearSync';

const GLYCEMIA_ASYNC_KEY = '@health_companion/latest_glycemia';
const HISTORY_KEY = '@health_companion/history';
const MAX_HISTORY = 20;

async function appendToHistory(reading: { value: number; unit: string; timestamp: number }) {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const history = raw ? JSON.parse(raw) : [];
    const filtered = history.filter((r: { timestamp: number }) => Math.abs(r.timestamp - reading.timestamp) > 5000);
    const updated = [reading, ...filtered].slice(0, MAX_HISTORY);
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (_) {}
}

interface NotificationPayload {
  app?: string;
  title?: string;
  text?: string;
  bigText?: string;
  subText?: string;
  summaryText?: string;
  extraInfoText?: string;
  tickerText?: string;
  extrasText?: string;
  groupedMessages?: Array<{ title?: string; text?: string }>;
}

const headlessNotificationListener = async (payload: {
  notification?: string | NotificationPayload;
}) => {
  let notification: NotificationPayload | null = null;
  const raw = payload?.notification;
  if (!raw) return;

  if (typeof raw === 'string') {
    try {
      notification = JSON.parse(raw) as NotificationPayload;
    } catch {
      return;
    }
  } else if (typeof raw === 'object' && raw !== null) {
    notification = raw;
  }
  if (!notification) return;

  const packageId = notification.app ?? '';
  const isCapAPS = isCapAPSFxPackage(packageId);
  const textPreview = [notification.title, notification.text, notification.bigText]
    .filter(Boolean)
    .join(' ')
    .substring(0, 150);
  if (__DEV__) {
    console.log('[HealthCompanion] Notification package:', packageId, 'isCapAPS:', isCapAPS, 'text:', textPreview);
  }
  if (!isCapAPS && !(__DEV__ && packageId === 'com.android.shell')) return;

  const parts: string[] = [
    notification.title,
    notification.text,
    notification.bigText,
    notification.subText,
    notification.summaryText,
    notification.extraInfoText,
    notification.tickerText,
    notification.extrasText,
  ].filter(Boolean) as string[];

  const grouped = notification.groupedMessages ?? [];
  for (const msg of grouped) {
    if (msg.title) parts.push(msg.title);
    if (msg.text) parts.push(msg.text);
  }

  const text = parts.join(' ');
  const reading = parseGlycemiaFromNotification(text);
  if (__DEV__) {
    console.log('[HealthCompanion] Parsed text:', text.substring(0, 200), 'reading:', reading ? JSON.stringify(reading) : 'null');
  }
  if (!reading) return;

  try {
    await AsyncStorage.setItem(GLYCEMIA_ASYNC_KEY, JSON.stringify(reading));
    await appendToHistory(reading);
    await sendGlycemiaToWatch(reading);
  } catch (_) {
    // Ignore storage errors in headless context
  }
};

AppRegistry.registerHeadlessTask(
  RNAndroidNotificationListenerHeadlessJsName,
  () => headlessNotificationListener
);

registerRootComponent(App);

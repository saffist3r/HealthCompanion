import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';
import RNAndroidNotificationListener, {
  RNAndroidNotificationListenerHeadlessJsName,
} from 'react-native-android-notification-listener';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parseGlycemiaFromNotificationParts,
  parsePumpLogFromNotificationParts,
  isCapAPSFxPackage,
  MAX_GLYCEMIA_HISTORY,
  type GlycemiaReading,
} from '@health-companion/shared';

import App from './App';
import { sendGlycemiaToWatch } from './src/wearSync';
import { pushGlucoseToCloud } from './src/glucoseCloudSync';
import { pushPumpEventToCloud } from './src/pumpCloudSync';

const GLYCEMIA_ASYNC_KEY = '@health_companion/latest_glycemia';
const HISTORY_KEY = '@health_companion/history';
const MAX_HISTORY = MAX_GLYCEMIA_HISTORY;

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
  /** Android StatusBarNotification postTime (ms since epoch), as string */
  time?: string;
  groupedMessages?: Array<{ title?: string; text?: string }>;
}

function notificationPostTimeMs(notification: NotificationPayload): number {
  const raw = notification.time;
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 1e11) return Math.round(n);
    if (Number.isFinite(n) && n > 1e9) return Math.round(n * 1000);
  }
  return Date.now();
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
    // extrasText often dumps Android class names — only keep if it looks human
    notification.extrasText &&
    /insulin|delivered|reservoir|battery|glucose|hypo|occlusion|sensor|high|low/i.test(
      notification.extrasText
    )
      ? notification.extrasText
      : undefined,
  ].filter(Boolean) as string[];

  const grouped = notification.groupedMessages ?? [];
  for (const msg of grouped) {
    if (msg.title) parts.push(msg.title);
    if (msg.text) parts.push(msg.text);
  }

  const postedAt = notificationPostTimeMs(notification);
  const reading = parseGlycemiaFromNotificationParts(parts);
  const pumpEvent = parsePumpLogFromNotificationParts(parts, {
    packageId,
    timestamp: postedAt,
  });
  if (__DEV__) {
    const text = parts.join(' ');
    console.log(
      '[HealthCompanion] Parsed text:',
      text.substring(0, 200),
      'reading:',
      reading ? JSON.stringify(reading) : 'null',
      'pump:',
      pumpEvent ? JSON.stringify(pumpEvent) : 'null',
      'postTime:',
      postedAt
    );
  }

  if (pumpEvent) {
    try {
      pushPumpEventToCloud(pumpEvent).catch(() => {});
    } catch (_) {
      // Ignore in headless context
    }
  }

  if (!reading) return;

  try {
    // Prefer CapAPS post time so refreshes of the same reading don't skew history
    const stamped = { ...reading, timestamp: reading.timestamp || postedAt };
    await AsyncStorage.setItem(GLYCEMIA_ASYNC_KEY, JSON.stringify(stamped));
    await appendToHistory(stamped);
    await sendGlycemiaToWatch(stamped, await loadHistoryForSync());
    // Store on the web dashboard as soon as CapAPS delivers a reading
    pushGlucoseToCloud(stamped).catch(() => {});
  } catch (_) {
    // Ignore storage errors in headless context
  }
};

async function loadHistoryForSync(): Promise<GlycemiaReading[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

AppRegistry.registerHeadlessTask(
  RNAndroidNotificationListenerHeadlessJsName,
  () => headlessNotificationListener
);

registerRootComponent(App);

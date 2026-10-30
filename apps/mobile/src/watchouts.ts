/**
 * Watch-outs: the server spots moments that, in your own history, tend to lead to a hypo or a
 * high (sport → night hypos, late bolus → highs, ...). This turns each one into a notification,
 * once, either now or at its time (e.g. bedtime after sport).
 *
 * Safe to call from the headless CamAPS listener: it throttles itself and never throws.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { fetchWatchouts, type Watchout } from './api/client';

const SEEN_KEY = '@health_companion/watchouts_seen';
const LAST_CHECK_KEY = '@health_companion/watchouts_last_check';
const CHANNEL = 'hc-watchouts';
const MIN_INTERVAL_MS = 4 * 60 * 1000;
const MAX_SEEN = 300;

let channelReady = false;

async function ensureChannel() {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Watch-outs',
    description: 'Heads-ups drawn from your own patterns (sport, bolus timing, rebounds)',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
    lightColor: '#00E5FF',
  });
  channelReady = true;
}

async function loadSeen(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function schedule(w: Watchout) {
  const inSeconds = Math.round((w.fireAt - Date.now()) / 1000);
  await Notifications.scheduleNotificationAsync({
    identifier: `hc-watchout:${w.id}`,
    content: {
      title: w.title,
      body: w.body,
      data: { hcNudge: true, kind: `watchout:${w.kind}`, screen: w.kind === 'bolus' ? 'Meals' : 'Glucose' },
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}),
    },
    trigger:
      inSeconds > 60
        ? {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: inSeconds,
            channelId: Platform.OS === 'android' ? CHANNEL : undefined,
          }
        : null,
  });
}

/** Fetch current watch-outs and notify the new ones. Returns how many were scheduled. */
export async function checkWatchouts(opts: { force?: boolean } = {}): Promise<number> {
  try {
    const last = Number((await AsyncStorage.getItem(LAST_CHECK_KEY)) || 0);
    if (!opts.force && Date.now() - last < MIN_INTERVAL_MS) return 0;
    await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return 0;

    const watchouts = await fetchWatchouts();
    if (!watchouts.length) return 0;
    const seen = await loadSeen();
    const fresh = watchouts.filter((w) => !seen.includes(w.id));
    if (!fresh.length) return 0;

    await ensureChannel();
    for (const w of fresh) {
      await schedule(w);
      seen.push(w.id);
    }
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-MAX_SEEN)));
    return fresh.length;
  } catch {
    return 0;
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { GlycemiaReading, PumpEventKind, PumpLogEvent } from '@health-companion/shared';

/** Preference keys — all default ON. */
export type NudgeKind =
  | 'morning'
  | 'evening'
  | 'mealLunch'
  | 'mealDinner'
  | 'postMeal'
  | 'carbTarget'
  | 'weightWeekly'
  | 'meds'
  | 'injuryPain'
  | 'afterSport'
  | 'careFollowUp'
  | 'reportReady'
  | 'weeklySummary'
  | 'glucoseOor'
  | 'glucoseRate'
  | 'glucoseMissed'
  | 'pumpAlert'
  | 'siteChange'
  | 'preBolus';

export type NudgeScreen =
  | 'MorningLog'
  | 'PainLog'
  | 'Meals'
  | 'Mental'
  | 'Glucose'
  | 'Activity'
  | 'Reports'
  | 'Today';

export type NudgePrefs = Record<NudgeKind, boolean>;

export const NUDGE_META: Array<{
  kind: NudgeKind;
  title: string;
  blurb: string;
  channel: 'lifestyle' | 'meals' | 'glucose' | 'reports';
}> = [
  { kind: 'morning', title: 'Morning log', blurb: '10:30 — weight + check-in', channel: 'lifestyle' },
  { kind: 'evening', title: 'Evening check-in', blurb: '21:30 — mood / sleep', channel: 'lifestyle' },
  { kind: 'mealLunch', title: 'Lunch reminder', blurb: '13:00 — log lunch if you ate', channel: 'meals' },
  { kind: 'mealDinner', title: 'Dinner reminder', blurb: '20:00 — log dinner if you ate', channel: 'meals' },
  { kind: 'postMeal', title: 'Post-meal check', blurb: '+2h after you log a meal', channel: 'meals' },
  { kind: 'carbTarget', title: 'High-carb meal', blurb: 'When a logged meal is high in carbs', channel: 'meals' },
  { kind: 'weightWeekly', title: 'Weekly weigh-in', blurb: 'Sunday 10:00', channel: 'lifestyle' },
  { kind: 'meds', title: 'Meds reminder', blurb: '09:00', channel: 'lifestyle' },
  { kind: 'injuryPain', title: 'Injury check', blurb: '19:00 — pain score', channel: 'lifestyle' },
  { kind: 'afterSport', title: 'After sport', blurb: '+30 min after a logged session', channel: 'lifestyle' },
  { kind: 'careFollowUp', title: 'Care follow-up', blurb: 'Day after a care visit', channel: 'lifestyle' },
  { kind: 'reportReady', title: 'Daily report', blurb: '07:05 — yesterday’s report', channel: 'reports' },
  { kind: 'weeklySummary', title: 'Weekly summary', blurb: 'Sunday 18:00', channel: 'reports' },
  { kind: 'glucoseOor', title: 'Out of range', blurb: 'Sustained high or low (~20 min)', channel: 'glucose' },
  { kind: 'glucoseRate', title: 'Fast change', blurb: 'Rapid rise or drop', channel: 'glucose' },
  { kind: 'glucoseMissed', title: 'No CGM reading', blurb: 'No reading for ~3 hours', channel: 'glucose' },
  { kind: 'pumpAlert', title: 'Pump alert', blurb: 'Reservoir / battery / occlusion', channel: 'glucose' },
  { kind: 'siteChange', title: 'Site change', blurb: 'When cannula day count is high', channel: 'glucose' },
  { kind: 'preBolus', title: 'Pre-bolus timer', blurb: 'Reminder when your timer ends', channel: 'meals' },
];

const PREFS_KEY = 'hc.nudgePrefs.v2';
const LEGACY_MORNING_KEY = 'hc.morningReminder.enabled';
const OOR_SINCE_KEY = 'hc.nudge.oorSince';
const LAST_OOR_NOTIFY_KEY = 'hc.nudge.lastOorNotify';
const LAST_RATE_NOTIFY_KEY = 'hc.nudge.lastRateNotify';
const LAST_MISSED_NOTIFY_KEY = 'hc.nudge.lastMissedNotify';
const LAST_PUMP_NOTIFY_KEY = 'hc.nudge.lastPumpNotify';
const LAST_SITE_CHANGE_KEY = 'hc.nudge.lastSiteChange';
const ID_PREFIX = 'hc-nudge:';

export const MORNING_REMINDER_HOUR = 10;
export const MORNING_REMINDER_MINUTE = 30;

const DEFAULT_TIR_LOW = 70;
const DEFAULT_TIR_HIGH = 180;

/** Kinds enabled by default — keep the noise low; user can turn more on. */
const DEFAULT_ON: ReadonlySet<NudgeKind> = new Set([
  'morning',
  'meds',
  'reportReady',
  'glucoseOor',
  'glucoseMissed',
  'pumpAlert',
  'preBolus',
]);

type NudgeCopy = { title: string; body: string };

const COPY: Record<NudgeKind, NudgeCopy[]> = {
  morning: [{ title: 'Morning log', body: 'Time for weight and a quick check-in.' }],
  evening: [{ title: 'Evening check-in', body: 'Log how you’re feeling before bed.' }],
  mealLunch: [{ title: 'Lunch', body: 'Log lunch if you ate.' }],
  mealDinner: [{ title: 'Dinner', body: 'Log dinner if you ate.' }],
  postMeal: [{ title: 'Post-meal check', body: 'Check glucose about 2 hours after your meal.' }],
  carbTarget: [{ title: 'High-carb meal', body: 'That meal was high in carbs. Worth a note.' }],
  weightWeekly: [{ title: 'Weekly weigh-in', body: 'Log your weight for the week.' }],
  meds: [{ title: 'Meds', body: 'Have you taken your medication?' }],
  injuryPain: [{ title: 'Injury check', body: 'Log today’s pain score if you have an open injury.' }],
  afterSport: [{ title: 'After sport', body: 'How did the session feel? Add a quick note.' }],
  careFollowUp: [{ title: 'Care follow-up', body: 'How are you feeling after yesterday’s care visit?' }],
  reportReady: [{ title: 'Daily report', body: 'Yesterday’s report is ready.' }],
  weeklySummary: [{ title: 'Weekly summary', body: 'Your week summary is ready in Reports.' }],
  glucoseOor: [{ title: 'Out of range', body: 'Glucose has been outside your target for a while. Check CapAPS.' }],
  glucoseRate: [{ title: 'Fast change', body: 'Glucose is changing quickly. Check CapAPS.' }],
  glucoseMissed: [{ title: 'No reading', body: 'No glucose reading for a few hours. Check CapAPS or the sensor.' }],
  pumpAlert: [{ title: 'Pump alert', body: 'Check CapAPS — reservoir, battery, or occlusion may need attention.' }],
  siteChange: [{ title: 'Site change', body: 'Cannula day count is high. Consider a site change.' }],
  preBolus: [{ title: 'Pre-bolus timer', body: 'Timer done — you can eat now.' }],
};

const SCREEN_FOR: Record<NudgeKind, NudgeScreen> = {
  morning: 'MorningLog',
  evening: 'MorningLog',
  mealLunch: 'Meals',
  mealDinner: 'Meals',
  postMeal: 'Glucose',
  carbTarget: 'Meals',
  weightWeekly: 'MorningLog',
  meds: 'MorningLog',
  injuryPain: 'PainLog',
  afterSport: 'Activity',
  careFollowUp: 'Activity',
  reportReady: 'Reports',
  weeklySummary: 'Reports',
  glucoseOor: 'Glucose',
  glucoseRate: 'Glucose',
  glucoseMissed: 'Glucose',
  pumpAlert: 'Glucose',
  siteChange: 'Today',
  preBolus: 'Meals',
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function pickCopy(kind: NudgeKind): NudgeCopy {
  const list = COPY[kind];
  return list[Math.floor(Math.random() * list.length)] || list[0];
}

function channelId(channel: 'lifestyle' | 'meals' | 'glucose' | 'reports') {
  return `hc-${channel}`;
}

async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  const defs: Array<{ id: string; name: string; importance: Notifications.AndroidImportance }> = [
    { id: 'hc-lifestyle', name: 'Lifestyle nudges', importance: Notifications.AndroidImportance.DEFAULT },
    { id: 'hc-meals', name: 'Meal nudges', importance: Notifications.AndroidImportance.DEFAULT },
    { id: 'hc-glucose', name: 'Glucose nudges', importance: Notifications.AndroidImportance.HIGH },
    { id: 'hc-reports', name: 'Reports', importance: Notifications.AndroidImportance.DEFAULT },
    { id: 'morning-checkin', name: 'Morning check-in', importance: Notifications.AndroidImportance.DEFAULT },
  ];
  for (const d of defs) {
    await Notifications.setNotificationChannelAsync(d.id, {
      name: d.name,
      importance: d.importance,
      vibrationPattern: [0, 220, 120, 220],
      lightColor: '#0d9488',
    });
  }
}

function defaultPrefs(): NudgePrefs {
  const prefs = {} as NudgePrefs;
  for (const m of NUDGE_META) prefs[m.kind] = DEFAULT_ON.has(m.kind);
  return prefs;
}

export async function getNudgePrefs(): Promise<NudgePrefs> {
  const raw = await AsyncStorage.getItem(PREFS_KEY);
  const base = defaultPrefs();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<NudgePrefs>;
      return { ...base, ...parsed };
    } catch {
      /* ignore */
    }
  }
  // Migrate from v1: start from quieter defaults (v1 had everything on).
  const legacyV1 = await AsyncStorage.getItem('hc.nudgePrefs.v1');
  if (legacyV1) {
    try {
      const parsed = JSON.parse(legacyV1) as Partial<NudgePrefs>;
      const merged = { ...base };
      // Keep only explicit offs from v1 for kinds that stay on by default.
      for (const kind of DEFAULT_ON) {
        if (parsed[kind] === false) merged[kind] = false;
      }
      await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(merged));
      return merged;
    } catch {
      /* ignore */
    }
  }
  // Migrate legacy morning toggle.
  const legacy = await AsyncStorage.getItem(LEGACY_MORNING_KEY);
  if (legacy === '0') base.morning = false;
  if (legacy === '1') base.morning = true;
  return base;
}

export async function setNudgePref(kind: NudgeKind, enabled: boolean): Promise<NudgePrefs> {
  const prefs = await getNudgePrefs();
  prefs[kind] = enabled;
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  if (kind === 'morning') {
    await AsyncStorage.setItem(LEGACY_MORNING_KEY, enabled ? '1' : '0');
  }
  await syncAllNudges();
  return prefs;
}

export async function requestNudgePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  const already =
    (current as { granted?: boolean; status?: string }).granted ||
    (current as { status?: string }).status === 'granted';
  if (already) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return Boolean(
    (asked as { granted?: boolean }).granted || (asked as { status?: string }).status === 'granted'
  );
}

async function cancelByPrefix(prefix: string) {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((n) => n.identifier.startsWith(prefix) || (n.content.data as { kind?: string })?.kind)
      .filter((n) => {
        const kind = (n.content.data as { kind?: string } | undefined)?.kind;
        return n.identifier.startsWith(prefix) || (kind != null && String(n.identifier).includes(kind));
      })
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

async function cancelAllHcNudges() {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((n) => {
        const data = n.content.data as { hcNudge?: boolean; screen?: string } | undefined;
        return (
          n.identifier.startsWith(ID_PREFIX) ||
          data?.hcNudge === true ||
          data?.screen === 'MorningLog'
        );
      })
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
  );
}

async function scheduleDaily(
  kind: NudgeKind,
  hour: number,
  minute: number,
  channel: 'lifestyle' | 'meals' | 'glucose' | 'reports'
) {
  const copy = pickCopy(kind);
  const ch = channelId(channel);
  await Notifications.scheduleNotificationAsync({
    identifier: `${ID_PREFIX}daily:${kind}`,
    content: {
      title: copy.title,
      body: copy.body,
      data: { hcNudge: true, kind, screen: SCREEN_FOR[kind] },
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: ch } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: Platform.OS === 'android' ? ch : undefined,
    },
  });
}

async function scheduleWeekly(
  kind: NudgeKind,
  weekday: number,
  hour: number,
  minute: number,
  channel: 'lifestyle' | 'meals' | 'glucose' | 'reports'
) {
  const copy = pickCopy(kind);
  const ch = channelId(channel);
  await Notifications.scheduleNotificationAsync({
    identifier: `${ID_PREFIX}weekly:${kind}`,
    content: {
      title: copy.title,
      body: copy.body,
      data: { hcNudge: true, kind, screen: SCREEN_FOR[kind] },
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: ch } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday,
      hour,
      minute,
      channelId: Platform.OS === 'android' ? ch : undefined,
    },
  });
}

async function scheduleInSeconds(
  kind: NudgeKind,
  seconds: number,
  channel: 'lifestyle' | 'meals' | 'glucose' | 'reports',
  idSuffix?: string
) {
  if (seconds < 1) return;
  const copy = pickCopy(kind);
  const ch = channelId(channel);
  const id = `${ID_PREFIX}once:${kind}:${idSuffix || Date.now()}`;
  // Cancel prior same-kind once if suffix fixed.
  if (idSuffix) {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all
        .filter((n) => n.identifier.startsWith(`${ID_PREFIX}once:${kind}:${idSuffix}`))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
  }
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title: copy.title,
      body: copy.body,
      data: { hcNudge: true, kind, screen: SCREEN_FOR[kind] },
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: ch } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, Math.round(seconds)),
      channelId: Platform.OS === 'android' ? ch : undefined,
    },
  });
}

async function fireNow(kind: NudgeKind, channel: 'lifestyle' | 'meals' | 'glucose' | 'reports') {
  const copy = pickCopy(kind);
  const ch = channelId(channel);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: copy.title,
      body: copy.body,
      data: { hcNudge: true, kind, screen: SCREEN_FOR[kind] },
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: ch } : {}),
    },
    trigger: null,
  });
}

/** Reschedule all recurring nudges from prefs. */
export async function syncAllNudges(): Promise<boolean> {
  await ensureChannels();
  const granted = await requestNudgePermission();
  if (!granted) return false;

  const prefs = await getNudgePrefs();
  await cancelAllHcNudges();

  if (prefs.morning) await scheduleDaily('morning', MORNING_REMINDER_HOUR, MORNING_REMINDER_MINUTE, 'lifestyle');
  if (prefs.evening) await scheduleDaily('evening', 21, 30, 'lifestyle');
  if (prefs.mealLunch) await scheduleDaily('mealLunch', 13, 0, 'meals');
  if (prefs.mealDinner) await scheduleDaily('mealDinner', 20, 0, 'meals');
  if (prefs.meds) await scheduleDaily('meds', 9, 0, 'lifestyle');
  if (prefs.injuryPain) await scheduleDaily('injuryPain', 19, 0, 'lifestyle');
  if (prefs.reportReady) await scheduleDaily('reportReady', 7, 5, 'reports');
  // Sunday = 1 in expo weekly trigger
  if (prefs.weightWeekly) await scheduleWeekly('weightWeekly', 1, 10, 0, 'lifestyle');
  if (prefs.weeklySummary) await scheduleWeekly('weeklySummary', 1, 18, 0, 'reports');

  return true;
}

export async function syncMorningReminderOnLaunch(): Promise<void> {
  await syncAllNudges();
}

// --- Legacy morning API (Reminders screen / App) ---

export const MORNING_REMINDER_DATA = { screen: 'MorningLog' as const, hcNudge: true, kind: 'morning' as const };

export async function getMorningReminderEnabled(): Promise<boolean> {
  return (await getNudgePrefs()).morning;
}

export async function setMorningReminderEnabled(enabled: boolean): Promise<boolean> {
  const prefs = await setNudgePref('morning', enabled);
  if (!enabled) return false;
  const granted = await requestNudgePermission();
  return granted && prefs.morning;
}

export async function scheduleMorningReminder(): Promise<boolean> {
  return syncAllNudges();
}

export async function cancelMorningReminder(): Promise<void> {
  await setNudgePref('morning', false);
}

export function isMorningReminderResponse(data: unknown): data is { screen: 'MorningLog' } {
  return isNudgeResponse(data) && (data as { screen?: string }).screen === 'MorningLog';
}

export function isNudgeResponse(
  data: unknown
): data is { hcNudge?: boolean; kind?: NudgeKind; screen?: NudgeScreen } {
  if (!data || typeof data !== 'object') return false;
  const d = data as { hcNudge?: boolean; screen?: string; kind?: string };
  return d.hcNudge === true || !!d.kind || d.screen === 'MorningLog';
}

// --- Event-driven ---

export async function onMealLogged(carbsG?: number): Promise<void> {
  const prefs = await getNudgePrefs();
  if (prefs.postMeal) {
    await scheduleInSeconds('postMeal', 2 * 60 * 60, 'meals', 'postMeal');
  }
  if (prefs.carbTarget && carbsG != null && Number.isFinite(carbsG) && carbsG >= 70) {
    await fireNow('carbTarget', 'meals');
  }
}

export async function onSportLogged(): Promise<void> {
  if (!(await getNudgePrefs()).afterSport) return;
  await scheduleInSeconds('afterSport', 30 * 60, 'lifestyle', 'afterSport');
}

export async function onCareLogged(): Promise<void> {
  if (!(await getNudgePrefs()).careFollowUp) return;
  // ~24h later
  await scheduleInSeconds('careFollowUp', 24 * 60 * 60, 'lifestyle', 'careFollowUp');
}

function toMgDl(reading: GlycemiaReading): number {
  const v = reading.value;
  if ((reading.unit || '').toLowerCase().includes('mmol')) return v * 18;
  return v;
}

export async function evaluateGlucoseNudges(reading: GlycemiaReading): Promise<void> {
  const prefs = await getNudgePrefs();
  await ensureChannels();

  const mg = toMgDl(reading);
  const now = reading.timestamp || Date.now();

  // Missed BG: if previous latest was old — handled separately via checkMissedGlucose
  await AsyncStorage.setItem('@health_companion/latest_glycemia_ts', String(now));

  const low = DEFAULT_TIR_LOW;
  const high = DEFAULT_TIR_HIGH;
  const out = mg < low || mg > high;

  if (prefs.glucoseOor) {
    if (out) {
      const sinceRaw = await AsyncStorage.getItem(OOR_SINCE_KEY);
      const since = sinceRaw ? Number(sinceRaw) : now;
      if (!sinceRaw) await AsyncStorage.setItem(OOR_SINCE_KEY, String(now));
      const lastNotify = Number((await AsyncStorage.getItem(LAST_OOR_NOTIFY_KEY)) || '0');
      if (now - since >= 20 * 60 * 1000 && now - lastNotify >= 90 * 60 * 1000) {
        await fireNow('glucoseOor', 'glucose');
        await AsyncStorage.setItem(LAST_OOR_NOTIFY_KEY, String(now));
      }
    } else {
      await AsyncStorage.removeItem(OOR_SINCE_KEY);
    }
  }

  if (prefs.glucoseRate) {
    try {
      const histRaw = await AsyncStorage.getItem('@health_companion/history');
      const hist = histRaw ? (JSON.parse(histRaw) as GlycemiaReading[]) : [];
      const prev = hist.find((r) => r.timestamp && r.timestamp < now - 60_000);
      if (prev) {
        const prevMg = toMgDl(prev);
        const dtMin = Math.max(1, (now - prev.timestamp) / 60_000);
        const rate = Math.abs(mg - prevMg) / dtMin;
        const last = Number((await AsyncStorage.getItem(LAST_RATE_NOTIFY_KEY)) || '0');
        if (rate >= 3 && Math.abs(mg - prevMg) >= 25 && now - last >= 90 * 60 * 1000) {
          await fireNow('glucoseRate', 'glucose');
          await AsyncStorage.setItem(LAST_RATE_NOTIFY_KEY, String(now));
        }
      }
    } catch {
      /* ignore */
    }
  }
}

export async function checkMissedGlucose(): Promise<void> {
  if (!(await getNudgePrefs()).glucoseMissed) return;
  const tsRaw = await AsyncStorage.getItem('@health_companion/latest_glycemia_ts');
  let ts = tsRaw ? Number(tsRaw) : 0;
  if (!ts) {
    try {
      const latest = await AsyncStorage.getItem('@health_companion/latest_glycemia');
      if (latest) ts = (JSON.parse(latest) as GlycemiaReading).timestamp || 0;
    } catch {
      /* ignore */
    }
  }
  if (!ts) return;
  const now = Date.now();
  const last = Number((await AsyncStorage.getItem(LAST_MISSED_NOTIFY_KEY)) || '0');
  if (now - ts >= 3 * 60 * 60 * 1000 && now - last >= 3 * 60 * 60 * 1000) {
    await ensureChannels();
    await fireNow('glucoseMissed', 'glucose');
    await AsyncStorage.setItem(LAST_MISSED_NOTIFY_KEY, String(now));
  }
}

const PUMP_KINDS = new Set<PumpEventKind>([
  'reservoir',
  'battery',
  'occlusion',
  'urgent_low',
  'low',
  'high',
  'sensor',
]);

export async function onPumpEvent(event: PumpLogEvent): Promise<void> {
  if (!(await getNudgePrefs()).pumpAlert) return;
  if (!PUMP_KINDS.has(event.kind)) return;
  const now = Date.now();
  const last = Number((await AsyncStorage.getItem(LAST_PUMP_NOTIFY_KEY)) || '0');
  if (now - last < 45 * 60 * 1000) return;
  await ensureChannels();
  await fireNow('pumpAlert', 'glucose');
  await AsyncStorage.setItem(LAST_PUMP_NOTIFY_KEY, String(now));
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Fire site-change nudge at most once per day when backend suggests rotation. */
export async function maybeNudgeSiteChange(deviceCare: {
  siteChangeSuggested?: boolean;
  cannulaDay?: number | null;
}): Promise<void> {
  if (!deviceCare?.siteChangeSuggested) return;
  const prefs = await getNudgePrefs();
  if (!prefs.siteChange) return;
  const key = todayKey();
  const last = await AsyncStorage.getItem(LAST_SITE_CHANGE_KEY);
  if (last === key) return;
  await ensureChannels();
  await fireNow('siteChange', 'glucose');
  await AsyncStorage.setItem(LAST_SITE_CHANGE_KEY, key);
}

// silence unused in some trees
void cancelByPrefix;

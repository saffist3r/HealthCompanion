import { useCallback, useEffect, useState, useRef } from 'react';
import {
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  AppState,
  ScrollView,
  RefreshControl,
  LayoutAnimation,
  UIManager,
  useColorScheme,
  DeviceEventEmitter,
  type AppStateStatus,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import { Swipeable } from 'react-native-gesture-handler';
import Svg, { Circle } from 'react-native-svg';
import type { GlycemiaReading } from '@health-companion/shared';
import {
  getGlycemiaStatusColor,
  getGlycemiaStatusLabel,
  toMgDl,
} from '@health-companion/shared';
import { sendGlycemiaToWatch, sendBackgroundToWatch } from '../wearSync';
import { SparklineChart, type ChartRangeHours } from '../components/SparklineChart';
import ScreenHero from '../components/ui/ScreenHero';
import { FadeIn } from '../components/ui/FadeIn';
import { HC } from '../theme';
import { loadBackgroundSettings } from '../backgroundSettings';
import { syncGlucose, fetchGlucoseHistory, fetchGlycemiaEvents, type GlycemiaChartEvent } from '../api/client';
import { pushGlucoseToCloud, flushGlucosePending, GLYCEMIA_UPDATED_EVENT } from '../glucoseCloudSync';
import {
  appendToHistory,
  loadHistory,
  loadLatestGlycemia,
  mergeHistory,
  removeFromHistory,
  saveHistory,
} from '../glucose/store';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  return `${day}d ago`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

function StatusRing({
  reading,
  size = 160,
  strokeWidth = 12,
  color,
  isDark,
}: {
  reading: GlycemiaReading;
  size?: number;
  strokeWidth?: number;
  color: string;
  isDark: boolean;
}) {
  const mgDl = toMgDl(reading.value, reading.unit);
  const maxVal = 300;
  const progress = Math.min(1, Math.max(0, (mgDl - 0) / maxVal));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <Text
          style={{
            fontSize: 40,
            fontFamily: 'sans-serif-light',
            color: color,
          }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {reading.unit === 'mg/dL' ? Math.round(reading.value) : reading.value}
        </Text>
        <Text style={{ fontSize: 12, letterSpacing: 1.5, color: isDark ? 'rgba(255,255,255,0.6)' : '#888' }}>
          {reading.unit.toUpperCase()}
        </Text>
        <Text
          style={{
            fontSize: 13,
            color: isDark ? 'rgba(255,255,255,0.7)' : '#888',
            marginTop: 2,
          }}
        >
          {getGlycemiaStatusLabel(reading)}
        </Text>
      </View>
    </View>
  );
}

function EmptyState({ isDark }: { isDark: boolean }) {
  const textColor = isDark ? 'rgba(255,255,255,0.8)' : '#666';
  return (
    <View style={{ alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 }}>
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: isDark ? 'rgba(128,203,196,0.2)' : 'rgba(128,203,196,0.3)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Text style={{ fontSize: 40 }}>💧</Text>
      </View>
      <Text style={{ fontSize: 16, fontWeight: '600', color: textColor, textAlign: 'center' }}>
        No reading yet
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: isDark ? 'rgba(255,255,255,0.6)' : '#888',
          textAlign: 'center',
          marginTop: 8,
        }}
      >
        Ensure CapAPS Fx is sending notifications and Health Companion has notification access.
      </Text>
    </View>
  );
}

export default function GlucoseScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [permissionStatus, setPermissionStatus] = useState<'unknown' | 'authorized' | 'denied'>('unknown');
  const [glycemia, setGlycemia] = useState<GlycemiaReading | null>(null);
  const [history, setHistory] = useState<GlycemiaReading[]>([]);
  const [chartRange, setChartRange] = useState<ChartRangeHours>(12);
  const [chartEvents, setChartEvents] = useState<GlycemiaChartEvent[]>([]);
  const [showEvents, setShowEvents] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const syncSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshPermission = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const status = await RNAndroidNotificationListener?.getPermissionStatus?.();
      setPermissionStatus(status ?? 'unknown');
    } catch {
      setPermissionStatus('unknown');
    }
  }, []);

  const loadChartEvents = useCallback(async (hours: number) => {
    try {
      const events = await fetchGlycemiaEvents(hours);
      setChartEvents(events);
    } catch {
      setChartEvents([]);
    }
  }, []);

  const mergeCloudHistory = useCallback(async (local: GlycemiaReading[], hours: number) => {
    try {
      const cloud = await fetchGlucoseHistory(hours);
      const merged = mergeHistory(local, cloud);
      setHistory(merged);
      await saveHistory(merged);
      await loadChartEvents(hours);
      return merged;
    } catch {
      setHistory(local);
      await loadChartEvents(hours);
      return local;
    }
  }, [loadChartEvents]);

  const refreshGlycemia = useCallback(async () => {
    const reading = await loadLatestGlycemia();
    setGlycemia(reading);
    if (reading) {
      await appendToHistory(reading);
      pushGlucoseToCloud(reading).catch(() => {});
    }
    const local = await loadHistory();
    await mergeCloudHistory(local, Math.max(chartRange, 24));
  }, [chartRange, mergeCloudHistory]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    await refreshPermission();
    await refreshGlycemia();
    flushGlucosePending().catch(() => {});
    setRefreshing(false);
  }, [refreshPermission, refreshGlycemia]);

  const requestPermission = useCallback(() => {
    RNAndroidNotificationListener?.requestPermission?.();
  }, []);

  useEffect(() => {
    refreshPermission();
    refreshGlycemia();
    loadHistory().then(setHistory);
    flushGlucosePending().catch(() => {});
  }, [refreshPermission, refreshGlycemia]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(GLYCEMIA_UPDATED_EVENT, async (reading: GlycemiaReading) => {
      setGlycemia(reading);
      await appendToHistory(reading);
      setHistory(await loadHistory());
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || permissionStatus === 'authorized') return;
    const timer = setTimeout(() => {
      Alert.alert(
        'Notification access needed',
        'Health Companion needs notification access to read glycemia from CapAPS Fx and sync to your watch.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Open settings', onPress: requestPermission },
        ]
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [permissionStatus, requestPermission]);

  // Foreground catch-up (watch + cloud) runs app-wide; here we only refresh what's shown.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') refreshPermission();
    });
    return () => subscription.remove();
  }, [refreshPermission]);

  const openAccessibilitySettings = () => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS').catch(() =>
        Linking.openSettings()
      );
    }
  };

  const syncToWatch = async () => {
    if (!glycemia) return;
    setSyncing(true);
    setSyncSuccess(false);
    try {
      const hist = await loadHistory();
      await sendGlycemiaToWatch(glycemia, hist);
      await sendBackgroundToWatch(await loadBackgroundSettings());
      await pushGlucoseToCloud(glycemia);
      syncGlucose(hist).catch(() => {});
      flushGlucosePending().catch(() => {});
      setSyncSuccess(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      syncSuccessTimerRef.current = setTimeout(() => setSyncSuccess(false), 3000);
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteReading = async (ts: number) => {
    await removeFromHistory(ts);
    setHistory(await loadHistory());
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  if (Platform.OS !== 'android') {
    return (
      <View style={[styles(isDark).container, styles(isDark).scrollView]}>
        <Text style={styles(isDark).message}>
          Health Companion runs on Android only (phone + Wear OS watch).
        </Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  const theme = styles(isDark);

  const renderRightActions = (ts: number) => (
    <TouchableOpacity
      onPress={() => handleDeleteReading(ts)}
      style={[theme.deleteAction, { justifyContent: 'center', paddingHorizontal: 20 }]}
    >
      <Text style={{ color: '#fff', fontWeight: '600' }}>Delete</Text>
    </TouchableOpacity>
  );

  return (
      <ScrollView
        style={theme.scrollView}
        contentContainerStyle={theme.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={HC.teal} />}
      >
        <ScreenHero
          eyebrow="CGM · CAPAPS"
          title="Glucose"
          subtitle="Live readings from CapAPS notifications, synced to your watch and cloud."
          pills={['Live', 'History', 'TIR']}
          compact
        />

        <FadeIn>
        {permissionStatus !== 'authorized' && (
          <View style={theme.card}>
            <Text style={theme.cardTitle}>Notification access</Text>
            <Text style={theme.hint}>
              Grant notification access so the app can read glycemia from CapAPS Fx and sync to your
              watch.
            </Text>
            <TouchableOpacity style={theme.button} onPress={requestPermission} activeOpacity={0.8}>
              <Text style={theme.buttonText}>Open settings</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={theme.card}>
          <Text style={theme.cardTitle}>Accessibility (recommended)</Text>
          <Text style={theme.hint}>
            Enable Health Companion under Accessibility for best compatibility.
          </Text>
          <TouchableOpacity
            style={theme.buttonSecondary}
            onPress={openAccessibilitySettings}
            activeOpacity={0.8}
          >
            <Text style={theme.buttonSecondaryText}>Open Accessibility settings</Text>
          </TouchableOpacity>
        </View>

        {permissionStatus === 'authorized' && (
          <>
            <View style={theme.card}>
              <Text style={theme.cardTitle}>Latest glycemia</Text>
              {glycemia ? (
                <>
                  <View style={{ alignItems: 'center', marginVertical: 12 }}>
                    <StatusRing
                      reading={glycemia}
                      color={getGlycemiaStatusColor(glycemia)}
                      isDark={isDark}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                    <Text style={theme.timeAgo}>
                      Updated {formatTimeAgo(glycemia.timestamp)}
                    </Text>
                    {syncSuccess && (
                      <Text style={{ marginLeft: 8, fontSize: 14, color: '#81C784' }}>✓ Synced</Text>
                    )}
                  </View>
                </>
              ) : (
                <EmptyState isDark={isDark} />
              )}
              <View style={theme.buttonRow}>
                <TouchableOpacity
                  style={theme.buttonSecondary}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    refreshGlycemia();
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={theme.buttonSecondaryText}>Refresh</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[theme.buttonSecondary, syncing && theme.buttonDisabled]}
                  onPress={syncToWatch}
                  disabled={syncing}
                  activeOpacity={0.8}
                >
                  <Text style={theme.buttonSecondaryText}>
                    {syncing ? 'Syncing…' : 'Sync to watch'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={theme.card}>
                <Text style={theme.cardTitle}>Glycemia chart</Text>
                <SparklineChart
                  history={history}
                  color={isDark ? '#80CBC4' : '#00897B'}
                  isDark={isDark}
                  rangeHours={chartRange}
                  onRangeChange={(h) => {
                    setChartRange(h);
                    mergeCloudHistory(history, h).catch(() => {});
                  }}
                  events={chartEvents}
                  showEvents={showEvents}
                  onToggleEvents={setShowEvents}
                />
              </View>

            {history.length > 0 && (
              <View style={theme.card}>
                <Text style={theme.cardTitle}>Recent readings</Text>
                {history.slice(0, 10).map((r, i) => (
                  <Swipeable
                    key={r.timestamp}
                    renderRightActions={() => renderRightActions(r.timestamp)}
                    overshootRight={false}
                  >
                    <View
                      style={[
                        theme.historyRow,
                        {
                          backgroundColor: `${getGlycemiaStatusColor(r)}15`,
                          borderRadius: 8,
                          marginBottom: 4,
                          paddingHorizontal: 12,
                        },
                      ]}
                    >
                      <Text style={[theme.historyValue, { color: getGlycemiaStatusColor(r) }]}>
                        {r.value} {r.unit}
                        <Text style={[theme.historyTime, { marginLeft: 8 }]}>
                          {getGlycemiaStatusLabel(r)}
                        </Text>
                      </Text>
                      <Text style={theme.historyTime}>{formatTime(r.timestamp)}</Text>
                    </View>
                  </Swipeable>
                ))}
              </View>
            )}
          </>
        )}

        <StatusBar style={isDark ? 'light' : 'dark'} />
        </FadeIn>
      </ScrollView>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    scrollView: { flex: 1, backgroundColor: isDark ? '#070B14' : '#f3f7f6' },
    container: {
      paddingBottom: 40,
    },
    title: {
      fontSize: 26,
      fontWeight: '800',
      marginBottom: 20,
      color: isDark ? '#E6F4FF' : '#0f172a',
      letterSpacing: -0.4,
    },
    card: {
      backgroundColor: isDark ? '#0E1624' : '#fff',
      borderRadius: 18,
      padding: 18,
      marginBottom: 16,
      marginHorizontal: 16,
      borderWidth: 1,
      borderColor: isDark ? '#1E3350' : '#e2e8f0',
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '800',
      marginBottom: 8,
      color: isDark ? '#E6F4FF' : '#0f172a',
    },
    hint: {
      fontSize: 14,
      color: isDark ? '#8CA0BC' : '#64748b',
      marginBottom: 12,
    },
    timeAgo: {
      fontSize: 13,
      color: isDark ? '#8CA0BC' : '#64748b',
    },
    historyRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
    },
    historyValue: { fontSize: 16, fontWeight: '600' },
    historyTime: { fontSize: 13, color: isDark ? '#8CA0BC' : '#64748b' },
    button: {
      backgroundColor: '#0891B2',
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 14,
      alignSelf: 'flex-start',
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
    buttonSecondary: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      alignSelf: 'flex-start',
    },
    buttonSecondaryText: {
      color: '#0891B2',
      fontSize: 14,
      fontWeight: '700',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 16,
      flexWrap: 'wrap',
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    deleteAction: {
      backgroundColor: '#E57373',
      justifyContent: 'center',
      minWidth: 80,
    },
    message: {
      fontSize: 16,
      color: isDark ? '#8CA0BC' : '#64748b',
      textAlign: 'center',
    },
  });

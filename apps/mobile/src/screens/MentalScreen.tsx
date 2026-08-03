import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  useColorScheme,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  fetchCaffeineLogs,
  fetchDashboard,
  fetchStressLogs,
} from '../api/client';
import { syncActivityToCloud } from '../activityCloudSync';

type Dash = any;

export default function MentalScreen() {
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const t = styles(isDark);
  const [data, setData] = useState<Dash | null>(null);
  const [caffeine, setCaffeine] = useState<any[]>([]);
  const [stress, setStress] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await syncActivityToCloud().catch(() => undefined);
      const [dash, caf, str] = await Promise.all([
        fetchDashboard(),
        fetchCaffeineLogs(),
        fetchStressLogs(),
      ]);
      setData(dash);
      setCaffeine(Array.isArray(caf) ? caf.slice(0, 14) : []);
      setStress(Array.isArray(str) ? str.slice(0, 14) : []);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const checkIn = data?.todayDayCheckIn;
  const energy = data?.todayEnergyScore;
  const todayCaf = data?.todayCaffeineLogs || [];
  const todayMg = data?.todayCaffeineMg ?? 0;
  const samsungStress = (data?.todayStressLogs || []).find(
    (s: any) => s.source === 'samsung_energy'
  );
  const manualStress = (data?.todayStressLogs || []).filter(
    (s: any) => s.source !== 'samsung_energy'
  );

  return (
    <View style={t.root}>
      <ScrollView
        contentContainerStyle={[t.content, { paddingTop: insets.top + 12, paddingBottom: 120 }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#0d9488" />}
      >
        <Text style={t.title}>Mental</Text>
        <Text style={t.sub}>
          Mood, ADHD check-in, caffeine, and Samsung Energy Score (continuous stress isn’t exposed to
          third-party apps — Energy Score is the readiness proxy).
        </Text>

        {loading && !data ? <ActivityIndicator style={{ marginTop: 24 }} color="#0d9488" /> : null}

        <View style={t.statGrid}>
          <View style={t.stat}>
            <Text style={t.statLabel}>Energy Score</Text>
            <Text style={t.statValue}>{energy != null ? Math.round(energy) : '—'}</Text>
            <Text style={t.statFoot}>Samsung Health</Text>
          </View>
          <View style={t.stat}>
            <Text style={t.statLabel}>Caffeine</Text>
            <Text style={t.statValue}>{todayMg || '—'}</Text>
            <Text style={t.statFoot}>{todayMg ? `${todayCaf.length} drink(s) · mg` : 'Use + → Caffeine'}</Text>
          </View>
        </View>

        <View style={t.card}>
          <Text style={t.cardTitle}>Today’s check-in</Text>
          {!checkIn ? (
            <Text style={t.line}>No check-in yet. Use + → Check-in (mood, wake, ADHD).</Text>
          ) : (
            <>
              <Text style={t.rowTitle}>
                Mood {checkIn.moodLabel || checkIn.mood} · woke {checkIn.wakeQualityLabel || checkIn.wakeQuality}
              </Text>
              <Text style={t.line}>
                Focus {checkIn.focusLabel || checkIn.focus || '—'} · restlessness{' '}
                {checkIn.restlessnessLabel || checkIn.restlessness || '—'} · overwhelm{' '}
                {checkIn.overwhelmLabel || checkIn.overwhelm || '—'}
              </Text>
              <Text style={t.line}>
                Task start {checkIn.taskInitiationLabel || checkIn.taskInitiation || '—'} · impulsivity{' '}
                {checkIn.impulsivityLabel || checkIn.impulsivity || '—'}
              </Text>
              <Text style={t.line}>
                {[
                  checkIn.medicationTaken ? 'Meds taken' : null,
                  checkIn.hyperfocus ? 'Hyperfocus' : null,
                  checkIn.sleepHours != null ? `Sleep ${checkIn.sleepHours}h` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No meds / hyperfocus / sleep logged'}
              </Text>
              {checkIn.notes ? <Text style={t.line}>{checkIn.notes}</Text> : null}
            </>
          )}
        </View>

        <View style={t.card}>
          <Text style={t.cardTitle}>Stress today</Text>
          {samsungStress ? (
            <Text style={t.line}>
              Samsung Energy → {samsungStress.levelLabel || samsungStress.level}
              {samsungStress.score != null ? ` (${samsungStress.score})` : ''}
            </Text>
          ) : (
            <Text style={t.line}>Sync Activity to pull Samsung Energy Score.</Text>
          )}
          {manualStress.length === 0 ? (
            <Text style={t.line}>No manual stress logs. Use + → Stress.</Text>
          ) : (
            manualStress.map((s: any) => (
              <Text key={s.id} style={t.line}>
                {s.levelLabel || s.level}
                {s.score != null ? ` (${s.score})` : ''}
                {s.notes ? ` · ${s.notes}` : ''}
              </Text>
            ))
          )}
        </View>

        <View style={t.card}>
          <Text style={t.cardTitle}>Caffeine today</Text>
          {todayCaf.length === 0 ? (
            <Text style={t.line}>Nothing logged. Espresso, coffee, tea…</Text>
          ) : (
            todayCaf.map((c: any) => (
              <Text key={c.id} style={t.line}>
                {c.drinkLabel || c.drink}
                {c.time ? ` @ ${c.time}` : ''} · {c.caffeineMg} mg
              </Text>
            ))
          )}
        </View>

        <View style={t.card}>
          <Text style={t.cardTitle}>Recent stress</Text>
          {stress.length === 0 ? (
            <Text style={t.line}>No stress entries yet.</Text>
          ) : (
            stress.slice(0, 8).map((s: any) => (
              <Text key={s.id} style={t.line}>
                {s.date} · {s.levelLabel || s.level}
                {s.score != null ? ` (${s.score})` : ''}
                {s.source === 'samsung_energy' ? ' · Samsung' : ''}
              </Text>
            ))
          )}
        </View>

        <View style={t.card}>
          <Text style={t.cardTitle}>Recent caffeine</Text>
          {caffeine.length === 0 ? (
            <Text style={t.line}>No caffeine entries yet.</Text>
          ) : (
            caffeine.slice(0, 10).map((c: any) => (
              <Text key={c.id} style={t.line}>
                {c.date} · {c.drinkLabel || c.drink} · {c.caffeineMg} mg
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function styles(isDark: boolean) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { paddingHorizontal: 16 },
    title: { fontSize: 28, fontWeight: '700', color: isDark ? '#e6edf3' : '#111' },
    sub: { marginTop: 6, fontSize: 13, lineHeight: 18, color: isDark ? '#8b949e' : '#6b7280' },
    statGrid: { flexDirection: 'row', gap: 10, marginTop: 16 },
    stat: {
      flex: 1,
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: isDark ? '#21262d' : '#e5e7eb',
    },
    statLabel: { fontSize: 12, color: isDark ? '#8b949e' : '#6b7280', fontWeight: '600' },
    statValue: { marginTop: 6, fontSize: 26, fontWeight: '700', color: isDark ? '#e6edf3' : '#111' },
    statFoot: { marginTop: 4, fontSize: 11, color: isDark ? '#6e7681' : '#9ca3af' },
    card: {
      marginTop: 12,
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: isDark ? '#21262d' : '#e5e7eb',
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: isDark ? '#e6edf3' : '#111', marginBottom: 8 },
    rowTitle: { fontSize: 15, fontWeight: '600', color: isDark ? '#e6edf3' : '#111', marginBottom: 4 },
    line: { fontSize: 13, color: isDark ? '#9aa4b2' : '#4b5563', marginBottom: 4, lineHeight: 18 },
  });
}

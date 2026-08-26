import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  useColorScheme,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchCaffeineLogs,
  fetchDashboard,
  fetchStressLogs,
} from '../api/client';
import { syncActivityToCloud } from '../activityCloudSync';
import { openMorningLog } from '../navigation';
import ScreenHero from '../components/ui/ScreenHero';
import { FadeIn } from '../components/ui/FadeIn';
import { HC, themeColors } from '../theme';

type Dash = any;

export default function MentalScreen() {
  const isDark = useColorScheme() === 'dark';
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
        contentContainerStyle={t.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={HC.teal} />}
      >
        <ScreenHero
          eyebrow="MIND & ENERGY"
          title="Mental"
          subtitle="Mood, ADHD check-in, caffeine, and Samsung Energy Score."
          pills={['Mood', 'Stress', 'Caffeine']}
          compact
        >
          <TouchableOpacity style={t.morningBtn} onPress={openMorningLog} activeOpacity={0.85}>
            <Text style={t.morningBtnText}>Morning log — weight + check-in</Text>
          </TouchableOpacity>
        </ScreenHero>

        {loading && !data ? <ActivityIndicator style={{ marginTop: 8 }} color={HC.teal} /> : null}

        <FadeIn>
          <View style={t.statGrid}>
            <View style={t.stat}>
              <Text style={t.statLabel}>Energy Score</Text>
              <Text style={t.statValue}>{energy != null ? Math.round(energy) : '—'}</Text>
              <Text style={t.statFoot}>Samsung Health</Text>
            </View>
            <View style={t.stat}>
              <Text style={t.statLabel}>Caffeine</Text>
              <Text style={t.statValue}>{todayMg || '—'}</Text>
              <Text style={t.statFoot}>
                {todayMg ? `${todayCaf.length} drink(s) · mg` : 'Use + → Caffeine'}
              </Text>
            </View>
          </View>
        </FadeIn>

        <FadeIn delay={80}>
          <View style={t.card}>
            <Text style={t.cardTitle}>Today’s check-in</Text>
            {!checkIn ? (
              <Text style={t.line}>No check-in yet. Use + → Check-in (mood, wake, ADHD).</Text>
            ) : (
              <>
                <Text style={t.rowTitle}>
                  Mood {checkIn.moodLabel || checkIn.mood} · woke{' '}
                  {checkIn.wakeQualityLabel || checkIn.wakeQuality}
                </Text>
                <Text style={t.line}>
                  Focus {checkIn.focusLabel || checkIn.focus || '—'} · restlessness{' '}
                  {checkIn.restlessnessLabel || checkIn.restlessness || '—'} · overwhelm{' '}
                  {checkIn.overwhelmLabel || checkIn.overwhelm || '—'}
                </Text>
                <Text style={t.line}>
                  Task start {checkIn.taskInitiationLabel || checkIn.taskInitiation || '—'} ·
                  impulsivity {checkIn.impulsivityLabel || checkIn.impulsivity || '—'}
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
        </FadeIn>

        <FadeIn delay={120}>
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
        </FadeIn>

        <FadeIn delay={160}>
          <View style={t.card}>
            <Text style={t.cardTitle}>Caffeine today</Text>
            {todayCaf.length === 0 ? (
              <Text style={t.line}>Nothing logged. Espresso, coffee, tea…</Text>
            ) : (
              todayCaf.map((caf: any) => (
                <Text key={caf.id} style={t.line}>
                  {caf.drinkLabel || caf.drink}
                  {caf.time ? ` @ ${caf.time}` : ''} · {caf.caffeineMg} mg
                </Text>
              ))
            )}
          </View>
        </FadeIn>

        <FadeIn delay={200}>
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
        </FadeIn>

        <FadeIn delay={240}>
          <View style={t.card}>
            <Text style={t.cardTitle}>Recent caffeine</Text>
            {caffeine.length === 0 ? (
              <Text style={t.line}>No caffeine entries yet.</Text>
            ) : (
              caffeine.slice(0, 10).map((caf: any) => (
                <Text key={caf.id} style={t.line}>
                  {caf.date} · {caf.drinkLabel || caf.drink} · {caf.caffeineMg} mg
                </Text>
              ))
            )}
          </View>
        </FadeIn>
      </ScrollView>
    </View>
  );
}

function styles(isDark: boolean) {
  const c = themeColors(isDark);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    content: { paddingBottom: 120 },
    morningBtn: {
      marginTop: 8,
      backgroundColor: '#fff',
      borderRadius: HC.radius.md,
      paddingVertical: 14,
      paddingHorizontal: 14,
      alignItems: 'center',
    },
    morningBtnText: { color: HC.tealDeep, fontWeight: '800', fontSize: 15 },
    statGrid: { flexDirection: 'row', gap: 10, marginTop: 4, paddingHorizontal: 16 },
    stat: {
      flex: 1,
      backgroundColor: c.card,
      borderRadius: HC.radius.lg,
      padding: 14,
      borderWidth: 1,
      borderColor: c.border,
    },
    statLabel: { fontSize: 11, color: c.muted, fontWeight: '800', textTransform: 'uppercase' },
    statValue: { marginTop: 6, fontSize: 26, fontWeight: '800', color: c.ink },
    statFoot: { marginTop: 4, fontSize: 11, color: c.muted },
    card: {
      marginTop: 12,
      marginHorizontal: 16,
      backgroundColor: c.card,
      borderRadius: HC.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardTitle: { fontSize: 16, fontWeight: '800', color: c.ink, marginBottom: 8 },
    rowTitle: { fontSize: 15, fontWeight: '700', color: c.ink, marginBottom: 4 },
    line: { fontSize: 13, color: c.muted, marginBottom: 4, lineHeight: 18 },
  });
}

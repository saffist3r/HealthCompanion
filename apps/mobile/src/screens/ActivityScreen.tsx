import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  useColorScheme,
  ActivityIndicator,
  Platform,
  Image,
  DeviceEventEmitter,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  toDateKey,
  type CareVisit,
  type CareVisitKind,
  type Injury,
  type SportMatch,
} from '@health-companion/shared';
import {
  deleteCareVisit,
  deleteSportMatch,
  fetchCareVisits,
  fetchInjuries,
  fetchSportMatches,
  syncActivity,
  updateInjury,
} from '../api/client';
import { getAccessToken } from '../api/auth';
import {
  getHealthConnectStatus,
  openHealthConnectApp,
  openHealthConnectData,
  openSamsungHealth,
  readTodayActivity,
  requestHealthPermissions,
  type ActivitySnapshot,
  type HealthConnectStatus,
} from '../healthConnect';
import {
  connectSamsungHealth,
  isSamsungHealthAvailable,
} from '../samsungHealth';
import { AppIcons, careKindIcon, sportSessionIcon } from '../ui/appIcons';

export default function ActivityScreen() {
  const isDark = useColorScheme() === 'dark';
  const [status, setStatus] = useState<HealthConnectStatus>('unavailable');
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [samsungOk, setSamsungOk] = useState(false);
  const [careVisits, setCareVisits] = useState<CareVisit[]>([]);
  const [matches, setMatches] = useState<SportMatch[]>([]);
  const [injuries, setInjuries] = useState<Injury[]>([]);
  const t = styles(isDark);
  const today = toDateKey(Date.now());

  const pushToCloud = useCallback(async (opts?: { silent?: boolean }) => {
    if (!(await getAccessToken())) {
      if (!opts?.silent) Alert.alert('Sign in required', 'Sign in first.');
      return false;
    }
    try {
      const data = await readTodayActivity();
      if (!data.stepsSource && data.steps <= 0 && data.energyScore == null) {
        if (!opts?.silent) {
          Alert.alert('Nothing to sync', 'Connect Samsung Health and wait for steps to load.');
        }
        return false;
      }
      await syncActivity({
        date: data.date,
        steps: data.steps,
        caloriesBurned: data.caloriesBurned,
        workouts: data.workouts,
        source: data.stepsSource || 'health_connect',
        energyScore: data.energyScore,
      });
      if (!opts?.silent) {
        const via =
          data.stepsSource === 'samsung_health'
            ? ' via Samsung Health'
            : data.stepsSource === 'watch'
              ? ' via watch'
              : data.stepsSource === 'health_connect'
                ? ' via Health Connect'
                : '';
        Alert.alert(
          'Synced to reports',
          [
            data.steps > 0 ? `Sent ${data.steps.toLocaleString()} steps${via}` : null,
            data.energyScore != null
              ? `Energy Score ${Math.round(data.energyScore)}${
                  data.energyScoreDate ? ` (${data.energyScoreDate})` : ''
                }`
              : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Activity synced. Open Reports to refresh.'
        );
      }
      return true;
    } catch (e) {
      if (!opts?.silent) Alert.alert('Sync failed', String(e));
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const token = Boolean(await getAccessToken());
      setLoggedIn(token);
      setSamsungOk(await isSamsungHealthAvailable());
      const st = await getHealthConnectStatus();
      setStatus(st);
      const snap = await readTodayActivity();
      setSnapshot(snap);
      if (token) {
        const [care, sport, openInjuries] = await Promise.all([
          fetchCareVisits(today),
          fetchSportMatches(today),
          fetchInjuries('open'),
        ]);
        setCareVisits(care);
        setMatches(sport);
        setInjuries(openInjuries);
        // Keep reports up to date whenever Activity loads Samsung/HC data.
        if (snap.stepsSource || snap.energyScore != null || snap.steps > 0) {
          await pushToCloud({ silent: true });
        }
      }
    } catch (e) {
      Alert.alert('Activity', String(e));
    } finally {
      setBusy(false);
    }
  }, [today, pushToCloud]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('entry-saved', () => {
      refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const connectHc = async () => {
    setBusy(true);
    try {
      await requestHealthPermissions();
      await refresh();
    } catch (e) {
      Alert.alert('Health Connect', String(e));
    } finally {
      setBusy(false);
    }
  };

  const connectSamsung = async () => {
    setBusy(true);
    try {
      const ok = await connectSamsungHealth();
      if (!ok) {
        Alert.alert(
          'Samsung Health',
          'Could not connect. In Samsung Health: Settings → About → tap version 10+ times → Developer Mode (Samsung Health Data SDK) → enable Developer Mode for Data Read.'
        );
        return;
      }
      const snap = await readTodayActivity();
      setSnapshot(snap);
      const synced = await pushToCloud({ silent: true });
      if (synced) {
        Alert.alert(
          'Samsung Health',
          snap.steps > 0
            ? `Connected and synced ${snap.steps.toLocaleString()} steps to reports.`
            : 'Connected and synced. Open Reports to see activity.'
        );
      } else if (await getAccessToken()) {
        Alert.alert('Samsung Health', 'Connected. Tap “Sync today to reports” if data does not appear.');
      } else {
        Alert.alert('Samsung Health', 'Connected. Sign in, then sync to see data in reports.');
      }
      await refresh();
    } catch (e) {
      Alert.alert('Samsung Health', String(e).replace(/^Error:\s*/i, ''));
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel =
    snapshot?.stepsSource === 'samsung_health'
      ? 'Samsung Health'
      : snapshot?.stepsSource === 'watch'
        ? 'watch'
        : snapshot?.stepsSource === 'health_connect'
          ? 'Health Connect'
          : null;

  return (
    <ScrollView
      style={t.root}
      contentContainerStyle={t.content}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} />}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={t.title}>Activity</Text>
      <Text style={t.hint}>Use + to log meals, weight, injuries, care visits, or sport. Energy score comes from Samsung Health.</Text>

      {Platform.OS !== 'android' ? (
        <Text style={t.empty}>Activity sync is Android-only.</Text>
      ) : (
        <>
          <View style={t.card}>
            <Text style={t.label}>Status</Text>
            <Text style={t.value}>
              HC {status}
              {samsungOk ? ' · Samsung ready' : ' · Samsung not linked'}
              {loggedIn ? ' · signed in' : ' · not signed in'}
            </Text>
            {busy ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
          </View>

          <TouchableOpacity style={t.btn} onPress={connectSamsung}>
            <View style={t.btnInner}>
              <Image source={AppIcons.samsung} style={t.btnIcon} />
              <Text style={t.btnText}>Connect Samsung Health</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={t.btnSecondary} onPress={connectHc}>
            <Text style={t.btnTextDark}>Connect Health Connect</Text>
          </TouchableOpacity>

          <View style={t.card}>
            <View style={t.sectionHead}>
              <Image source={AppIcons.steps} style={t.sectionIcon} />
              <Text style={t.label}>Today’s steps</Text>
            </View>
            <Text style={t.big}>
              {snapshot ? snapshot.steps.toLocaleString() : '—'}
            </Text>
            {snapshot ? (
              <>
                {sourceLabel ? (
                  <View style={t.sourceRow}>
                    {snapshot.stepsSource === 'samsung_health' ? (
                      <Image source={AppIcons.samsung} style={t.sourceIcon} />
                    ) : snapshot.stepsSource === 'watch' ? (
                      <Image source={AppIcons.watch} style={t.sourceIcon} />
                    ) : null}
                    <Text style={t.meta}>Via {sourceLabel}</Text>
                  </View>
                ) : null}
                {snapshot.heartRateBpm != null ? (
                  <Text style={t.meta}>Heart rate avg: {snapshot.heartRateBpm} bpm</Text>
                ) : null}
                {snapshot.caloriesBurned != null ? (
                  <Text style={t.meta}>{snapshot.caloriesBurned} active kcal</Text>
                ) : null}
                {snapshot.energyScore != null ? (
                  <View style={t.sourceRow}>
                    <Image source={AppIcons.samsung} style={t.sourceIcon} />
                    <Text style={t.meta}>
                      Energy score: {Math.round(snapshot.energyScore)}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}
            {snapshot?.warning ? <Text style={t.warn}>{snapshot.warning}</Text> : null}
          </View>

          <View style={t.card}>
            <View style={t.sectionHead}>
              <Image source={AppIcons.samsung} style={t.sectionIcon} />
              <Text style={t.label}>Energy score</Text>
            </View>
            {snapshot?.energyScore != null ? (
              <>
                <Text style={t.big}>{Math.round(snapshot.energyScore)}</Text>
                <View style={t.sourceRow}>
                  <Image source={AppIcons.samsung} style={t.sourceIcon} />
                  <Text style={t.meta}>
                    Samsung Health
                    {snapshot.energyScoreDate ? ` · ${snapshot.energyScoreDate}` : ''}
                  </Text>
                </View>
              </>
            ) : (
              <Text style={t.meta}>
                {snapshot?.energyScoreNote ||
                  'Connect Samsung Health and allow Energy Score. Then tap Sync today to reports.'}
              </Text>
            )}
          </View>

          {(snapshot?.workouts?.length || 0) > 0 ? (
            <View style={t.card}>
              <Text style={t.label}>Workouts</Text>
              {snapshot!.workouts.map((w, i) => (
                <Text key={i} style={t.value}>
                  {w.name} · {w.durationMin} min
                </Text>
              ))}
            </View>
          ) : null}

          <TouchableOpacity
            style={t.btnSecondary}
            onPress={async () => {
              setBusy(true);
              try {
                await pushToCloud();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            <Text style={t.btnTextDark}>Sync today to reports</Text>
          </TouchableOpacity>

          {injuries.length > 0 ? (
            <View style={t.card}>
              <Text style={t.label}>Open injuries</Text>
              {injuries.map((inj) => (
                <View key={inj.id} style={t.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={t.value}>
                      {inj.title || inj.bodyAreaLabel || inj.injuryType}
                      {inj.todayPain
                        ? ` · pain ${inj.todayPain.painScore}/10`
                        : inj.latestPain
                          ? ` · last ${inj.latestPain.painScore}/10`
                          : ''}
                    </Text>
                    <Text style={t.meta}>
                      Since {inj.startedOn}
                      {inj.exerciseNotes ? ` · ${inj.exerciseNotes.slice(0, 60)}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        await updateInjury(inj.id, {
                          status: 'healed',
                          healedOn: today,
                        });
                        await refresh();
                      } catch (e) {
                        Alert.alert('Injury', String(e));
                      }
                    }}
                  >
                    <Text style={t.delete}>Healed</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

          {(careVisits.length > 0 || matches.length > 0) && (
            <View style={t.card}>
              <Text style={t.label}>Today’s log</Text>
              {careVisits.map((v) => (
                <View key={v.id} style={t.row}>
                  <Image
                    source={careKindIcon((v.kind as CareVisitKind) || 'other')}
                    style={t.rowIcon}
                  />
                  <Text style={t.value}>
                    {v.kindLabel || v.kind}
                    {v.label ? ` · ${v.label}` : ''}
                    {v.notes ? ` — ${v.notes}` : ''}
                  </Text>
                  <TouchableOpacity
                    onPress={async () => {
                      await deleteCareVisit(v.id);
                      await refresh();
                    }}
                  >
                    <Text style={t.delete}>Delete</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {matches.map((m) => (
                <View key={m.id} style={t.row}>
                  <Image
                    source={sportSessionIcon(m.sport, m.result)}
                    style={t.rowIcon}
                  />
                  <Text style={t.value}>
                    Padel {m.result}
                    {m.score ? ` · ${m.score}` : ''}
                    {m.durationMin != null ? ` · ${m.durationMin} min` : ''}
                    {m.time ? ` · ${m.time}` : ''}
                  </Text>
                  <TouchableOpacity
                    onPress={async () => {
                      await deleteSportMatch(m.id);
                      await refresh();
                    }}
                  >
                    <Text style={t.delete}>Delete</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity style={t.btnSecondary} onPress={() => openHealthConnectData()}>
            <Text style={t.btnTextDark}>Health Connect data</Text>
          </TouchableOpacity>
          <TouchableOpacity style={t.btnSecondary} onPress={() => openHealthConnectApp()}>
            <Text style={t.btnTextDark}>Health Connect permissions</Text>
          </TouchableOpacity>
          <TouchableOpacity style={t.btnSecondary} onPress={() => openSamsungHealth()}>
            <View style={t.btnInner}>
              <Image source={AppIcons.samsung} style={t.btnIcon} />
              <Text style={t.btnTextDark}>Open Samsung Health app</Text>
            </View>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { padding: 16, paddingBottom: 100 },
    title: { fontSize: 24, fontWeight: '700', color: isDark ? '#fff' : '#111', marginBottom: 6 },
    hint: { color: isDark ? '#8b949e' : '#666', marginBottom: 16, fontSize: 13 },
    empty: { color: isDark ? '#8b949e' : '#666' },
    card: {
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
    },
    label: { color: isDark ? '#8b949e' : '#666', fontSize: 13, marginBottom: 6 },
    value: { marginTop: 4, color: isDark ? '#e6edf3' : '#222', flex: 1 },
    meta: { marginTop: 4, fontSize: 13, color: isDark ? '#8b949e' : '#666' },
    sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
    sourceIcon: { width: 16, height: 16, borderRadius: 4 },
    big: { fontSize: 36, fontWeight: '700', color: isDark ? '#7ee787' : '#0f766e', marginTop: 4 },
    warn: { marginTop: 8, color: '#d97706', fontSize: 13 },
    btn: {
      backgroundColor: '#0d9488',
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: 10,
    },
    btnSecondary: {
      backgroundColor: isDark ? '#21262d' : '#e5e7eb',
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: 10,
    },
    btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    btnIcon: { width: 22, height: 22, borderRadius: 6 },
    btnText: { color: '#fff', fontWeight: '700' },
    btnTextDark: { color: isDark ? '#e6edf3' : '#111', fontWeight: '600' },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    sectionIcon: { width: 28, height: 28, borderRadius: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    rowIcon: { width: 28, height: 28, borderRadius: 8 },
    delete: { color: '#ef4444', fontWeight: '600', paddingHorizontal: 6 },
  });

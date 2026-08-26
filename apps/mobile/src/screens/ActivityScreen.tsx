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
  TextInput,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  toDateKey,
  type CareVisit,
  type CareVisitKind,
  type Injury,
  type SportMatch,
  type WorkoutPlan,
  type WorkoutPlanDraft,
} from '@health-companion/shared';
import {
  deleteCareVisit,
  deleteSportMatch,
  deleteWorkoutPlan,
  fetchCareVisits,
  fetchInjuries,
  fetchSportMatches,
  fetchWorkoutPlans,
  generateWorkout,
  saveWorkoutPlan,
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
import ScreenHero from '../components/ui/ScreenHero';
import { FadeIn } from '../components/ui/FadeIn';
import { HC, themeColors } from '../theme';

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
  const [workoutPlans, setWorkoutPlans] = useState<WorkoutPlan[]>([]);
  const [workoutNote, setWorkoutNote] = useState('');
  const [workoutDraft, setWorkoutDraft] = useState<WorkoutPlanDraft | null>(null);
  const [workoutBusy, setWorkoutBusy] = useState(false);
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
        const [care, sport, openInjuries, plans] = await Promise.all([
          fetchCareVisits(today),
          fetchSportMatches(today),
          fetchInjuries('open'),
          fetchWorkoutPlans(15),
        ]);
        setCareVisits(care);
        setMatches(sport);
        setInjuries(openInjuries);
        setWorkoutPlans(plans);
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
      refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={HC.teal} />}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHero
        eyebrow="MOVE & RECOVER"
        title="Activity"
        subtitle="Steps, Samsung Energy, workouts, care visits, and sport."
        pills={['Steps', 'Sport', 'Care', 'Workouts']}
        compact
      />

      {Platform.OS !== 'android' ? (
        <Text style={t.empty}>Activity sync is Android-only.</Text>
      ) : (
        <FadeIn>
        <>
          <View style={t.card}>
            <Text style={t.label}>Status</Text>
            <Text style={t.value}>
              HC {status}
              {samsungOk ? ' · Samsung ready' : ' · Samsung not linked'}
              {loggedIn ? ' · signed in' : ' · not signed in'}
            </Text>
            {busy ? <ActivityIndicator style={{ marginTop: 8 }} color={HC.teal} /> : null}
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

          <View style={t.card}>
            <Text style={t.label}>Suggest workout</Text>
            <Text style={t.meta}>
              Uses recent sport, activity, and open injuries. Not medical advice.
            </Text>
            <TextInput
              style={t.input}
              placeholder="Optional: legs, padel recovery, 45 min gym…"
              placeholderTextColor={isDark ? '#6e7681' : '#999'}
              value={workoutNote}
              onChangeText={setWorkoutNote}
            />
            <TouchableOpacity
              style={[t.btn, (workoutBusy || !loggedIn) && { opacity: 0.5 }]}
              disabled={workoutBusy || !loggedIn}
              onPress={async () => {
                if (!loggedIn) {
                  Alert.alert('Sign in required', 'Sign in to generate workouts.');
                  return;
                }
                setWorkoutBusy(true);
                try {
                  const res = await generateWorkout(workoutNote.trim() || undefined);
                  setWorkoutDraft(res.plan);
                } catch (e) {
                  const msg = String(e);
                  Alert.alert(
                    'Workout failed',
                    msg.includes('busy') || msg.includes('503')
                      ? 'AI is busy right now. Wait a few seconds and try again.'
                      : msg
                  );
                } finally {
                  setWorkoutBusy(false);
                }
              }}
            >
              {workoutBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={t.btnText}>Suggest workout with AI</Text>
              )}
            </TouchableOpacity>

            {workoutDraft ? (
              <View style={t.workoutDraft}>
                <Text style={t.value}>{workoutDraft.title}</Text>
                {workoutDraft.focus ? <Text style={t.meta}>Focus: {workoutDraft.focus}</Text> : null}
                {workoutDraft.durationMin ? (
                  <Text style={t.meta}>~{workoutDraft.durationMin} min</Text>
                ) : null}
                {workoutDraft.summary ? <Text style={t.meta}>{workoutDraft.summary}</Text> : null}
                {workoutDraft.exercises.map((ex, i) => (
                  <Text key={i} style={t.meta}>
                    · {ex.name}
                    {ex.sets ? ` · ${ex.sets} sets` : ''}
                    {ex.reps ? ` · ${ex.reps}` : ''}
                    {ex.durationMin ? ` · ${ex.durationMin} min` : ''}
                  </Text>
                ))}
                <View style={t.row}>
                  <TouchableOpacity
                    style={t.btnSecondary}
                    onPress={() => setWorkoutDraft(null)}
                  >
                    <Text style={t.btnTextDark}>Discard</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={t.btn}
                    onPress={async () => {
                      setWorkoutBusy(true);
                      try {
                        await saveWorkoutPlan({
                          title: workoutDraft.title,
                          focus: workoutDraft.focus,
                          durationMin: workoutDraft.durationMin,
                          summary: workoutDraft.summary,
                          exercises: workoutDraft.exercises,
                          basedOn: workoutDraft.basedOn,
                        });
                        setWorkoutDraft(null);
                        setWorkoutNote('');
                        await refresh();
                        Alert.alert('Saved', 'Workout plan saved to your archive.');
                      } catch (e) {
                        Alert.alert('Save failed', String(e));
                      } finally {
                        setWorkoutBusy(false);
                      }
                    }}
                  >
                    <Text style={t.btnText}>Save plan</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>

          {workoutPlans.length > 0 ? (
            <View style={t.card}>
              <Text style={t.label}>Saved workout plans</Text>
              {workoutPlans.map((plan) => (
                <View key={plan.id} style={t.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={t.value}>{plan.title}</Text>
                    <Text style={t.meta}>
                      {plan.focus ? `${plan.focus} · ` : ''}
                      {plan.durationMin ? `${plan.durationMin} min · ` : ''}
                      {plan.exercises.length} exercises
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        await deleteWorkoutPlan(plan.id);
                        await refresh();
                      } catch (e) {
                        Alert.alert('Delete failed', String(e));
                      }
                    }}
                  >
                    <Text style={t.delete}>Delete</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

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
        </FadeIn>
      )}
    </ScrollView>
  );
}

const styles = (isDark: boolean) => {
  const c = themeColors(isDark);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    content: { paddingBottom: 100 },
    title: { fontSize: 24, fontWeight: '700', color: c.ink, marginBottom: 6 },
    hint: { color: c.muted, marginBottom: 16, fontSize: 13 },
    empty: { color: c.muted, paddingHorizontal: 16, marginTop: 8 },
    card: {
      backgroundColor: c.card,
      borderRadius: HC.radius.lg,
      padding: 16,
      marginBottom: 12,
      marginHorizontal: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    label: {
      color: c.muted,
      fontSize: 12,
      marginBottom: 6,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    value: { marginTop: 4, color: c.ink, flex: 1 },
    meta: { marginTop: 4, fontSize: 13, color: c.muted },
    sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
    sourceIcon: { width: 16, height: 16, borderRadius: 4 },
    big: { fontSize: 36, fontWeight: '800', color: isDark ? '#7ee787' : HC.tealMid, marginTop: 4 },
    warn: { marginTop: 8, color: HC.amber, fontSize: 13 },
    btn: {
      backgroundColor: HC.teal,
      borderRadius: HC.radius.md,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: 10,
      marginHorizontal: 16,
    },
    btnSecondary: {
      backgroundColor: isDark ? '#21262d' : '#e2e8f0',
      borderRadius: HC.radius.md,
      paddingVertical: 14,
      alignItems: 'center',
      marginBottom: 10,
      marginHorizontal: 16,
    },
    btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    btnIcon: { width: 22, height: 22, borderRadius: 6 },
    btnText: { color: '#fff', fontWeight: '800' },
    btnTextDark: { color: c.ink, fontWeight: '700' },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    sectionIcon: { width: 28, height: 28, borderRadius: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    rowIcon: { width: 28, height: 28, borderRadius: 8 },
    delete: { color: '#ef4444', fontWeight: '700', paddingHorizontal: 6 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      padding: 10,
      marginTop: 8,
      marginBottom: 10,
      color: c.ink,
      backgroundColor: isDark ? '#0d1117' : '#fff',
    },
    workoutDraft: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: c.border,
      gap: 4,
    },
  });
};

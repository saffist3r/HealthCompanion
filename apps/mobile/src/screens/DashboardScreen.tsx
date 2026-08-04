import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Image,
  useColorScheme,
  ActivityIndicator,
  Alert,
  Share,
  type ImageSourcePropType,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { absoluteUploadUrl, fetchDashboard } from '../api/client';
import { syncActivityToCloud } from '../activityCloudSync';
import MealDetailModal from '../components/MealDetailModal';
import { AppIcons } from '../ui/appIcons';
import { maybeNudgeSiteChange } from '../pushNudges';

type Dash = any;

function formatEpisodeTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function episodeContextBlurb(context: any): string | null {
  if (!context) return null;
  const bits: string[] = [];
  const meals = context.meals || [];
  if (meals.length) {
    const m = meals[meals.length - 1];
    bits.push(`${m.mealType || 'meal'} (${Math.round(m.carbsG || 0)}g carbs)`);
  }
  const caffeine = context.caffeine || [];
  if (caffeine.length) bits.push(`${caffeine.length} caffeine log(s)`);
  const sports = context.sports || [];
  if (sports.length) bits.push(`${sports[0].sport || 'sport'}`);
  const pump = context.pump || [];
  const insulin = pump.filter((p: any) => p.kind === 'insulin_delivered');
  if (insulin.length) bits.push(`${insulin.length} bolus event(s)`);
  return bits.length ? bits.join(' · ') : null;
}

function StatCard({
  label,
  value,
  unit,
  foot,
  footIcon,
  warn,
  t,
}: {
  label: string;
  value: string | number;
  unit?: string;
  foot?: string;
  footIcon?: ImageSourcePropType;
  warn?: boolean;
  t: ReturnType<typeof styles>;
}) {
  return (
    <View style={[t.statCard, warn ? t.statWarn : null]}>
      <Text style={t.statLabel}>{label}</Text>
      <Text style={t.statValue}>
        {value}
        {unit ? <Text style={t.statUnit}> {unit}</Text> : null}
      </Text>
      {foot || footIcon ? (
        <View style={t.statFootRow}>
          {footIcon ? <Image source={footIcon} style={t.statFootIcon} /> : null}
          {foot ? <Text style={t.statFoot}>{foot}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

export default function DashboardScreen() {
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const t = styles(isDark);
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMeal, setSelectedMeal] = useState<any | null>(null);
  const [mealPhotos, setMealPhotos] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await syncActivityToCloud().catch(() => false);
      const dash = await fetchDashboard();
      setData(dash);
      const urls: Record<string, string> = {};
      for (const m of dash.recentMeals || []) {
        const u = await absoluteUploadUrl(m.photoUrl);
        if (u && m.id) urls[m.id] = u;
      }
      setMealPhotos(urls);
      if (dash.deviceCare) void maybeNudgeSiteChange(dash.deviceCare);
    } catch (e) {
      Alert.alert('Dashboard', String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const tir = data?.timeInRangePct;
  const energyScore = data?.todayEnergyScore ?? data?.sports?.todayEnergyScore ?? null;
  const fromSamsung = data?.todayActivitySource === 'samsung_health';
  const activityFoot =
    data?.todayActivitySource === 'samsung_health'
      ? 'Samsung Health'
      : data?.todayActivitySource === 'watch'
        ? 'Watch'
        : data?.todayActivitySource === 'health_connect'
          ? 'Health Connect'
          : data?.todayActivitySource || 'Activity sync';
  const activityFootIcon =
    data?.todayActivitySource === 'samsung_health'
      ? AppIcons.samsung
      : data?.todayActivitySource === 'watch'
        ? AppIcons.watch
        : undefined;
  const intakeKcal = Math.round(data?.todayCaloriesKcal || 0);
  const targetKcal = data?.calorieTargets?.targetKcal;
  const remaining =
    data?.calorieBalance?.remainingToTarget != null
      ? Math.round(data.calorieBalance.remainingToTarget)
      : targetKcal != null
        ? Math.round(targetKcal - intakeKcal)
        : null;
  const hypos = data?.todayHypoEventCount ?? 0;
  const insulin = data?.todayInsulinDeliveredU ?? 0;
  const pumpEvents = data?.todayPumpEvents || [];
  const meals = data?.recentMeals || [];
  const workouts = data?.todayWorkouts || [];
  const matches = data?.todaySportMatches || [];
  const care = data?.todayCareVisits || [];
  const injuries = data?.todayInjuries || [];
  const checkIn = data?.todayDayCheckIn || null;
  const insights = [
    ...(data?.dailyReport?.insights || []),
    ...((data?.weeklyReport?.insights || []).slice(0, 2) as string[]),
  ];
  const warnings = data?.dailyReport?.warnings || [];
  const streak = data?.mealLogStreak ?? 0;
  const overnight = data?.overnight;
  const deviceCare = data?.deviceCare;
  const plotTwists: string[] = data?.plotTwists || [];
  const directorsCut: string | undefined = data?.directorsCut;
  const hypoEvents: any[] = data?.todayHypoEvents || [];
  const hyperEvents: any[] = data?.todayHyperEvents || [];

  const shareDirectorsCut = async () => {
    if (!directorsCut) return;
    try {
      await Share.share({ message: directorsCut, title: "Director's cut" });
    } catch {
      /* user cancelled */
    }
  };

  return (
    <View style={t.root}>
      <ScrollView
        contentContainerStyle={[t.content, { paddingTop: insets.top + 12, paddingBottom: 120 }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#0d9488" />}
      >
        <Text style={t.title}>Today</Text>
        <Text style={t.sub}>Glucose, meals, pump & activity — pull to refresh</Text>

        {loading && !data ? <ActivityIndicator style={{ marginTop: 24 }} color="#0d9488" /> : null}

        {data ? (
          <>
            <View style={t.statGrid}>
              <StatCard
                label="Avg glucose"
                value={data.glucoseAvgMgDl != null ? data.glucoseAvgMgDl : '—'}
                unit={data.glucoseAvgMgDl != null ? 'mg/dL' : undefined}
                foot="From CapAPS sync"
                t={t}
              />
              <StatCard
                label="Time in range"
                value={tir != null ? `${Math.round(tir)}%` : '—'}
                foot="Target 70–180"
                warn={tir != null && tir < 50}
                t={t}
              />
              <StatCard
                label="Calories"
                value={intakeKcal}
                unit="kcal"
                foot={
                  remaining == null
                    ? `${data.todayCarbsG ?? 0}g carbs`
                    : remaining >= 0
                      ? `${remaining} left · target ${targetKcal}`
                      : `${Math.abs(remaining)} over · target ${targetKcal}`
                }
                warn={remaining != null && remaining < 0}
                t={t}
              />
              <StatCard
                label="Steps"
                value={Number(data.todaySteps || 0).toLocaleString()}
                foot={activityFoot}
                footIcon={activityFootIcon}
                t={t}
              />
              <StatCard
                label="Energy"
                value={energyScore != null ? Math.round(energyScore) : '—'}
                foot={
                  energyScore != null
                    ? 'Samsung Health readiness'
                    : 'Auto-syncs from phone'
                }
                footIcon={energyScore != null || fromSamsung ? AppIcons.samsung : undefined}
                t={t}
              />
              <StatCard
                label="Hypos"
                value={hypos}
                foot={hypos > 0 ? 'Below 70 mg/dL' : 'None today'}
                warn={hypos > 0}
                t={t}
              />
              <StatCard
                label="Insulin"
                value={insulin}
                unit="U"
                foot={
                  (data.todayPumpEventCount || 0) > 0
                    ? `${data.todayPumpEventCount} pump event${data.todayPumpEventCount === 1 ? '' : 's'}`
                    : 'From CapAPS'
                }
                t={t}
              />
            </View>

            <View style={t.card}>
              <Text style={t.cardTitle}>Diabetes plot</Text>
              {streak > 0 ? (
                <Text style={t.plotLine}>
                  Meal log streak: {streak} day{streak === 1 ? '' : 's'} — the food diary remembers.
                </Text>
              ) : (
                <Text style={t.plotLine}>No meal streak yet. Log something edible and start the arc.</Text>
              )}
              {overnight?.blurb ? <Text style={t.plotLine}>{overnight.blurb}</Text> : null}
              {deviceCare ? (
                <Text style={t.plotLine}>
                  Cannula day {deviceCare.cannulaDay ?? '—'}
                  {deviceCare.siteChangeSuggested ? ' (site change vibes)' : ''}
                  {' · '}
                  Sensor day {deviceCare.sensorDay ?? '—'}
                  {deviceCare.sensorAging ? ' (aging sensor arc)' : ''}
                </Text>
              ) : null}
              {plotTwists.length > 0 ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={t.plotSubtitle}>Plot twists</Text>
                  {plotTwists.slice(0, 4).map((twist, i) => (
                    <Text key={i} style={t.plotLine}>
                      • {twist}
                    </Text>
                  ))}
                </View>
              ) : null}
              {directorsCut ? (
                <TouchableOpacity style={t.shareBtn} onPress={shareDirectorsCut}>
                  <Text style={t.shareBtnText}>Share director&apos;s cut</Text>
                </TouchableOpacity>
              ) : null}
              {(hypoEvents.length > 0 || hyperEvents.length > 0) && (
                <View style={{ marginTop: 8 }}>
                  <Text style={t.plotSubtitle}>Today&apos;s episodes</Text>
                  {hypoEvents.slice(0, 3).map((ev, i) => {
                    const ctx = episodeContextBlurb(ev.context);
                    return (
                      <Text key={`hypo-${i}`} style={[t.plotLine, t.plotHypo]}>
                        Hypo {formatEpisodeTime(ev.startedAt)} — min {ev.minMgDl} mg/dL
                        {ev.durationMin ? ` · ${ev.durationMin} min` : ''}
                        {ctx ? `\n  ${ctx}` : ''}
                      </Text>
                    );
                  })}
                  {hyperEvents.slice(0, 3).map((ev, i) => {
                    const ctx = episodeContextBlurb(ev.context);
                    return (
                      <Text key={`hyper-${i}`} style={[t.plotLine, t.plotHyper]}>
                        Hyper {formatEpisodeTime(ev.startedAt)} — peak {ev.maxMgDl} mg/dL
                        {ev.durationMin ? ` · ${ev.durationMin} min` : ''}
                        {ctx ? `\n  ${ctx}` : ''}
                      </Text>
                    );
                  })}
                </View>
              )}
            </View>

            {(insights.length > 0 || warnings.length > 0) && (
              <View style={t.card}>
                <Text style={t.cardTitle}>Insights</Text>
                {insights.slice(0, 6).map((i: string, idx: number) => (
                  <Text key={idx} style={t.insight}>
                    • {i}
                  </Text>
                ))}
                {warnings.map((w: any, idx: number) => (
                  <View key={`w-${idx}`} style={t.warn}>
                    <Text style={t.warnTitle}>{w.title}</Text>
                    <Text style={t.line}>{w.message}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={t.card}>
              <Text style={t.cardTitle}>Today’s log</Text>
              {meals.length === 0 && workouts.length === 0 && matches.length === 0 && care.length === 0 && injuries.length === 0 && !checkIn ? (
                <Text style={t.line}>Nothing logged yet. Use + to add an entry.</Text>
              ) : (
                <>
                  {checkIn ? (
                    <View style={t.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={t.rowTitle}>
                          Mood {checkIn.moodLabel || checkIn.mood} · focus{' '}
                          {checkIn.focusLabel || checkIn.focus || '—'}
                        </Text>
                        <Text style={t.line}>
                          Woke {checkIn.wakeQualityLabel || checkIn.wakeQuality}
                          {checkIn.overwhelm === 'high' ? ' · high overwhelm' : ''}
                          {checkIn.medicationTaken ? ' · meds' : ''}
                        </Text>
                        {checkIn.notes ? <Text style={t.line}>{checkIn.notes}</Text> : null}
                      </View>
                      <Text style={t.badge}>Check-in</Text>
                    </View>
                  ) : null}
                  {meals.slice(0, 6).map((m: any) => (
                    <TouchableOpacity
                      key={m.id}
                      style={t.row}
                      onPress={() =>
                        setSelectedMeal({
                          ...m,
                          resolvedPhotoUrl: mealPhotos[m.id],
                        })
                      }
                    >
                      {mealPhotos[m.id] ? (
                        <Image source={{ uri: mealPhotos[m.id] }} style={t.thumb} />
                      ) : (
                        <Image source={AppIcons.meals} style={t.thumb} />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={t.rowTitle}>
                          {(m.mealType === 'resucrage' ? 'Resucrage' : m.mealType) || 'Meal'}
                        </Text>
                        <Text style={t.rowSub}>
                          {Math.round(m.macros?.caloriesKcal || 0)} kcal · C {m.macros?.carbsG ?? 0}g · P{' '}
                          {m.macros?.proteinG ?? 0}g
                        </Text>
                      </View>
                      <Text style={t.badge}>
                        {m.eatenAt
                          ? new Date(m.eatenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {workouts.map((w: any, i: number) => (
                    <View key={`wo-${i}`} style={t.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={t.rowTitle}>{w.name || 'Workout'}</Text>
                        <Text style={t.rowSub}>{w.durationMin || 0} min</Text>
                      </View>
                      <Text style={[t.badge, t.badgeGood]}>Workout</Text>
                    </View>
                  ))}
                  {matches.map((m: any) => (
                    <View key={m.id} style={t.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={t.rowTitle}>
                          {(m.sport || 'sport').toString()}
                          {m.result && m.result !== 'completed' ? ` · ${m.result}` : ''}
                        </Text>
                        <Text style={t.rowSub}>
                          {[m.time, m.durationMin != null ? `${m.durationMin} min` : null, m.score]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                      <Text style={t.badge}>{m.result || m.sport}</Text>
                    </View>
                  ))}
                  {care.map((c: any) => (
                    <View key={c.id} style={t.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={t.rowTitle}>{c.kindLabel || c.kind}</Text>
                        {c.label ? <Text style={t.rowSub}>{c.label}</Text> : null}
                      </View>
                      <Text style={t.badge}>Care</Text>
                    </View>
                  ))}
                  {injuries.map((inj: any) => (
                    <View key={inj.id} style={t.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={t.rowTitle}>
                          {inj.title || inj.bodyAreaLabel || inj.injuryTypeLabel || 'Injury'}
                        </Text>
                        <Text style={t.rowSub}>
                          {inj.todayPain
                            ? `Pain ${inj.todayPain.painScore}/10`
                            : inj.statusLabel || inj.status}
                          {inj.exerciseNotes ? ` · ${String(inj.exerciseNotes).slice(0, 40)}` : ''}
                        </Text>
                      </View>
                      <Text style={t.badge}>Injury</Text>
                    </View>
                  ))}
                </>
              )}
            </View>

            <View style={t.card}>
              <Text style={t.cardTitle}>Pump log events</Text>
              {pumpEvents.length === 0 ? (
                <Text style={t.line}>No pump notifications synced yet today.</Text>
              ) : (
                [...pumpEvents]
                  .reverse()
                  .slice(0, 12)
                  .map((e: any) => (
                    <View key={e.id} style={t.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={t.rowTitle}>{e.kindLabel || e.kind}</Text>
                        <Text style={t.rowSub}>
                          {e.kind === 'insulin_delivered' && e.units != null
                            ? `Delivered ${e.units} U of insulin`
                            : e.message || e.title || '—'}
                        </Text>
                      </View>
                      <Text
                        style={[
                          t.badge,
                          e.kind === 'insulin_delivered'
                            ? t.badgeGood
                            : e.kind === 'low' || e.kind === 'urgent_low' || e.kind === 'reservoir'
                              ? t.badgeWarn
                              : null,
                        ]}
                      >
                        {e.kind === 'insulin_delivered' && e.units != null ? `${e.units} U` : e.time || '—'}
                      </Text>
                    </View>
                  ))
              )}
            </View>

            {data.weight?.weightKg != null || data.calorieTargets?.weightKg != null ? (
              <View style={t.card}>
                <Text style={t.cardTitle}>Body</Text>
                <Text style={t.line}>
                  Weight {data.weight?.weightKg ?? data.calorieTargets?.weightKg} kg
                  {data.calorieTargets?.bmi != null ? ` · BMI ${data.calorieTargets.bmi}` : ''}
                  {data.calorieTargets?.maintenanceKcal != null
                    ? ` · maint. ${data.calorieTargets.maintenanceKcal} kcal`
                    : ''}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <MealDetailModal
        meal={selectedMeal}
        onClose={() => setSelectedMeal(null)}
        onSaved={(updated) => {
          if ('deleted' in updated && updated.deleted) {
            setSelectedMeal(null);
          } else {
            setSelectedMeal({
              ...(updated as any),
              resolvedPhotoUrl: (selectedMeal as any)?.resolvedPhotoUrl,
            });
          }
          load();
        }}
      />
    </View>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { paddingHorizontal: 16 },
    title: { fontSize: 28, fontWeight: '700', color: isDark ? '#fff' : '#0f172a', letterSpacing: -0.4 },
    sub: { marginTop: 4, marginBottom: 16, color: isDark ? '#8b949e' : '#64748b', fontSize: 14 },
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
    statCard: {
      width: '48%',
      flexGrow: 1,
      minWidth: '46%',
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: isDark ? '#21262d' : '#e5e7eb',
    },
    statWarn: { borderColor: isDark ? '#9a3412' : '#fdba74' },
    statLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: isDark ? '#8b949e' : '#64748b',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    statValue: {
      marginTop: 8,
      fontSize: 24,
      fontWeight: '700',
      color: isDark ? '#fff' : '#0f172a',
    },
    statUnit: { fontSize: 14, fontWeight: '600', color: isDark ? '#8b949e' : '#64748b' },
    statFoot: { flex: 1, fontSize: 12, color: isDark ? '#8b949e' : '#64748b', lineHeight: 16 },
    statFootRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
    statFootIcon: { width: 16, height: 16, borderRadius: 4 },
    card: {
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 16,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: isDark ? '#21262d' : '#e5e7eb',
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: isDark ? '#fff' : '#0f172a',
      marginBottom: 10,
    },
    insight: { marginTop: 6, color: isDark ? '#c9d1d9' : '#334155', lineHeight: 20 },
    line: { color: isDark ? '#c9d1d9' : '#334155', lineHeight: 20 },
    warn: {
      marginTop: 10,
      padding: 10,
      borderRadius: 10,
      backgroundColor: isDark ? '#3d2c00' : '#fff7ed',
    },
    warnTitle: { fontWeight: '700', color: '#d97706', marginBottom: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: isDark ? '#21262d' : '#e5e7eb',
    },
    thumb: { width: 44, height: 44, borderRadius: 12 },
    rowTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: isDark ? '#e6edf3' : '#0f172a',
      textTransform: 'capitalize',
    },
    rowSub: { marginTop: 2, fontSize: 12, color: isDark ? '#8b949e' : '#64748b' },
    badge: {
      fontSize: 12,
      fontWeight: '700',
      color: isDark ? '#c9d1d9' : '#475569',
      backgroundColor: isDark ? '#21262d' : '#f1f5f9',
      overflow: 'hidden',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
    },
    badgeGood: { backgroundColor: '#ccfbf1', color: '#0f766e' },
    badgeWarn: { backgroundColor: '#ffedd5', color: '#c2410c' },
    plotLine: { marginTop: 6, color: isDark ? '#c9d1d9' : '#334155', lineHeight: 20, fontSize: 14 },
    plotSubtitle: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: isDark ? '#8b949e' : '#64748b',
      marginBottom: 2,
    },
    plotHypo: { color: isDark ? '#fca5a5' : '#b91c1c' },
    plotHyper: { color: isDark ? '#fdba74' : '#c2410c' },
    shareBtn: {
      marginTop: 12,
      alignSelf: 'flex-start',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: isDark ? '#21262d' : '#e0f2fe',
    },
    shareBtnText: { fontWeight: '700', color: isDark ? '#7dd3fc' : '#0369a1', fontSize: 13 },
  });

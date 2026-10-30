import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { TREND_ARROW_GLYPH, TREND_ARROW_LABEL, type GlycemiaUnit } from '@health-companion/shared';
import { fetchCaffeineLogs, fetchDashboard, fetchStressLogs } from '../api/client';
import { syncActivityToCloud } from '../activityCloudSync';
import { maybeNudgeSiteChange } from '../pushNudges';
import { openMorningLog, navigateTo } from '../navigation';
import { sendBackgroundToWatch, sendGlycemiaToWatch } from '../wearSync';
import { loadBackgroundSettings } from '../backgroundSettings';
import { requestNotificationAccess, toSamples, useGlucose } from '../glucose/store';
import { ageLabel, formatDelta5Min, formatGlucose, trendAlert } from '../glucose/format';
import { loadTimeline, timeLabel, type TimelineItem } from '../log/timeline';
import GlucoseTrendChart from '../components/GlucoseTrendChart';
import MealDetailModal from '../components/MealDetailModal';
import {
  Button,
  EmptyNote,
  HUD,
  Label,
  Panel,
  Pill,
  Row,
  Screen,
  SectionHeader,
  Stat,
  StatGrid,
  withAlpha,
  zoneColor,
} from '../ui/hud';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const glucose = useGlucose(12);
  const [dash, setDash] = useState<any>(null);
  const [stressToday, setStressToday] = useState<any>(null);
  const [caffeineMg, setCaffeineMg] = useState<number | null>(null);
  const [recent, setRecent] = useState<TimelineItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [syncState, setSyncState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [selectedMeal, setSelectedMeal] = useState<any | null>(null);

  const load = useCallback(async () => {
    const today = todayKey();
    await syncActivityToCloud().catch(() => false);
    const [d, stress, caffeine, timeline] = await Promise.all([
      fetchDashboard().catch(() => null),
      fetchStressLogs(today).catch(() => []),
      fetchCaffeineLogs(today).catch(() => []),
      loadTimeline(1).catch(() => []),
    ]);
    setDash(d);
    if (d?.deviceCare) void maybeNudgeSiteChange(d.deviceCare);
    setStressToday(stress[0] ?? null);
    setCaffeineMg(caffeine.length ? caffeine.reduce((t: number, c: any) => t + (c.caffeineMg || 0), 0) : null);
    setRecent(timeline.slice(0, 4));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([glucose.refresh(), load()]);
    setRefreshing(false);
  }, [glucose, load]);

  const syncWatch = useCallback(async () => {
    if (!glucose.latest) return;
    setSyncState('busy');
    try {
      await sendGlycemiaToWatch(glucose.latest, glucose.history);
      await sendBackgroundToWatch(await loadBackgroundSettings());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSyncState('done');
      setTimeout(() => setSyncState('idle'), 2500);
    } catch {
      setSyncState('idle');
    }
  }, [glucose.latest, glucose.history]);

  const { insight, latest } = glucose;
  const unit: GlycemiaUnit = (latest?.unit as GlycemiaUnit) || 'mg/dL';
  const zone = insight.isStale ? null : insight.zone;
  const accent = zoneColor(zone);
  const alert = trendAlert(insight);
  const alertColor = alert?.level === 'high' || alert?.level === 'stale' ? HUD.amber : alert ? HUD.red : accent;
  const delta = formatDelta5Min(insight, unit);
  const statusLine = insight.current
    ? [insight.arrow !== 'none' ? TREND_ARROW_LABEL[insight.arrow] : null, delta, ageLabel(insight.ageMs)].filter(Boolean).join('  ·  ')
    : null;

  const tir = dash?.timeInRangePct;
  const tirColor = tir == null ? HUD.ink : tir >= 70 ? HUD.mint : tir >= 50 ? HUD.amber : HUD.red;
  const avg = dash?.glucoseAvgMgDl;
  const carbs = dash?.todayCarbsG;
  const insulin = dash?.todayInsulinDeliveredU;
  const steps = dash?.todaySteps;
  const energy = dash?.todayEnergyScore ?? dash?.sports?.todayEnergyScore ?? null;
  const checkIn = dash?.todayDayCheckIn;
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();

  return (
    <>
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label color={HUD.cyan}>{date}</Label>
          <Pressable
            onPress={syncWatch}
            hitSlop={10}
            accessibilityLabel="Sync to watch"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Ionicons
              name={syncState === 'done' ? 'checkmark-circle' : 'watch-outline'}
              size={18}
              color={syncState === 'done' ? HUD.mint : HUD.muted}
            />
            <Text style={{ color: syncState === 'done' ? HUD.mint : HUD.muted, fontFamily: HUD.fontCondensed, fontSize: 13 }}>
              {syncState === 'busy' ? 'Syncing…' : syncState === 'done' ? 'Synced' : 'Sync watch'}
            </Text>
          </Pressable>
        </View>

        {glucose.access === 'denied' ? (
          <Panel glow={HUD.amber}>
            <Label color={HUD.amber}>Notification access is off</Label>
            <Text style={{ color: HUD.inkSoft, marginVertical: 8, lineHeight: 20 }}>
              Health Companion reads your CamAPS readings from its notifications. Without access, nothing reaches the
              watch.
            </Text>
            <Button label="Turn on access" icon="notifications-outline" onPress={requestNotificationAccess} />
          </Panel>
        ) : null}

        <Panel glow={accent} onPress={() => navigation.navigate('GlucoseDetail')}>
          {insight.current ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                <Text
                  style={{
                    fontFamily: HUD.fontLight,
                    fontSize: 76,
                    lineHeight: 80,
                    color: insight.isStale ? HUD.dim : accent,
                    textShadowColor: withAlpha(accent, 0.7),
                    textShadowRadius: insight.isStale ? 0 : 18,
                    textDecorationLine: insight.isStale ? 'line-through' : 'none',
                  }}
                >
                  {formatGlucose(insight.current.mgDl, unit)}
                </Text>
                <View style={{ paddingBottom: 12 }}>
                  <Label>{unit}</Label>
                </View>
                {insight.arrow !== 'none' ? (
                  <View
                    style={{
                      marginLeft: 'auto',
                      marginBottom: 10,
                      width: 52,
                      height: 52,
                      borderRadius: 26,
                      borderWidth: 1.5,
                      borderColor: withAlpha(accent, 0.8),
                      backgroundColor: withAlpha(accent, 0.12),
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 28 }}>{TREND_ARROW_GLYPH[insight.arrow]}</Text>
                  </View>
                ) : null}
              </View>
              {statusLine ? <Text style={{ color: HUD.inkSoft, fontFamily: HUD.fontCondensed, fontSize: 14, letterSpacing: 0.4 }}>{statusLine}</Text> : null}
              {alert ? (
                <View style={{ marginTop: 10 }}>
                  <Pill label={alert.text.toUpperCase()} color={alertColor} />
                </View>
              ) : null}
              <View style={{ marginTop: 16 }}>
                <GlucoseTrendChart
                  samples={toSamples(glucose.history)}
                  prediction={insight.prediction}
                  nowMs={glucose.now}
                />
              </View>
            </>
          ) : (
            <View style={{ paddingVertical: 12, gap: 6 }}>
              <Label>Waiting for CamAPS</Label>
              <Text style={{ color: HUD.inkSoft }}>Your next reading will show up here.</Text>
            </View>
          )}
        </Panel>

        <StatGrid>
          <Stat label="Time in range" value={tir != null ? `${Math.round(tir)}` : '—'} unit="%" color={tirColor} hint="Target 70–180" />
          <Stat label="Average" value={avg != null ? formatGlucose(avg, unit) : '—'} unit={unit} hint="Today" />
          <Stat
            label="Carbs"
            value={carbs != null ? `${Math.round(carbs)}` : '—'}
            unit="g"
            hint={insulin != null ? `${Math.round(insulin * 10) / 10} U insulin` : null}
          />
          <Stat
            label="Steps"
            value={steps != null ? Math.round(steps).toLocaleString('en-GB') : '—'}
            hint={energy != null ? `Energy score ${Math.round(energy)}` : null}
          />
        </StatGrid>

        <Panel onPress={openMorningLog} style={{ paddingVertical: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label color={HUD.violet}>Mind</Label>
            <Text style={{ color: HUD.cyan, fontFamily: HUD.fontCondensed, fontSize: 13 }}>
              {checkIn ? 'Edit check-in' : 'Check in'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', marginTop: 10 }}>
            <MindCell label="Mood" value={checkIn?.moodLabel || '—'} />
            <MindCell label="Energy" value={energy != null ? String(Math.round(energy)) : '—'} />
            <MindCell
              label="Stress"
              value={stressToday ? stressToday.levelLabel || String(stressToday.level) : '—'}
            />
            <MindCell label="Caffeine" value={caffeineMg != null ? `${Math.round(caffeineMg)} mg` : '—'} />
          </View>
        </Panel>

        <SectionHeader title="Today" action="See all" onAction={() => navigateTo('Tabs', { screen: 'Log' })} />
        <Panel style={{ paddingVertical: 4 }}>
          {recent.length ? (
            recent.map((it, i) => (
              <Row
                key={it.id}
                first={i === 0}
                icon={it.icon}
                color={it.color}
                title={it.title}
                subtitle={it.subtitle}
                trailing={timeLabel(it.ts)}
                image={it.thumb}
                onPress={it.meal ? () => setSelectedMeal(it.meal) : undefined}
              />
            ))
          ) : (
            <EmptyNote text="Nothing logged yet today. Use + to add a meal, check-in or workout." />
          )}
        </Panel>
      </Screen>

      <MealDetailModal
        meal={selectedMeal}
        onClose={() => setSelectedMeal(null)}
        onSaved={() => {
          setSelectedMeal(null);
          void load();
        }}
      />
    </>
  );
}

function MindCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Label>{label}</Label>
      <Text style={{ color: HUD.ink, fontSize: 15 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

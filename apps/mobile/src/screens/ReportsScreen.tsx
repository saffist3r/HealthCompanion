import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  useColorScheme,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { DailyReport, WeeklyReport, WorkoutPlan } from '@health-companion/shared';
import {
  fetchDailyReport,
  fetchDailyVoiceBriefing,
  fetchDailyVoiceVideo,
  fetchDebrief,
  fetchRagArchive,
  fetchWeeklyReport,
  type DayDebriefDetail,
  type DayDebriefSummary,
} from '../api/client';
import ScreenHero from '../components/ui/ScreenHero';
import { FadeIn } from '../components/ui/FadeIn';
import { HC, themeColors } from '../theme';
function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '—';
  }
}

export default function ReportsScreen() {
  const navigation = useNavigation<any>();
  const isDark = useColorScheme() === 'dark';
  const [mode, setMode] = useState<'daily' | 'weekly' | 'archive'>('daily');
  const [loading, setLoading] = useState(false);
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const [archive, setArchive] = useState<{
    debriefs: DayDebriefSummary[];
    workoutPlans: WorkoutPlan[];
  } | null>(null);
  const [openDebriefDate, setOpenDebriefDate] = useState<string | null>(null);
  const [openDebrief, setOpenDebrief] = useState<DayDebriefDetail | null>(null);
  const [debriefBusy, setDebriefBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [voiceBackground, setVoiceBackground] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const audioPlayer = useAudioPlayer(null);
  const videoPlayer = useVideoPlayer(null, (p) => {
    p.loop = false;
  });
  const t = styles(isDark);
  const promoPulse = useRef(new Animated.Value(1)).current;
  const promoGlow = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const scaleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(promoPulse, { toValue: 1.015, duration: 1800, useNativeDriver: true }),
        Animated.timing(promoPulse, { toValue: 1, duration: 1800, useNativeDriver: true }),
      ])
    );
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(promoGlow, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(promoGlow, { toValue: 0.45, duration: 1400, useNativeDriver: true }),
      ])
    );
    scaleLoop.start();
    glowLoop.start();
    return () => {
      scaleLoop.stop();
      glowLoop.stop();
    };
  }, [promoGlow, promoPulse]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'daily') {
        setDaily(await fetchDailyReport());
      } else if (mode === 'weekly') {
        setWeekly(await fetchWeeklyReport());
      } else if (mode === 'archive') {
        setArchive(await fetchRagArchive(30));
      }
    } catch (e) {
      Alert.alert('Report failed', String(e));
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openArchiveDebrief = async (date: string) => {
    if (openDebriefDate === date) {
      setOpenDebriefDate(null);
      setOpenDebrief(null);
      return;
    }
    setDebriefBusy(true);
    try {
      const detail = await fetchDebrief(date);
      setOpenDebriefDate(date);
      setOpenDebrief(detail);
    } catch (e) {
      Alert.alert('Archive', String(e));
    } finally {
      setDebriefBusy(false);
    }
  };

  const playVoice = async () => {
    if (!daily?.date) return;
    setVoiceBusy(true);
    try {
      await setAudioModeAsync({ playsInSilentMode: true });
      const res = await fetchDailyVoiceBriefing(daily.date);
      setVoiceTranscript(res.transcript);
      setVoiceBackground(null);
      setVideoUri(null);
      const file = new File(Paths.cache, `reb3i-voice-${daily.date}.wav`);
      if (file.exists) file.delete();
      file.create();
      file.write(res.audioBase64, { encoding: 'base64' });
      audioPlayer.replace({ uri: file.uri });
      audioPlayer.play();
    } catch (e) {
      Alert.alert('Reb3i voice', String(e));
    } finally {
      setVoiceBusy(false);
    }
  };

  const playVideo = async () => {
    if (!daily?.date) return;
    setVideoBusy(true);
    try {
      const res = await fetchDailyVoiceVideo(daily.date);
      setVoiceTranscript(res.transcript);
      setVoiceBackground(res.background || null);
      const file = new File(Paths.cache, `reb3i-video-${daily.date}.mp4`);
      if (file.exists) file.delete();
      file.create();
      file.write(res.videoBase64, { encoding: 'base64' });
      setVideoUri(file.uri);
      videoPlayer.replace({ uri: file.uri });
      videoPlayer.play();
    } catch (e) {
      Alert.alert('Reb3i video', String(e));
    } finally {
      setVideoBusy(false);
    }
  };

  const glucoseReadings = daily?.glucose?.readings || [];

  return (
    <ScrollView
      style={t.root}
      contentContainerStyle={t.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={HC.teal} />}
    >
      <ScreenHero
        eyebrow="INSIGHTS"
        title="Reports"
        subtitle="Meals, glucose & activity in one place"
        pills={['Daily', 'Weekly', 'Archive']}
        compact
      />

      <FadeIn>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => navigation.navigate('LifeReview')}
        style={{ marginBottom: 16, marginHorizontal: 16 }}
      >
        <Animated.View style={{ transform: [{ scale: promoPulse }] }}>
          <LinearGradient
            colors={HC.heroGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={t.lifePromo}
          >
            <View style={t.lifePromoRow}>
              <View style={{ flex: 1 }}>
                <View style={t.lifePromoEyebrowRow}>
                  <Animated.View style={[t.lifePromoDot, { opacity: promoGlow }]} />
                  <Text style={t.lifePromoEyebrow}>7-DAY HONEST READ</Text>
                </View>
                <Text style={t.lifePromoTitle}>Life review</Text>
                <Text style={t.lifePromoSub}>
                  An unfiltered AI assessment of your week — glucose, food, mood, sport.
                </Text>
                <Text style={t.lifePromoCta}>Open review →</Text>
              </View>
              <View style={t.lifePromoBadge}>
                <Text style={t.lifePromoBadgeText}>7d</Text>
              </View>
            </View>
          </LinearGradient>
        </Animated.View>
      </TouchableOpacity>
      </FadeIn>

      <View style={t.tabs}>
        <TouchableOpacity
          style={[t.tab, mode === 'daily' && t.tabOn]}
          onPress={() => setMode('daily')}
        >
          <Text style={[t.tabText, mode === 'daily' && t.tabTextOn]}>Daily</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[t.tab, mode === 'weekly' && t.tabOn]}
          onPress={() => setMode('weekly')}
        >
          <Text style={[t.tabText, mode === 'weekly' && t.tabTextOn]}>Weekly</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[t.tab, mode === 'archive' && t.tabOn]}
          onPress={() => setMode('archive')}
        >
          <Text style={[t.tabText, mode === 'archive' && t.tabTextOn]}>Archive</Text>
        </TouchableOpacity>
      </View>

      {loading && !daily && !weekly && !archive ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={HC.teal} />
      ) : null}

      {mode === 'daily' && daily ? (
        <View style={t.card}>
          <Text style={t.cardTitle}>{daily.date}</Text>
          <TouchableOpacity
            style={[t.voiceBtn, voiceBusy && t.voiceBtnBusy]}
            onPress={playVoice}
            disabled={voiceBusy || videoBusy}
          >
            {voiceBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={t.voiceBtnText}>Reb3i — voice (TN)</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[t.videoBtn, videoBusy && t.voiceBtnBusy]}
            onPress={playVideo}
            disabled={voiceBusy || videoBusy}
          >
            {videoBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={t.voiceBtnText}>Reb3i — video (TN)</Text>
            )}
          </TouchableOpacity>
          {videoUri ? (
            <VideoView
              style={t.video}
              player={videoPlayer}
              allowsFullscreen
              contentFit="contain"
              nativeControls
            />
          ) : null}
          {voiceBackground ? (
            <Text style={t.disclaimer}>Set: {voiceBackground} · Reb3i → Saff</Text>
          ) : null}
          {voiceTranscript ? (
            <Text style={t.transcript} selectable>
              {voiceTranscript}
            </Text>
          ) : null}
          {voiceTranscript ? (
            <Text style={t.disclaimer}>Reb3i → Saff · lifestyle chatter — not medical advice.</Text>
          ) : null}
          <Text style={t.line}>
            Meals: {daily.nutrition.mealCount} · {Math.round(daily.nutrition.macros.caloriesKcal || 0)}{' '}
            kcal · Carbs {daily.nutrition.macros.carbsG}g · Protein {daily.nutrition.macros.proteinG}g
          </Text>
          <Text style={t.line}>
            Glucose avg:{' '}
            {daily.glucose.avgMgDl != null ? `${daily.glucose.avgMgDl} mg/dL` : '—'} · TIR{' '}
            {daily.glucose.timeInRangePct != null ? `${daily.glucose.timeInRangePct}%` : '—'}
            {daily.glucose.readingCount ? ` · ${daily.glucose.readingCount} readings` : ''}
          </Text>
          {glucoseReadings.length > 0 ? (
            <View style={t.subCard}>
              <Text style={t.subTitle}>Glucose history</Text>
              {glucoseReadings.slice(0, 24).map((r, i) => (
                <Text key={i} style={t.meta}>
                  {formatTime(r.timestamp)} · {Math.round(r.mgDl)} mg/dL
                </Text>
              ))}
              {glucoseReadings.length > 24 ? (
                <Text style={t.meta}>… +{glucoseReadings.length - 24} more in archive</Text>
              ) : null}
            </View>
          ) : null}
          <Text style={t.line}>
            Steps: {daily.activity ? daily.activity.steps.toLocaleString() : '—'}
          </Text>
          {daily.insights.map((i, idx) => (
            <Text key={idx} style={t.insight}>
              • {i}
            </Text>
          ))}
          {daily.warnings.map((w, idx) => (
            <View key={idx} style={t.warn}>
              <Text style={t.warnTitle}>
                [{w.severity}] {w.title}
              </Text>
              <Text style={t.line}>{w.message}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {mode === 'weekly' && weekly ? (
        <View style={t.card}>
          <Text style={t.cardTitle}>
            {weekly.weekStart} → {weekly.weekEnd}
          </Text>
          <Text style={t.line}>
            Meals {weekly.totals.mealCount} · {Math.round(weekly.totals.macros.caloriesKcal || 0)} kcal ·
            Carbs {weekly.totals.macros.carbsG}g · Steps{' '}
            {weekly.totals.totalSteps.toLocaleString()}
          </Text>
          <Text style={t.line}>
            Avg glucose:{' '}
            {weekly.totals.avgGlucoseMgDl != null ? `${weekly.totals.avgGlucoseMgDl} mg/dL` : '—'} ·
            Avg TIR{' '}
            {weekly.totals.avgTimeInRangePct != null
              ? `${weekly.totals.avgTimeInRangePct}%`
              : '—'}
          </Text>
          {weekly.insights.map((i, idx) => (
            <Text key={idx} style={t.insight}>
              • {i}
            </Text>
          ))}
        </View>
      ) : null}

      {mode === 'archive' && archive ? (
        <View style={t.card}>
          <Text style={t.cardTitle}>RAG archive</Text>
          <Text style={t.meta}>
            Saved debrief facts and workout plans for retrieval. Email a PDF or open a daily report to
            refresh a day.
          </Text>

          <Text style={t.subTitle}>Daily debriefs</Text>
          {archive.debriefs.length === 0 ? (
            <Text style={t.meta}>No archived debriefs yet.</Text>
          ) : (
            archive.debriefs.map((d) => (
              <View key={d.id}>
                <TouchableOpacity
                  style={t.archiveRow}
                  onPress={() => openArchiveDebrief(d.date)}
                  disabled={debriefBusy}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={t.value}>{d.date}</Text>
                    <Text style={t.meta}>{d.headline || 'Day overview'}</Text>
                  </View>
                  <Text style={t.meta}>{d.source}</Text>
                </TouchableOpacity>
                {openDebriefDate === d.date && openDebrief ? (
                  <View style={t.subCard}>
                    <Text style={t.line}>{openDebrief.summary}</Text>
                  </View>
                ) : null}
              </View>
            ))
          )}

          <Text style={[t.subTitle, { marginTop: 16 }]}>Workout plans</Text>
          {archive.workoutPlans.length === 0 ? (
            <Text style={t.meta}>No saved workout plans yet.</Text>
          ) : (
            archive.workoutPlans.map((p) => (
              <View key={p.id} style={t.archiveRow}>
                <View style={{ flex: 1 }}>
                  <Text style={t.value}>{p.title}</Text>
                  <Text style={t.meta}>
                    {p.focus ? `${p.focus} · ` : ''}
                    {p.exercises.length} exercises
                    {p.basedOn ? ` · ${p.basedOn.slice(0, 60)}` : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = (isDark: boolean) => {
  const c = themeColors(isDark);
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    content: { paddingBottom: 40 },
    title: { fontSize: 24, fontWeight: '700', color: c.ink },
    sub: { marginTop: 4, marginBottom: 16, color: c.muted },
    lifePromo: { borderRadius: HC.radius.xl, padding: 18, overflow: 'hidden' },
    lifePromoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    lifePromoEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    lifePromoDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: HC.tealBright,
    },
    lifePromoEyebrow: {
      color: 'rgba(255,255,255,0.72)',
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.2,
    },
    lifePromoTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 6 },
    lifePromoSub: { color: 'rgba(255,255,255,0.88)', fontSize: 13, lineHeight: 19, marginBottom: 10 },
    lifePromoCta: { color: HC.tealBright, fontWeight: '800', fontSize: 14 },
    lifePromoBadge: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.2)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    lifePromoBadgeText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    tabs: { flexDirection: 'row', gap: 8, marginBottom: 12, marginHorizontal: 16 },
    tab: {
      flex: 1,
      padding: 12,
      borderRadius: HC.radius.md,
      backgroundColor: isDark ? '#21262d' : '#e2e8f0',
      alignItems: 'center',
    },
    tabOn: { backgroundColor: HC.teal },
    tabText: { fontWeight: '700', color: isDark ? '#c9d1d9' : '#334155', fontSize: 13 },
    tabTextOn: { color: '#fff' },
    card: {
      backgroundColor: c.card,
      borderRadius: HC.radius.lg,
      padding: 16,
      gap: 8,
      marginHorizontal: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardTitle: { fontSize: 18, fontWeight: '800', color: c.ink, marginBottom: 4 },
    subTitle: { fontSize: 15, fontWeight: '800', color: c.ink, marginTop: 8 },
    subCard: {
      marginTop: 8,
      padding: 10,
      borderRadius: HC.radius.sm,
      backgroundColor: isDark ? '#0d1117' : '#f8fafc',
      gap: 4,
    },
    archiveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 10,
      paddingVertical: 6,
    },
    value: { color: c.ink, fontWeight: '600' },
    meta: { color: c.muted, fontSize: 12, marginTop: 2 },
    voiceBtn: {
      backgroundColor: HC.teal,
      borderRadius: HC.radius.md,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: 'center',
      marginBottom: 4,
    },
    videoBtn: {
      backgroundColor: HC.violet,
      borderRadius: HC.radius.md,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: 'center',
      marginBottom: 4,
    },
    voiceBtnBusy: { opacity: 0.7 },
    voiceBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    video: {
      width: '100%',
      height: 360,
      borderRadius: 12,
      backgroundColor: '#000',
      marginTop: 4,
    },
    transcript: {
      color: c.ink,
      fontSize: 14,
      lineHeight: 22,
      marginTop: 4,
      writingDirection: 'auto',
    },
    disclaimer: { color: c.muted, fontSize: 12, marginBottom: 4 },
    line: { color: c.line, fontSize: 14, lineHeight: 20 },
    insight: { color: c.muted, fontSize: 13, marginTop: 4 },
    warn: {
      marginTop: 8,
      padding: 10,
      borderRadius: HC.radius.sm,
      backgroundColor: isDark ? '#3d1f1f' : '#fef2f2',
    },
    warnTitle: { fontWeight: '700', color: isDark ? '#fca5a5' : '#b91c1c', marginBottom: 4 },
  });
};

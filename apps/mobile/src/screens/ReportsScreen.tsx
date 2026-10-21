import { useCallback, useMemo, useRef, useState } from 'react';
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
  PanResponder,
  type LayoutChangeEvent,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { DailyReport, WeeklyReport, WorkoutPlan } from '@health-companion/shared';
import { toDateKey } from '@health-companion/shared';
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
import { HC, themeColors } from '../theme';
import { openReb3iLive } from '../navigation';

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d.getTime());
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function formatDayLabel(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatTime(ts: number): string {
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '—';
  }
}

export default function ReportsScreen() {
  const isDark = useColorScheme() === 'dark';
  const [mode, setMode] = useState<'daily' | 'weekly' | 'archive'>('daily');
  const today = useMemo(() => toDateKey(Date.now()), []);
  const yesterday = useMemo(() => shiftDate(today, -1), [today]);
  const [selectedDate, setSelectedDate] = useState(() => shiftDate(toDateKey(Date.now()), -1));
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
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [voiceBackground, setVoiceBackground] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [seekWidth, setSeekWidth] = useState(1);
  const audioPlayer = useAudioPlayer(null, { updateInterval: 250 });
  const audioStatus = useAudioPlayerStatus(audioPlayer);
  const videoPlayer = useVideoPlayer(null, (p) => {
    p.loop = false;
  });
  const t = styles(isDark);
  const canGoNext = selectedDate < today;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'daily') {
        setVoiceTranscript(null);
        setVoiceBackground(null);
        setVideoUri(null);
        setVoiceReady(false);
        try {
          audioPlayer.pause();
        } catch {
          /* ignore */
        }
        setDaily(await fetchDailyReport(selectedDate));
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
  }, [mode, selectedDate]);

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
      setVoiceReady(true);
      audioPlayer.play();
    } catch (e) {
      setVoiceReady(false);
      Alert.alert('Reb3i voice', String(e));
    } finally {
      setVoiceBusy(false);
    }
  };

  const toggleVoicePlayback = () => {
    if (!voiceReady) {
      void playVoice();
      return;
    }
    if (audioStatus.playing) {
      audioPlayer.pause();
    } else {
      // Restart if finished
      if (
        audioStatus.duration > 0 &&
        audioStatus.currentTime >= Math.max(0, audioStatus.duration - 0.35)
      ) {
        void audioPlayer.seekTo(0).then(() => audioPlayer.play());
      } else {
        audioPlayer.play();
      }
    }
  };

  const seekWidthRef = useRef(1);
  const seekPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const dur = audioStatus.duration || 0;
          if (dur <= 0) return;
          const x = e.nativeEvent.locationX;
          const ratio = Math.max(0, Math.min(1, x / (seekWidthRef.current || 1)));
          void audioPlayer.seekTo(ratio * dur);
        },
        onPanResponderMove: (e) => {
          const dur = audioStatus.duration || 0;
          if (dur <= 0) return;
          const x = e.nativeEvent.locationX;
          const ratio = Math.max(0, Math.min(1, x / (seekWidthRef.current || 1)));
          void audioPlayer.seekTo(ratio * dur);
        },
      }),
    [audioPlayer, audioStatus.duration]
  );

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

      <TouchableOpacity style={t.liveBtn} onPress={openReb3iLive} activeOpacity={0.9}>
        <Text style={t.liveBtnTitle}>Talk with Reb3i</Text>
        <Text style={t.liveBtnSub}>Live Darija — hold to talk or Gemini-style hands-free orb</Text>
      </TouchableOpacity>

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

      {mode === 'daily' ? (
        <View style={t.dayPicker}>
          <TouchableOpacity
            style={t.dayNavBtn}
            onPress={() => setSelectedDate((d) => shiftDate(d, -1))}
            disabled={loading}
          >
            <Text style={t.dayNavText}>←</Text>
          </TouchableOpacity>
          <View style={t.dayPickerMain}>
            <Text style={t.dayPickerLabel}>{formatDayLabel(selectedDate)}</Text>
            <Text style={t.dayPickerIso}>
              {selectedDate}
              {selectedDate === yesterday ? ' · yesterday' : selectedDate === today ? ' · today' : ''}
            </Text>
          </View>
          <TouchableOpacity
            style={[t.dayNavBtn, !canGoNext && t.dayNavBtnDisabled]}
            onPress={() => setSelectedDate((d) => shiftDate(d, 1))}
            disabled={loading || !canGoNext}
          >
            <Text style={t.dayNavText}>→</Text>
          </TouchableOpacity>
          {selectedDate !== yesterday ? (
            <TouchableOpacity style={t.todayBtn} onPress={() => setSelectedDate(yesterday)}>
              <Text style={t.todayBtnText}>Yesterday</Text>
            </TouchableOpacity>
          ) : null}
          {selectedDate !== today ? (
            <TouchableOpacity style={t.todayBtn} onPress={() => setSelectedDate(today)}>
              <Text style={t.todayBtnText}>Today</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {loading && !daily && !weekly && !archive ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={HC.teal} />
      ) : null}

      {mode === 'daily' && daily ? (
        <View style={t.card}>
          <Text style={t.cardTitle}>{formatDayLabel(daily.date)}</Text>
          <Text style={t.meta}>What happened this day (Europe/Paris)</Text>
          <TouchableOpacity
            style={[t.voiceBtn, voiceBusy && t.voiceBtnBusy]}
            onPress={toggleVoicePlayback}
            disabled={voiceBusy || videoBusy}
          >
            {voiceBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={t.voiceBtnText}>
                {!voiceReady
                  ? 'Reb3i — voice (TN)'
                  : audioStatus.playing
                    ? 'Pause'
                    : 'Play'}
              </Text>
            )}
          </TouchableOpacity>
          {voiceReady ? (
            <View style={t.seekBlock}>
              <View
                onLayout={(e: LayoutChangeEvent) => {
                  const w = e.nativeEvent.layout.width;
                  seekWidthRef.current = w;
                  setSeekWidth(w);
                }}
                {...seekPan.panHandlers}
                style={t.seekTrack}
                accessibilityRole="adjustable"
                accessibilityLabel="Voice position"
              >
                <View
                  pointerEvents="none"
                  style={[
                    t.seekFill,
                    {
                      width:
                        (audioStatus.duration > 0
                          ? audioStatus.currentTime / audioStatus.duration
                          : 0) * seekWidth,
                    },
                  ]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    t.seekThumb,
                    {
                      left: Math.max(
                        0,
                        Math.min(
                          seekWidth - 16,
                          (audioStatus.duration > 0
                            ? audioStatus.currentTime / audioStatus.duration
                            : 0) *
                            seekWidth -
                            8
                        )
                      ),
                    },
                  ]}
                />
              </View>
              <View style={t.seekTimes}>
                <Text style={t.seekTime}>{formatClock(audioStatus.currentTime)}</Text>
                <Text style={t.seekTime}>{formatClock(audioStatus.duration)}</Text>
              </View>
            </View>
          ) : null}
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
          {((daily as any).meals || []).length > 0 ? (
            <View style={t.subCard}>
              <Text style={t.subTitle}>Meals that day</Text>
              {((daily as any).meals as any[]).map((m, i) => (
                <Text key={m.id || i} style={t.meta}>
                  {(m.mealType || 'meal').toString()}
                  {m.eatenAt ? ` · ${formatTime(m.eatenAt)}` : ''}
                  {m.macros?.caloriesKcal != null
                    ? ` · ${Math.round(m.macros.caloriesKcal)} kcal`
                    : ''}
                  {m.macros?.carbsG != null ? ` · C ${m.macros.carbsG}g` : ''}
                </Text>
              ))}
            </View>
          ) : null}
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
                <View style={t.archiveRow}>
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    onPress={() => openArchiveDebrief(d.date)}
                    disabled={debriefBusy}
                  >
                    <Text style={t.value}>{d.date}</Text>
                    <Text style={t.meta}>{d.headline || 'Day overview'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedDate(d.date);
                      setMode('daily');
                    }}
                  >
                    <Text style={t.openDayLink}>Open day</Text>
                  </TouchableOpacity>
                </View>
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
    liveBtn: {
      marginHorizontal: 16,
      marginBottom: 14,
      borderRadius: HC.radius.lg,
      padding: 16,
      backgroundColor: HC.violet,
    },
    liveBtnTitle: { color: '#fff', fontWeight: '800', fontSize: 17 },
    liveBtnSub: { color: 'rgba(255,255,255,0.85)', marginTop: 4, fontSize: 13, lineHeight: 18 },
    tabs: { flexDirection: 'row', gap: 8, marginBottom: 12, marginHorizontal: 16 },
    dayPicker: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 12,
      padding: 12,
      borderRadius: HC.radius.lg,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
    },
    dayNavBtn: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#21262d' : '#e2e8f0',
    },
    dayNavBtnDisabled: { opacity: 0.35 },
    dayNavText: { color: c.ink, fontSize: 18, fontWeight: '800' },
    dayPickerMain: { flex: 1 },
    dayPickerLabel: { color: c.ink, fontWeight: '800', fontSize: 15 },
    dayPickerIso: { color: c.muted, fontSize: 12, marginTop: 2 },
    todayBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: HC.teal,
    },
    todayBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
    openDayLink: { color: HC.teal, fontWeight: '800', fontSize: 13 },
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
    seekBlock: { marginTop: 6, marginBottom: 8 },
    seekTrack: {
      height: 28,
      borderRadius: 14,
      backgroundColor: isDark ? '#21262d' : '#e2e8f0',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    seekFill: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: HC.teal,
      opacity: 0.85,
      borderRadius: 14,
    },
    seekThumb: {
      position: 'absolute',
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: '#fff',
      borderWidth: 2,
      borderColor: HC.teal,
      top: 6,
    },
    seekTimes: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 4,
    },
    seekTime: { color: c.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
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

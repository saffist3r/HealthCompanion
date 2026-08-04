import { useCallback, useState } from 'react';
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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { DailyReport, WeeklyReport } from '@health-companion/shared';
import {
  fetchDailyReport,
  fetchDailyVoiceBriefing,
  fetchDailyVoiceVideo,
  fetchWeeklyReport,
} from '../api/client';

export default function ReportsScreen() {
  const isDark = useColorScheme() === 'dark';
  const [mode, setMode] = useState<'daily' | 'weekly'>('daily');
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'daily') {
        setDaily(await fetchDailyReport());
      } else {
        setWeekly(await fetchWeeklyReport());
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

  return (
    <ScrollView
      style={t.root}
      contentContainerStyle={t.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Text style={t.title}>Reports</Text>
      <Text style={t.sub}>Meals, glucose & activity in one place</Text>

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
      </View>

      {loading && !daily && !weekly ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}

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
          </Text>
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
    </ScrollView>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { padding: 16, paddingBottom: 40 },
    title: { fontSize: 24, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    sub: { marginTop: 4, marginBottom: 16, color: isDark ? '#9aa4b2' : '#667' },
    tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    tab: {
      flex: 1,
      padding: 10,
      borderRadius: 10,
      backgroundColor: isDark ? '#21262d' : '#e5e7eb',
      alignItems: 'center',
    },
    tabOn: { backgroundColor: '#0d9488' },
    tabText: { fontWeight: '600', color: isDark ? '#c9d1d9' : '#333' },
    tabTextOn: { color: '#fff' },
    card: {
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 14,
      padding: 16,
      gap: 8,
    },
    cardTitle: { fontSize: 18, fontWeight: '700', color: isDark ? '#fff' : '#111', marginBottom: 4 },
    voiceBtn: {
      backgroundColor: '#0d9488',
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: 'center',
      marginBottom: 4,
    },
    videoBtn: {
      backgroundColor: '#b45309',
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: 'center',
      marginBottom: 4,
    },
    voiceBtnBusy: { opacity: 0.7 },
    voiceBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    video: {
      width: '100%',
      height: 360,
      borderRadius: 12,
      backgroundColor: '#000',
      marginTop: 4,
    },
    transcript: {
      color: isDark ? '#e6edf3' : '#1f2937',
      fontSize: 14,
      lineHeight: 22,
      marginTop: 4,
      writingDirection: 'auto',
    },
    disclaimer: { color: isDark ? '#8b949e' : '#6b7280', fontSize: 12, marginBottom: 4 },
    line: { color: isDark ? '#c9d1d9' : '#444', fontSize: 14, lineHeight: 20 },
    insight: { color: isDark ? '#9aa4b2' : '#556', fontSize: 13, marginTop: 4 },
    warn: {
      marginTop: 8,
      padding: 10,
      borderRadius: 10,
      backgroundColor: isDark ? '#3d1f1f' : '#fef2f2',
    },
    warnTitle: { fontWeight: '700', color: isDark ? '#fca5a5' : '#b91c1c', marginBottom: 4 },
  });

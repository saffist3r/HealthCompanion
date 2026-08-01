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
  Share,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { DailyReport, WeeklyReport } from '@health-companion/shared';
import { fetchDailyReport, fetchWeeklyReport } from '../api/client';

export default function ReportsScreen() {
  const isDark = useColorScheme() === 'dark';
  const [mode, setMode] = useState<'daily' | 'weekly'>('daily');
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
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

  const shareAgentPrompt = async () => {
    const text = daily?.agentPrompt;
    if (!text) {
      Alert.alert('Agent prompt', 'No briefing available for this day.');
      return;
    }
    try {
      await Share.share({ message: text, title: `Day briefing · ${daily?.date || ''}` });
    } catch (e) {
      Alert.alert('Share failed', String(e));
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
          {daily.agentPrompt ? (
            <View style={t.promptBox}>
              <Text style={t.promptTitle}>AI agent briefing</Text>
              <Text style={t.promptBody} numberOfLines={8}>
                {daily.agentPrompt}
              </Text>
              <TouchableOpacity style={t.shareBtn} onPress={shareAgentPrompt}>
                <Text style={t.shareBtnText}>Share / copy prompt</Text>
              </TouchableOpacity>
            </View>
          ) : null}
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
    line: { color: isDark ? '#c9d1d9' : '#444', fontSize: 14, lineHeight: 20 },
    insight: { color: isDark ? '#9aa4b2' : '#556', fontSize: 13, marginTop: 4 },
    warn: {
      marginTop: 8,
      padding: 10,
      borderRadius: 10,
      backgroundColor: isDark ? '#3d1f1f' : '#fef2f2',
    },
    warnTitle: { fontWeight: '700', color: isDark ? '#fca5a5' : '#b91c1c', marginBottom: 4 },
    promptBox: {
      marginTop: 8,
      marginBottom: 4,
      padding: 12,
      borderRadius: 12,
      backgroundColor: isDark ? '#0f172a' : '#f1f5f9',
      gap: 8,
    },
    promptTitle: { fontWeight: '700', color: isDark ? '#e2e8f0' : '#0f172a', fontSize: 14 },
    promptBody: { color: isDark ? '#94a3b8' : '#475569', fontSize: 12, lineHeight: 17 },
    shareBtn: {
      alignSelf: 'flex-start',
      backgroundColor: '#0d9488',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
    },
    shareBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  });

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
  });

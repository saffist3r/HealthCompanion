import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { Injury, InjuryActivityKind } from '@health-companion/shared';
import { INJURY_ACTIVITY_OPTIONS, toDateKey } from '@health-companion/shared';
import { fetchInjuries, logInjuryPain } from '../api/client';
import { getAccessToken } from '../api/auth';
import { InjuryPainCard, PAIN_PRESETS, painColor, painWord } from '../components/PainScoreControls';

type PainLogParams = { injuryId?: string };

function seedScore(inj: Injury): number {
  if (inj.todayPain?.painScore != null) return inj.todayPain.painScore;
  if (inj.latestPain?.painScore != null) return inj.latestPain.painScore;
  return 3;
}

function injuryLabel(inj: Injury): string {
  return inj.title || inj.bodyAreaLabel || inj.injuryType || 'Injury';
}

export default function PainLogScreen() {
  const isDark = useColorScheme() === 'dark';
  const nav = useNavigation();
  const route = useRoute<RouteProp<{ PainLog: PainLogParams }, 'PainLog'>>();
  const insets = useSafeAreaInsets();
  const t = styles(isDark);
  const focusId = route.params?.injuryId;
  const date = useMemo(() => toDateKey(Date.now()), []);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [activity, setActivity] = useState<InjuryActivityKind | ''>('');
  const [notes, setNotes] = useState('');
  const [contextOpen, setContextOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchInjuries('open');
      setInjuries(list);
      const next: Record<string, number> = {};
      for (const inj of list) next[inj.id] = seedScore(inj);
      setScores(next);
    } catch (e) {
      Alert.alert('Pain log', String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setScore = (id: string, n: number) => {
    setScores((prev) => ({ ...prev, [id]: n }));
  };

  const applyAll = (n: number) => {
    setScores((prev) => {
      const next = { ...prev };
      for (const inj of injuries) next[inj.id] = n;
      return next;
    });
    void Haptics.selectionAsync().catch(() => {});
  };

  const saveAll = async () => {
    if (!(await getAccessToken())) {
      Alert.alert('Sign in required', 'Sign in first.');
      return;
    }
    if (injuries.length === 0) {
      Alert.alert('Pain log', 'No open injuries to rate.');
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        injuries.map((inj) =>
          logInjuryPain(inj.id, {
            date,
            painScore: Math.round(scores[inj.id] ?? seedScore(inj)),
            relatedActivityKind: activity || undefined,
            notes: notes.trim() || undefined,
          })
        )
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      DeviceEventEmitter.emit('entry-saved');
      nav.goBack();
    } catch (e) {
      Alert.alert('Pain log', String(e));
    } finally {
      setBusy(false);
    }
  };

  const loggedCount = injuries.filter((inj) => inj.todayPain).length;

  return (
    <View style={[t.root, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {loading ? (
        <ActivityIndicator color="#0d9488" style={{ marginTop: 40 }} />
      ) : injuries.length === 0 ? (
        <View style={t.empty}>
          <Text style={t.emptyTitle}>No open injuries</Text>
          <Text style={t.emptySub}>Create an injury from + → Injury first.</Text>
          <TouchableOpacity style={t.btn} onPress={() => nav.goBack()}>
            <Text style={t.btnText}>Close</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView
            style={t.scroll}
            contentContainerStyle={t.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={t.lead}>
              Rate every open injury, then save once.
              {loggedCount > 0
                ? ` ${loggedCount}/${injuries.length} already logged today — you can update.`
                : ''}
            </Text>

            {injuries.length > 1 ? (
              <View style={t.applyAll}>
                <Text style={t.applyLabel}>Set all to</Text>
                <View style={t.applyRow}>
                  {PAIN_PRESETS.map((p) => (
                    <TouchableOpacity
                      key={p.score}
                      onPress={() => applyAll(p.score)}
                      style={[t.applyChip, { backgroundColor: painColor(p.score) }]}
                    >
                      <Text style={t.applyChipText}>{p.score}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            {injuries.map((inj) => {
              const last =
                inj.todayPain?.painScore ?? inj.latestPain?.painScore ?? null;
              const subtitleBits = [
                inj.bodyAreaLabel || inj.injuryType,
                last != null
                  ? inj.todayPain
                    ? `today ${last}/10`
                    : `last ${last}/10`
                  : null,
              ].filter(Boolean);
              return (
                <InjuryPainCard
                  key={inj.id}
                  title={injuryLabel(inj)}
                  subtitle={subtitleBits.join(' · ')}
                  value={scores[inj.id] ?? seedScore(inj)}
                  onChange={(n) => setScore(inj.id, n)}
                  isDark={!!isDark}
                  focused={focusId === inj.id}
                />
              );
            })}

            <TouchableOpacity onPress={() => setContextOpen((v) => !v)} style={t.contextToggle}>
              <Text style={t.contextToggleText}>
                {contextOpen ? 'Hide shared context' : 'Add shared context (optional)'}
              </Text>
            </TouchableOpacity>

            {contextOpen ? (
              <View style={t.contextBox}>
                <Text style={t.applyLabel}>Related to (applies to all)</Text>
                <View style={t.chipRow}>
                  {INJURY_ACTIVITY_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[t.chip, activity === opt.value && t.chipOn]}
                      onPress={() =>
                        setActivity((prev) => (prev === opt.value ? '' : opt.value))
                      }
                    >
                      <Text style={[t.chipText, activity === opt.value && t.chipTextOn]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={t.input}
                  placeholder="Notes for all (optional)"
                  placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                  value={notes}
                  onChangeText={setNotes}
                />
              </View>
            ) : null}
          </ScrollView>

          <View style={t.footer}>
            <TouchableOpacity
              style={[t.btn, busy && { opacity: 0.7 }]}
              onPress={saveAll}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={t.btnText}>
                  Save all · {injuries.length}{' '}
                  {injuries.length === 1 ? 'injury' : 'injuries'}
                  {injuries.length === 1
                    ? ` · ${painWord(scores[injuries[0].id] ?? 3)}`
                    : ''}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f3f7f6' },
    scroll: { flex: 1 },
    content: { padding: 16, paddingBottom: 24 },
    lead: {
      color: isDark ? '#9aa4b2' : '#64748b',
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 14,
    },
    empty: { flex: 1, padding: 24, justifyContent: 'center' },
    emptyTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: isDark ? '#e6edf3' : '#111',
      marginBottom: 8,
    },
    emptySub: { color: isDark ? '#8b949e' : '#667', marginBottom: 20, lineHeight: 20 },
    applyAll: {
      marginBottom: 14,
      padding: 12,
      borderRadius: 14,
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#30363d' : '#e2e8f0',
    },
    applyLabel: {
      color: isDark ? '#8b949e' : '#64748b',
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    applyRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    applyChip: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    applyChipText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    contextToggle: { paddingVertical: 10, marginBottom: 4 },
    contextToggleText: { color: '#0d9488', fontWeight: '700', fontSize: 14 },
    contextBox: { marginBottom: 8 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: isDark ? '#21262d' : '#eef2f7',
    },
    chipOn: { backgroundColor: '#0d9488' },
    chipText: { color: isDark ? '#c9d1d9' : '#334155', fontWeight: '600', fontSize: 13 },
    chipTextOn: { color: '#fff' },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#30363d' : '#e2e8f0',
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: isDark ? '#e6edf3' : '#111',
      fontSize: 15,
    },
    footer: {
      paddingHorizontal: 16,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: isDark ? '#21262d' : '#e5e7eb',
      backgroundColor: isDark ? '#0d1117' : '#f3f7f6',
    },
    btn: {
      backgroundColor: '#0d9488',
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: 'center',
    },
    btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  });

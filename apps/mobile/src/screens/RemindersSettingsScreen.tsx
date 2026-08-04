import { useCallback, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getNudgePrefs,
  NUDGE_META,
  setNudgePref,
  syncAllNudges,
  type NudgeKind,
  type NudgePrefs,
  MORNING_REMINDER_HOUR,
  MORNING_REMINDER_MINUTE,
} from '../pushNudges';
import { openMorningLog } from '../navigation';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export default function RemindersSettingsScreen() {
  const isDark = useColorScheme() === 'dark';
  const t = styles(isDark);
  const [prefs, setPrefs] = useState<NudgePrefs | null>(null);
  const [busyKind, setBusyKind] = useState<NudgeKind | null>(null);
  const morningLabel = `${pad(MORNING_REMINDER_HOUR)}:${pad(MORNING_REMINDER_MINUTE)}`;

  useFocusEffect(
    useCallback(() => {
      getNudgePrefs().then(setPrefs);
    }, [])
  );

  const toggle = async (kind: NudgeKind, next: boolean) => {
    setBusyKind(kind);
    try {
      const updated = await setNudgePref(kind, next);
      setPrefs(updated);
      if (next) {
        const ok = await syncAllNudges();
        if (!ok) {
          Alert.alert(
            'Notifications blocked',
            'Allow notifications so Health Companion can send these delightfully unhinged nudges.'
          );
          const reverted = await setNudgePref(kind, false);
          setPrefs(reverted);
        }
      }
    } catch (e) {
      Alert.alert('Reminder', String(e));
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <ScrollView style={t.root} contentContainerStyle={t.content}>
      <Text style={t.title}>Reminders</Text>
      <Text style={t.sub}>
        Local nudges on this phone — funny on purpose, never a substitute for CapAPS or your care team.
        Morning log still lands at {morningLabel}.
      </Text>

      {!prefs ? (
        <ActivityIndicator color="#0d9488" style={{ marginTop: 24 }} />
      ) : (
        <View style={t.card}>
          {NUDGE_META.map((row, i) => (
            <View
              key={row.kind}
              style={[t.row, i < NUDGE_META.length - 1 && t.rowBorder]}
            >
              <View style={{ flex: 1 }}>
                <Text style={t.rowTitle}>{row.title}</Text>
                <Text style={t.rowSub}>{row.blurb}</Text>
              </View>
              <Switch
                value={!!prefs[row.kind]}
                onValueChange={(v) => toggle(row.kind, v)}
                disabled={busyKind === row.kind}
                trackColor={{ false: isDark ? '#30363d' : '#d1d5db', true: '#5eead4' }}
                thumbColor={prefs[row.kind] ? '#0d9488' : '#f4f3f4'}
              />
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={t.btn} onPress={openMorningLog}>
        <Text style={t.btnText}>Open morning log now</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { padding: 16, paddingBottom: 48 },
    title: { fontSize: 24, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    sub: { marginTop: 4, marginBottom: 16, color: isDark ? '#9aa4b2' : '#667', lineHeight: 20 },
    card: {
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 14,
      paddingHorizontal: 14,
      marginBottom: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#30363d' : '#e5e7eb',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? '#30363d' : '#e5e7eb',
    },
    rowTitle: { fontSize: 15, fontWeight: '600', color: isDark ? '#e6edf3' : '#111' },
    rowSub: { marginTop: 3, fontSize: 12, color: isDark ? '#8b949e' : '#6b7280', lineHeight: 17 },
    btn: {
      backgroundColor: '#0d9488',
      padding: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    btnText: { color: '#fff', fontWeight: '700' },
  });

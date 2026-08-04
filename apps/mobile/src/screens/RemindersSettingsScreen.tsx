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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getMorningReminderEnabled,
  MORNING_REMINDER_HOUR,
  MORNING_REMINDER_MINUTE,
  setMorningReminderEnabled,
} from '../morningReminder';
import { openMorningLog } from '../navigation';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export default function RemindersSettingsScreen() {
  const isDark = useColorScheme() === 'dark';
  const t = styles(isDark);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const timeLabel = `${pad(MORNING_REMINDER_HOUR)}:${pad(MORNING_REMINDER_MINUTE)}`;

  useFocusEffect(
    useCallback(() => {
      getMorningReminderEnabled().then(setEnabled);
    }, [])
  );

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const stillOn = await setMorningReminderEnabled(next);
      setEnabled(stillOn);
      if (next && !stillOn) {
        Alert.alert(
          'Notifications blocked',
          'Allow notifications for Health Companion to get the daily 10:30 reminder.'
        );
      }
    } catch (e) {
      Alert.alert('Reminder', String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={t.root} contentContainerStyle={t.content}>
      <Text style={t.title}>Reminders</Text>
      <Text style={t.sub}>Local daily nudge on this phone (device time zone).</Text>

      <View style={t.card}>
        <View style={t.row}>
          <View style={{ flex: 1 }}>
            <Text style={t.rowTitle}>Morning check-in</Text>
            <Text style={t.rowSub}>Every day at {timeLabel} — opens weight + mental log</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={toggle}
            disabled={busy}
            trackColor={{ false: isDark ? '#30363d' : '#d1d5db', true: '#5eead4' }}
            thumbColor={enabled ? '#0d9488' : '#f4f3f4'}
          />
        </View>
      </View>

      <TouchableOpacity style={t.btn} onPress={openMorningLog}>
        <Text style={t.btnText}>Open morning log now</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#0d1117' : '#f5f7fa' },
    content: { padding: 16, paddingBottom: 40 },
    title: { fontSize: 24, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    sub: { marginTop: 4, marginBottom: 16, color: isDark ? '#9aa4b2' : '#667' },
    card: {
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderRadius: 14,
      padding: 14,
      marginBottom: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#30363d' : '#e5e7eb',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowTitle: { fontSize: 16, fontWeight: '600', color: isDark ? '#e6edf3' : '#111' },
    rowSub: { marginTop: 4, fontSize: 13, color: isDark ? '#8b949e' : '#6b7280', lineHeight: 18 },
    btn: {
      backgroundColor: '#0d9488',
      padding: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    btnText: { color: '#fff', fontWeight: '700' },
  });

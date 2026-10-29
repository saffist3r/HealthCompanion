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
import { useNavigation } from '@react-navigation/native';
import type {
  AdhdIntensity,
  FocusLevel,
  MoodLevel,
  TaskInitiation,
  WakeQuality,
} from '@health-companion/shared';
import {
  ADHD_INTENSITY_OPTIONS,
  FOCUS_OPTIONS,
  MOOD_OPTIONS,
  TASK_INITIATION_OPTIONS,
  WAKE_QUALITY_OPTIONS,
  toDateKey,
} from '@health-companion/shared';
import {
  fetchDayCheckIn,
  fetchWeightHistory,
  logWeight,
  upsertDayCheckIn,
} from '../api/client';
import { getAccessToken } from '../api/auth';

export default function MorningLogScreen() {
  const isDark = useColorScheme() === 'dark';
  const nav = useNavigation();
  const t = styles(isDark);
  const date = useMemo(() => toDateKey(Date.now()), []);

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [weightKg, setWeightKg] = useState('');
  const [weightNotes, setWeightNotes] = useState('');
  const [mood, setMood] = useState<MoodLevel>('ok');
  const [wakeQuality, setWakeQuality] = useState<WakeQuality>('ok');
  const [focus, setFocus] = useState<FocusLevel>('ok');
  const [restlessness, setRestlessness] = useState<AdhdIntensity>('ok');
  const [overwhelm, setOverwhelm] = useState<AdhdIntensity>('ok');
  const [taskInitiation, setTaskInitiation] = useState<TaskInitiation>('ok');
  const [impulsivity, setImpulsivity] = useState<AdhdIntensity>('ok');
  const [medicationTaken, setMedicationTaken] = useState(false);
  const [hyperfocus, setHyperfocus] = useState(false);
  const [sleepHours, setSleepHours] = useState('');
  const [checkInNotes, setCheckInNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [checkIn, weights] = await Promise.all([
        fetchDayCheckIn(date).catch(() => null),
        fetchWeightHistory(5).catch(() => []),
      ]);
      const todayWeight = weights.find((w) => w.date === date);
      const lastWeight = todayWeight || weights[0];
      if (lastWeight) setWeightKg(String(lastWeight.weightKg));
      if (todayWeight?.notes) setWeightNotes(todayWeight.notes);
      if (checkIn) {
        if (MOOD_OPTIONS.some((o) => o.value === checkIn.mood)) setMood(checkIn.mood as MoodLevel);
        if (WAKE_QUALITY_OPTIONS.some((o) => o.value === checkIn.wakeQuality)) {
          setWakeQuality(checkIn.wakeQuality as WakeQuality);
        }
        if (checkIn.focus && FOCUS_OPTIONS.some((o) => o.value === checkIn.focus)) {
          setFocus(checkIn.focus as FocusLevel);
        }
        if (checkIn.restlessness && ADHD_INTENSITY_OPTIONS.some((o) => o.value === checkIn.restlessness)) {
          setRestlessness(checkIn.restlessness as AdhdIntensity);
        }
        if (checkIn.overwhelm && ADHD_INTENSITY_OPTIONS.some((o) => o.value === checkIn.overwhelm)) {
          setOverwhelm(checkIn.overwhelm as AdhdIntensity);
        }
        if (
          checkIn.taskInitiation &&
          TASK_INITIATION_OPTIONS.some((o) => o.value === checkIn.taskInitiation)
        ) {
          setTaskInitiation(checkIn.taskInitiation as TaskInitiation);
        }
        if (checkIn.impulsivity && ADHD_INTENSITY_OPTIONS.some((o) => o.value === checkIn.impulsivity)) {
          setImpulsivity(checkIn.impulsivity as AdhdIntensity);
        }
        setMedicationTaken(!!checkIn.medicationTaken);
        setHyperfocus(!!checkIn.hyperfocus);
        setSleepHours(checkIn.sleepHours != null ? String(checkIn.sleepHours) : '');
        setCheckInNotes(checkIn.notes || '');
      }
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const saveAll = async () => {
    if (!(await getAccessToken())) {
      Alert.alert('Sign in required', 'Sign in first.');
      return;
    }
    const kg = Number(String(weightKg).replace(',', '.'));
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) {
      Alert.alert('Weight', 'Enter a valid weight in kg (e.g. 82.5).');
      return;
    }
    const sleep = sleepHours.trim() ? Number(String(sleepHours).replace(',', '.')) : undefined;
    if (sleep != null && (!Number.isFinite(sleep) || sleep < 0 || sleep > 24)) {
      Alert.alert('Sleep', 'Enter sleep hours between 0 and 24.');
      return;
    }

    setBusy(true);
    try {
      await Promise.all([
        logWeight({
          date,
          weightKg: Math.round(kg * 10) / 10,
          notes: weightNotes.trim() || undefined,
        }),
        upsertDayCheckIn({
          date,
          mood,
          wakeQuality,
          focus,
          restlessness,
          overwhelm,
          taskInitiation,
          impulsivity,
          medicationTaken,
          hyperfocus,
          sleepHours: sleep,
          notes: checkInNotes.trim() || undefined,
        }),
      ]);
      DeviceEventEmitter.emit('entry-saved');
      Alert.alert('Saved', 'Morning check-in and weight logged.', [
        { text: 'OK', onPress: () => nav.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Save failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const ChipRow = <T extends string>({
    label,
    options,
    value,
    onChange,
  }: {
    label: string;
    options: ReadonlyArray<{ value: T; label: string }>;
    value: T;
    onChange: (v: T) => void;
  }) => (
    <View style={t.block}>
      <Text style={t.hint}>{label}</Text>
      <View style={t.chipRow}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[t.chip, value === opt.value && t.chipOn]}
            onPress={() => onChange(opt.value)}
          >
            <Text style={[t.chipText, value === opt.value && t.chipTextOn]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={[t.root, t.center]}>
        <ActivityIndicator color="#0891B2" />
      </View>
    );
  }

  return (
    <ScrollView style={t.root} contentContainerStyle={t.content} keyboardShouldPersistTaps="handled">
      <Text style={t.title}>Morning log</Text>
      <Text style={t.sub}>
        Quick daily check for {date} — weight and mental check-in in one save.
      </Text>

      <View style={t.card}>
        <Text style={t.section}>Weight</Text>
        <TextInput
          style={t.input}
          placeholder="Weight (kg) *"
          placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
          value={weightKg}
          onChangeText={setWeightKg}
          keyboardType="decimal-pad"
        />
        <TextInput
          style={t.input}
          placeholder="Notes (optional)"
          placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
          value={weightNotes}
          onChangeText={setWeightNotes}
        />
      </View>

      <View style={t.card}>
        <Text style={t.section}>Mental check-in</Text>
        <ChipRow label="Mood" options={MOOD_OPTIONS} value={mood} onChange={setMood} />
        <ChipRow
          label="How you woke up"
          options={WAKE_QUALITY_OPTIONS}
          value={wakeQuality}
          onChange={setWakeQuality}
        />
        <ChipRow label="Focus / attention" options={FOCUS_OPTIONS} value={focus} onChange={setFocus} />
        <ChipRow
          label="Restlessness"
          options={ADHD_INTENSITY_OPTIONS}
          value={restlessness}
          onChange={setRestlessness}
        />
        <ChipRow
          label="Overwhelm"
          options={ADHD_INTENSITY_OPTIONS}
          value={overwhelm}
          onChange={setOverwhelm}
        />
        <ChipRow
          label="Task initiation"
          options={TASK_INITIATION_OPTIONS}
          value={taskInitiation}
          onChange={setTaskInitiation}
        />
        <ChipRow
          label="Impulsivity"
          options={ADHD_INTENSITY_OPTIONS}
          value={impulsivity}
          onChange={setImpulsivity}
        />
        <View style={t.chipRow}>
          <TouchableOpacity
            style={[t.chip, medicationTaken && t.chipOn]}
            onPress={() => setMedicationTaken((v) => !v)}
          >
            <Text style={[t.chipText, medicationTaken && t.chipTextOn]}>Meds taken</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[t.chip, hyperfocus && t.chipOn]}
            onPress={() => setHyperfocus((v) => !v)}
          >
            <Text style={[t.chipText, hyperfocus && t.chipTextOn]}>Hyperfocus</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={t.input}
          placeholder="Sleep hours (optional)"
          placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
          value={sleepHours}
          onChangeText={setSleepHours}
          keyboardType="decimal-pad"
        />
        <TextInput
          style={t.input}
          placeholder="Notes (optional)"
          placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
          value={checkInNotes}
          onChangeText={setCheckInNotes}
        />
      </View>

      <TouchableOpacity style={t.btn} onPress={saveAll} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={t.btnText}>Save morning log</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: isDark ? '#070B14' : '#f5f7fa' },
    center: { alignItems: 'center', justifyContent: 'center' },
    content: { padding: 16, paddingBottom: 48 },
    title: { fontSize: 24, fontWeight: '700', color: isDark ? '#fff' : '#111' },
    sub: { marginTop: 4, marginBottom: 16, color: isDark ? '#9aa4b2' : '#667', lineHeight: 20 },
    card: {
      backgroundColor: isDark ? '#0E1624' : '#fff',
      borderRadius: 14,
      padding: 14,
      marginBottom: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? '#1E3350' : '#e5e7eb',
    },
    section: {
      fontSize: 17,
      fontWeight: '700',
      color: isDark ? '#E6F4FF' : '#111',
      marginBottom: 10,
    },
    block: { marginBottom: 10 },
    hint: { fontSize: 13, color: isDark ? '#8CA0BC' : '#666', marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#1E3350' : '#ddd',
      borderRadius: 10,
      padding: 12,
      color: isDark ? '#E6F4FF' : '#111',
      marginBottom: 8,
      backgroundColor: isDark ? '#070B14' : '#fff',
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: isDark ? '#16233A' : '#e5e7eb',
    },
    chipOn: { backgroundColor: '#0891B2' },
    chipText: { color: isDark ? '#E6F4FF' : '#111', fontWeight: '600', fontSize: 13 },
    chipTextOn: { color: '#fff' },
    btn: {
      backgroundColor: '#0891B2',
      padding: 16,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 4,
    },
    btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  });

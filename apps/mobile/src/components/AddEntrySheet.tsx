import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  useColorScheme,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
  Pressable,
  DeviceEventEmitter,
  Platform,
  PanResponder,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  AdhdIntensity,
  CareVisitKind,
  CaffeineDrink,
  FocusLevel,
  Injury,
  InjuryActivityKind,
  InjuryBodyArea,
  InjuryType,
  MoodLevel,
  SportIntensity,
  SportKind,
  SportMatchResult,
  StressLevel,
  TaskInitiation,
  WakeQuality,
} from '@health-companion/shared';
import {
  ADHD_INTENSITY_OPTIONS,
  CAFFEINE_DRINK_OPTIONS,
  FOCUS_OPTIONS,
  INJURY_ACTIVITY_OPTIONS,
  INJURY_BODY_AREA_OPTIONS,
  INJURY_TYPE_OPTIONS,
  MOOD_OPTIONS,
  SPORT_INTENSITY_OPTIONS,
  SPORT_KIND_OPTIONS,
  STRESS_LEVEL_OPTIONS,
  TASK_INITIATION_OPTIONS,
  WAKE_QUALITY_OPTIONS,
  isCompetitiveSport,
  toDateKey,
} from '@health-companion/shared';
import {
  createCareVisit,
  createCaffeineLog,
  createInjury,
  createSportMatch,
  createStressLog,
  fetchDayCheckIn,
  fetchInjuries,
  logInjuryPain,
  logWeight,
  upsertDayCheckIn,
} from '../api/client';
import { getAccessToken } from '../api/auth';
import { AppIcons, careKindIcon, sportResultIcon } from '../ui/appIcons';
import { onCareLogged, onMealLogged, onSportLogged } from '../pushNudges';

export type EntryKind = 'meal' | 'care' | 'sport' | 'weight' | 'injury' | 'checkin' | 'caffeine' | 'stress';
type InjuryMode = 'choose' | 'new' | 'pain';

function painColor(score: number) {
  if (score >= 7) return '#e11d48';
  if (score >= 4) return '#f59e0b';
  return '#10b981';
}

function stressColor(score: number) {
  if (score < 40) return '#e11d48';
  if (score < 70) return '#f59e0b';
  return '#10b981';
}

function stressLevelFromScore(score: number): StressLevel {
  if (score >= 70) return 'calm';
  if (score >= 40) return 'ok';
  return 'high';
}

function ScoreSlider({
  value,
  onChange,
  isDark,
  label,
  max,
  colorFor,
  lowLabel,
  highLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  isDark: boolean;
  label: string;
  max: number;
  colorFor: (n: number) => string;
  lowLabel: string;
  highLabel: string;
}) {
  const [trackWidth, setTrackWidth] = useState(1);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const widthRef = useRef(1);

  const scoreFromX = (x: number) => {
    const w = widthRef.current || 1;
    return Math.round(Math.max(0, Math.min(max, (x / w) * max)));
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => onChangeRef.current(scoreFromX(e.nativeEvent.locationX)),
        onPanResponderMove: (e) => onChangeRef.current(scoreFromX(e.nativeEvent.locationX)),
      }),
    [max]
  );

  const color = colorFor(value);
  const thumbLeft = Math.max(0, Math.min(trackWidth - 28, (value / max) * trackWidth - 14));

  return (
    <View style={{ marginBottom: 12 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <Text style={{ color: isDark ? '#8b949e' : '#666', fontSize: 13, fontWeight: '600' }}>
          {label}
        </Text>
        <Text style={{ color, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
          {value}
          <Text style={{ fontSize: 14, fontWeight: '600', color: isDark ? '#8b949e' : '#9ca3af' }}>
            {' '}
            / {max}
          </Text>
        </Text>
      </View>
      <View
        onLayout={(e: LayoutChangeEvent) => {
          const w = e.nativeEvent.layout.width;
          widthRef.current = w;
          setTrackWidth(w);
        }}
        {...pan.panHandlers}
        style={{
          height: 36,
          borderRadius: 18,
          backgroundColor: isDark ? '#21262d' : '#e5e7eb',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max, now: value }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: (value / max) * trackWidth,
            backgroundColor: color,
            opacity: 0.85,
            borderRadius: 18,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: thumbLeft,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: '#fff',
            borderWidth: 2,
            borderColor: color,
            top: 4,
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 3,
            elevation: 2,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text style={{ color: isDark ? '#6e7681' : '#9ca3af', fontSize: 11 }}>{lowLabel}</Text>
        <Text style={{ color: isDark ? '#6e7681' : '#9ca3af', fontSize: 11 }}>{highLabel}</Text>
      </View>
    </View>
  );
}

function PainScoreSlider({
  value,
  onChange,
  isDark,
}: {
  value: number;
  onChange: (n: number) => void;
  isDark: boolean;
}) {
  return (
    <ScoreSlider
      value={value}
      onChange={onChange}
      isDark={isDark}
      label="Pain"
      max={10}
      colorFor={painColor}
      lowLabel="None"
      highLabel="Worst"
    />
  );
}

function StressScoreSlider({
  value,
  onChange,
  isDark,
}: {
  value: number;
  onChange: (n: number) => void;
  isDark: boolean;
}) {
  const level = stressLevelFromScore(value);
  const levelLabel = STRESS_LEVEL_OPTIONS.find((o) => o.level === level)?.label || level;
  return (
    <View>
      <ScoreSlider
        value={value}
        onChange={onChange}
        isDark={isDark}
        label={`Stress · ${levelLabel}`}
        max={100}
        colorFor={stressColor}
        lowLabel="High stress"
        highLabel="Calm"
      />
    </View>
  );
}

const CARE_KIND_OPTIONS: Array<{ kind: CareVisitKind; label: string }> = [
  { kind: 'kine', label: 'Kiné' },
  { kind: 'osteo', label: 'Ostéo' },
  { kind: 'podologue', label: 'Podologue' },
  { kind: 'other', label: 'Other' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
  onCaptureMeal?: () => void;
};

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d.getTime());
}

export default function AddEntrySheet({ visible, onClose, onSaved, onCaptureMeal }: Props) {
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  const bottomPad = 28 + (Platform.OS === 'android' ? Math.max(insets.bottom, 48) : Math.max(insets.bottom, 8));
  const t = styles(isDark);
  const today = useMemo(() => toDateKey(Date.now()), [visible]);
  const [kind, setKind] = useState<EntryKind | null>(null);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);

  const [careKind, setCareKind] = useState<CareVisitKind>('kine');
  const [careLabel, setCareLabel] = useState('');
  const [careNotes, setCareNotes] = useState('');
  const [padelResult, setPadelResult] = useState<SportMatchResult>('win');
  const [sportKind, setSportKind] = useState<SportKind>('padel');
  const [customSport, setCustomSport] = useState('');
  const [intensity, setIntensity] = useState<SportIntensity>('moderate');
  const [padelScore, setPadelScore] = useState('');
  const [padelDuration, setPadelDuration] = useState('');
  const [padelTime, setPadelTime] = useState('');
  const [padelNotes, setPadelNotes] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [weightNotes, setWeightNotes] = useState('');
  const [injuryMode, setInjuryMode] = useState<InjuryMode>('choose');
  const [openInjuries, setOpenInjuries] = useState<Injury[]>([]);
  const [injuryType, setInjuryType] = useState<InjuryType>('sprain');
  const [bodyArea, setBodyArea] = useState<InjuryBodyArea>('knee_right');
  const [bodyAreaOther, setBodyAreaOther] = useState('');
  const [injuryTitle, setInjuryTitle] = useState('');
  const [injuryExercises, setInjuryExercises] = useState('');
  const [injuryNotes, setInjuryNotes] = useState('');
  const [activityTags, setActivityTags] = useState<InjuryActivityKind[]>(['sport']);
  const [painInjuryId, setPainInjuryId] = useState<string | null>(null);
  const [painScore, setPainScore] = useState(4);
  const [painActivity, setPainActivity] = useState<InjuryActivityKind | ''>('sport');
  const [painNotes, setPainNotes] = useState('');
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
  const [caffeineDrink, setCaffeineDrink] = useState<CaffeineDrink>('coffee');
  const [caffeineTime, setCaffeineTime] = useState('');
  const [caffeineNotes, setCaffeineNotes] = useState('');
  const [stressScore, setStressScore] = useState(55);
  const [stressNotes, setStressNotes] = useState('');

  useEffect(() => {
    if (visible) {
      setKind(null);
      setDate(toDateKey(Date.now()));
      setCareLabel('');
      setCareNotes('');
      setPadelScore('');
      setPadelDuration('');
      setPadelTime('');
      setPadelNotes('');
      setCustomSport('');
      setIntensity('moderate');
      setCareKind('kine');
      setPadelResult('win');
      setSportKind('padel');
      setWeightKg('');
      setWeightNotes('');
      setInjuryMode('choose');
      setInjuryType('sprain');
      setBodyArea('knee_right');
      setBodyAreaOther('');
      setInjuryTitle('');
      setInjuryExercises('');
      setInjuryNotes('');
      setActivityTags(['sport']);
      setPainInjuryId(null);
      setPainScore(4);
      setPainActivity('sport');
      setPainNotes('');
      setMood('ok');
      setWakeQuality('ok');
      setFocus('ok');
      setRestlessness('ok');
      setOverwhelm('ok');
      setTaskInitiation('ok');
      setImpulsivity('ok');
      setMedicationTaken(false);
      setHyperfocus(false);
      setSleepHours('');
      setCheckInNotes('');
      setCaffeineDrink('coffee');
      setCaffeineTime('');
      setCaffeineNotes('');
      setStressScore(55);
      setStressNotes('');
      fetchInjuries('open')
        .then((list) => setOpenInjuries(list))
        .catch(() => setOpenInjuries([]));
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || kind !== 'checkin') return;
    fetchDayCheckIn(date)
      .then((row) => {
        if (!row) return;
        if (MOOD_OPTIONS.some((o) => o.value === row.mood)) setMood(row.mood as MoodLevel);
        if (WAKE_QUALITY_OPTIONS.some((o) => o.value === row.wakeQuality)) {
          setWakeQuality(row.wakeQuality as WakeQuality);
        }
        if (row.focus && FOCUS_OPTIONS.some((o) => o.value === row.focus)) {
          setFocus(row.focus as FocusLevel);
        }
        if (row.restlessness && ADHD_INTENSITY_OPTIONS.some((o) => o.value === row.restlessness)) {
          setRestlessness(row.restlessness as AdhdIntensity);
        }
        if (row.overwhelm && ADHD_INTENSITY_OPTIONS.some((o) => o.value === row.overwhelm)) {
          setOverwhelm(row.overwhelm as AdhdIntensity);
        }
        if (row.taskInitiation && TASK_INITIATION_OPTIONS.some((o) => o.value === row.taskInitiation)) {
          setTaskInitiation(row.taskInitiation as TaskInitiation);
        }
        if (row.impulsivity && ADHD_INTENSITY_OPTIONS.some((o) => o.value === row.impulsivity)) {
          setImpulsivity(row.impulsivity as AdhdIntensity);
        }
        setMedicationTaken(!!row.medicationTaken);
        setHyperfocus(!!row.hyperfocus);
        setSleepHours(row.sleepHours != null ? String(row.sleepHours) : '');
        setCheckInNotes(row.notes || '');
      })
      .catch(() => undefined);
  }, [visible, kind, date]);

  const requireAuth = async () => {
    if (!(await getAccessToken())) {
      Alert.alert('Sign in required', 'Sign in first.');
      return false;
    }
    return true;
  };

  const finish = () => {
    DeviceEventEmitter.emit('entry-saved');
    onSaved?.();
    onClose();
  };

  const saveCare = async () => {
    if (!(await requireAuth())) return;
    setBusy(true);
    try {
      await createCareVisit({
        date,
        kind: careKind,
        label: careLabel.trim() || undefined,
        notes: careNotes.trim() || undefined,
      });
      void onCareLogged();
      finish();
    } catch (e) {
      Alert.alert('Care visit', String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSport = async () => {
    if (!(await requireAuth())) return;
    const durationMin = Number(padelDuration);
    if (!Number.isFinite(durationMin) || durationMin <= 0) {
      Alert.alert('Duration required', 'Enter how long you trained (minutes).');
      return;
    }
    const competitive = isCompetitiveSport(sportKind);
    const sportName = sportKind === 'other' ? customSport.trim() : sportKind;
    if (!sportName) {
      Alert.alert('Sport name', 'Enter a custom sport name.');
      return;
    }
    setBusy(true);
    try {
      await createSportMatch({
        date,
        time: padelTime.trim() || undefined,
        sport: sportName,
        result: competitive ? padelResult : 'completed',
        score: competitive ? padelScore.trim() : '',
        durationMin: Math.round(durationMin),
        intensity: competitive ? undefined : intensity,
        notes: padelNotes.trim() || undefined,
      });
      void onSportLogged();
      finish();
    } catch (e) {
      Alert.alert('Sport', String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveWeight = async () => {
    if (!(await requireAuth())) return;
    const kg = Number(String(weightKg).replace(',', '.'));
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) {
      Alert.alert('Weight', 'Enter a valid weight in kg (e.g. 82.5).');
      return;
    }
    setBusy(true);
    try {
      await logWeight({
        date,
        weightKg: Math.round(kg * 10) / 10,
        notes: weightNotes.trim() || undefined,
      });
      finish();
    } catch (e) {
      Alert.alert('Weight', String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCheckIn = async () => {
    if (!(await requireAuth())) return;
    const sleep = sleepHours.trim() ? Number(String(sleepHours).replace(',', '.')) : undefined;
    if (sleep != null && (!Number.isFinite(sleep) || sleep < 0 || sleep > 24)) {
      Alert.alert('Sleep', 'Enter sleep hours between 0 and 24.');
      return;
    }
    setBusy(true);
    try {
      await upsertDayCheckIn({
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
      });
      finish();
    } catch (e) {
      Alert.alert('Check-in', String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCaffeine = async () => {
    if (!(await requireAuth())) return;
    setBusy(true);
    try {
      await createCaffeineLog({
        date,
        time: caffeineTime.trim() || undefined,
        drink: caffeineDrink,
        notes: caffeineNotes.trim() || undefined,
      });
      finish();
    } catch (e) {
      Alert.alert('Caffeine', String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveStress = async () => {
    if (!(await requireAuth())) return;
    setBusy(true);
    try {
      await createStressLog({
        date,
        level: stressLevelFromScore(stressScore),
        score: Math.round(stressScore),
        notes: stressNotes.trim() || undefined,
      });
      finish();
    } catch (e) {
      Alert.alert('Stress', String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleActivityTag = (tag: InjuryActivityKind) => {
    setActivityTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const saveInjury = async () => {
    if (!(await requireAuth())) return;
    if (bodyArea === 'other' && !bodyAreaOther.trim()) {
      Alert.alert('Body area', 'Describe the body area.');
      return;
    }
    setBusy(true);
    try {
      await createInjury({
        title: injuryTitle.trim() || undefined,
        injuryType,
        bodyArea,
        bodyAreaOther: bodyArea === 'other' ? bodyAreaOther.trim() : undefined,
        startedOn: date,
        status: 'active',
        relatedActivityKinds: activityTags,
        exerciseNotes: injuryExercises.trim() || undefined,
        notes: injuryNotes.trim() || undefined,
      });
      finish();
    } catch (e) {
      Alert.alert('Injury', String(e));
    } finally {
      setBusy(false);
    }
  };

  const savePain = async () => {
    if (!(await requireAuth())) return;
    if (!painInjuryId) {
      Alert.alert('Injury', 'Pick an injury to log pain against.');
      return;
    }
    const score = Math.round(painScore);
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      Alert.alert('Pain', 'Score must be from 0 to 10.');
      return;
    }
    setBusy(true);
    try {
      await logInjuryPain(painInjuryId, {
        date,
        painScore: score,
        relatedActivityKind: painActivity || undefined,
        notes: painNotes.trim() || undefined,
      });
      finish();
    } catch (e) {
      Alert.alert('Pain', String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickMeal = () => {
    onClose();
    onCaptureMeal?.();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={t.backdrop} onPress={onClose}>
        <Pressable
          style={[t.sheet, { paddingBottom: bottomPad }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={t.handle} />
          <View style={t.sheetHead}>
            <Text style={t.sheetTitle}>{kind ? 'Add entry' : 'What do you want to log?'}</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={t.close}>Close</Text>
            </TouchableOpacity>
          </View>

          <View style={t.dateRow}>
            <Text style={t.dateLabel}>Date</Text>
            <TouchableOpacity style={t.dateChip} onPress={() => setDate(today)}>
              <Text style={[t.dateChipText, date === today && t.dateChipOn]}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={t.dateChip}
              onPress={() => setDate(shiftDate(today, -1))}
            >
              <Text style={[t.dateChipText, date === shiftDate(today, -1) && t.dateChipOn]}>
                Yesterday
              </Text>
            </TouchableOpacity>
            <TextInput
              style={t.dateInput}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
            {!kind ? (
              <View style={t.typeGrid}>
                {(
                  [
                    { id: 'meal' as const, label: 'Meal', icon: AppIcons.meals },
                    { id: 'checkin' as const, label: 'Check-in', icon: AppIcons.checkin },
                    { id: 'caffeine' as const, label: 'Caffeine', icon: AppIcons.caffeine },
                    { id: 'stress' as const, label: 'Stress', icon: AppIcons.stress },
                    { id: 'weight' as const, label: 'Weight', icon: AppIcons.weight },
                    { id: 'injury' as const, label: 'Injury', icon: AppIcons.injury },
                    { id: 'care' as const, label: 'Care visit', icon: AppIcons.kine },
                    { id: 'sport' as const, label: 'Sport', icon: AppIcons.padel },
                  ] as const
                ).map((opt) => (
                  <TouchableOpacity
                    key={opt.id}
                    style={t.typeCard}
                    onPress={() => {
                      if (opt.id === 'meal') pickMeal();
                      else {
                        setKind(opt.id);
                        if (opt.id === 'injury') setInjuryMode('choose');
                      }
                    }}
                  >
                    <Image source={opt.icon} style={t.typeIcon} />
                    <Text style={t.typeLabel}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {kind === 'injury' ? (
              <View>
                <TouchableOpacity
                  onPress={() => {
                    if (injuryMode === 'choose') setKind(null);
                    else setInjuryMode('choose');
                  }}
                >
                  <Text style={t.back}>← Back</Text>
                </TouchableOpacity>
                {injuryMode === 'choose' ? (
                  <View style={t.typeGrid}>
                    <TouchableOpacity style={t.typeCard} onPress={() => setInjuryMode('new')}>
                      <Text style={t.typeLabel}>New injury</Text>
                      <Text style={t.hint}>Type, area, exercises</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={t.typeCard}
                      onPress={() => {
                        setInjuryMode('pain');
                        if (openInjuries[0]) setPainInjuryId(openInjuries[0].id);
                      }}
                    >
                      <Text style={t.typeLabel}>Log pain</Text>
                      <Text style={t.hint}>Daily score 0–10</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                {injuryMode === 'new' ? (
                  <View>
                    <Text style={t.hint}>Started on the selected date above.</Text>
                    <View style={t.chipRow}>
                      {INJURY_TYPE_OPTIONS.map((opt) => (
                        <TouchableOpacity
                          key={opt.value}
                          style={[t.chip, injuryType === opt.value && t.chipOn]}
                          onPress={() => setInjuryType(opt.value)}
                        >
                          <Text style={[t.chipText, injuryType === opt.value && t.chipTextOn]}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={t.chipRow}>
                      {INJURY_BODY_AREA_OPTIONS.map((opt) => (
                        <TouchableOpacity
                          key={opt.value}
                          style={[t.chip, bodyArea === opt.value && t.chipOn]}
                          onPress={() => setBodyArea(opt.value)}
                        >
                          <Text style={[t.chipText, bodyArea === opt.value && t.chipTextOn]}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {bodyArea === 'other' ? (
                      <TextInput
                        style={t.input}
                        placeholder="Body area *"
                        placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                        value={bodyAreaOther}
                        onChangeText={setBodyAreaOther}
                      />
                    ) : null}
                    <TextInput
                      style={t.input}
                      placeholder="Short title (optional)"
                      placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                      value={injuryTitle}
                      onChangeText={setInjuryTitle}
                    />
                    <Text style={t.hint}>Related activity</Text>
                    <View style={t.chipRow}>
                      {INJURY_ACTIVITY_OPTIONS.map((opt) => {
                        const on = activityTags.includes(opt.value);
                        return (
                          <TouchableOpacity
                            key={opt.value}
                            style={[t.chip, on && t.chipOn]}
                            onPress={() => toggleActivityTag(opt.value)}
                          >
                            <Text style={[t.chipText, on && t.chipTextOn]}>{opt.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <TextInput
                      style={[t.input, { minHeight: 72 }]}
                      placeholder="Treatment exercises"
                      placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                      value={injuryExercises}
                      onChangeText={setInjuryExercises}
                      multiline
                    />
                    <TextInput
                      style={t.input}
                      placeholder="Notes (optional)"
                      placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                      value={injuryNotes}
                      onChangeText={setInjuryNotes}
                    />
                    <TouchableOpacity style={t.btn} onPress={saveInjury} disabled={busy}>
                      {busy ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={t.btnText}>Save injury</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : null}
                {injuryMode === 'pain' ? (
                  <View>
                    {openInjuries.length === 0 ? (
                      <Text style={t.hint}>No open injuries. Create one first.</Text>
                    ) : (
                      <>
                        <View style={t.chipRow}>
                          {openInjuries.map((inj) => (
                            <TouchableOpacity
                              key={inj.id}
                              style={[t.chip, painInjuryId === inj.id && t.chipOn]}
                              onPress={() => setPainInjuryId(inj.id)}
                            >
                              <Text
                                style={[t.chipText, painInjuryId === inj.id && t.chipTextOn]}
                              >
                                {inj.title || inj.bodyAreaLabel || inj.injuryType}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <PainScoreSlider value={painScore} onChange={setPainScore} isDark={!!isDark} />
                        <View style={t.chipRow}>
                          {INJURY_ACTIVITY_OPTIONS.map((opt) => (
                            <TouchableOpacity
                              key={opt.value}
                              style={[t.chip, painActivity === opt.value && t.chipOn]}
                              onPress={() =>
                                setPainActivity((prev) => (prev === opt.value ? '' : opt.value))
                              }
                            >
                              <Text
                                style={[
                                  t.chipText,
                                  painActivity === opt.value && t.chipTextOn,
                                ]}
                              >
                                {opt.label}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <TextInput
                          style={t.input}
                          placeholder="Notes (optional)"
                          placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                          value={painNotes}
                          onChangeText={setPainNotes}
                        />
                        <TouchableOpacity style={t.btn} onPress={savePain} disabled={busy}>
                          {busy ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <Text style={t.btnText}>Save pain</Text>
                          )}
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                ) : null}
              </View>
            ) : null}

            {kind === 'weight' ? (
              <View>
                <TouchableOpacity onPress={() => setKind(null)}>
                  <Text style={t.back}>← Back</Text>
                </TouchableOpacity>
                <Text style={t.hint}>Logs kg for the selected day and updates calorie targets.</Text>
                <TextInput
                  style={t.input}
                  placeholder="Weight (kg) *"
                  placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                  value={weightKg}
                  onChangeText={setWeightKg}
                  keyboardType="decimal-pad"
                  autoFocus
                />
                <TextInput
                  style={t.input}
                  placeholder="Notes (optional)"
                  placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                  value={weightNotes}
                  onChangeText={setWeightNotes}
                />
                <TouchableOpacity style={t.btn} onPress={saveWeight} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={t.btnText}>Save weight</Text>}
                </TouchableOpacity>
              </View>
            ) : null}

            {kind === 'checkin' ? (
              <View>
                <TouchableOpacity onPress={() => setKind(null)}>
                  <Text style={t.back}>← Back</Text>
                </TouchableOpacity>
                <Text style={t.hint}>
                  One check-in per day — mood, wake, and ADHD ratings. Saving again updates it.
                </Text>
                <Text style={t.hint}>Mood</Text>
                <View style={t.chipRow}>
                  {MOOD_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[t.chip, mood === opt.value && t.chipOn]}
                      onPress={() => setMood(opt.value)}
                    >
                      <Text style={[t.chipText, mood === opt.value && t.chipTextOn]}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={t.hint}>How you woke up</Text>
                <View style={t.chipRow}>
                  {WAKE_QUALITY_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[t.chip, wakeQuality === opt.value && t.chipOn]}
                      onPress={() => setWakeQuality(opt.value)}
                    >
                      <Text style={[t.chipText, wakeQuality === opt.value && t.chipTextOn]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={t.hint}>Focus / attention</Text>
                <View style={t.chipRow}>
                  {FOCUS_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[t.chip, focus === opt.value && t.chipOn]}
                      onPress={() => setFocus(opt.value)}
                    >
                      <Text style={[t.chipText, focus === opt.value && t.chipTextOn]}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={t.hint}>Restlessness</Text>
                <View style={t.chipRow}>
                  {ADHD_INTENSITY_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[t.chip, restlessness === opt.value && t.chipOn]}
                      onPress={() => setRestlessness(opt.value)}
                    >
                      <Text style={[t.chipText, restlessness === opt.value && t.chipTextOn]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={t.hint}>Overwhelm</Text>
                <View style={t.chipRow}>
                  {ADHD_INTENSITY_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[t.chip, overwhelm === opt.value && t.chipOn]}
                      onPress={() => setOverwhelm(opt.value)}
                    >
                      <Text style={[t.chipText, overwhelm === opt.value && t.chipTextOn]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={t.hint}>Task initiation</Text>
                <View style={t.chipRow}>
                  {TASK_INITIATION_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[t.chip, taskInitiation === opt.value && t.chipOn]}
                      onPress={() => setTaskInitiation(opt.value)}
                    >
                      <Text style={[t.chipText, taskInitiation === opt.value && t.chipTextOn]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={t.hint}>Impulsivity</Text>
                <View style={t.chipRow}>
                  {ADHD_INTENSITY_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[t.chip, impulsivity === opt.value && t.chipOn]}
                      onPress={() => setImpulsivity(opt.value)}
                    >
                      <Text style={[t.chipText, impulsivity === opt.value && t.chipTextOn]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
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
                <TouchableOpacity style={t.btn} onPress={saveCheckIn} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={t.btnText}>Save check-in</Text>}
                </TouchableOpacity>
              </View>
            ) : null}

            {kind === 'caffeine' ? (
              <View>
                <TouchableOpacity onPress={() => setKind(null)}>
                  <Text style={t.back}>← Back</Text>
                </TouchableOpacity>
                <Text style={t.hint}>
                  Defaults:{' '}
                  {CAFFEINE_DRINK_OPTIONS.find((d) => d.value === caffeineDrink)?.mg ?? 95} mg for{' '}
                  {CAFFEINE_DRINK_OPTIONS.find((d) => d.value === caffeineDrink)?.label}
                </Text>
                <View style={t.chipRow}>
                  {CAFFEINE_DRINK_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[t.chip, caffeineDrink === opt.value && t.chipOn]}
                      onPress={() => setCaffeineDrink(opt.value)}
                    >
                      <Text style={[t.chipText, caffeineDrink === opt.value && t.chipTextOn]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={t.input}
                  placeholder="Time HH:MM (optional)"
                  placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                  value={caffeineTime}
                  onChangeText={setCaffeineTime}
                  autoCapitalize="none"
                />
                <TextInput
                  style={t.input}
                  placeholder="Notes (optional)"
                  placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                  value={caffeineNotes}
                  onChangeText={setCaffeineNotes}
                />
                <TouchableOpacity style={t.btn} onPress={saveCaffeine} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={t.btnText}>Log drink</Text>}
                </TouchableOpacity>
              </View>
            ) : null}

            {kind === 'stress' ? (
              <View>
                <TouchableOpacity onPress={() => setKind(null)}>
                  <Text style={t.back}>← Back</Text>
                </TouchableOpacity>
                <Text style={t.hint}>
                  Slide to rate stress (0–100). Level maps automatically · Samsung Energy syncs from
                  Activity.
                </Text>
                <StressScoreSlider
                  value={stressScore}
                  onChange={setStressScore}
                  isDark={!!isDark}
                />
                <TextInput
                  style={t.input}
                  placeholder="Notes (optional)"
                  placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                  value={stressNotes}
                  onChangeText={setStressNotes}
                />
                <TouchableOpacity style={t.btn} onPress={saveStress} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={t.btnText}>Save stress</Text>}
                </TouchableOpacity>
              </View>
            ) : null}

            {kind === 'care' ? (
              <View>
                <TouchableOpacity onPress={() => setKind(null)}>
                  <Text style={t.back}>← Back</Text>
                </TouchableOpacity>
                <View style={t.chipRow}>
                  {CARE_KIND_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.kind}
                      style={[t.chip, careKind === opt.kind && t.chipOn]}
                      onPress={() => setCareKind(opt.kind)}
                    >
                      <Image source={careKindIcon(opt.kind)} style={t.chipIcon} />
                      <Text style={[t.chipText, careKind === opt.kind && t.chipTextOn]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={t.input}
                  placeholder="Practitioner (optional)"
                  placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                  value={careLabel}
                  onChangeText={setCareLabel}
                />
                <TextInput
                  style={t.input}
                  placeholder="Notes (optional)"
                  placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                  value={careNotes}
                  onChangeText={setCareNotes}
                />
                <TouchableOpacity style={t.btn} onPress={saveCare} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={t.btnText}>Save visit</Text>}
                </TouchableOpacity>
              </View>
            ) : null}

            {kind === 'sport' ? (
              <View>
                <TouchableOpacity onPress={() => setKind(null)}>
                  <Text style={t.back}>← Back</Text>
                </TouchableOpacity>
                <View style={t.chipRow}>
                  {SPORT_KIND_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.kind}
                      style={[t.chip, sportKind === opt.kind && t.chipOn]}
                      onPress={() => {
                        setSportKind(opt.kind);
                        if (isCompetitiveSport(opt.kind)) {
                          if (padelResult === 'completed') setPadelResult('win');
                        } else {
                          setPadelResult('completed');
                        }
                      }}
                    >
                      <Text style={[t.chipText, sportKind === opt.kind && t.chipTextOn]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {sportKind === 'other' ? (
                  <TextInput
                    style={t.input}
                    placeholder="Sport name *"
                    placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                    value={customSport}
                    onChangeText={setCustomSport}
                  />
                ) : null}
                {isCompetitiveSport(sportKind) ? (
                  <>
                    <View style={t.chipRow}>
                      {(
                        [
                          { id: 'win', label: 'Won' },
                          { id: 'loss', label: 'Lost' },
                          { id: 'draw', label: 'Draw' },
                        ] as const
                      ).map((opt) => (
                        <TouchableOpacity
                          key={opt.id}
                          style={[t.chip, padelResult === opt.id && t.chipOn]}
                          onPress={() => setPadelResult(opt.id)}
                        >
                          <Image source={sportResultIcon(opt.id)} style={t.chipIcon} />
                          <Text style={[t.chipText, padelResult === opt.id && t.chipTextOn]}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      style={t.input}
                      placeholder="Score (e.g. 6-4 6-3)"
                      placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                      value={padelScore}
                      onChangeText={setPadelScore}
                      autoCapitalize="none"
                    />
                  </>
                ) : (
                  <View style={t.chipRow}>
                    {SPORT_INTENSITY_OPTIONS.map((opt) => (
                      <TouchableOpacity
                        key={opt.value}
                        style={[t.chip, intensity === opt.value && t.chipOn]}
                        onPress={() => setIntensity(opt.value)}
                      >
                        <Text style={[t.chipText, intensity === opt.value && t.chipTextOn]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <TextInput
                  style={t.input}
                  placeholder="Duration (minutes) *"
                  placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                  value={padelDuration}
                  onChangeText={setPadelDuration}
                  keyboardType="number-pad"
                />
                <TextInput
                  style={t.input}
                  placeholder="When (optional, e.g. 18:30)"
                  placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                  value={padelTime}
                  onChangeText={setPadelTime}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextInput
                  style={t.input}
                  placeholder={
                    isCompetitiveSport(sportKind) ? 'Notes (optional)' : 'Focus (legs, upper, cardio…)'
                  }
                  placeholderTextColor={isDark ? '#6e7681' : '#9ca3af'}
                  value={padelNotes}
                  onChangeText={setPadelNotes}
                />
                <TouchableOpacity style={t.btn} onPress={saveSport} disabled={busy}>
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={t.btnText}>
                      {isCompetitiveSport(sportKind) ? 'Save match' : 'Save session'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}

          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = (isDark: boolean) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: isDark ? '#161b22' : '#fff',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 16,
      paddingBottom: 28,
      maxHeight: '88%',
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: isDark ? '#30363d' : '#d1d5db',
      marginBottom: 12,
    },
    sheetHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    sheetTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: isDark ? '#e6edf3' : '#111',
      flex: 1,
      paddingRight: 12,
    },
    close: { color: '#0d9488', fontWeight: '600' },
    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 14,
    },
    dateLabel: { color: isDark ? '#8b949e' : '#666', fontSize: 13, marginRight: 4 },
    dateChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: isDark ? '#21262d' : '#f3f4f6',
    },
    dateChipText: { color: isDark ? '#c9d1d9' : '#374151', fontSize: 13 },
    dateChipOn: { color: '#0d9488', fontWeight: '700' },
    dateInput: {
      minWidth: 120,
      flexGrow: 1,
      borderWidth: 1,
      borderColor: isDark ? '#30363d' : '#e5e7eb',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      color: isDark ? '#e6edf3' : '#111',
      fontSize: 13,
    },
    typeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    typeCard: {
      width: '47%',
      backgroundColor: isDark ? '#0d1117' : '#f8fafc',
      borderRadius: 14,
      padding: 14,
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: isDark ? '#21262d' : '#e5e7eb',
    },
    typeIcon: { width: 48, height: 48, borderRadius: 12 },
    typeLabel: { fontWeight: '600', color: isDark ? '#e6edf3' : '#111' },
    hint: { color: isDark ? '#8b949e' : '#666', fontSize: 13, marginBottom: 12, lineHeight: 18 },
    back: { color: '#0d9488', marginBottom: 10, fontWeight: '600' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: isDark ? '#21262d' : '#f3f4f6',
    },
    chipOn: { backgroundColor: isDark ? '#0f3f3a' : '#ccfbf1' },
    chipIcon: { width: 22, height: 22, borderRadius: 6 },
    chipText: { color: isDark ? '#c9d1d9' : '#374151', fontSize: 13 },
    chipTextOn: { color: isDark ? '#5eead4' : '#0f766e', fontWeight: '700' },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#30363d' : '#e5e7eb',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 10,
      color: isDark ? '#e6edf3' : '#111',
    },
    btn: {
      backgroundColor: '#0d9488',
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 4,
    },
    btnText: { color: '#fff', fontWeight: '700' },
  });

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  INJURY_ACTIVITY_OPTIONS,
  INJURY_BODY_AREA_OPTIONS,
  INJURY_TYPE_OPTIONS,
  type Injury,
  type InjuryActivityKind,
  type InjuryBodyArea,
  type InjuryType,
} from '../injuries';
import {
  createCareVisit,
  createCaffeineLog,
  createInjury,
  createManualMeal,
  createSportMatch,
  createStressLog,
  fetchDayCheckIn,
  fetchInjuries,
  logInjuryPain,
  logWeight,
  upsertDayCheckIn,
} from '../api'
import { useLocale } from '../i18n';

type EntryKind =
  | 'meal'
  | 'care'
  | 'sport'
  | 'weight'
  | 'injury'
  | 'checkin'
  | 'caffeine'
  | 'stress'
  | null;
type InjuryMode = 'choose' | 'new' | 'pain';
type SportKind = 'padel' | 'gym' | 'running' | 'cycling' | 'swimming' | 'walking' | 'other';
type SportIntensity = 'easy' | 'moderate' | 'hard' | 'max';
type MoodLevel = 'terrible' | 'low' | 'ok' | 'good' | 'great';
type WakeQuality = 'rough' | 'groggy' | 'ok' | 'fresh' | 'energized';
type FocusLevel = MoodLevel;
type AdhdIntensity = 'low' | 'ok' | 'high';
type TaskInitiation = 'stuck' | 'slow' | 'ok' | 'easy';
type CaffeineDrink =
  | 'espresso'
  | 'double_espresso'
  | 'coffee'
  | 'iced_coffee'
  | 'green_tea'
  | 'black_tea';

const SPORT_KIND_OPTIONS: Array<{ kind: SportKind; label: string }> = [
  { kind: 'padel', label: 'Padel' },
  { kind: 'gym', label: 'Gym' },
  { kind: 'running', label: 'Running' },
  { kind: 'cycling', label: 'Cycling' },
  { kind: 'swimming', label: 'Swimming' },
  { kind: 'walking', label: 'Walking' },
  { kind: 'other', label: 'Other' },
];

const SPORT_INTENSITY_OPTIONS: Array<{ value: SportIntensity; label: string }> = [
  { value: 'easy', label: 'Easy' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'hard', label: 'Hard' },
  { value: 'max', label: 'Max' },
];

const MOOD_OPTIONS: Array<{ value: MoodLevel; label: string }> = [
  { value: 'terrible', label: 'Terrible' },
  { value: 'low', label: 'Low' },
  { value: 'ok', label: 'OK' },
  { value: 'good', label: 'Good' },
  { value: 'great', label: 'Great' },
];

const WAKE_QUALITY_OPTIONS: Array<{ value: WakeQuality; label: string }> = [
  { value: 'rough', label: 'Rough' },
  { value: 'groggy', label: 'Groggy' },
  { value: 'ok', label: 'OK' },
  { value: 'fresh', label: 'Fresh' },
  { value: 'energized', label: 'Energized' },
];

const FOCUS_OPTIONS = MOOD_OPTIONS;

const ADHD_INTENSITY_OPTIONS: Array<{ value: AdhdIntensity; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'ok', label: 'OK' },
  { value: 'high', label: 'High' },
];

const TASK_INITIATION_OPTIONS: Array<{ value: TaskInitiation; label: string }> = [
  { value: 'stuck', label: 'Stuck' },
  { value: 'slow', label: 'Slow' },
  { value: 'ok', label: 'OK' },
  { value: 'easy', label: 'Easy' },
];

const CAFFEINE_DRINK_OPTIONS: Array<{ value: CaffeineDrink; label: string; mg: number }> = [
  { value: 'espresso', label: 'Espresso', mg: 63 },
  { value: 'double_espresso', label: 'Double espresso', mg: 125 },
  { value: 'coffee', label: 'Coffee', mg: 95 },
  { value: 'iced_coffee', label: 'Iced coffee', mg: 150 },
  { value: 'green_tea', label: 'Green tea', mg: 28 },
  { value: 'black_tea', label: 'Black tea', mg: 47 },
];

function isCompetitiveSport(sport?: string | null) {
  return (sport || '').toLowerCase() === 'padel';
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const TYPES: Array<{ id: Exclude<EntryKind, null>; labelKey: string; blurbKey: string; icon: string }> = [
  { id: 'meal', labelKey: 'compose.meal', blurbKey: 'compose.mealBlurb', icon: '/icons/icon-meals.png' },
  { id: 'checkin', labelKey: 'compose.checkin', blurbKey: 'compose.checkinBlurb', icon: '/icons/icon-checkin.png' },
  { id: 'caffeine', labelKey: 'compose.caffeine', blurbKey: 'compose.caffeineBlurb', icon: '/icons/icon-caffeine.png' },
  { id: 'stress', labelKey: 'compose.stress', blurbKey: 'compose.stressBlurb', icon: '/icons/icon-stress.png' },
  { id: 'weight', labelKey: 'compose.weight', blurbKey: 'compose.weightBlurb', icon: '/icons/icon-weight.png' },
  { id: 'injury', labelKey: 'compose.injury', blurbKey: 'compose.injuryBlurb', icon: '/icons/icon-injury.png' },
  { id: 'care', labelKey: 'compose.care', blurbKey: 'compose.careBlurb', icon: '/icons/icon-kine.png' },
  { id: 'sport', labelKey: 'compose.sport', blurbKey: 'compose.sportBlurb', icon: '/icons/icon-padel.png' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

export default function ComposeModal({ open, onClose, onSaved }: Props) {
  const { t } = useLocale();
  const today = useMemo(() => todayKey(), [open]);
  const [kind, setKind] = useState<EntryKind>(null);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mealType, setMealType] = useState('lunch');
  const [carbs, setCarbs] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [calories, setCalories] = useState('');
  const [caloriesTouched, setCaloriesTouched] = useState(false);
  const [mealNotes, setMealNotes] = useState('');

  const [careKind, setCareKind] = useState('kine');
  const [careLabel, setCareLabel] = useState('');
  const [careNotes, setCareNotes] = useState('');

  const [result, setResult] = useState<'win' | 'loss' | 'draw' | 'completed'>('win');
  const [sportKind, setSportKind] = useState<SportKind>('padel');
  const [customSport, setCustomSport] = useState('');
  const [intensity, setIntensity] = useState<SportIntensity>('moderate');
  const [score, setScore] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [sportTime, setSportTime] = useState('');
  const [sportNotes, setSportNotes] = useState('');
  const [weightKg, setWeightKg] = useState('');

  const [injuryMode, setInjuryMode] = useState<InjuryMode>('choose');
  const [injuryFlash, setInjuryFlash] = useState<string | null>(null);
  const [openInjuries, setOpenInjuries] = useState<Injury[]>([]);
  const [injuryType, setInjuryType] = useState<InjuryType>('sprain');
  const [bodyArea, setBodyArea] = useState<InjuryBodyArea>('knee_right');
  const [bodyAreaOther, setBodyAreaOther] = useState('');
  const [injuryTitle, setInjuryTitle] = useState('');
  const [injuryExercises, setInjuryExercises] = useState('');
  const [injuryNotes, setInjuryNotes] = useState('');
  const [activityTags, setActivityTags] = useState<InjuryActivityKind[]>(['sport']);
  const [painInjuryId, setPainInjuryId] = useState<string>('');
  const [painScore, setPainScore] = useState(3);
  const [painActivity, setPainActivity] = useState<InjuryActivityKind | ''>('sport');
  const [painNotes, setPainNotes] = useState('');
  const [mood, setMood] = useState<MoodLevel>('ok');
  const [wakeQuality, setWakeQuality] = useState<WakeQuality>('ok');
  const [checkInNotes, setCheckInNotes] = useState('');
  const [focus, setFocus] = useState<FocusLevel>('ok');
  const [restlessness, setRestlessness] = useState<AdhdIntensity>('ok');
  const [overwhelm, setOverwhelm] = useState<AdhdIntensity>('ok');
  const [taskInitiation, setTaskInitiation] = useState<TaskInitiation>('ok');
  const [impulsivity, setImpulsivity] = useState<AdhdIntensity>('ok');
  const [medicationTaken, setMedicationTaken] = useState(false);
  const [hyperfocus, setHyperfocus] = useState(false);
  const [sleepHours, setSleepHours] = useState('');
  const [caffeineDrink, setCaffeineDrink] = useState<CaffeineDrink>('coffee');
  const [caffeineTime, setCaffeineTime] = useState('');
  const [caffeineNotes, setCaffeineNotes] = useState('');
  const [stressScore, setStressScore] = useState(55);
  const [stressNotes, setStressNotes] = useState('');

  useEffect(() => {
    if (!open || kind !== 'injury') return;
    fetchInjuries('open')
      .then((rows) => {
        setOpenInjuries(rows);
        if (rows[0] && !painInjuryId) setPainInjuryId(rows[0].id);
      })
      .catch(() => setOpenInjuries([]));
  }, [open, kind, injuryMode]);

  useEffect(() => {
    if (!open || kind !== 'checkin') return;
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
  }, [open, kind, date]);

  if (!open) return null;

  const competitive = isCompetitiveSport(sportKind);
  const estimatedKcal = Math.round(
    (Number(carbs) || 0) * 4 + (Number(protein) || 0) * 4 + (Number(fat) || 0) * 9
  );

  const setMacro = (field: 'carbs' | 'protein' | 'fat', value: string) => {
    if (field === 'carbs') setCarbs(value);
    if (field === 'protein') setProtein(value);
    if (field === 'fat') setFat(value);
    if (!caloriesTouched) {
      const c = field === 'carbs' ? Number(value) || 0 : Number(carbs) || 0;
      const p = field === 'protein' ? Number(value) || 0 : Number(protein) || 0;
      const f = field === 'fat' ? Number(value) || 0 : Number(fat) || 0;
      const est = Math.round(c * 4 + p * 4 + f * 9);
      setCalories(est > 0 ? String(est) : '');
    }
  };

  const toggleTag = (tag: InjuryActivityKind) => {
    setActivityTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const reset = () => {
    setKind(null);
    setDate(todayKey());
    setError(null);
    setBusy(false);
    setInjuryFlash(null);
    setCarbs('');
    setProtein('');
    setFat('');
    setCalories('');
    setCaloriesTouched(false);
    setMealNotes('');
    setCareLabel('');
    setCareNotes('');
    setScore('');
    setDurationMin('');
    setSportTime('');
    setSportNotes('');
    setCustomSport('');
    setIntensity('moderate');
    setWeightKg('');
    setSportKind('padel');
    setResult('win');
    setInjuryMode('choose');
    setInjuryType('sprain');
    setBodyArea('knee_right');
    setBodyAreaOther('');
    setInjuryTitle('');
    setInjuryExercises('');
    setInjuryNotes('');
    setActivityTags(['sport']);
    setPainInjuryId('');
    setPainScore(3);
    setPainActivity('sport');
    setPainNotes('');
    setMood('ok');
    setWakeQuality('ok');
    setCheckInNotes('');
    setFocus('ok');
    setRestlessness('ok');
    setOverwhelm('ok');
    setTaskInitiation('ok');
    setImpulsivity('ok');
    setMedicationTaken(false);
    setHyperfocus(false);
    setSleepHours('');
    setCaffeineDrink('coffee');
    setCaffeineTime('');
    setCaffeineNotes('');
    setStressScore(55);
    setStressNotes('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const resetNewInjuryFields = () => {
    setInjuryType('sprain');
    setBodyArea('knee_right');
    setBodyAreaOther('');
    setInjuryTitle('');
    setInjuryExercises('');
    setInjuryNotes('');
    setActivityTags(['sport']);
  };

  const resetPainFields = () => {
    setPainScore(3);
    setPainActivity('sport');
    setPainNotes('');
  };

  const submit = async (e?: FormEvent | null, mode: 'another' | 'done' = 'done') => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setInjuryFlash(null);
    try {
      if (kind === 'meal') {
        const c = Number(carbs) || 0;
        const p = Number(protein) || 0;
        const f = Number(fat) || 0;
        const kcal = Number(calories);
        await createManualMeal({
          date,
          mealType,
          carbsG: c,
          proteinG: p,
          fatG: f,
          caloriesKcal: Number.isFinite(kcal) && kcal > 0 ? kcal : undefined,
          notes: mealNotes.trim() || undefined,
        });
      } else if (kind === 'care') {
        await createCareVisit({
          date,
          kind: careKind as 'kine' | 'osteo' | 'podologue' | 'other',
          label: careLabel.trim() || undefined,
          notes: careNotes.trim() || undefined,
        });
      } else if (kind === 'sport') {
        const mins = Number(durationMin);
        if (!Number.isFinite(mins) || mins <= 0) {
          setError(t('compose.errDuration'));
          setBusy(false);
          return;
        }
        const sportName = sportKind === 'other' ? customSport.trim() : sportKind;
        if (!sportName) {
          setError(t('compose.errSport'));
          setBusy(false);
          return;
        }
        await createSportMatch({
          date,
          time: sportTime.trim() || undefined,
          sport: sportName,
          result: competitive ? (result === 'completed' ? 'draw' : result) : 'completed',
          score: competitive ? score.trim() : '',
          durationMin: Math.round(mins),
          intensity: competitive ? undefined : intensity,
          notes: sportNotes.trim() || undefined,
        });
      } else if (kind === 'weight') {
        const kg = Number(weightKg);
        if (!Number.isFinite(kg) || kg < 20) {
          setError(t('compose.errWeight'));
          setBusy(false);
          return;
        }
        await logWeight({ date, weightKg: kg });
      } else if (kind === 'checkin') {
        const sleep = sleepHours.trim() ? Number(sleepHours) : undefined;
        if (sleep != null && (!Number.isFinite(sleep) || sleep < 0 || sleep > 24)) {
          setError(t('compose.errSleep'));
          setBusy(false);
          return;
        }
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
      } else if (kind === 'caffeine') {
        await createCaffeineLog({
          date,
          time: caffeineTime.trim() || undefined,
          drink: caffeineDrink,
          notes: caffeineNotes.trim() || undefined,
        });
      } else if (kind === 'stress') {
        await createStressLog({
          date,
          level: stressScore >= 70 ? 'calm' : stressScore >= 40 ? 'ok' : 'high',
          score: Math.round(stressScore),
          notes: stressNotes.trim() || undefined,
        });
      } else if (kind === 'injury' && injuryMode === 'new') {
        await createInjury({
          title: injuryTitle.trim() || undefined,
          injuryType,
          bodyArea,
          bodyAreaOther: bodyArea === 'other' ? bodyAreaOther.trim() || undefined : undefined,
          startedOn: date,
          relatedActivityKinds: activityTags,
          exerciseNotes: injuryExercises.trim() || undefined,
          notes: injuryNotes.trim() || undefined,
        });
        onSaved?.();
        if (mode === 'another') {
          resetNewInjuryFields();
          const rows = await fetchInjuries('open').catch(() => openInjuries);
          setOpenInjuries(rows);
          setInjuryFlash(t('compose.injurySaved'));
          setBusy(false);
          return;
        }
      } else if (kind === 'injury' && injuryMode === 'pain') {
        if (!painInjuryId) {
          setError(t('compose.errInjury'));
          setBusy(false);
          return;
        }
        const scoreNum = Number(painScore);
        if (!Number.isFinite(scoreNum) || scoreNum < 0 || scoreNum > 10) {
          setError(t('compose.errPain'));
          setBusy(false);
          return;
        }
        await logInjuryPain(painInjuryId, {
          date,
          painScore: Math.round(scoreNum),
          relatedActivityKind: painActivity || undefined,
          notes: painNotes.trim() || undefined,
        });
        onSaved?.();
        if (mode === 'another') {
          resetPainFields();
          setInjuryFlash(t('compose.painSaved'));
          setBusy(false);
          return;
        }
      } else if (kind === 'injury') {
        setBusy(false);
        return;
      }
      onSaved?.();
      close();
    } catch (err: any) {
      setError(String(err?.response?.data?.detail || err.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-root" role="dialog" aria-modal="true">
      <button type="button" className="modal-backdrop" aria-label={t('common.close')} onClick={close} />
      <div className="modal-sheet">
        <div className="modal-head">
          <h2>{kind ? t('compose.addEntry') : t('compose.title')}</h2>
          <button type="button" className="btn ghost" onClick={close}>
            {t('common.close')}
          </button>
        </div>

        <div className="compose-date">
          <span className="muted">{t('common.date')}</span>
          <button
            type="button"
            className={`chip ${date === today ? 'on' : ''}`}
            onClick={() => setDate(today)}
          >
            {t('common.today')}
          </button>
          <button
            type="button"
            className={`chip ${date === shiftDate(today, -1) ? 'on' : ''}`}
            onClick={() => setDate(shiftDate(today, -1))}
          >
            {t('common.yesterday')}
          </button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {!kind ? (
          <div className="compose-grid">
            {TYPES.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="compose-type"
                onClick={() => {
                  setKind(opt.id);
                  if (opt.id === 'injury') setInjuryMode('choose');
                }}
              >
                <img src={opt.icon} alt="" width={44} height={44} />
                <strong>{t(opt.labelKey as any)}</strong>
                <span className="muted">{t(opt.blurbKey as any)}</span>
              </button>
            ))}
          </div>
        ) : kind === 'injury' && injuryMode === 'choose' ? (
          <div>
            <button type="button" className="btn ghost" onClick={() => setKind(null)}>
              {t('compose.back')}
            </button>
            <div className="compose-grid" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="compose-type"
                onClick={() => {
                  setInjuryFlash(null);
                  setInjuryMode('new');
                }}
              >
                <strong>{t('compose.newInjury')}</strong>
                <span className="muted">{t('compose.newInjuryBlurb')}</span>
              </button>
              <button
                type="button"
                className="compose-type"
                onClick={() => {
                  setInjuryFlash(null);
                  setInjuryMode('pain');
                  if (openInjuries[0]) setPainInjuryId(openInjuries[0].id);
                }}
              >
                <strong>{t('compose.logPain')}</strong>
                <span className="muted">{t('compose.logPainBlurb')}</span>
              </button>
            </div>
          </div>
        ) : (
          <form
            className="form"
            onSubmit={(e) =>
              submit(
                e,
                kind === 'injury' && (injuryMode === 'new' || injuryMode === 'pain')
                  ? 'another'
                  : 'done'
              )
            }
          >
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                if (kind === 'injury') setInjuryMode('choose');
                else setKind(null);
              }}
            >
              {t('compose.back')}
            </button>

            {kind === 'meal' ? (
              <>
                <label>
                  {t('compose.mealType')}
                  <select value={mealType} onChange={(e) => setMealType(e.target.value)}>
                    <option value="breakfast">{t('mealType.breakfast')}</option>
                    <option value="lunch">{t('mealType.lunch')}</option>
                    <option value="dinner">{t('mealType.dinner')}</option>
                    <option value="snack">{t('mealType.snack')}</option>
                    <option value="resucrage">{t('mealType.resucrage')}</option>
                    <option value="other">{t('mealType.other')}</option>
                  </select>
                </label>
                <div className="form-row-3">
                  <label>
                    {t('compose.carbs')}
                    <input
                      value={carbs}
                      onChange={(e) => setMacro('carbs', e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <label>
                    {t('compose.protein')}
                    <input
                      value={protein}
                      onChange={(e) => setMacro('protein', e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <label>
                    {t('compose.fat')}
                    <input
                      value={fat}
                      onChange={(e) => setMacro('fat', e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                </div>
                <label>
                  {t('compose.calories')}
                  <input
                    value={calories}
                    onChange={(e) => {
                      setCaloriesTouched(true);
                      setCalories(e.target.value);
                    }}
                    inputMode="numeric"
                    placeholder={estimatedKcal > 0 ? `Est. ${estimatedKcal}` : 'Optional'}
                  />
                </label>
                <p className="muted" style={{ margin: '-4px 0 8px', fontSize: 12 }}>
                  Auto-fills from macros (4/4/9). Edit to override.
                </p>
                <label>
                  {t('common.notes')}
                  <input value={mealNotes} onChange={(e) => setMealNotes(e.target.value)} />
                </label>
              </>
            ) : null}

            {kind === 'care' ? (
              <>
                <label>
                  {t('compose.kind')}
                  <select value={careKind} onChange={(e) => setCareKind(e.target.value)}>
                    <option value="kine">{t('care.kine')}</option>
                    <option value="osteo">{t('care.osteo')}</option>
                    <option value="podologue">{t('care.podologue')}</option>
                    <option value="other">{t('mealType.other')}</option>
                  </select>
                </label>
                <label>
                  Practitioner
                  <input value={careLabel} onChange={(e) => setCareLabel(e.target.value)} />
                </label>
                <label>
                  {t('common.notes')}
                  <input value={careNotes} onChange={(e) => setCareNotes(e.target.value)} />
                </label>
              </>
            ) : null}

            {kind === 'sport' ? (
              <>
                <label>
                  {t('compose.sport')}
                  <select
                    value={sportKind}
                    onChange={(e) => {
                      const next = e.target.value as SportKind;
                      setSportKind(next);
                      setResult(isCompetitiveSport(next) ? 'win' : 'completed');
                    }}
                  >
                    {SPORT_KIND_OPTIONS.map((opt) => (
                      <option key={opt.kind} value={opt.kind}>
                        {t(`sport.${opt.kind}` as any)}
                      </option>
                    ))}
                  </select>
                </label>
                {sportKind === 'other' ? (
                  <label>
                    {t('compose.sportName')}
                    <input
                      value={customSport}
                      onChange={(e) => setCustomSport(e.target.value)}
                      placeholder="Yoga, climbing, tennis…"
                      required
                    />
                  </label>
                ) : null}
                {competitive ? (
                  <>
                    <label>
                      {t('compose.result')}
                      <select
                        value={result}
                        onChange={(e) =>
                          setResult(e.target.value as 'win' | 'loss' | 'draw' | 'completed')
                        }
                      >
                        <option value="win">{t('compose.won')}</option>
                        <option value="loss">{t('compose.lost')}</option>
                        <option value="draw">{t('compose.draw')}</option>
                      </select>
                    </label>
                    <label>
                      {t('compose.score')}
                      <input
                        value={score}
                        onChange={(e) => setScore(e.target.value)}
                        placeholder="6-4 6-3"
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    {t('compose.intensity')}
                    <select
                      value={intensity}
                      onChange={(e) => setIntensity(e.target.value as SportIntensity)}
                    >
                      {SPORT_INTENSITY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t(`intensity.${opt.value}` as any)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {t('compose.duration')}
                  <input
                    type="number"
                    min={1}
                    required
                    value={durationMin}
                    onChange={(e) => setDurationMin(e.target.value)}
                    placeholder={competitive ? '90' : '60'}
                  />
                </label>
                <label>
                  {t('compose.when')}
                  <input
                    type="time"
                    value={sportTime}
                    onChange={(e) => setSportTime(e.target.value)}
                  />
                </label>
                <label>
                  {competitive ? t('common.notes') : 'Focus / notes'}
                  <input
                    value={sportNotes}
                    onChange={(e) => setSportNotes(e.target.value)}
                    placeholder={competitive ? '' : 'Legs, upper body, cardio…'}
                  />
                </label>
              </>
            ) : null}

            {kind === 'weight' ? (
              <>
                <label>
                  {t('compose.weightKg')}
                  <input
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    inputMode="decimal"
                    placeholder="101.4"
                    required
                  />
                </label>
                <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                  Updates maintenance and deficit calorie targets for reports.
                </p>
              </>
            ) : null}

            {kind === 'checkin' ? (
              <>
                <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                  One check-in per day. Saving again updates mood, wake, and ADHD ratings.
                </p>
                <div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {t('compose.mood')}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {MOOD_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`chip ${mood === opt.value ? 'on' : ''}`}
                        onClick={() => setMood(opt.value)}
                      >
                        {t(`mood.${opt.value}` as any)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {t('compose.wake')}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {WAKE_QUALITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`chip ${wakeQuality === opt.value ? 'on' : ''}`}
                        onClick={() => setWakeQuality(opt.value)}
                      >
                        {t(`wake.${opt.value}` as any)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {t('compose.focus')}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {FOCUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`chip ${focus === opt.value ? 'on' : ''}`}
                        onClick={() => setFocus(opt.value)}
                      >
                        {t(`mood.${opt.value}` as any)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {t('compose.restlessness')}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {ADHD_INTENSITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`chip ${restlessness === opt.value ? 'on' : ''}`}
                        onClick={() => setRestlessness(opt.value)}
                      >
                        {t(`adhd.${opt.value}` as any)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {t('compose.overwhelm')}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {ADHD_INTENSITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`chip ${overwhelm === opt.value ? 'on' : ''}`}
                        onClick={() => setOverwhelm(opt.value)}
                      >
                        {t(`adhd.${opt.value}` as any)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {t('compose.taskInitiation')}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {TASK_INITIATION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`chip ${taskInitiation === opt.value ? 'on' : ''}`}
                        onClick={() => setTaskInitiation(opt.value)}
                      >
                        {t(`task.${opt.value}` as any)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {t('compose.impulsivity')}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {ADHD_INTENSITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`chip ${impulsivity === opt.value ? 'on' : ''}`}
                        onClick={() => setImpulsivity(opt.value)}
                      >
                        {t(`adhd.${opt.value}` as any)}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    type="button"
                    className={`chip ${medicationTaken ? 'on' : ''}`}
                    onClick={() => setMedicationTaken((v) => !v)}
                  >
                    {t('compose.meds')}
                  </button>
                  <button
                    type="button"
                    className={`chip ${hyperfocus ? 'on' : ''}`}
                    onClick={() => setHyperfocus((v) => !v)}
                  >
                    {t('compose.hyperfocus')}
                  </button>
                </div>
                <label>
                  {t('compose.sleepHours')}
                  <input
                    value={sleepHours}
                    onChange={(e) => setSleepHours(e.target.value)}
                    inputMode="decimal"
                    placeholder="7.5"
                  />
                </label>
                <label>
                  {t('common.notes')}
                  <input
                    value={checkInNotes}
                    onChange={(e) => setCheckInNotes(e.target.value)}
                    placeholder="Slept poorly, restless…"
                  />
                </label>
              </>
            ) : null}

            {kind === 'caffeine' ? (
              <>
                <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                  Default{' '}
                  {CAFFEINE_DRINK_OPTIONS.find((d) => d.value === caffeineDrink)?.mg ?? 95} mg for{' '}
                  {t(`caffeine.${caffeineDrink}` as any)}.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {CAFFEINE_DRINK_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`chip ${caffeineDrink === opt.value ? 'on' : ''}`}
                      onClick={() => setCaffeineDrink(opt.value)}
                    >
                      {t(`caffeine.${opt.value}` as any)}
                    </button>
                  ))}
                </div>
                <label>
                  {t('compose.timeOptional')}
                  <input
                    value={caffeineTime}
                    onChange={(e) => setCaffeineTime(e.target.value)}
                    placeholder="09:30"
                  />
                </label>
                <label>
                  {t('common.notes')}
                  <input
                    value={caffeineNotes}
                    onChange={(e) => setCaffeineNotes(e.target.value)}
                    placeholder="After lunch, before padel…"
                  />
                </label>
              </>
            ) : null}

            {kind === 'stress' ? (
              <>
                <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                  Slide to rate stress. Level maps automatically · Samsung Energy syncs from Activity.
                </p>
                <div className="pain-slider">
                  <div className="pain-slider-head">
                    <span>
                      Stress ·{' '}
                      {stressScore >= 70 ? t('compose.calm') : stressScore >= 40 ? t('mood.ok') : 'High'}
                    </span>
                    <strong
                      className={
                        stressScore < 40 ? 'pain-hi' : stressScore < 70 ? 'pain-mid' : 'pain-lo'
                      }
                    >
                      {stressScore}
                      <span className="muted"> / 100</span>
                    </strong>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={stressScore}
                    onChange={(e) => setStressScore(Number(e.target.value))}
                    aria-label="Stress score"
                  />
                  <div className="pain-slider-ends">
                    <span className="muted">{t('compose.highStress')}</span>
                    <span className="muted">{t('compose.calm')}</span>
                  </div>
                </div>
                <label>
                  {t('common.notes')}
                  <input
                    value={stressNotes}
                    onChange={(e) => setStressNotes(e.target.value)}
                    placeholder="Work deadline, noisy day…"
                  />
                </label>
              </>
            ) : null}

            {kind === 'injury' && injuryMode === 'new' ? (
              <>
                <label>
                  {t('compose.type')}
                  <select
                    value={injuryType}
                    onChange={(e) => setInjuryType(e.target.value as InjuryType)}
                  >
                    {INJURY_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t(`mood.${opt.value}` as any)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('compose.bodyArea')}
                  <select
                    value={bodyArea}
                    onChange={(e) => setBodyArea(e.target.value as InjuryBodyArea)}
                  >
                    {INJURY_BODY_AREA_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t(`wake.${opt.value}` as any)}
                      </option>
                    ))}
                  </select>
                </label>
                {bodyArea === 'other' ? (
                  <label>
                    {t('compose.areaDetail')}
                    <input
                      value={bodyAreaOther}
                      onChange={(e) => setBodyAreaOther(e.target.value)}
                      placeholder="Describe area"
                    />
                  </label>
                ) : null}
                <label>
                  {t('compose.labelOptional')}
                  <input
                    value={injuryTitle}
                    onChange={(e) => setInjuryTitle(e.target.value)}
                    placeholder="Right knee after padel"
                  />
                </label>
                <div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {t('compose.relatedTo')}
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {INJURY_ACTIVITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`chip ${activityTags.includes(opt.value) ? 'on' : ''}`}
                        onClick={() => toggleTag(opt.value)}
                      >
                        {t(`activityKind.${opt.value}` as any)}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  {t('compose.treatment')}
                  <textarea
                    value={injuryExercises}
                    onChange={(e) => setInjuryExercises(e.target.value)}
                    rows={3}
                    placeholder="Eccentric quads, foam roll…"
                  />
                </label>
                <label>
                  {t('common.notes')}
                  <input value={injuryNotes} onChange={(e) => setInjuryNotes(e.target.value)} />
                </label>
              </>
            ) : null}

            {kind === 'injury' && injuryMode === 'pain' ? (
              <>
                {openInjuries.length === 0 ? (
                  <p className="muted">{t('compose.noOpenInjuries')}</p>
                ) : (
                  <>
                    <label>
                      {t('compose.injury')}
                      <select
                        value={painInjuryId}
                        onChange={(e) => setPainInjuryId(e.target.value)}
                        required
                      >
                        {openInjuries.map((inj) => (
                          <option key={inj.id} value={inj.id}>
                            {inj.title || inj.bodyAreaLabel || inj.injuryType}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="pain-slider">
                      <div className="pain-slider-head">
                        <span>{t('compose.pain')}</span>
                        <strong
                          className={
                            painScore >= 7
                              ? 'pain-hi'
                              : painScore >= 4
                                ? 'pain-mid'
                                : 'pain-lo'
                          }
                        >
                          {painScore}
                          <span className="muted"> / 10</span>
                        </strong>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        step={1}
                        value={painScore}
                        onChange={(e) => setPainScore(Number(e.target.value))}
                        aria-label="Pain score"
                      />
                      <div className="pain-slider-ends">
                        <span className="muted">{t('common.none')}</span>
                        <span className="muted">{t('compose.worst')}</span>
                      </div>
                    </div>
                    <label>
                      Related activity (optional)
                      <select
                        value={painActivity}
                        onChange={(e) =>
                          setPainActivity(e.target.value as InjuryActivityKind | '')
                        }
                      >
                        <option value="">{t('common.none')}</option>
                        {INJURY_ACTIVITY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {t(`mood.${opt.value}` as any)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('common.notes')}
                      <input
                        value={painNotes}
                        onChange={(e) => setPainNotes(e.target.value)}
                        placeholder="After padel, morning stiffness…"
                      />
                    </label>
                  </>
                )}
              </>
            ) : null}

            {error ? <p className="error">{error}</p> : null}
            {injuryFlash ? <p className="compose-flash-ok">{injuryFlash}</p> : null}
            {!(kind === 'injury' && injuryMode === 'pain' && openInjuries.length === 0) ? (
              <div className="form-actions">
                {kind === 'injury' && (injuryMode === 'new' || injuryMode === 'pain') ? (
                  <>
                    <button type="submit" className="btn primary" disabled={busy}>
                      {busy ? t('common.saving') : t('compose.saveAddAnother')}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy}
                      onClick={() => void submit(null, 'done')}
                    >
                      {t('compose.saveDone')}
                    </button>
                  </>
                ) : (
                  <button type="submit" className="btn primary" disabled={busy}>
                    {busy ? t('common.saving') : t('common.save')}
                  </button>
                )}
              </div>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}

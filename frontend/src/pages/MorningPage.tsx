import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  fetchDayCheckIn,
  fetchWeightHistory,
  logWeight,
  upsertDayCheckIn,
} from '../api';
import { PageHeader, Panel } from '../components/ui';
import { useLocale } from '../i18n';

type MoodLevel = 'terrible' | 'low' | 'ok' | 'good' | 'great';
type WakeQuality = 'rough' | 'groggy' | 'ok' | 'fresh' | 'energized';
type FocusLevel = MoodLevel;
type AdhdIntensity = 'low' | 'ok' | 'high';
type TaskInitiation = 'stuck' | 'slow' | 'ok' | 'easy';

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

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function MorningPage() {
  const { t } = useLocale();
  const date = useMemo(() => todayKey(), []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [checkIn, weights] = await Promise.all([
          fetchDayCheckIn(date).catch(() => null),
          fetchWeightHistory(5).catch(() => []),
        ]);
        if (cancelled) return;
        const todayWeight = weights.find((w) => w.date === date);
        const last = todayWeight || weights[0];
        if (last) setWeightKg(String(last.weightKg));
        if (todayWeight?.notes) setWeightNotes(todayWeight.notes || '');
        if (checkIn) {
          if (MOOD_OPTIONS.some((o) => o.value === checkIn.mood)) setMood(checkIn.mood as MoodLevel);
          if (WAKE_QUALITY_OPTIONS.some((o) => o.value === checkIn.wakeQuality)) {
            setWakeQuality(checkIn.wakeQuality as WakeQuality);
          }
          if (checkIn.focus && FOCUS_OPTIONS.some((o) => o.value === checkIn.focus)) {
            setFocus(checkIn.focus as FocusLevel);
          }
          if (
            checkIn.restlessness &&
            ADHD_INTENSITY_OPTIONS.some((o) => o.value === checkIn.restlessness)
          ) {
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
          if (
            checkIn.impulsivity &&
            ADHD_INTENSITY_OPTIONS.some((o) => o.value === checkIn.impulsivity)
          ) {
            setImpulsivity(checkIn.impulsivity as AdhdIntensity);
          }
          setMedicationTaken(!!checkIn.medicationTaken);
          setHyperfocus(!!checkIn.hyperfocus);
          setSleepHours(checkIn.sleepHours != null ? String(checkIn.sleepHours) : '');
          setCheckInNotes(checkIn.notes || '');
        }
      } catch {
        /* ignore preload errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const kg = Number(String(weightKg).replace(',', '.'));
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) {
      setErr(t('morning.weightInvalid'));
      return;
    }
    const sleep = sleepHours.trim() ? Number(String(sleepHours).replace(',', '.')) : undefined;
    if (sleep != null && (!Number.isFinite(sleep) || sleep < 0 || sleep > 24)) {
      setErr(t('morning.sleepInvalid'));
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
      setMsg(t('morning.saved'));
    } catch (ex) {
      setErr(String(ex));
    } finally {
      setBusy(false);
    }
  };

  const ChipGroup = <T extends string>({
    label,
    options,
    value,
    onChange,
    labelFn,
  }: {
    label: string;
    options: ReadonlyArray<{ value: T; label: string }>;
    value: T;
    onChange: (v: T) => void;
    labelFn: (v: T) => string;
  }) => (
    <div>
      <span className="muted" style={{ fontSize: 13 }}>
        {label}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`chip ${value === opt.value ? 'on' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {labelFn(opt.value)}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title={t('morning.title')} lede={t('morning.subtitle', { date })} />
      <form onSubmit={onSubmit}>
        <div className="grid-2" style={{ gap: 16 }}>
          <Panel title={t('morning.weight')}>
            <label className="field">
              <span>{t('compose.weightKg')}</span>
              <input
                type="number"
                step="0.1"
                min={20}
                max={400}
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>{t('compose.notes')}</span>
              <input value={weightNotes} onChange={(e) => setWeightNotes(e.target.value)} />
            </label>
          </Panel>

          <Panel title={t('morning.checkin')}>
            <div style={{ display: 'grid', gap: 14 }}>
              <ChipGroup
                label={t('compose.mood')}
                options={MOOD_OPTIONS}
                value={mood}
                onChange={setMood}
                labelFn={(v) => t(`mood.${v}` as any)}
              />
              <ChipGroup
                label={t('compose.wake')}
                options={WAKE_QUALITY_OPTIONS}
                value={wakeQuality}
                onChange={setWakeQuality}
                labelFn={(v) => t(`wake.${v}` as any)}
              />
              <ChipGroup
                label={t('compose.focus')}
                options={FOCUS_OPTIONS}
                value={focus}
                onChange={setFocus}
                labelFn={(v) => t(`mood.${v}` as any)}
              />
              <ChipGroup
                label={t('compose.restlessness')}
                options={ADHD_INTENSITY_OPTIONS}
                value={restlessness}
                onChange={setRestlessness}
                labelFn={(v) => t(`adhd.${v}` as any)}
              />
              <ChipGroup
                label={t('compose.overwhelm')}
                options={ADHD_INTENSITY_OPTIONS}
                value={overwhelm}
                onChange={setOverwhelm}
                labelFn={(v) => t(`adhd.${v}` as any)}
              />
              <ChipGroup
                label={t('compose.taskInitiation')}
                options={TASK_INITIATION_OPTIONS}
                value={taskInitiation}
                onChange={setTaskInitiation}
                labelFn={(v) => t(`task.${v}` as any)}
              />
              <ChipGroup
                label={t('compose.impulsivity')}
                options={ADHD_INTENSITY_OPTIONS}
                value={impulsivity}
                onChange={setImpulsivity}
                labelFn={(v) => t(`adhd.${v}` as any)}
              />
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
              <label className="field">
                <span>{t('compose.sleepHours')}</span>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={24}
                  value={sleepHours}
                  onChange={(e) => setSleepHours(e.target.value)}
                />
              </label>
              <label className="field">
                <span>{t('compose.notes')}</span>
                <input value={checkInNotes} onChange={(e) => setCheckInNotes(e.target.value)} />
              </label>
            </div>
          </Panel>
        </div>

        {err ? (
          <p className="error" style={{ marginTop: 12 }}>
            {err}
          </p>
        ) : null}
        {msg ? (
          <p className="ok" style={{ marginTop: 12 }}>
            {msg}
          </p>
        ) : null}

        <button type="submit" className="btn primary" style={{ marginTop: 16 }} disabled={busy}>
          {busy ? t('morning.saving') : t('morning.save')}
        </button>
      </form>
    </div>
  );
}

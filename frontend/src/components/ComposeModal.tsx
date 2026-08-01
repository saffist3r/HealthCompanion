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
  createInjury,
  createManualMeal,
  createSportMatch,
  fetchInjuries,
  logInjuryPain,
  logWeight,
} from '../api';

type EntryKind = 'meal' | 'care' | 'sport' | 'weight' | 'injury' | null;
type InjuryMode = 'choose' | 'new' | 'pain';
type SportKind = 'padel' | 'gym' | 'running' | 'cycling' | 'swimming' | 'walking' | 'other';
type SportIntensity = 'easy' | 'moderate' | 'hard' | 'max';

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

const TYPES: Array<{ id: Exclude<EntryKind, null>; label: string; icon: string; blurb: string }> = [
  { id: 'meal', label: 'Meal', icon: '/icons/icon-meals.png', blurb: 'Manual macros & notes' },
  { id: 'weight', label: 'Weight', icon: '/icons/icon-glucose.png', blurb: 'Log kg for calorie targets' },
  { id: 'injury', label: 'Injury', icon: '/icons/icon-stress.png', blurb: 'New case or daily pain 0–10' },
  { id: 'care', label: 'Care visit', icon: '/icons/icon-kine.png', blurb: 'Kiné, Ostéo, Podologue…' },
  { id: 'sport', label: 'Sport', icon: '/icons/icon-padel.png', blurb: 'Padel, gym, run, swim…' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

export default function ComposeModal({ open, onClose, onSaved }: Props) {
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

  useEffect(() => {
    if (!open || kind !== 'injury') return;
    fetchInjuries('open')
      .then((rows) => {
        setOpenInjuries(rows);
        if (rows[0] && !painInjuryId) setPainInjuryId(rows[0].id);
      })
      .catch(() => setOpenInjuries([]));
  }, [open, kind, injuryMode]);

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
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
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
          setError('Duration (minutes) is required');
          setBusy(false);
          return;
        }
        const sportName = sportKind === 'other' ? customSport.trim() : sportKind;
        if (!sportName) {
          setError('Enter a sport name');
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
          setError('Enter a valid weight in kg');
          setBusy(false);
          return;
        }
        await logWeight({ date, weightKg: kg });
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
      } else if (kind === 'injury' && injuryMode === 'pain') {
        if (!painInjuryId) {
          setError('Pick an injury to log pain against');
          setBusy(false);
          return;
        }
        const scoreNum = Number(painScore);
        if (!Number.isFinite(scoreNum) || scoreNum < 0 || scoreNum > 10) {
          setError('Pain score must be 0–10');
          setBusy(false);
          return;
        }
        await logInjuryPain(painInjuryId, {
          date,
          painScore: Math.round(scoreNum),
          relatedActivityKind: painActivity || undefined,
          notes: painNotes.trim() || undefined,
        });
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
      <button type="button" className="modal-backdrop" aria-label="Close" onClick={close} />
      <div className="modal-sheet">
        <div className="modal-head">
          <h2>{kind ? 'Add entry' : 'What do you want to log?'}</h2>
          <button type="button" className="btn ghost" onClick={close}>
            Close
          </button>
        </div>

        <div className="compose-date">
          <span className="muted">Date</span>
          <button
            type="button"
            className={`chip ${date === today ? 'on' : ''}`}
            onClick={() => setDate(today)}
          >
            Today
          </button>
          <button
            type="button"
            className={`chip ${date === shiftDate(today, -1) ? 'on' : ''}`}
            onClick={() => setDate(shiftDate(today, -1))}
          >
            Yesterday
          </button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {!kind ? (
          <div className="compose-grid">
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="compose-type"
                onClick={() => {
                  setKind(t.id);
                  if (t.id === 'injury') setInjuryMode('choose');
                }}
              >
                <img src={t.icon} alt="" width={44} height={44} />
                <strong>{t.label}</strong>
                <span className="muted">{t.blurb}</span>
              </button>
            ))}
          </div>
        ) : kind === 'injury' && injuryMode === 'choose' ? (
          <div>
            <button type="button" className="btn ghost" onClick={() => setKind(null)}>
              ← Back
            </button>
            <div className="compose-grid" style={{ marginTop: 12 }}>
              <button type="button" className="compose-type" onClick={() => setInjuryMode('new')}>
                <strong>New injury</strong>
                <span className="muted">Type, body area, treatment exercises</span>
              </button>
              <button
                type="button"
                className="compose-type"
                onClick={() => {
                  setInjuryMode('pain');
                  if (openInjuries[0]) setPainInjuryId(openInjuries[0].id);
                }}
              >
                <strong>Log pain</strong>
                <span className="muted">Daily score 0–10 for an open case</span>
              </button>
            </div>
          </div>
        ) : (
          <form className="form" onSubmit={submit}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                if (kind === 'injury') setInjuryMode('choose');
                else setKind(null);
              }}
            >
              ← Back
            </button>

            {kind === 'meal' ? (
              <>
                <label>
                  Meal type
                  <select value={mealType} onChange={(e) => setMealType(e.target.value)}>
                    <option value="breakfast">Breakfast</option>
                    <option value="lunch">Lunch</option>
                    <option value="dinner">Dinner</option>
                    <option value="snack">Snack</option>
                    <option value="resucrage">Resucrage</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <div className="form-row-3">
                  <label>
                    Carbs (g)
                    <input
                      value={carbs}
                      onChange={(e) => setMacro('carbs', e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <label>
                    Protein (g)
                    <input
                      value={protein}
                      onChange={(e) => setMacro('protein', e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <label>
                    Fat (g)
                    <input
                      value={fat}
                      onChange={(e) => setMacro('fat', e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                </div>
                <label>
                  Calories (kcal)
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
                  Notes
                  <input value={mealNotes} onChange={(e) => setMealNotes(e.target.value)} />
                </label>
              </>
            ) : null}

            {kind === 'care' ? (
              <>
                <label>
                  Kind
                  <select value={careKind} onChange={(e) => setCareKind(e.target.value)}>
                    <option value="kine">Kiné</option>
                    <option value="osteo">Ostéo</option>
                    <option value="podologue">Podologue</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  Practitioner
                  <input value={careLabel} onChange={(e) => setCareLabel(e.target.value)} />
                </label>
                <label>
                  Notes
                  <input value={careNotes} onChange={(e) => setCareNotes(e.target.value)} />
                </label>
              </>
            ) : null}

            {kind === 'sport' ? (
              <>
                <label>
                  Sport
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
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                {sportKind === 'other' ? (
                  <label>
                    Sport name *
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
                      Result
                      <select
                        value={result}
                        onChange={(e) =>
                          setResult(e.target.value as 'win' | 'loss' | 'draw' | 'completed')
                        }
                      >
                        <option value="win">Won</option>
                        <option value="loss">Lost</option>
                        <option value="draw">Draw</option>
                      </select>
                    </label>
                    <label>
                      Score
                      <input
                        value={score}
                        onChange={(e) => setScore(e.target.value)}
                        placeholder="6-4 6-3"
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    Intensity
                    <select
                      value={intensity}
                      onChange={(e) => setIntensity(e.target.value as SportIntensity)}
                    >
                      {SPORT_INTENSITY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Duration (minutes) *
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
                  When (optional)
                  <input
                    type="time"
                    value={sportTime}
                    onChange={(e) => setSportTime(e.target.value)}
                  />
                </label>
                <label>
                  {competitive ? 'Notes' : 'Focus / notes'}
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
                  Weight (kg) *
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

            {kind === 'injury' && injuryMode === 'new' ? (
              <>
                <label>
                  Type
                  <select
                    value={injuryType}
                    onChange={(e) => setInjuryType(e.target.value as InjuryType)}
                  >
                    {INJURY_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Body area
                  <select
                    value={bodyArea}
                    onChange={(e) => setBodyArea(e.target.value as InjuryBodyArea)}
                  >
                    {INJURY_BODY_AREA_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                {bodyArea === 'other' ? (
                  <label>
                    Area detail
                    <input
                      value={bodyAreaOther}
                      onChange={(e) => setBodyAreaOther(e.target.value)}
                      placeholder="Describe area"
                    />
                  </label>
                ) : null}
                <label>
                  Label (optional)
                  <input
                    value={injuryTitle}
                    onChange={(e) => setInjuryTitle(e.target.value)}
                    placeholder="Right knee after padel"
                  />
                </label>
                <div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Related to
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {INJURY_ACTIVITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`chip ${activityTags.includes(opt.value) ? 'on' : ''}`}
                        onClick={() => toggleTag(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  Treatment exercises
                  <textarea
                    value={injuryExercises}
                    onChange={(e) => setInjuryExercises(e.target.value)}
                    rows={3}
                    placeholder="Eccentric quads, foam roll…"
                  />
                </label>
                <label>
                  Notes
                  <input value={injuryNotes} onChange={(e) => setInjuryNotes(e.target.value)} />
                </label>
              </>
            ) : null}

            {kind === 'injury' && injuryMode === 'pain' ? (
              <>
                {openInjuries.length === 0 ? (
                  <p className="muted">No open injuries. Create a case first.</p>
                ) : (
                  <>
                    <label>
                      Injury
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
                        <span>Pain</span>
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
                        <span className="muted">None</span>
                        <span className="muted">Worst</span>
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
                        <option value="">None</option>
                        {INJURY_ACTIVITY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Notes
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
            {!(kind === 'injury' && injuryMode === 'pain' && openInjuries.length === 0) ? (
              <div className="form-actions">
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}

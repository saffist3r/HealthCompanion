import { useEffect, useState, type FormEvent } from 'react';
import { deleteMeal, fetchMeal, getApiBase, updateMeal } from '../api';
import { useLocale } from '../i18n';

function photoRoleLabel(role: string | null | undefined): string {
  switch ((role || '').toLowerCase()) {
    case 'main':
      return 'Main';
    case 'side':
      return 'Side';
    case 'dessert':
      return 'Dessert';
    case 'drink':
      return 'Drink';
    default:
      return role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Photo';
  }
}

const MEAL_TYPES = [
  { value: 'breakfast' },
  { value: 'lunch' },
  { value: 'dinner' },
  { value: 'snack' },
  { value: 'resucrage' },
  { value: 'other' },
] as const;

type MealDetail = {
  id?: string;
  mealType?: string;
  eatenAt?: number;
  photoUrl?: string | null;
  photos?: Array<{ url: string; role?: string; label?: string | null; path?: string }>;
  macros?: {
    caloriesKcal?: number;
    carbsG?: number;
    proteinG?: number;
    fatG?: number;
    fiberG?: number;
    sugarG?: number;
  };
  items?: Array<{ name?: string; portion?: string; estimatedCarbsG?: number } | string>;
  notes?: string | null;
  aiSummary?: string | null;
  carbEstimateNote?: string | null;
  warnings?: Array<{ title?: string; message?: string; severity?: string }>;
  suggestions?: string[];
  source?: string;
  wouldAgain?: number | null;
  wouldAgainNote?: string | null;
  relatedHypoStartedAt?: number | null;
  glucoseStory?: {
    ready?: boolean;
    reason?: string;
    peakMgDl?: number;
    timeToPeakMin?: number;
    returnToRangeMin?: number | null;
    blurb?: string;
  } | null;
  similarMeals?: Array<{
    id?: string;
    mealType?: string;
    carbsG?: number;
    aiSummary?: string;
    wouldAgain?: number | null;
    glucoseStory?: { ready?: boolean; blurb?: string } | null;
  }>;
};

function mealTypeKey(type?: string) {
  const key = (type || 'other').toLowerCase();
  return `mealType.${key}`;
}

function itemLabel(item: { name?: string; portion?: string; estimatedCarbsG?: number } | string) {
  if (typeof item === 'string') return item;
  const bits = [item.name, item.portion].filter(Boolean);
  if (item.estimatedCarbsG != null) bits.push(`~${item.estimatedCarbsG}g carbs`);
  return bits.join(' · ') || 'Item';
}

function toLocalDateInput(ts?: number) {
  if (!ts) return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toLocalTimeInput(ts?: number) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function MealDetailModal({
  meal,
  onClose,
  onSaved,
}: {
  meal: MealDetail | null;
  onClose: () => void;
  onSaved?: (meal: MealDetail) => void;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mealType, setMealType] = useState('other');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [carbs, setCarbs] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [calories, setCalories] = useState('');
  const [notes, setNotes] = useState('');
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState<MealDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [wouldAgain, setWouldAgain] = useState<number | null>(null);
  const [ratingBusy, setRatingBusy] = useState(false);

  useEffect(() => {
    if (!meal) return;
    setEditing(false);
    setError(null);
    setDetail(null);
    setWouldAgain(meal.wouldAgain ?? null);
    setMealType(meal.mealType || 'other');
    setDate(toLocalDateInput(meal.eatenAt));
    setTime(toLocalTimeInput(meal.eatenAt));
    setCarbs(String(meal.macros?.carbsG ?? 0));
    setProtein(String(meal.macros?.proteinG ?? 0));
    setFat(String(meal.macros?.fatG ?? 0));
    setCalories(String(Math.round(meal.macros?.caloriesKcal || 0)));
    setNotes(meal.notes || '');
    setSummary(meal.aiSummary || '');

    if (!meal.id) return;
    let cancelled = false;
    setDetailLoading(true);
    fetchMeal(meal.id)
      .then((full) => {
        if (cancelled) return;
        setDetail(full);
        setWouldAgain(full.wouldAgain ?? null);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [meal]);

  if (!meal) return null;

  const view = detail || meal;
  const glucoseStory = view.glucoseStory;
  const similarMeals = view.similarMeals || [];
  const base = getApiBase().replace(/\/$/, '');
  const gallery =
    view.photos && view.photos.length > 0
      ? view.photos
      : meal.photoUrl
        ? [{ url: meal.photoUrl, role: 'main' as const }]
        : [];
  const photo = gallery[0] ? `${base}${gallery[0].url}` : meal.photoUrl ? `${base}${meal.photoUrl}` : null;
  const macros = meal.macros || {};
  const kcal = Math.round(macros.caloriesKcal || 0);
  const items = meal.items || [];
  const when = meal.eatenAt ? new Date(meal.eatenAt).toLocaleString() : '—';

  const setRating = async (value: number) => {
    if (!meal.id) return;
    setRatingBusy(true);
    setError(null);
    try {
      const updated = await updateMeal(meal.id, { wouldAgain: value });
      setWouldAgain(value);
      setDetail((prev) => (prev ? { ...prev, wouldAgain: value } : prev));
      onSaved?.(updated);
    } catch (err: any) {
      setError(String(err?.response?.data?.detail || err.message || err));
    } finally {
      setRatingBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!meal.id) return;
    setBusy(true);
    setError(null);
    try {
      const c = Number(carbs) || 0;
      const p = Number(protein) || 0;
      const f = Number(fat) || 0;
      const cal = Number(calories);
      const estimated = Math.round(c * 4 + p * 4 + f * 9);
      const eatenAt =
        date && time
          ? new Date(`${date}T${time}:00`).toISOString()
          : date
            ? new Date(`${date}T12:00:00`).toISOString()
            : undefined;
      const updated = await updateMeal(meal.id, {
        mealType,
        notes: notes.trim() || null,
        aiSummary: summary.trim() || null,
        eatenAt,
        macros: {
          carbsG: c,
          proteinG: p,
          fatG: f,
          fiberG: macros.fiberG ?? 0,
          sugarG: macros.sugarG ?? 0,
          caloriesKcal: Number.isFinite(cal) && cal > 0 ? Math.round(cal) : estimated,
        },
      });
      onSaved?.(updated);
      setEditing(false);
    } catch (err: any) {
      setError(String(err?.response?.data?.detail || err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!meal.id) return;
    if (!window.confirm(t('mealDetail.deleteConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      await deleteMeal(meal.id);
      onSaved?.({ id: meal.id, deleted: true } as MealDetail & { deleted: boolean });
      onClose();
    } catch (err: any) {
      setError(String(err?.response?.data?.detail || err.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-label={t('mealDetail.details')}>
      <button type="button" className="modal-backdrop" aria-label={t('mealDetail.close')} onClick={onClose} />
      <div className="modal-sheet meal-detail-sheet">
        <div className="modal-head">
          <div>
            <h2 className="capitalize" style={{ margin: 0 }}>
              {editing ? t('mealDetail.edit') : t(mealTypeKey(meal.mealType) as any)}
            </h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {when}
              {meal.source ? ` · ${meal.source}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!editing ? (
              <button type="button" className="btn secondary" onClick={() => setEditing(true)}>
                {t('mealDetail.editBtn')}
              </button>
            ) : null}
            <button type="button" className="btn ghost" onClick={onClose}>
              {t('mealDetail.close')}
            </button>
          </div>
        </div>

        {gallery.length > 1 ? (
          <div className="meal-detail-gallery">
            {gallery.map((p, i) => (
              <figure key={`${p.url}-${i}`} className="meal-detail-gallery-item">
                <img
                  src={`${base}${p.url}`}
                  alt={p.label || photoRoleLabel(p.role)}
                  className="meal-detail-photo"
                />
                <figcaption>{p.label || photoRoleLabel(p.role)}</figcaption>
              </figure>
            ))}
          </div>
        ) : photo ? (
          <div className="meal-detail-photo-wrap">
            <img src={photo} alt={t(mealTypeKey(meal.mealType) as any)} className="meal-detail-photo" />
          </div>
        ) : (
          <div className="meal-detail-photo-wrap empty">
            <img src="/icons/icon-meals.png" alt="" width={72} height={72} style={{ borderRadius: 16 }} />
            <p className="muted">{t('mealDetail.noPhoto')}</p>
          </div>
        )}

        {editing ? (
          <form className="form" onSubmit={save}>
            <label>
              {t('mealDetail.category')}
              <select value={mealType} onChange={(e) => setMealType(e.target.value)}>
                {MEAL_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(`mealType.${opt.value}` as any)}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label>
                {t('mealDetail.date')}
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </label>
              <label>
                {t('mealDetail.time')}
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <div className="form-row-3">
              <label>
                {t('mealDetail.carbs')}
                <input value={carbs} onChange={(e) => setCarbs(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                {t('mealDetail.protein')}
                <input value={protein} onChange={(e) => setProtein(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                {t('mealDetail.fat')}
                <input value={fat} onChange={(e) => setFat(e.target.value)} inputMode="decimal" />
              </label>
            </div>
            <label>
              {t('mealDetail.calories')}
              <input value={calories} onChange={(e) => setCalories(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              {t('mealDetail.summary')}
              <input value={summary} onChange={(e) => setSummary(e.target.value)} />
            </label>
            <label>
              {t('mealDetail.notes')}
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <div className="form-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? t('common.saving') : t('mealDetail.save')}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
              >
                {t('mealDetail.cancel')}
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={remove} style={{ marginLeft: 'auto', color: '#FF4D6D' }}>
                {t('mealDetail.delete')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="macro-pills meal-detail-macros">
              <span className="pill calories">{kcal} kcal</span>
              <span className="pill carbs">Carbs {macros.carbsG ?? 0}g</span>
              <span className="pill protein">Protein {macros.proteinG ?? 0}g</span>
              <span className="pill fat">Fat {macros.fatG ?? 0}g</span>
            </div>

            {meal.aiSummary ? (
              <section className="meal-detail-section">
                <h3>{t('mealDetail.summary')}</h3>
                <p className="meal-detail-text">{meal.aiSummary}</p>
              </section>
            ) : null}

            {detailLoading ? (
              <p className="muted" style={{ fontSize: 13 }}>Loading glucose story…</p>
            ) : glucoseStory?.ready ? (
              <section className="meal-detail-section">
                <h3>Glucose story</h3>
                <p className="meal-detail-text">{glucoseStory.blurb}</p>
                <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Peak {Math.round(glucoseStory.peakMgDl || 0)} mg/dL · {glucoseStory.timeToPeakMin} min to peak
                  {glucoseStory.returnToRangeMin != null
                    ? ` · back in range by ${glucoseStory.returnToRangeMin} min`
                    : ''}
                </p>
              </section>
            ) : glucoseStory && !glucoseStory.ready ? (
              <p className="muted" style={{ fontSize: 13 }}>
                Glucose arc still loading — CGM needs a few more readings.
              </p>
            ) : null}

            {similarMeals.length > 0 ? (
              <section className="meal-detail-section">
                <h3>Similar meals</h3>
                <ul className="meal-detail-items">
                  {similarMeals.slice(0, 4).map((s) => (
                    <li key={s.id}>
                      <span className="capitalize">{s.mealType || 'meal'}</span>
                      {s.carbsG != null ? ` · ${s.carbsG}g carbs` : ''}
                      {s.aiSummary ? ` — ${String(s.aiSummary).slice(0, 60)}` : ''}
                      {s.wouldAgain === 1 ? ' 👍' : s.wouldAgain === -1 ? ' 👎' : ''}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="meal-detail-section">
              <h3>Would I eat this again?</h3>
              <div className="chip-row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className={`chip ${wouldAgain === 1 ? 'on' : ''}`}
                  disabled={ratingBusy || !meal.id}
                  onClick={() => setRating(1)}
                >
                  Again
                </button>
                <button
                  type="button"
                  className={`chip ${wouldAgain === 0 ? 'on' : ''}`}
                  disabled={ratingBusy || !meal.id}
                  onClick={() => setRating(0)}
                >
                  Meh
                </button>
                <button
                  type="button"
                  className={`chip ${wouldAgain === -1 ? 'on' : ''}`}
                  disabled={ratingBusy || !meal.id}
                  onClick={() => setRating(-1)}
                >
                  Never
                </button>
              </div>
            </section>

            {view.relatedHypoStartedAt ? (
              <p className="muted" style={{ fontSize: 13 }}>
                Resucrage logged near a hypo around{' '}
                {new Date(view.relatedHypoStartedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                . The plot thickens, but at least you documented it.
              </p>
            ) : null}

            {meal.notes ? (
              <section className="meal-detail-section">
                <h3>{t('mealDetail.notes')}</h3>
                <p className="meal-detail-text">{meal.notes}</p>
              </section>
            ) : null}

            {meal.carbEstimateNote ? (
              <section className="meal-detail-section">
                <h3>{t('mealDetail.carbEstimate')}</h3>
                <p className="meal-detail-text muted">{meal.carbEstimateNote}</p>
              </section>
            ) : null}

            {items.length > 0 ? (
              <section className="meal-detail-section">
                <h3>{t('mealDetail.items')}</h3>
                <ul className="meal-detail-items">
                  {items.map((it, i) => (
                    <li key={i}>{itemLabel(it)}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {(meal.suggestions || []).length > 0 ? (
              <section className="meal-detail-section">
                <h3>{t('mealDetail.suggestions')}</h3>
                <ul className="meal-detail-items">
                  {meal.suggestions!.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {(meal.warnings || []).map((w, i) => (
              <div key={i} className={`warn warn-${w.severity || 'caution'}`}>
                <strong>{w.title || t('mealDetail.warning')}</strong>
                <p>{w.message}</p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

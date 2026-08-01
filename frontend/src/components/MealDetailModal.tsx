import { useEffect, useState, type FormEvent } from 'react';
import { deleteMeal, getApiBase, updateMeal } from '../api';

const MEAL_TYPES = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
  { value: 'resucrage', label: 'Resucrage' },
  { value: 'other', label: 'Other' },
] as const;

type MealDetail = {
  id?: string;
  mealType?: string;
  eatenAt?: number;
  photoUrl?: string | null;
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
};

function mealTypeLabel(type?: string) {
  if (!type) return 'Meal';
  if (type === 'resucrage') return 'Resucrage';
  return type.charAt(0).toUpperCase() + type.slice(1);
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

  useEffect(() => {
    if (!meal) return;
    setEditing(false);
    setError(null);
    setMealType(meal.mealType || 'other');
    setDate(toLocalDateInput(meal.eatenAt));
    setTime(toLocalTimeInput(meal.eatenAt));
    setCarbs(String(meal.macros?.carbsG ?? 0));
    setProtein(String(meal.macros?.proteinG ?? 0));
    setFat(String(meal.macros?.fatG ?? 0));
    setCalories(String(Math.round(meal.macros?.caloriesKcal || 0)));
    setNotes(meal.notes || '');
    setSummary(meal.aiSummary || '');
  }, [meal]);

  if (!meal) return null;

  const base = getApiBase().replace(/\/$/, '');
  const photo = meal.photoUrl ? `${base}${meal.photoUrl}` : null;
  const macros = meal.macros || {};
  const kcal = Math.round(macros.caloriesKcal || 0);
  const items = meal.items || [];
  const when = meal.eatenAt ? new Date(meal.eatenAt).toLocaleString() : '—';

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
    if (!window.confirm('Delete this meal?')) return;
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
    <div className="modal-root" role="dialog" aria-modal="true" aria-label="Meal details">
      <button type="button" className="modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="modal-sheet meal-detail-sheet">
        <div className="modal-head">
          <div>
            <h2 className="capitalize" style={{ margin: 0 }}>
              {editing ? 'Edit meal' : mealTypeLabel(meal.mealType)}
            </h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {when}
              {meal.source ? ` · ${meal.source}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!editing ? (
              <button type="button" className="btn secondary" onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : null}
            <button type="button" className="btn ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {photo ? (
          <div className="meal-detail-photo-wrap">
            <img src={photo} alt={mealTypeLabel(meal.mealType)} className="meal-detail-photo" />
          </div>
        ) : (
          <div className="meal-detail-photo-wrap empty">
            <img src="/icons/icon-meals.png" alt="" width={72} height={72} style={{ borderRadius: 16 }} />
            <p className="muted">No photo for this meal</p>
          </div>
        )}

        {editing ? (
          <form className="form" onSubmit={save}>
            <label>
              Category
              <select value={mealType} onChange={(e) => setMealType(e.target.value)}>
                {MEAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label>
                Date
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </label>
              <label>
                Time
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
            <div className="form-row-3">
              <label>
                Carbs (g)
                <input value={carbs} onChange={(e) => setCarbs(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                Protein (g)
                <input value={protein} onChange={(e) => setProtein(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                Fat (g)
                <input value={fat} onChange={(e) => setFat(e.target.value)} inputMode="decimal" />
              </label>
            </div>
            <label>
              Calories (kcal)
              <input value={calories} onChange={(e) => setCalories(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              Summary
              <input value={summary} onChange={(e) => setSummary(e.target.value)} />
            </label>
            <label>
              Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <div className="form-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
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
                Cancel
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={remove} style={{ marginLeft: 'auto', color: '#be123c' }}>
                Delete
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
                <h3>Summary</h3>
                <p className="meal-detail-text">{meal.aiSummary}</p>
              </section>
            ) : null}

            {meal.notes ? (
              <section className="meal-detail-section">
                <h3>Notes</h3>
                <p className="meal-detail-text">{meal.notes}</p>
              </section>
            ) : null}

            {meal.carbEstimateNote ? (
              <section className="meal-detail-section">
                <h3>Carb estimate</h3>
                <p className="meal-detail-text muted">{meal.carbEstimateNote}</p>
              </section>
            ) : null}

            {items.length > 0 ? (
              <section className="meal-detail-section">
                <h3>Items</h3>
                <ul className="meal-detail-items">
                  {items.map((it, i) => (
                    <li key={i}>{itemLabel(it)}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {(meal.suggestions || []).length > 0 ? (
              <section className="meal-detail-section">
                <h3>Suggestions</h3>
                <ul className="meal-detail-items">
                  {meal.suggestions!.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {(meal.warnings || []).map((w, i) => (
              <div key={i} className={`warn warn-${w.severity || 'caution'}`}>
                <strong>{w.title || 'Warning'}</strong>
                <p>{w.message}</p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

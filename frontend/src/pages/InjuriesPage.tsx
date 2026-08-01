import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Injury } from '../injuries';
import { deleteInjury, fetchInjuries, updateInjury } from '../api';
import { PageHeader, Panel, StatCard } from '../components/ui';

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function PainSpark({ scores }: { scores: number[] }) {
  if (scores.length === 0) {
    return <span className="muted" style={{ fontSize: 12 }}>No pain logs yet</span>;
  }
  const max = 10;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 28 }}>
      {scores.map((s, i) => (
        <div
          key={i}
          title={`${s}/10`}
          style={{
            width: 8,
            height: Math.max(4, Math.round((s / max) * 28)),
            borderRadius: 2,
            background:
              s >= 7 ? '#e11d48' : s >= 4 ? '#f59e0b' : '#10b981',
          }}
        />
      ))}
    </div>
  );
}

export default function InjuriesPage() {
  const [filter, setFilter] = useState<'open' | 'healed' | 'all'>('open');
  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exerciseDraft, setExerciseDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const today = useMemo(() => todayKey(), []);

  const load = useCallback(() => {
    setLoading(true);
    fetchInjuries(filter)
      .then((rows) => setInjuries(rows))
      .catch((e) => setError(String(e?.response?.data?.detail || e.message || e)))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const openCount = injuries.filter((i) => i.status !== 'healed').length;
  const withPainToday = injuries.filter((i) => i.todayPain).length;
  const avgPainToday =
    withPainToday > 0
      ? Math.round(
          (injuries.reduce((s, i) => s + (i.todayPain?.painScore ?? 0), 0) / withPainToday) * 10
        ) / 10
      : null;

  const markHealed = async (inj: Injury) => {
    setBusyId(inj.id);
    try {
      await updateInjury(inj.id, { status: 'healed', healedOn: today });
      load();
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setBusyId(null);
    }
  };

  const saveExercises = async (inj: Injury) => {
    setBusyId(inj.id);
    try {
      await updateInjury(inj.id, { exerciseNotes: exerciseDraft.trim() });
      setEditingId(null);
      load();
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (inj: Injury) => {
    if (!window.confirm(`Delete injury “${inj.title || inj.bodyAreaLabel || inj.injuryType}”?`)) {
      return;
    }
    setBusyId(inj.id);
    try {
      await deleteInjury(inj.id);
      load();
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Recovery"
        title="Injuries"
        lede="Track cases, daily pain (0–10), and treatment exercises. Included in daily AI reports."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {(['open', 'healed', 'all'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`chip ${filter === f ? 'on' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'open' ? 'Open' : f === 'healed' ? 'Healed' : 'All'}
              </button>
            ))}
          </div>
        }
      />

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading injuries…</p> : null}

      <div className="stat-grid">
        <StatCard label="Listed" value={injuries.length} accent="blue" />
        <StatCard
          label="Open (this view)"
          value={openCount}
          accent="amber"
          foot="Active or healing"
        />
        <StatCard
          label="Pain logged today"
          value={withPainToday}
          accent="rose"
          foot={avgPainToday != null ? `Avg ${avgPainToday}/10` : 'Use + to log'}
        />
      </div>

      <Panel title="Cases" subtitle="Tap exercises to edit · mark healed when ready">
        {injuries.length === 0 && !loading ? (
          <p className="muted">No injuries in this filter. Use + → Injury to create a case.</p>
        ) : (
          <div className="meal-list">
            {injuries.map((inj) => {
              const scores = (inj.recentPain || []).map((p) => p.painScore);
              const label = inj.title || inj.bodyAreaLabel || inj.injuryTypeLabel || 'Injury';
              return (
                <div key={inj.id} className="meal-row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{label}</strong>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {[
                        inj.injuryTypeLabel || inj.injuryType,
                        inj.bodyAreaLabel || inj.bodyArea,
                        `since ${inj.startedOn}`,
                        inj.status,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {(inj.relatedActivityLabels || []).length > 0 ? (
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        Related: {(inj.relatedActivityLabels || []).join(', ')}
                      </div>
                    ) : null}
                    <div style={{ marginTop: 8 }}>
                      <PainSpark scores={scores} />
                    </div>
                    {editingId === inj.id ? (
                      <div style={{ marginTop: 8 }}>
                        <textarea
                          value={exerciseDraft}
                          onChange={(e) => setExerciseDraft(e.target.value)}
                          rows={3}
                          style={{ width: '100%' }}
                          placeholder="Treatment exercises…"
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                          <button
                            type="button"
                            className="btn primary"
                            disabled={busyId === inj.id}
                            onClick={() => saveExercises(inj)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ marginTop: 6, padding: '4px 0', fontSize: 13 }}
                        onClick={() => {
                          setEditingId(inj.id);
                          setExerciseDraft(inj.exerciseNotes || '');
                        }}
                      >
                        {inj.exerciseNotes
                          ? `Exercises: ${inj.exerciseNotes.slice(0, 80)}${
                              inj.exerciseNotes.length > 80 ? '…' : ''
                            }`
                          : 'Add treatment exercises'}
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <span className="stat-badge">
                      {inj.todayPain
                        ? `${inj.todayPain.painScore}/10 today`
                        : inj.latestPain
                          ? `last ${inj.latestPain.painScore}/10`
                          : inj.status}
                    </span>
                    {inj.status !== 'healed' ? (
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={busyId === inj.id}
                        onClick={() => markHealed(inj)}
                      >
                        Mark healed
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busyId === inj.id}
                      onClick={() => remove(inj)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

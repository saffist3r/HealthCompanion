import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchMeals, getApiBase } from '../api';
import MealDetailModal from '../components/MealDetailModal';
import { ChartTooltipBox, PageHeader, Panel, StatCard } from '../components/ui'
import { useLocale } from '../i18n';

export default function MealsPage() {
  const { t } = useLocale();
  const [meals, setMeals] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    fetchMeals()
      .then(setMeals)
      .catch((e) => setError(String(e?.response?.data?.detail || e.message || e)))
      .finally(() => setLoading(false));
  }, []);

  const base = getApiBase();

  const totals = useMemo(() => {
    return meals.reduce(
      (acc, m) => {
        const macros = m.macros || {};
        const kcal =
          macros.caloriesKcal > 0
            ? macros.caloriesKcal
            : Math.round((macros.carbsG || 0) * 4 + (macros.proteinG || 0) * 4 + (macros.fatG || 0) * 9);
        return {
          carbs: acc.carbs + (macros.carbsG || 0),
          protein: acc.protein + (macros.proteinG || 0),
          fat: acc.fat + (macros.fatG || 0),
          calories: acc.calories + kcal,
          warns: acc.warns + (m.warnings?.length || 0),
        };
      },
      { carbs: 0, protein: 0, fat: 0, calories: 0, warns: 0 }
    );
  }, [meals]);

  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of meals) {
      const t = m.mealType || 'other';
      map[t] = (map[t] || 0) + (m.macros?.carbsG || 0);
    }
    return Object.entries(map).map(([type, carbs]) => ({ type, carbs: Math.round(carbs * 10) / 10 }));
  }, [meals]);

  return (
    <div>
      <PageHeader
        eyebrow={t('meals.eyebrow')}
        title={t('meals.title')}
        lede={t('meals.lede')}
      />

      {error ? <p className="error">{error}</p> : null}

      <div className="stat-grid">
        <StatCard label={t('meals.title')} value={meals.length} accent="teal" />
        <StatCard label={t('meals.calories')} value={Math.round(totals.calories)} unit="kcal" accent="amber" />
        <StatCard label={t('meals.totalCarbs')} value={Math.round(totals.carbs)} unit="g" accent="teal" />
        <StatCard label={t('meals.protein')} value={Math.round(totals.protein)} unit="g" accent="blue" />
        <StatCard
          label={t('meals.warnings')}
          value={totals.warns}
          accent={totals.warns ? 'rose' : 'green'}
          badge={totals.warns ? { text: t('meals.review'), tone: 'warn' } : { text: t('meals.clear'), tone: 'good' }}
        />
      </div>

      {byType.length > 0 ? (
        <Panel title={t('meals.carbsByType')} subtitle={t('meals.acrossLog')}>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byType} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E3350" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#8CA0BC', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="type"
                  width={80}
                  tick={{ fill: '#8CA0BC', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltipBox unit="g" />} />
                <Bar dataKey="carbs" name={t('meals.carbs')} fill="#22D3EE" radius={[0, 8, 8, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      ) : null}

      {loading ? <p className="muted">{t('meals.loading')}</p> : null}

      <div className="meal-list">
        {meals.map((m) => (
          <button
            key={m.id}
            type="button"
            className="panel meal-card meal-card-button"
            onClick={() => setSelected(m)}
          >
            <div className="meal-card-top">
              {m.photoUrl ? (
                <img src={`${base}${m.photoUrl}`} alt="" className="thumb" />
              ) : (
                <img src="/icons/icon-meals.png" alt="" className="entry-icon" />
              )}
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong className="capitalize" style={{ fontSize: 16 }}>
                    {m.mealType === 'resucrage' ? 'Resucrage' : m.mealType}
                  </strong>
                  {(m.warnings || []).length ? (
                    <span className="stat-badge warn">{m.warnings.length} warning</span>
                  ) : (
                    <span className="stat-badge good">OK</span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  {new Date(m.eatenAt).toLocaleString()}
                </div>
                <div className="macro-pills">
                  <span className="pill calories">{Math.round(m.macros?.caloriesKcal || 0)} kcal</span>
                  <span className="pill carbs">Carbs {m.macros?.carbsG}g</span>
                  <span className="pill protein">Protein {m.macros?.proteinG}g</span>
                  <span className="pill fat">Fat {m.macros?.fatG}g</span>
                </div>
              </div>
            </div>
            {m.aiSummary ? (
              <p className="meal-card-preview">{m.aiSummary}</p>
            ) : null}
            {m.carbEstimateNote ? (
              <p className="muted" style={{ margin: 0, fontSize: 13, fontStyle: 'italic' }}>
                {m.carbEstimateNote}
              </p>
            ) : null}
            {(m.warnings || []).slice(0, 1).map((w: any, i: number) => (
              <div key={i} className={`warn warn-${w.severity}`}>
                <strong>{w.title}</strong>
                <p>{w.message}</p>
              </div>
            ))}
          </button>
        ))}
        {!loading && !error && meals.length === 0 ? (
          <div className="panel empty-state">
            <img src="/icons/icon-meals.png" alt="" width={56} height={56} style={{ borderRadius: 12 }} />
            <div>No meals yet. Tap + to add one, or photograph a meal on the phone.</div>
          </div>
        ) : null}
      </div>

      <MealDetailModal
        meal={selected}
        onClose={() => setSelected(null)}
        onSaved={(updated) => {
          fetchMeals()
            .then((rows) => {
              setMeals(rows);
              if ((updated as { deleted?: boolean } | null)?.deleted) {
                setSelected(null);
                return;
              }
              const next = rows.find((m) => m.id === updated?.id);
              setSelected(next || null);
            })
            .catch(() => undefined);
        }}
      />
    </div>
  );
}

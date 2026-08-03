import { useEffect, useMemo, useState } from 'react';
import {
  clearSession,
  fetchBodyProfile,
  fetchWeightHistory,
  getApiBase,
  getDeviceId,
  getStoredUser,
  logWeight,
  pingHealth,
  setApiBase,
  setDeviceId,
  updateBodyProfile,
} from '../api';
import { PageHeader, Panel, Segmented, StatCard } from '../components/ui';
import { LOCALES, normalizeLocale, useLocale, type Locale } from '../i18n';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

type SettingsTab = 'glucose' | 'body' | 'prefs' | 'account';

const TIR_RANGE_PRESETS = [
  { id: 'ada', low: 70, high: 180 },
  { id: 'tight', low: 70, high: 140 },
  { id: 'relaxed', low: 70, high: 200 },
  { id: 'pregnancy', low: 63, high: 140 },
] as const;

const TIR_GOAL_PRESETS = [60, 70, 80, 85] as const;
const CARB_PRESETS = [120, 150, 180, 200, 250] as const;
const DEFICIT_PRESETS = [250, 500, 750] as const;

export default function SettingsPage() {
  const user = getStoredUser();
  const { t, locale, setLocale } = useLocale();
  const [tab, setTab] = useState<SettingsTab>('glucose');
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [deviceId, setDevice] = useState(getDeviceId());
  const [status, setStatus] = useState('—');
  const [online, setOnline] = useState<boolean | null>(null);

  const [heightCm, setHeightCm] = useState('178');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [ageYears, setAgeYears] = useState('30');
  const [activity, setActivity] = useState<
    'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
  >('light');
  const [deficitKcal, setDeficitKcal] = useState('500');
  const [tirLow, setTirLow] = useState('70');
  const [tirHigh, setTirHigh] = useState('180');
  const [tirGoal, setTirGoal] = useState('70');
  const [carbTarget, setCarbTarget] = useState('180');
  const [weightKg, setWeightKg] = useState('101.4');
  const [weightDate, setWeightDate] = useState(todayKey());
  const [targets, setTargets] = useState<any>(null);
  const [weights, setWeights] = useState<any[]>([]);
  const [bodyNote, setBodyNote] = useState<string | null>(null);
  const [bodyBusy, setBodyBusy] = useState(false);
  const [langNote, setLangNote] = useState<string | null>(null);

  const lowN = Number(tirLow) || 70;
  const highN = Number(tirHigh) || 180;
  const goalN = Number(tirGoal) || 70;
  const carbN = Number(carbTarget) || 180;
  const deficitN = Number(deficitKcal) || 500;

  const activeRangePreset = useMemo(
    () => TIR_RANGE_PRESETS.find((p) => p.low === lowN && p.high === highN)?.id ?? null,
    [lowN, highN]
  );

  const rangePreview = useMemo(() => {
    const min = 40;
    const max = 250;
    const clamp = (v: number) => Math.max(min, Math.min(max, v));
    const left = ((clamp(lowN) - min) / (max - min)) * 100;
    const right = ((clamp(highN) - min) / (max - min)) * 100;
    return { left, width: Math.max(2, right - left) };
  }, [lowN, highN]);

  const profilePayload = (nextLocale: Locale = locale) => ({
    heightCm: Number(heightCm),
    sex,
    ageYears: Number(ageYears),
    activity,
    deficitKcal: Number(deficitKcal),
    locale: nextLocale,
    tirLowMgDl: Number(tirLow),
    tirHighMgDl: Number(tirHigh),
    tirGoalPct: Number(tirGoal),
    dailyCarbTargetG: Number(carbTarget),
  });

  const loadBody = async () => {
    try {
      const [body, hist] = await Promise.all([fetchBodyProfile(), fetchWeightHistory(14)]);
      if (body.profile) {
        setHeightCm(String(body.profile.heightCm));
        setSex((body.profile.sex as 'male' | 'female') || 'male');
        setAgeYears(String(body.profile.ageYears));
        setActivity((body.profile.activity as typeof activity) || 'light');
        setDeficitKcal(String(body.profile.deficitKcal));
        setTirLow(String(body.profile.tirLowMgDl ?? 70));
        setTirHigh(String(body.profile.tirHighMgDl ?? 180));
        setTirGoal(String(body.profile.tirGoalPct ?? 70));
        setCarbTarget(String(body.profile.dailyCarbTargetG ?? 180));
        if (body.profile.locale) {
          setLocale(normalizeLocale(body.profile.locale));
        }
      }
      if (body.latestWeight) {
        setWeightKg(String(body.latestWeight.weightKg));
      }
      setTargets(body.targets);
      setWeights(hist);
    } catch (e: any) {
      setBodyNote(String(e?.response?.data?.detail || e.message || e));
    }
  };

  useEffect(() => {
    loadBody();
  }, []);

  const save = () => {
    setApiBase(apiUrl);
    setDeviceId(deviceId);
    setStatus(t('settings.savedLocal'));
  };

  const saveLanguage = async (next: Locale) => {
    setLocale(next);
    setLangNote(null);
    setBodyBusy(true);
    try {
      await updateBodyProfile(profilePayload(next));
      setLangNote(t('settings.languageSaved'));
    } catch (e: any) {
      setLangNote(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setBodyBusy(false);
    }
  };

  const ping = async () => {
    try {
      setApiBase(apiUrl);
      setDeviceId(deviceId);
      const h = await pingHealth();
      setOnline(Boolean(h.ok));
      setStatus(
        h.ok
          ? `Connected · auth ${h.auth || 'unknown'} · Gemini ${
              h.geminiConfigured || h.openaiConfigured ? 'ready' : 'key missing'
            }`
          : t('settings.unreachable')
      );
    } catch (e: any) {
      setOnline(false);
      setStatus(String(e.message || e));
    }
  };

  const saveProfile = async () => {
    setBodyBusy(true);
    setBodyNote(null);
    try {
      const res = await updateBodyProfile(profilePayload());
      setTargets(res.targets);
      if (res.profile) {
        setTirLow(String(res.profile.tirLowMgDl ?? tirLow));
        setTirHigh(String(res.profile.tirHighMgDl ?? tirHigh));
        setTirGoal(String(res.profile.tirGoalPct ?? tirGoal));
        setCarbTarget(String(res.profile.dailyCarbTargetG ?? carbTarget));
      }
      setBodyNote(t('settings.profileSaved'));
    } catch (e: any) {
      setBodyNote(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setBodyBusy(false);
    }
  };

  const saveWeight = async () => {
    setBodyBusy(true);
    setBodyNote(null);
    try {
      const res = await logWeight({
        date: weightDate,
        weightKg: Number(weightKg),
      });
      setTargets(res.targets);
      await loadBody();
      setBodyNote(t('settings.weightSaved', { kg: res.weight.weightKg, date: res.weight.date }));
    } catch (e: any) {
      setBodyNote(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setBodyBusy(false);
    }
  };

  const applyRange = (low: number, high: number) => {
    setTirLow(String(low));
    setTirHigh(String(high));
  };

  return (
    <div>
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        lede={t('settings.lede')}
        actions={
          online == null ? null : (
            <span className={`status-chip ${online ? '' : 'offline'}`}>
              <span className="status-dot" />
              {online ? t('settings.apiOnline') : t('settings.apiOffline')}
            </span>
          )
        }
      />

      <div className="settings-tabs">
        <Segmented
          value={tab}
          onChange={(id) => setTab(id as SettingsTab)}
          options={[
            { id: 'glucose', label: t('settings.tab.glucose') },
            { id: 'body', label: t('settings.tab.body') },
            { id: 'prefs', label: t('settings.tab.prefs') },
            { id: 'account', label: t('settings.tab.account') },
          ]}
        />
      </div>

      {tab === 'glucose' ? (
        <>
          <Panel title={t('settings.glucoseTitle')} subtitle={t('settings.glucoseSubtitle')}>
            <div className="tir-preview" aria-hidden>
              <div className="tir-preview-track">
                <div
                  className="tir-preview-band"
                  style={{ left: `${rangePreview.left}%`, width: `${rangePreview.width}%` }}
                />
              </div>
              <div className="tir-preview-labels">
                <span>40</span>
                <strong>
                  {lowN}–{highN} mg/dL · ≥{goalN}% TIR
                </strong>
                <span>250</span>
              </div>
            </div>

            <div className="suggest-block">
              <div className="suggest-label">{t('settings.suggestRange')}</div>
              <div className="chip-row">
                {TIR_RANGE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`chip ${activeRangePreset === p.id ? 'on' : ''}`}
                    onClick={() => applyRange(p.low, p.high)}
                  >
                    {t(`settings.preset.${p.id}`)} · {p.low}–{p.high}
                  </button>
                ))}
              </div>
            </div>

            <div className="form" style={{ marginTop: 14 }}>
              <div className="form-row-3">
                <label>
                  {t('settings.tirLow')}
                  <input value={tirLow} onChange={(e) => setTirLow(e.target.value)} inputMode="decimal" />
                </label>
                <label>
                  {t('settings.tirHigh')}
                  <input value={tirHigh} onChange={(e) => setTirHigh(e.target.value)} inputMode="decimal" />
                </label>
                <label>
                  {t('settings.tirGoal')}
                  <input value={tirGoal} onChange={(e) => setTirGoal(e.target.value)} inputMode="decimal" />
                </label>
              </div>
            </div>

            <div className="suggest-block">
              <div className="suggest-label">{t('settings.suggestGoal')}</div>
              <div className="chip-row">
                {TIR_GOAL_PRESETS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`chip ${goalN === g ? 'on' : ''}`}
                    onClick={() => setTirGoal(String(g))}
                  >
                    ≥{g}%
                  </button>
                ))}
              </div>
              <p className="muted suggest-hint">{t('settings.suggestGoalHint')}</p>
            </div>

            <div className="suggest-block">
              <div className="suggest-label">{t('settings.carbTarget')}</div>
              <div className="chip-row">
                {CARB_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`chip ${carbN === c ? 'on' : ''}`}
                    onClick={() => setCarbTarget(String(c))}
                  >
                    {c}g
                  </button>
                ))}
              </div>
              <div className="form" style={{ marginTop: 10 }}>
                <label>
                  {t('settings.carbTargetCustom')}
                  <input
                    value={carbTarget}
                    onChange={(e) => setCarbTarget(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
              </div>
              <p className="muted suggest-hint">{t('settings.suggestCarbHint')}</p>
            </div>

            <div className="form-actions">
              <button type="button" className="btn primary" disabled={bodyBusy} onClick={saveProfile}>
                {t('settings.saveProfile')}
              </button>
            </div>
            {bodyNote && tab === 'glucose' ? <p className="muted">{bodyNote}</p> : null}
          </Panel>
        </>
      ) : null}

      {tab === 'body' ? (
        <>
          {targets ? (
            <div className="stat-grid">
              <StatCard
                label={t('settings.weight')}
                value={targets.weightKg}
                unit="kg"
                accent="teal"
                foot={`BMI ${targets.bmi}`}
              />
              <StatCard
                label={t('settings.bmr')}
                value={targets.bmrKcal}
                unit="kcal"
                accent="blue"
                foot={targets.formula}
              />
              <StatCard
                label={t('settings.maintenance')}
                value={targets.maintenanceKcal}
                unit="kcal"
                accent="green"
                foot={`× ${targets.activityFactor} activity`}
              />
              <StatCard
                label={t('settings.deficitTarget')}
                value={targets.targetKcal}
                unit="kcal"
                accent="amber"
                foot={`−${targets.deficitKcal} from maintenance`}
              />
            </div>
          ) : null}

          <Panel title={t('settings.bodyTitle')} subtitle={t('settings.bodySubtitle')}>
            <div className="form">
              <div className="form-row-3">
                <label>
                  {t('settings.height')}
                  <input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} inputMode="decimal" />
                </label>
                <label>
                  {t('settings.age')}
                  <input value={ageYears} onChange={(e) => setAgeYears(e.target.value)} inputMode="numeric" />
                </label>
                <label>
                  {t('settings.sex')}
                  <select value={sex} onChange={(e) => setSex(e.target.value as 'male' | 'female')}>
                    <option value="male">{t('settings.male')}</option>
                    <option value="female">{t('settings.female')}</option>
                  </select>
                </label>
              </div>
              <div className="form-row-3">
                <label>
                  {t('settings.activity')}
                  <select value={activity} onChange={(e) => setActivity(e.target.value as typeof activity)}>
                    <option value="sedentary">{t('settings.activity.sedentary')}</option>
                    <option value="light">{t('settings.activity.light')}</option>
                    <option value="moderate">{t('settings.activity.moderate')}</option>
                    <option value="active">{t('settings.activity.active')}</option>
                    <option value="very_active">{t('settings.activity.very_active')}</option>
                  </select>
                </label>
                <label>
                  {t('settings.deficit')}
                  <input
                    value={deficitKcal}
                    onChange={(e) => setDeficitKcal(e.target.value)}
                    inputMode="numeric"
                  />
                </label>
              </div>
            </div>

            <div className="suggest-block">
              <div className="suggest-label">{t('settings.suggestDeficit')}</div>
              <div className="chip-row">
                {DEFICIT_PRESETS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`chip ${deficitN === d ? 'on' : ''}`}
                    onClick={() => setDeficitKcal(String(d))}
                  >
                    −{d} kcal
                  </button>
                ))}
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn primary" disabled={bodyBusy} onClick={saveProfile}>
                {t('settings.saveProfile')}
              </button>
            </div>
            {bodyNote && tab === 'body' ? <p className="muted">{bodyNote}</p> : null}
          </Panel>

          <Panel title={t('settings.weight')} subtitle={t('settings.weightHelp')}>
            <div className="form">
              <div className="form-row-3">
                <label>
                  {t('settings.weight')}
                  <input value={weightKg} onChange={(e) => setWeightKg(e.target.value)} inputMode="decimal" />
                </label>
                <label>
                  {t('settings.weightDate')}
                  <input type="date" value={weightDate} onChange={(e) => setWeightDate(e.target.value)} />
                </label>
              </div>
              <div className="form-actions">
                <button type="button" className="btn secondary" disabled={bodyBusy} onClick={saveWeight}>
                  {t('settings.logWeight')}
                </button>
              </div>
              {weights.length > 0 ? (
                <div className="meal-list" style={{ marginTop: 12 }}>
                  {weights.slice(0, 8).map((w) => (
                    <div key={w.date} className="meal-row">
                      <strong>{w.weightKg} kg</strong>
                      <span className="muted">{w.date}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </Panel>
        </>
      ) : null}

      {tab === 'prefs' ? (
        <>
          <Panel title={t('settings.language')} subtitle={t('settings.languageHelp')}>
            <div className="form" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {LOCALES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={locale === opt.id ? 'btn' : 'btn secondary'}
                  disabled={bodyBusy}
                  onClick={() => saveLanguage(opt.id)}
                >
                  {opt.nativeLabel}
                </button>
              ))}
            </div>
            {langNote ? <p className="muted" style={{ marginTop: 10 }}>{langNote}</p> : null}
          </Panel>

          <Panel title={t('settings.connection')} subtitle={t('settings.connectionHelp')}>
            <div className="form">
              <label>{t('settings.apiBase')}</label>
              <input
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="http://localhost:8000"
              />
              <label>{t('settings.deviceId')}</label>
              <input value={deviceId} onChange={(e) => setDevice(e.target.value)} />
              <div className="form-actions">
                <button type="button" className="btn primary" onClick={save}>
                  {t('settings.saveLocal')}
                </button>
                <button type="button" className="btn ghost" onClick={ping}>
                  {t('settings.ping')}
                </button>
              </div>
              <p className="muted">{status}</p>
            </div>
          </Panel>
        </>
      ) : null}

      {tab === 'account' ? (
        <Panel title={t('settings.account')} subtitle={t('settings.accountHelp')}>
          <div className="form">
            <label>{t('settings.name')}</label>
            <input value={user?.displayName || ''} readOnly />
            <label>{t('login.email')}</label>
            <input value={user?.email || ''} readOnly />
            <label>{t('settings.role')}</label>
            <input value={user?.role || ''} readOnly />
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                clearSession();
                window.location.href = '/login';
              }}
            >
              {t('nav.signOut')}
            </button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

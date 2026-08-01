import { useEffect, useState } from 'react';
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
import { PageHeader, Panel, StatCard } from '../components/ui';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default function SettingsPage() {
  const user = getStoredUser();
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
  const [weightKg, setWeightKg] = useState('101.4');
  const [weightDate, setWeightDate] = useState(todayKey());
  const [targets, setTargets] = useState<any>(null);
  const [weights, setWeights] = useState<any[]>([]);
  const [bodyNote, setBodyNote] = useState<string | null>(null);
  const [bodyBusy, setBodyBusy] = useState(false);

  const loadBody = async () => {
    try {
      const [body, hist] = await Promise.all([fetchBodyProfile(), fetchWeightHistory(14)]);
      if (body.profile) {
        setHeightCm(String(body.profile.heightCm));
        setSex((body.profile.sex as 'male' | 'female') || 'male');
        setAgeYears(String(body.profile.ageYears));
        setActivity((body.profile.activity as typeof activity) || 'light');
        setDeficitKcal(String(body.profile.deficitKcal));
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
    setStatus('Saved locally in this browser');
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
          : 'Unreachable'
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
      const res = await updateBodyProfile({
        heightCm: Number(heightCm),
        sex,
        ageYears: Number(ageYears),
        activity,
        deficitKcal: Number(deficitKcal),
      });
      setTargets(res.targets);
      setBodyNote('Profile saved — calorie targets updated.');
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
      setBodyNote(`Weight ${res.weight.weightKg} kg saved for ${res.weight.date}.`);
    } catch (e: any) {
      setBodyNote(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setBodyBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        lede="Body metrics drive maintenance and deficit calorie targets used in daily reports."
        actions={
          online == null ? null : (
            <span className={`status-chip ${online ? '' : 'offline'}`}>
              <span className="status-dot" />
              {online ? 'API online' : 'API offline'}
            </span>
          )
        }
      />

      {targets ? (
        <div className="stat-grid">
          <StatCard label="Weight" value={targets.weightKg} unit="kg" accent="teal" foot={`BMI ${targets.bmi}`} />
          <StatCard label="BMR" value={targets.bmrKcal} unit="kcal" accent="blue" foot={targets.formula} />
          <StatCard
            label="Maintenance"
            value={targets.maintenanceKcal}
            unit="kcal"
            accent="green"
            foot={`× ${targets.activityFactor} activity`}
          />
          <StatCard
            label="Deficit target"
            value={targets.targetKcal}
            unit="kcal"
            accent="amber"
            foot={`−${targets.deficitKcal} from maintenance`}
          />
        </div>
      ) : null}

      <Panel title="Body & calories" subtitle="Mifflin–St Jeor · edit age/sex/activity if needed">
        <div className="form">
          <div className="form-row-3">
            <label>
              Height (cm)
              <input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} inputMode="decimal" />
            </label>
            <label>
              Age (years)
              <input value={ageYears} onChange={(e) => setAgeYears(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              Sex
              <select value={sex} onChange={(e) => setSex(e.target.value as 'male' | 'female')}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
          </div>
          <div className="form-row-3">
            <label>
              Activity
              <select value={activity} onChange={(e) => setActivity(e.target.value as typeof activity)}>
                <option value="sedentary">Sedentary (desk)</option>
                <option value="light">Light (1–3 days/wk)</option>
                <option value="moderate">Moderate (3–5 days/wk)</option>
                <option value="active">Active (6–7 days/wk)</option>
                <option value="very_active">Very active</option>
              </select>
            </label>
            <label>
              Daily deficit (kcal)
              <input
                value={deficitKcal}
                onChange={(e) => setDeficitKcal(e.target.value)}
                inputMode="numeric"
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="btn primary" disabled={bodyBusy} onClick={saveProfile}>
              Save profile
            </button>
          </div>
        </div>

        <div className="form" style={{ marginTop: 16 }}>
          <div className="form-row-3">
            <label>
              Weight (kg)
              <input value={weightKg} onChange={(e) => setWeightKg(e.target.value)} inputMode="decimal" />
            </label>
            <label>
              Date
              <input type="date" value={weightDate} onChange={(e) => setWeightDate(e.target.value)} />
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="btn secondary" disabled={bodyBusy} onClick={saveWeight}>
              Log weight
            </button>
          </div>
          {bodyNote ? <p className="muted">{bodyNote}</p> : null}
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

      <Panel title="Account" subtitle="Signed-in household member">
        <div className="form">
          <label>Name</label>
          <input value={user?.displayName || ''} readOnly />
          <label>Email</label>
          <input value={user?.email || ''} readOnly />
          <label>Role</label>
          <input value={user?.role || ''} readOnly />
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              clearSession();
              window.location.href = '/login';
            }}
          >
            Sign out
          </button>
        </div>
      </Panel>

      <Panel title="Connection" subtitle="Stored in localStorage for this browser only">
        <div className="form">
          <label>API base URL</label>
          <input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="http://localhost:8000"
          />
          <label>Local device id (optional metadata)</label>
          <input value={deviceId} onChange={(e) => setDevice(e.target.value)} />
          <div className="form-actions">
            <button type="button" className="btn primary" onClick={save}>
              Save
            </button>
            <button type="button" className="btn ghost" onClick={ping}>
              Test connection
            </button>
          </div>
          <p className="muted">{status}</p>
        </div>
      </Panel>
    </div>
  );
}

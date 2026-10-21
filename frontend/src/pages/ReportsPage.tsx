import { useEffect, useMemo, useState } from 'react';
import {
  fetchDaily,
  fetchWeekly,
  downloadDailyPdf,
  emailDailyReport,
  createDailyShare,
  fetchDebriefs,
  fetchDebrief,
  fetchRagArchive,
  downloadRagArchive,
  fetchDailyVoiceBriefing,
  fetchDailyVoiceVideo,
  type DailyShare,
  type DayDebriefSummary,
  type DayDebriefDetail,
} from '../api';
import { PageHeader, Panel, Segmented } from '../components/ui';
import { useLocale } from '../i18n';
import { DailyReportView } from '../components/reports/DailyReportView';
import { ReportArchiveView } from '../components/reports/ReportArchiveView';
import { WeeklyReportView } from '../components/reports/WeeklyReportView';

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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function yesterdayKey() {
  return shiftDate(todayKey(), -1);
}

function formatDayLabel(iso: string, locale: string) {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function ReportsPage() {
  const { t, locale } = useLocale();
  const [mode, setMode] = useState<'daily' | 'weekly' | 'archive'>('daily');
  const [selectedDate, setSelectedDate] = useState(yesterdayKey);
  const [daily, setDaily] = useState<any>(null);
  const [weekly, setWeekly] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [share, setShare] = useState<DailyShare | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [debriefs, setDebriefs] = useState<DayDebriefSummary[]>([]);
  const [archiveWorkouts, setArchiveWorkouts] = useState<any[]>([]);
  const [openDebriefDate, setOpenDebriefDate] = useState<string | null>(null);
  const [openDebrief, setOpenDebrief] = useState<DayDebriefDetail | null>(null);
  const [debriefBusy, setDebriefBusy] = useState(false);
  const [archiveDownloadBusy, setArchiveDownloadBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceVideoBusy, setVoiceVideoBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [voiceAudioUrl, setVoiceAudioUrl] = useState<string | null>(null);
  const [voiceVideoUrl, setVoiceVideoUrl] = useState<string | null>(null);
  const [voiceBackground, setVoiceBackground] = useState<string | null>(null);

  const today = useMemo(() => todayKey(), []);
  const canGoNext = selectedDate < today;

  useEffect(() => {
    if (mode === 'archive') return;
    setLoading(true);
    setError(null);
    if (mode === 'daily') {
      setVoiceTranscript(null);
      setVoiceAudioUrl(null);
      setVoiceVideoUrl(null);
      setVoiceBackground(null);
      setVoiceError(null);
      setShare(null);
      setShareNote(null);
    }
    const run = mode === 'daily' ? fetchDaily(selectedDate) : fetchWeekly();
    run
      .then((data) => {
        if (mode === 'daily') setDaily(data);
        else setWeekly(data);
      })
      .catch((e) => setError(String(e?.response?.data?.detail || e.message || e)))
      .finally(() => setLoading(false));
  }, [mode, selectedDate]);

  const loadArchive = () => {
    setLoading(true);
    fetchRagArchive(30)
      .then((data) => {
        setDebriefs(data.debriefs || []);
        setArchiveWorkouts(data.workoutPlans || []);
      })
      .catch(() => {
        fetchDebriefs(30)
          .then(setDebriefs)
          .catch(() => setDebriefs([]));
        setArchiveWorkouts([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (mode === 'archive') {
      loadArchive();
      return;
    }
    fetchRagArchive(30)
      .then((data) => {
        setDebriefs(data.debriefs || []);
        setArchiveWorkouts(data.workoutPlans || []);
      })
      .catch(() => {
        fetchDebriefs(30)
          .then(setDebriefs)
          .catch(() => setDebriefs([]));
        setArchiveWorkouts([]);
      });
  }, [mode, emailNote]);

  const reportDate = daily?.date;

  const glucoseTargets = useMemo(() => {
    const gt =
      daily?.glucoseTargets ||
      weekly?.days?.[0]?.glucoseTargets ||
      weekly?.glucoseTargets ||
      {};
    return {
      low: Number(gt.tirLowMgDl ?? 70),
      high: Number(gt.tirHighMgDl ?? 180),
      goal: Number(gt.tirGoalPct ?? 70),
    };
  }, [daily, weekly]);

  const refreshDebriefs = () => {
    fetchDebriefs(30)
      .then(setDebriefs)
      .catch(() => setDebriefs([]));
  };

  const downloadPdf = async () => {
    setPdfBusy(true);
    setError(null);
    try {
      await downloadDailyPdf(reportDate);
      refreshDebriefs();
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setPdfBusy(false);
    }
  };

  const emailPdf = async () => {
    setEmailBusy(true);
    setError(null);
    setEmailNote(null);
    try {
      const res = await emailDailyReport(reportDate);
      setEmailNote(
        t('reports.emailed', { date: res.date, to: res.to || 'the configured recipient' })
      );
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setEmailBusy(false);
    }
  };

  const openShare = async () => {
    setShareBusy(true);
    setError(null);
    setShareNote(null);
    try {
      const res = await createDailyShare(reportDate);
      setShare(res);
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareLink = async () => {
    if (!share?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(share.shareUrl);
      setShareNote(t('reports.linkCopied'));
    } catch {
      setShareNote(share.shareUrl);
    }
  };

  const playVoiceBriefing = async () => {
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      const res = await fetchDailyVoiceBriefing(reportDate);
      setVoiceTranscript(res.transcript);
      const binary = atob(res.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: res.mimeType || 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setVoiceAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      const audio = new Audio(url);
      void audio.play().catch(() => {
        /* user can tap native controls */
      });
    } catch (e: any) {
      setVoiceError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setVoiceBusy(false);
    }
  };

  const playVoiceVideo = async () => {
    setVoiceVideoBusy(true);
    setVoiceError(null);
    try {
      const res = await fetchDailyVoiceVideo(reportDate);
      setVoiceTranscript(res.transcript);
      setVoiceBackground(res.background || null);
      const binary = atob(res.videoBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: res.mimeType || 'video/mp4' });
      const url = URL.createObjectURL(blob);
      setVoiceVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (e: any) {
      setVoiceError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setVoiceVideoBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      if (voiceAudioUrl) URL.revokeObjectURL(voiceAudioUrl);
    };
  }, [voiceAudioUrl]);

  useEffect(() => {
    return () => {
      if (voiceVideoUrl) URL.revokeObjectURL(voiceVideoUrl);
    };
  }, [voiceVideoUrl]);

  const openArchiveDebrief = async (date: string) => {
    if (openDebriefDate === date) {
      setOpenDebriefDate(null);
      setOpenDebrief(null);
      return;
    }
    setDebriefBusy(true);
    setError(null);
    try {
      const detail = await fetchDebrief(date);
      setOpenDebriefDate(date);
      setOpenDebrief(detail);
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setDebriefBusy(false);
    }
  };

  const downloadArchiveBulk = async (format: 'zip' | 'json' = 'zip') => {
    setArchiveDownloadBusy(true);
    setError(null);
    try {
      await downloadRagArchive(format, 200);
    } catch (e: any) {
      setError(String(e?.response?.data?.detail || e.message || e));
    } finally {
      setArchiveDownloadBusy(false);
    }
  };

  const weekChart = useMemo(() => {
    if (!weekly?.days) return [];
    return weekly.days.map((d: any) => ({
      date: d.date.slice(5),
      carbs: d.nutrition?.macros?.carbsG ?? 0,
      protein: d.nutrition?.macros?.proteinG ?? 0,
      fat: d.nutrition?.macros?.fatG ?? 0,
      steps: d.activity?.steps ?? 0,
      workoutMin: (d.activity?.workouts || []).reduce(
        (s: number, w: any) => s + (Number(w.durationMin) || 0),
        0
      ),
      tir: d.glucose?.timeInRangePct,
      avg: d.glucose?.avgMgDl,
      meals: d.nutrition?.mealCount ?? 0,
    }));
  }, [weekly]);

  return (
    <div>
      <PageHeader
        eyebrow={t('reports.eyebrow')}
        title={t('reports.title')}
        lede={t('settings.languageHelp')}
        actions={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Segmented
              value={mode}
              onChange={(id) => setMode(id as 'daily' | 'weekly' | 'archive')}
              options={[
                { id: 'daily', label: t('reports.daily') },
                { id: 'weekly', label: t('reports.weekly') },
                { id: 'archive', label: t('reports.archive') },
              ]}
            />
            <button
              className="btn secondary"
              type="button"
              disabled={pdfBusy || loading || mode !== 'daily'}
              onClick={downloadPdf}
            >
              {pdfBusy ? t('common.loading') : t('reports.downloadPdf')}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={shareBusy || loading || mode !== 'daily'}
              onClick={openShare}
            >
              {shareBusy ? t('common.loading') : t('reports.share')}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={voiceBusy || voiceVideoBusy || loading || mode !== 'daily'}
              onClick={playVoiceBriefing}
              title="Reb3i talks to Saff in Tunisian Darija"
            >
              {voiceBusy ? 'Reb3i is warming up…' : 'Reb3i — voice (TN)'}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={voiceBusy || voiceVideoBusy || loading || mode !== 'daily'}
              onClick={playVoiceVideo}
              title="Stock Reb3i still animated with Darija audio (free, no Veo)"
            >
              {voiceVideoBusy ? 'Animating Reb3i…' : 'Reb3i — video (TN)'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={emailBusy || loading || mode !== 'daily'}
              onClick={emailPdf}
            >
              {emailBusy ? t('common.loading') : t('reports.email')}
            </button>
          </div>
        }
      />

      {error ? <p className="error">{error}</p> : null}
      {voiceError ? <p className="error">{voiceError}</p> : null}
      {emailNote ? <p className="muted">{emailNote}</p> : null}
      {loading && mode !== 'archive' ? <p className="muted">Loading report…</p> : null}
      {loading && mode === 'archive' ? <p className="muted">Loading archive…</p> : null}

      {mode === 'daily' ? (
        <div className="report-day-picker">
          <button
            type="button"
            className="btn ghost"
            onClick={() => setSelectedDate((d) => shiftDate(d, -1))}
            disabled={loading}
            aria-label={t('reports.prevDay')}
          >
            ←
          </button>
          <div className="report-day-picker__main">
            <span className="report-day-picker__label">{formatDayLabel(selectedDate, locale)}</span>
            <input
              type="date"
              value={selectedDate}
              max={today}
              onChange={(e) => {
                const v = e.target.value;
                if (v && v <= today) setSelectedDate(v);
              }}
            />
          </div>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setSelectedDate((d) => shiftDate(d, 1))}
            disabled={loading || !canGoNext}
            aria-label={t('reports.nextDay')}
          >
            →
          </button>
          {selectedDate !== yesterdayKey() ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => setSelectedDate(yesterdayKey())}
              disabled={loading}
            >
              Yesterday
            </button>
          ) : null}
          {selectedDate !== today ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => setSelectedDate(today)}
              disabled={loading}
            >
              {t('common.today')}
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === 'daily' && (voiceTranscript || voiceAudioUrl || voiceVideoUrl) ? (
        <Panel
          title="Reb3i — briefing (TN)"
          subtitle={
            voiceBackground
              ? `Reb3i → Saff · set: ${voiceBackground} · not medical advice`
              : 'Reb3i → Saff · lifestyle chatter — not medical advice.'
          }
        >
          {voiceVideoUrl ? (
            <video
              controls
              autoPlay
              playsInline
              src={voiceVideoUrl}
              style={{ width: '100%', maxHeight: 520, borderRadius: 12, marginBottom: 12, background: '#111' }}
            />
          ) : null}
          {voiceAudioUrl && !voiceVideoUrl ? (
            <audio controls src={voiceAudioUrl} style={{ width: '100%', marginBottom: 12 }} />
          ) : null}
          {voiceTranscript ? (
            <p dir="auto" style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {voiceTranscript}
            </p>
          ) : null}
        </Panel>
      ) : null}

      {share ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-label={t('reports.shareTitle')}>
          <button type="button" className="modal-backdrop" aria-label={t('common.close')} onClick={() => setShare(null)} />
          <div className="modal-sheet share-modal">
            <div className="modal-head">
              <h2>{t('reports.shareTitle')}</h2>
              <button type="button" className="btn ghost" onClick={() => setShare(null)}>
                {t('common.close')}
              </button>
            </div>
            <p className="muted">Scan to open the report for {share.date}. Link stays valid for 30 days.</p>
            <div className="share-qr-wrap">
              <img src={share.qrUrl} alt={t('reports.qrAlt')} width={220} height={220} />
            </div>
            <p className="share-url">{share.shareUrl}</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn" onClick={copyShareLink}>
                Copy link
              </button>
              <a className="btn secondary" href={share.shareUrl} target="_blank" rel="noreferrer">
                Open link
              </a>
            </div>
            {shareNote ? <p className="muted">{shareNote}</p> : null}
          </div>
        </div>
      ) : null}

      {mode === 'daily' && daily && !loading ? (
        <DailyReportView daily={daily} glucoseTargets={glucoseTargets} />
      ) : null}

      {mode === 'weekly' && weekly && !loading ? (
        <WeeklyReportView
          weekly={weekly}
          weekChart={weekChart}
          glucoseTargets={glucoseTargets}
        />
      ) : null}

      {mode === 'archive' ? (
        <ReportArchiveView
          debriefs={debriefs}
          archiveWorkouts={archiveWorkouts}
          loading={loading}
          archiveDownloadBusy={archiveDownloadBusy}
          downloadArchiveBulk={downloadArchiveBulk}
          openDebriefDate={openDebriefDate}
          openDebrief={openDebrief}
          debriefBusy={debriefBusy}
          openArchiveDebrief={openArchiveDebrief}
          onOpenDay={(date) => {
            setSelectedDate(date);
            setMode('daily');
          }}
        />
      ) : null}
    </div>
  );
}

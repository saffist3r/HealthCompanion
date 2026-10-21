
import { type DayDebriefSummary, type DayDebriefDetail } from '../../api';
import { Panel } from '../ui';
import { useLocale } from '../../i18n';

// Archive of past AI day debriefs and saved workout plans (RAG export).
type ReportArchiveViewProps = {
  debriefs: DayDebriefSummary[];
  archiveWorkouts: any[];
  loading: boolean;
  archiveDownloadBusy: boolean;
  downloadArchiveBulk: (format?: 'zip' | 'json') => void;
  openDebriefDate: string | null;
  openDebrief: DayDebriefDetail | null;
  debriefBusy: boolean;
  openArchiveDebrief: (date: string) => void;
  onOpenDay: (date: string) => void;
};

export function ReportArchiveView({ debriefs, archiveWorkouts, loading, archiveDownloadBusy, downloadArchiveBulk, openDebriefDate, openDebrief, debriefBusy, openArchiveDebrief, onOpenDay }: ReportArchiveViewProps) {
  const { t, locale } = useLocale();
  return (
    <Panel title={t('reports.archive')} subtitle={t('reports.archiveHelp')}>
      {debriefs.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <button
            className="btn"
            type="button"
            disabled={archiveDownloadBusy || loading}
            onClick={() => downloadArchiveBulk('zip')}
          >
            {archiveDownloadBusy ? t('common.loading') : t('reports.downloadArchiveZip')}
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={archiveDownloadBusy || loading}
            onClick={() => downloadArchiveBulk('json')}
          >
            {t('reports.downloadArchiveJson')}
          </button>
        </div>
      ) : null}
      {debriefs.length === 0 && !loading ? (
        <p className="muted">{t('reports.noArchive')}</p>
      ) : (
        <div className="meal-list">
          {debriefs.map((d) => (
            <div key={d.id}>
              <button
                type="button"
                className="meal-row"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  border: 'none',
                  background: openDebriefDate === d.date ? 'var(--surface-2, #f1f5f9)' : 'transparent',
                }}
                onClick={() => openArchiveDebrief(d.date)}
                disabled={debriefBusy}
              >
                <div>
                  <strong>{d.date}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {d.headline || t('reports.dayOverview')}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {t('reports.archiveLocale', {
                      locale: d.locale === 'fr' ? t('locale.fr') : t('locale.en'),
                    })}
                  </div>
                </div>
                <span className="stat-badge">{d.source}</span>
              </button>
              {openDebriefDate === d.date && openDebrief ? (
                <div
                  style={{
                    margin: '0 0 12px',
                    padding: 12,
                    borderRadius: 10,
                    background: 'var(--surface-2, #f1f5f9)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => onOpenDay(d.date)}
                    >
                      {t('reports.openThisDay')}
                    </button>
                  </div>
                  <p style={{ marginTop: 0, lineHeight: 1.5 }}>{openDebrief.summary}</p>
                  {(openDebrief.highlights || []).length > 0 ? (
                    <>
                      <strong style={{ fontSize: 13 }}>Highlights</strong>
                      <ul className="insight-list">
                        {openDebrief.highlights.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {(openDebrief.tomorrowTips || []).length > 0 ? (
                    <>
                      <strong style={{ fontSize: 13 }}>Tips</strong>
                      <ul className="insight-list">
                        {openDebrief.tomorrowTips.map((tip, i) => (
                          <li key={i}>{tip}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {archiveWorkouts.length > 0 ? (
        <>
          <h3 style={{ marginTop: 20, marginBottom: 8 }}>{t('reports.workoutPlansArchive')}</h3>
          <div className="meal-list">
            {archiveWorkouts.map((p) => (
              <div key={p.id} className="meal-row">
                <div>
                  <strong>{p.title}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {(p.focus ? `${p.focus} · ` : '') +
                      `${(p.exercises || []).length} exercises`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Panel>
  );
}

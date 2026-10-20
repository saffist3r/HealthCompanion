import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getApiRoot } from '../api';
import { useLocale } from '../i18n';

type ShareMeta = {
  token: string;
  date: string;
  shareUrl: string;
  pdfUrl: string;
  qrUrl: string;
  expiresAt?: number | null;
};

export default function ShareReportPage() {
  const { t } = useLocale();
  const { token = '' } = useParams();
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError(t('share.missing'));
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${getApiRoot()}/reports/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Share unavailable (${res.status})`);
        }
        return res.json() as Promise<ShareMeta>;
      })
      .then(setMeta)
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [token]);

  const pdfUrl = meta?.pdfUrl || `${getApiRoot()}/reports/share/${token}/pdf`;

  return (
    <div className="share-page">
      <div className="share-card">
        <p className="share-brand">{t('brand.name')}</p>
        <h1>{t('share.title')}</h1>
        {loading ? <p className="muted">{t('share.loading')}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {meta && !loading ? (
          <>
            <p className="muted">{t('share.reportFor', { date: String(meta.date) })}</p>
            <div className="share-actions">
              <a className="btn" href={pdfUrl} target="_blank" rel="noreferrer">
                {t('share.openPdf')}
              </a>
              <a className="btn secondary" href={pdfUrl} download={`health-companion-${meta.date}.pdf`}>
                {t('share.download')}
              </a>
            </div>
            <iframe title={`Daily report ${meta.date}`} className="share-pdf" src={pdfUrl} />
            <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>
              {t('share.hint')}
            </p>
          </>
        ) : null}
        <p style={{ marginTop: 24 }}>
          <Link to="/login" className="muted">
            {t('share.signIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}

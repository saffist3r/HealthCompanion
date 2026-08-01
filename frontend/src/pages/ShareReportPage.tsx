import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getApiBase } from '../api';

type ShareMeta = {
  token: string;
  date: string;
  shareUrl: string;
  pdfUrl: string;
  qrUrl: string;
  expiresAt?: number | null;
};

export default function ShareReportPage() {
  const { token = '' } = useParams();
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError('Missing share token');
      setLoading(false);
      return;
    }
    const base = getApiBase().replace(/\/$/, '');
    setLoading(true);
    fetch(`${base}/reports/share/${encodeURIComponent(token)}`)
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

  const pdfUrl = meta?.pdfUrl || `${getApiBase().replace(/\/$/, '')}/reports/share/${token}/pdf`;

  return (
    <div className="share-page">
      <div className="share-card">
        <p className="share-brand">Health Companion</p>
        <h1>Daily report</h1>
        {loading ? <p className="muted">Loading share…</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {meta && !loading ? (
          <>
            <p className="muted">Report for {meta.date}</p>
            <div className="share-actions">
              <a className="btn" href={pdfUrl} target="_blank" rel="noreferrer">
                Open PDF
              </a>
              <a className="btn secondary" href={pdfUrl} download={`health-companion-${meta.date}.pdf`}>
                Download
              </a>
            </div>
            <iframe title={`Daily report ${meta.date}`} className="share-pdf" src={pdfUrl} />
            <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>
              Anyone with this link can view the report until it expires.
            </p>
          </>
        ) : null}
        <p style={{ marginTop: 24 }}>
          <Link to="/login" className="muted">
            Sign in to Health Companion
          </Link>
        </p>
      </div>
    </div>
  );
}

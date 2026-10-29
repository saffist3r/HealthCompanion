import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchSharedCareSummary } from '../api';
import CareSummaryView, { type CareSummary } from '../components/care/CareSummaryView';
import { careText } from '../components/care/careText';
import { useLocale } from '../i18n';

function fmtDay(d: string, locale: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function CareSharePage() {
  const { token = '' } = useParams();
  const { locale, setLocale } = useLocale();
  const tx = careText(locale);
  const [data, setData] = useState<CareSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSharedCareSummary(token)
      .then(setData)
      .catch(() => setError(tx.expired));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="care-page">
      <header className="care-header">
        <div>
          <p className="share-brand">Health Companion</p>
          <h1>{tx.pageTitle}</h1>
          {data ? (
            <p className="muted">
              {data.patient ? <strong>{data.patient.displayName}</strong> : null}
              {data.patient ? ' · ' : null}
              {tx.periodLine(fmtDay(data.period.from, locale), fmtDay(data.period.to, locale), data.period.days)}
              {data.share?.label ? ` · ${data.share.label}` : null}
            </p>
          ) : null}
        </div>
        <div className="care-header-actions no-print">
          <div className="segmented">
            {(['fr', 'en'] as const).map((l) => (
              <button key={l} type="button" className={locale === l ? 'on' : ''} onClick={() => setLocale(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          {data ? (
            <button type="button" className="btn" onClick={() => window.print()}>
              {tx.print}
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p className="error">{error}</p> : null}
      {!data && !error ? <p className="muted">{tx.loading}</p> : null}
      {data ? <CareSummaryView data={data} /> : null}
      {data?.share ? (
        <p className="muted care-footer">
          {tx.expires(new Date(data.share.expiresAt).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB'))}
        </p>
      ) : null}
    </div>
  );
}

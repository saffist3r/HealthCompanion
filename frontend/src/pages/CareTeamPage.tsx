import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  createCareShare,
  fetchCareSummary,
  listCareShares,
  revokeCareShare,
  type CareShareLink,
} from '../api';
import CareSummaryView, { type CareSummary } from '../components/care/CareSummaryView';
import { careText } from '../components/care/careText';
import { PageHeader, Panel, Segmented } from '../components/ui';
import { useLocale } from '../i18n';
import FamilyLivePanel from '../components/live/FamilyLivePanel';

const PERIODS = [14, 30, 90] as const;
const TTLS = [7, 30, 90] as const;

export default function CareTeamPage() {
  const { locale } = useLocale();
  const tx = careText(locale);
  const [days, setDays] = useState<number>(14);
  const [ttl, setTtl] = useState<number>(30);
  const [note, setNote] = useState('');
  const [label, setLabel] = useState('');
  const [summary, setSummary] = useState<CareSummary | null>(null);
  const [links, setLinks] = useState<CareShareLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLinks = useCallback(() => {
    listCareShares().then(setLinks).catch(() => {});
  }, []);

  useEffect(() => {
    setSummary(null);
    fetchCareSummary(days)
      .then(setSummary)
      .catch((e) => setError(String(e?.response?.data?.detail || e.message || e)));
  }, [days]);

  useEffect(loadLinks, [loadLinks]);

  const copy = async (link: CareShareLink) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(link.token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt(tx.copy, link.url);
    }
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const link = await createCareShare({ days, ttlDays: ttl, label, note });
      setNote('');
      setLabel('');
      loadLinks();
      await copy(link);
    } catch (err: any) {
      setError(String(err?.response?.data?.detail || err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (token: string) => {
    await revokeCareShare(token);
    loadLinks();
  };

  const now = Date.now();

  return (
    <>
      <PageHeader eyebrow={tx.navTitle} title={tx.pageTitle} lede={tx.ownerLede} />

      <div className="care-owner-grid">
        <Panel title={tx.createLink}>
          <form className="form care-form" onSubmit={onCreate}>
            <label>{tx.period}</label>
            <Segmented
              value={String(days)}
              options={PERIODS.map((d) => ({ id: String(d), label: tx.daysLabel(d) }))}
              onChange={(id) => setDays(Number(id))}
            />
            <label>{tx.linkValid}</label>
            <Segmented
              value={String(ttl)}
              options={TTLS.map((d) => ({ id: String(d), label: tx.daysLabel(d) }))}
              onChange={(id) => setTtl(Number(id))}
            />
            <label htmlFor="care-label">{tx.labelLabel}</label>
            <input id="care-label" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder={tx.labelPlaceholder} />
            <label htmlFor="care-note">{tx.noteLabel}</label>
            <textarea
              id="care-note"
              rows={4}
              value={note}
              maxLength={4000}
              onChange={(e) => setNote(e.target.value)}
              placeholder={tx.notePlaceholder}
            />
            <button type="submit" className="btn" disabled={busy} style={{ marginTop: 12 }}>
              {busy ? tx.creating : tx.createLink}
            </button>
            {error ? <p className="error">{error}</p> : null}
          </form>
        </Panel>

        <Panel title={tx.linksTitle}>
          {links.length ? (
            <ul className="care-links">
              {links.map((l) => {
                const dead = l.revoked || l.expiresAt < now;
                return (
                  <li key={l.token} className={dead ? 'dead' : ''}>
                    <div>
                      <strong>{l.label || tx.daysLabel(l.days)}</strong>
                      <div className="muted small">
                        {tx.daysLabel(l.days)} ·{' '}
                        {l.revoked
                          ? tx.off
                          : l.expiresAt < now
                            ? tx.expiredShort
                            : tx.expires(new Date(l.expiresAt).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB'))}
                      </div>
                    </div>
                    {dead ? null : (
                      <div className="care-link-actions">
                        <button type="button" className="btn secondary compact" onClick={() => copy(l)}>
                          {copied === l.token ? tx.copied : tx.copy}
                        </button>
                        <a className="btn secondary compact" href={`/care/${l.token}`} target="_blank" rel="noreferrer">
                          {tx.open}
                        </a>
                        <button type="button" className="btn ghost danger compact" onClick={() => onRevoke(l.token)}>
                          {tx.turnOff}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">{tx.noLinks}</p>
          )}
        </Panel>
      </div>

      <FamilyLivePanel />

      <h2 className="care-preview-title">
        {tx.preview} · {tx.daysLabel(days)}
      </h2>
      {summary ? (
        <CareSummaryView data={{ ...summary, share: note ? { label, note, expiresAt: 0 } : undefined }} />
      ) : (
        <p className="muted">{tx.loading}</p>
      )}
    </>
  );
}

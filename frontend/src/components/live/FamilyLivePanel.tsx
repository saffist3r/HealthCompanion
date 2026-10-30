import { FormEvent, useCallback, useEffect, useState } from 'react';
import { createLiveShare, listLiveShares, revokeLiveShare, type LiveShareLink } from '../../api';
import { Panel, Segmented } from '../ui';
import { useLocale } from '../../i18n';
import { liveText } from './liveText';

/** 0 = until turned off. */
const VALIDITY = [0, 365, 30] as const;

/** Create, copy and turn off the family's live glucose links. */
export default function FamilyLivePanel() {
  const { locale } = useLocale();
  const tx = liveText(locale).owner;
  const [label, setLabel] = useState('');
  const [ttl, setTtl] = useState<number>(0);
  const [links, setLinks] = useState<LiveShareLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listLiveShares().then(setLinks).catch(() => {});
  }, []);

  useEffect(load, [load]);

  const copy = async (link: LiveShareLink) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(link.token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // No clipboard access (e.g. http or an embedded browser): show the link to copy by hand
      try {
        window.prompt(tx.copy, link.url);
      } catch {
        /* the link stays in the list with its own Copy and Open buttons */
      }
    }
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const link = await createLiveShare({ label: label.trim() || undefined, ttlDays: ttl || null });
      setLabel('');
      load();
      await copy(link);
    } catch (err: any) {
      setError(String(err?.response?.data?.detail || err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (token: string) => {
    await revokeLiveShare(token).catch(() => {});
    load();
  };

  const now = Date.now();
  const dateFmt = (ms: number) => new Date(ms).toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB');

  return (
    <div className="care-owner-grid" style={{ marginTop: 18 }}>
      <Panel title={tx.title} subtitle={tx.lede}>
        <form className="form care-form" onSubmit={onCreate}>
          <label htmlFor="live-label">{tx.labelLabel}</label>
          <input
            id="live-label"
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={tx.labelPlaceholder}
          />
          <label>{tx.valid}</label>
          <Segmented
            value={String(ttl)}
            options={VALIDITY.map((d) => ({ id: String(d), label: d ? tx.days(d) : tx.forever }))}
            onChange={(id) => setTtl(Number(id))}
          />
          <button type="submit" className="btn" disabled={busy} style={{ marginTop: 12 }}>
            {busy ? tx.creating : tx.create}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </Panel>

      <Panel title={tx.links}>
        {links.length ? (
          <ul className="care-links">
            {links.map((l) => {
              const expired = l.expiresAt != null && l.expiresAt < now;
              const dead = l.revoked || expired;
              return (
                <li key={l.token} className={dead ? 'dead' : ''}>
                  <div>
                    <strong>{l.label || tx.title}</strong>
                    <div className="muted small">
                      {l.revoked ? tx.off : expired ? tx.expired : l.expiresAt ? tx.expires(dateFmt(l.expiresAt)) : tx.noExpiry}
                    </div>
                  </div>
                  {dead ? null : (
                    <div className="care-link-actions">
                      <button type="button" className="btn secondary compact" onClick={() => copy(l)}>
                        {copied === l.token ? tx.copied : tx.copy}
                      </button>
                      <a className="btn secondary compact" href={`/live/${l.token}`} target="_blank" rel="noreferrer">
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
  );
}

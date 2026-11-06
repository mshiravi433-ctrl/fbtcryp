/**
 * AI INTELLIGENCE — OPPORTUNITY SCANNER UI
 * ---------------------------------------------------------------------------
 * A card per candidate, with its arithmetic spelled out, its confidence and
 * the explicit "not a signal" caveat. Filters are by shape (breakout, volume
 * spike, …), never by "best", so the screen cannot imply a ranking of trade
 * ideas.
 */
import { useState } from 'react';
import { Change, Chip, Meter, ProvenanceDot, SectionCard } from './ui.jsx';
import { fmtPrice, t } from '../../../lib/intelligence/copy.js';
import { reasonText } from '../../../lib/intelligence/narrative.js';
import { OPPORTUNITY_KINDS } from '../../../lib/intelligence/opportunities.js';

const TONE = { up: 'mint', down: 'rose', watch: 'amber' };

export default function OpportunitiesTab({ scan, locale, onOpenToken }) {
  const [kind, setKind] = useState('all');
  const rows = (scan?.opportunities || []).filter((o) => kind === 'all' || o.kind === kind);

  return (
    <div className="aix-tab-body">
      <SectionCard
        title={t(locale, 'opp.title')}
        hint={t(locale, 'opp.subtitle', { scanned: scan?.scanned ?? 0 })}
      >
        <div className="aix-chips">
          <Chip active={kind === 'all'} onClick={() => setKind('all')}>
            {t(locale, 'opp.all')} ({scan?.opportunities?.length ?? 0})
          </Chip>
          {OPPORTUNITY_KINDS.map((k) => (
            <Chip key={k.id} active={kind === k.id} onClick={() => setKind(k.id)}>
              {t(locale, `opp.kind.${k.id}`)}
              {scan?.counts?.[k.id] ? ` (${scan.counts[k.id]})` : ''}
            </Chip>
          ))}
        </div>
      </SectionCard>

      {rows.length ? (
        <div className="aix-opp-grid">
          {rows.map((o) => {
            const meta = OPPORTUNITY_KINDS.find((k) => k.id === o.kind);
            return (
              <article key={`${o.kind}-${o.coin.id}`} className={`aix-opp aix-opp-${TONE[meta?.tone] || 'cyan'}`}>
                <header className="aix-opp-head">
                  <div>
                    <h3>{o.coin.symbol}</h3>
                    <span className="aix-opp-kind">{t(locale, `opp.kind.${o.kind}`)}</span>
                  </div>
                  <ProvenanceDot provenance={o.provenance} />
                </header>

                <div className="aix-opp-price">
                  <strong>{fmtPrice(o.coin.price)}</strong>
                  <Change value={o.coin.change24h} />
                </div>

                <ul className="aix-opp-reasons">
                  {o.reasons.map((r, i) => <li key={i}>{reasonText(locale, r)}</li>)}
                </ul>

                <div className="aix-opp-conf">
                  <span>{t(locale, 'opp.confidence')}</span>
                  <Meter value={o.confidence} tone={TONE[meta?.tone] || 'cyan'} />
                  <b>{o.confidence}</b>
                </div>

                {o.caveats?.length ? (
                  <p className="aix-opp-caveat">{o.caveats.map((c) => t(locale, `caveat.${c}`)).join(' · ')}</p>
                ) : null}

                <button type="button" className="aix-cta aix-cta-ghost" onClick={() => onOpenToken?.(o.coin.id)}>
                  {t(locale, 'opp.open')} →
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <SectionCard>
          <p className="aix-card-hint">{t(locale, 'opp.empty')}</p>
        </SectionCard>
      )}

      <p className="aix-foot-note">
        {t(locale, 'page.notAdvice')}
        {' · '}
        {scan?.medianTurnoverPct != null
          ? `${locale === 'fa' ? 'میانه گردش مرجع' : 'reference median turnover'}: ${scan.medianTurnoverPct.toFixed(2)}%`
          : ''}
      </p>
    </div>
  );
}

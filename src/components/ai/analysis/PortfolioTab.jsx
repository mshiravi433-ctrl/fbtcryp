/**
 * AI INTELLIGENCE — PORTFOLIO
 * ---------------------------------------------------------------------------
 * Reads the SAME `buildIntelligence()` output the Wealth Hub already trusts
 * (cost basis, lots, snapshot history) and adds what this screen needs: asset
 * class allocation, network concentration, return correlation, a risk band
 * with its causes, and suggestions that carry horizon + confidence.
 *
 * The P&L block is allowed to say "unknown". A wallet without a recorded buy
 * price has no P&L; printing 0% there would be a lie the user could act on.
 */
import { EmptyState, Meter, SectionCard, StatTile, Change } from './ui.jsx';
import { fmtMoney, fmtPct, t } from '../../../lib/intelligence/copy.js';
import { suggestionText } from '../../../lib/intelligence/narrative.js';

const RISK_KEY = { high: 'port.riskHigh', medium: 'port.riskMedium', low: 'port.riskLow' };

function pctFrom(snapshotChange) {
  if (!snapshotChange || !Number.isFinite(snapshotChange.from) || snapshotChange.from <= 0) return null;
  return (snapshotChange.abs / snapshotChange.from) * 100;
}

export default function PortfolioTab({ connected, intel, analysis, locale, onConnect, loading, coverage }) {
  if (!connected) {
    return (
      <div className="aix-tab-body">
        <SectionCard title={t(locale, 'port.connect')} hint={t(locale, 'port.connectHint')}>
          <EmptyState
            title={t(locale, 'port.connect')}
            hint={t(locale, 'port.connectHint')}
            action={(
              <button type="button" className="aix-cta" onClick={() => onConnect?.('/wallet')}>
                {locale === 'fa' ? 'رفتن به کیف پول' : 'Open wallet'}
              </button>
            )}
          />
        </SectionCard>
      </div>
    );
  }

  if (!intel) {
    return (
      <div className="aix-tab-body">
        <SectionCard title={t(locale, 'port.value')}>
          <p className="aix-card-hint">{loading ? t(locale, 'page.loading') : t(locale, 'page.insufficient')}</p>
        </SectionCard>
      </div>
    );
  }

  const pnlStatus = analysis?.pnl?.status ?? 'unknown';
  const pnlLabel = (value) => (pnlStatus === 'unknown' ? t(locale, 'port.unknown') : value);
  const risk = analysis?.risk;

  return (
    <div className="aix-tab-body">
      <div className="aix-tiles">
        <StatTile
          label={t(locale, 'port.value')}
          value={fmtMoney(intel.total, locale)}
          sub={coverage ? `${coverage.pricedRows}/${coverage.totalRows} ${locale === 'fa' ? 'قیمت‌گذاری‌شده' : 'priced'}` : null}
        />
        <StatTile
          label={t(locale, 'port.cost')}
          value={pnlStatus === 'unknown' || intel.cost == null ? t(locale, 'port.unknown') : fmtMoney(intel.cost, locale)}
          tone={pnlStatus === 'unknown' ? 'warn' : 'neutral'}
          sub={pnlStatus === 'partial' ? t(locale, 'caveat.cost-basis-partial') : null}
        />
        <StatTile
          label={t(locale, 'port.realised')}
          value={pnlLabel(intel.realised != null ? fmtMoney(intel.realised, locale) : t(locale, 'port.unknown'))}
          tone={(intel.realised ?? 0) >= 0 ? 'up' : 'down'}
        />
        <StatTile
          label={t(locale, 'port.unrealised')}
          value={pnlLabel(intel.unrealised != null && pnlStatus !== 'unknown' ? fmtMoney(intel.unrealised, locale) : t(locale, 'port.unknown'))}
          tone={(intel.unrealised ?? 0) >= 0 ? 'up' : 'down'}
        />
        <StatTile
          label="24h"
          value={<Change value={pctFrom(intel.change24h)} />}
          sub={intel.change24h?.from != null ? `${fmtMoney(intel.change24h.from, locale)} → ${fmtMoney(intel.total, locale)}` : null}
        />
        <StatTile label="7d" value={<Change value={pctFrom(intel.change7d)} />} />
        <StatTile label="30d" value={<Change value={pctFrom(intel.change30d)} />} />
        <StatTile
          label={t(locale, 'port.risk')}
          value={risk ? `${risk.score}/100` : '—'}
          sub={risk ? t(locale, RISK_KEY[risk.band]) : null}
          tone={risk?.band === 'high' ? 'down' : risk?.band === 'medium' ? 'warn' : 'up'}
        />
      </div>

      <SectionCard
        title={t(locale, 'port.allocation')}
        hint={analysis ? `${t(locale, 'port.effectiveHoldings')}: ${analysis.concentration.effectiveHoldings} · HHI ${analysis.concentration.hhi}` : undefined}
      >
        {analysis?.allocation?.length ? (
          <div className="aix-alloc">
            {analysis.allocation.map((b) => (
              <div key={b.id} className="aix-alloc-row">
                <span className="aix-alloc-name">{locale === 'fa' ? b.fa : b.en}</span>
                <span className="aix-alloc-bar">
                  <i style={{ width: `${Math.min(100, b.weight)}%` }} />
                </span>
                <span className="aix-alloc-val">{fmtPct(b.weight, { signed: false, digits: 1 })}</span>
                <span className="aix-alloc-usd">{fmtMoney(b.value, locale)}</span>
              </div>
            ))}
          </div>
        ) : <p className="aix-card-hint">{t(locale, 'page.insufficient')}</p>}

        {analysis?.chainAllocation?.length > 1 ? (
          <div className="aix-chains">
            <p className="aix-card-hint">{locale === 'fa' ? 'توزیع روی شبکه‌ها' : 'Across networks'}</p>
            {analysis.chainAllocation.slice(0, 5).map((c) => (
              <div key={String(c.chainId)} className="aix-alloc-row">
                <span className="aix-alloc-name">#{c.chainId}</span>
                <span className="aix-alloc-bar"><i style={{ width: `${Math.min(100, c.weight)}%` }} /></span>
                <span className="aix-alloc-val">{fmtPct(c.weight, { signed: false, digits: 1 })}</span>
                <span className="aix-alloc-usd">{fmtMoney(c.value, locale)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title={t(locale, 'port.risk')} hint={risk ? t(locale, RISK_KEY[risk.band]) : undefined}>
        <Meter value={risk?.score ?? null} tone={risk?.band === 'high' ? 'rose' : risk?.band === 'medium' ? 'amber' : 'mint'} />
        <div className="aix-reasons">
          {(risk?.reasons || []).map((r) => (
            <span key={r.key} className="aix-reason">
              {r.key}{Object.keys(r.params || {}).length
                ? ` (${Object.entries(r.params).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${typeof v === 'number' ? Number(v).toFixed(2) : v}`).join(', ')})`
                : ''}
            </span>
          ))}
        </div>
        {risk?.unavailable?.length ? (
          <p className="aix-card-hint">
            {locale === 'fa' ? 'آمار محاسبه‌نشده' : 'Statistics not computed'}: {risk.unavailable.join(' · ')}
          </p>
        ) : null}
      </SectionCard>

      <SectionCard
        title={t(locale, 'port.correlation')}
        hint={analysis?.correlation?.average != null
          ? t(locale, 'port.pairs', { count: analysis.correlation.pairs.length, avg: analysis.correlation.average.toFixed(2) })
          : t(locale, 'port.correlationMissing')}
      >
        {analysis?.correlation?.pairs?.length ? (
          <div className="aix-corr">
            {analysis.correlation.pairs.map((p) => (
              <div key={`${p.a}-${p.b}`} className={`aix-corr-row${p.r >= 0.75 ? ' is-hot' : ''}`}>
                <span>{p.a} / {p.b}</span>
                <span className="aix-corr-bar"><i style={{ width: `${Math.abs(p.r) * 100}%` }} /></span>
                <span>{p.r.toFixed(2)}</span>
                <span className="aix-muted">{p.samples}d</span>
              </div>
            ))}
          </div>
        ) : <p className="aix-card-hint">{t(locale, 'port.correlationMissing')}</p>}
        {analysis?.correlation?.insufficient?.length ? (
          <p className="aix-card-hint">
            {locale === 'fa' ? 'بدون تاریخچه کافی' : 'Not enough history'}: {analysis.correlation.insufficient.join(', ')}
          </p>
        ) : null}
      </SectionCard>

      <SectionCard title={t(locale, 'port.suggestions')} hint={t(locale, 'page.notAdvice')}>
        {analysis?.suggestions?.length ? (
          <div className="aix-suggestions">
            {analysis.suggestions.map((s) => (
              <div key={s.action} className="aix-suggestion">
                <div className="aix-suggestion-head">
                  <strong>{suggestionText(locale, s)}</strong>
                  <span className="aix-conf">{t(locale, 'opp.confidence')} {s.confidence}</span>
                </div>
                <div className="aix-suggestion-meta">
                  <span>{t(locale, 'port.horizon')}: {t(locale, `port.horizon.${s.horizon}`)}</span>
                  <span>{t(locale, 'port.riskLevel')}: {t(locale, RISK_KEY[s.risk] || 'port.riskMedium')}</span>
                  <span>{t(locale, 'port.evidence')}: {s.evidence.join(', ')}</span>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="aix-card-hint">{t(locale, 'port.noSuggestions')}</p>}
      </SectionCard>

      <SectionCard title={locale === 'fa' ? 'دارایی‌ها' : 'Holdings'}>
        <div className="aix-table aix-table-compact">
          <div className="aix-thead">
            <span>{locale === 'fa' ? 'دارایی' : 'Asset'}</span>
            <span>{locale === 'fa' ? 'ارزش' : 'Value'}</span>
            <span>{locale === 'fa' ? 'سهم' : 'Weight'}</span>
            <span>{locale === 'fa' ? 'سود/ضرر' : 'P&L'}</span>
          </div>
          {(intel.rows || []).slice(0, 12).map((r) => (
            <div key={`${r.symbol}-${r.chainId ?? 'x'}`} className="aix-prow">
              <span className="aix-token-sym">{r.symbol}</span>
              <span className="aix-mono">{r.value != null ? fmtMoney(r.value, locale) : '—'}</span>
              <span>{r.weight != null ? `${r.weight.toFixed(1)}%` : '—'}</span>
              <span>
                {r.pnlPct != null
                  ? <Change value={r.pnlPct} />
                  : <span className="aix-na">{t(locale, 'port.unknown')}</span>}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

/**
 * FBT INTENT OS — Rich chat cards.
 * ---------------------------------------------------------------------------
 * The assistant used to answer token and portfolio questions with prose only.
 * These cards render the REAL tool output as UI:
 *
 *   · TokenMarketCard  — live price, 1h/24h/7d changes, the 7-day sparkline
 *     chart, the 24h high/low range bar, market-cap/volume/rank and the
 *     backtested signal. Every number is pass-through from a market read;
 *     a field the source did not return stays "—", never a guess.
 *   · PortfolioChatCard — total value + allocation bars per holding.
 *   · ConditionalAllocationCard (Phase 217) — a cross-asset conditional
 *     instruction («اگر طلا ۵٪ اصلاح کرد و BTC بالای X بود، ۱۰٪ سرمایه را به
 *     طلا اختصاص بده»): the conditions, the live reading of each, AND/OR, and
 *     the allocation the instruction would make. It never shows a state the
 *     engine did not compute, and an unreadable price renders as unreadable.
 *
 * All are presentational only: no fetches, no wallet access, no signing.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EVM_CHAINS } from '../lib/chains.js';

const hasFiniteValue = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const nf = (v, digits = 2) => {
  if (!hasFiniteValue(v)) return null;
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
};

export function fmtPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`;
  if (n >= 1) return `$${nf(n, 2)}`;
  if (n >= 0.01) return `$${nf(n, 4)}`;
  return `$${nf(n, 6)}`;
}

export function fmtCompact(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const fmt = (d) => (Math.round((n / d) * 100) / 100).toLocaleString('en-US');
  if (n >= 1e12) return `$${fmt(1e12)}T`;
  if (n >= 1e9) return `$${fmt(1e9)}B`;
  if (n >= 1e6) return `$${fmt(1e6)}M`;
  if (n >= 1e3) return `$${fmt(1e3)}K`;
  return `$${nf(n, 2)}`;
}

const pctLabel = (v) => (hasFiniteValue(v) ? `${Number(v) >= 0 ? '+' : ''}${Math.round(Number(v) * 100) / 100}%` : '—');

function ChangeChip({ label, value }) {
  const n = Number(value);
  const has = hasFiniteValue(value);
  const tone = !has ? 'na' : n >= 0 ? 'up' : 'down';
  return (
    <span className={`icc-chip icc-chip-${tone}`}>
      <small>{label}</small>
      <b>{has ? pctLabel(n) : '—'}</b>
    </span>
  );
}

/**
 * Inline SVG area chart from the 7d sparkline the market read returned.
 * Direction colors: green when the series ends above where it started.
 */
function Sparkline({ points, height = 74 }) {
  const data = (points || []).filter((p) => Number.isFinite(Number(p)));
  if (data.length < 2) {
    return <div className="icc-chart icc-chart-empty">—</div>;
  }
  const W = 320;
  const H = height;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const x = (i) => (i / (data.length - 1)) * (W - 8) + 4;
  const y = (v) => H - 8 - ((v - min) / span) * (H - 18);
  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${H - 4} L${x(0).toFixed(1)},${H - 4} Z`;
  const up = data[data.length - 1] >= data[0];
  const stroke = up ? '#34d399' : '#f87171';
  const gid = `icc-grad-${up ? 'up' : 'down'}`;
  return (
    <svg className="icc-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="7d chart">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="3" fill={stroke} />
    </svg>
  );
}

/** The 24h low→high band with a marker where the current price sits. */
function Range24h({ low, high, price, fa }) {
  const lo = Number(low);
  const hi = Number(high);
  const px = Number(price);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const pos = Number.isFinite(px) ? Math.min(0.97, Math.max(0.03, (px - lo) / (hi - lo))) : null;
  return (
    <div className="icc-range" data-testid="intent-ai-token-range">
      <div className="icc-range-labels">
        <span>{fa ? 'کمترین ۲۴ساعت' : '24h low'}</span>
        <span>{fa ? 'بالاترین ۲۴ساعت' : '24h high'}</span>
      </div>
      <div className="icc-range-bar">
        {pos != null ? <i className="icc-range-cursor" style={{ left: `${pos * 100}%` }} /> : null}
      </div>
      <div className="icc-range-values">
        <b>{fmtPrice(lo) || '—'}</b>
        <b>{fmtPrice(hi) || '—'}</b>
      </div>
    </div>
  );
}

export function TokenMarketCard({ card, locale = 'fa', onOpenRoute }) {
  if (!card || card.kind !== 'TOKEN') return null;
  const fa = String(locale || 'fa').startsWith('fa');
  const price = fmtPrice(card.priceUsd);
  const cap = fmtCompact(card.marketCapUsd);
  const vol = fmtCompact(card.volume24hUsd);
  const signal = card.signal || null;
  const signalTone = signal ? (/buy|bullish|strong.buy/i.test(signal) ? 'up' : /sell|bearish|strong.sell/i.test(signal) ? 'down' : 'na') : 'na';
  return (
    <div className="icc-token" data-testid="intent-ai-token-card">
      <div className="icc-token-head">
        <div className="icc-token-title">
          <strong>{card.symbol || '—'}</strong>
          <span>{card.name || ''}</span>
          {card.rank != null ? <em className="icc-rank">#{card.rank}</em> : null}
        </div>
        <div className="icc-token-price">
          <b>{price || '—'}</b>
          <ChangeChip label={fa ? '۲۴ساعت' : '24h'} value={card.change24hPct} />
        </div>
      </div>

      <div className="icc-chips">
        <ChangeChip label={fa ? '۱ ساعت' : '1h'} value={card.change1hPct} />
        <ChangeChip label={fa ? '۲۴ ساعت' : '24h'} value={card.change24hPct} />
        <ChangeChip label={fa ? '۷ روز' : '7d'} value={card.change7dPct} />
        {signal ? (
          <span className={`icc-chip icc-chip-${signalTone} icc-chip-signal`}>
            <small>{fa ? 'سیگنال' : 'Signal'}</small>
            <b>{String(signal).toUpperCase()}</b>
          </span>
        ) : null}
      </div>

      <Sparkline points={card.sparkline} />
      <div className="icc-chart-caption">{fa ? 'نمودار ۷ روز اخیر' : 'Last 7 days'}</div>

      <Range24h low={card.low24h} high={card.high24h} price={card.priceUsd} fa={fa} />

      <div className="icc-stats">
        {cap ? <div><small>{fa ? 'حجم بازار' : 'Mkt cap'}</small><b>{cap}</b></div> : null}
        {vol ? <div><small>{fa ? 'معاملات ۲۴ساعت' : 'Vol 24h'}</small><b>{vol}</b></div> : null}
        {card.ath != null && Number(card.ath) > 0 ? <div><small>ATH</small><b>{fmtPrice(card.ath)}</b></div> : null}
        {card.rsi != null ? <div><small>RSI</small><b>{Math.round(Number(card.rsi))}</b></div> : null}
      </div>

      {onOpenRoute ? (
        <button
          type="button"
          className="icc-open"
          onClick={() => onOpenRoute(`/coin/${card.coinId || String(card.symbol || '').toLowerCase()}`)}
        >
          {fa ? 'نمودار کامل در صفحه بازار ↗' : 'Full chart in market ↗'}
        </button>
      ) : null}
    </div>
  );
}

function portfolioCurrency(value, locale) {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n) || n < 0) return null;
  const digits = n > 0 && n < 0.01 ? 6 : n > 0 && n < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat(locale || 'en', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: digits
    }).format(n);
  } catch {
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: digits })}`;
  }
}

function portfolioAmount(value, locale) {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return '—';
  try { return new Intl.NumberFormat(locale || 'en', { maximumFractionDigits: 6 }).format(n); }
  catch { return n.toLocaleString('en-US', { maximumFractionDigits: 6 }); }
}

function portfolioPercent(value, locale) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return null;
  try { return new Intl.NumberFormat(locale || 'en', { style: 'percent', maximumFractionDigits: 1 }).format(n / 100); }
  catch { return `${Math.round(n * 10) / 10}%`; }
}

function portfolioNetwork(chainId, locale) {
  const id = Number(chainId);
  if (Number.isFinite(id) && EVM_CHAINS[id]) {
    const chain = EVM_CHAINS[id];
    return { name: chain.name, short: chain.short || chain.name };
  }
  if (String(chainId) === '501' || String(chainId).toLowerCase() === 'solana') return { name: 'Solana', short: 'SOL' };
  if (chainId != null && String(chainId).trim()) return { name: String(chainId), short: String(chainId) };
  return { name: locale?.startsWith?.('fa') ? 'شبکه نامشخص' : 'Unknown network', short: '—' };
}

export function PortfolioChatCard({ card, locale = 'fa', onOpenRoute, onQuickPrompt }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('assets');
  const [showAll, setShowAll] = useState(false);
  if (!card || card.kind !== 'PORTFOLIO') return null;
  const lang = String(locale || 'en');
  const copy = (key, vars = {}) => t(`intentAIOS.portfolioCard.${key}`, vars);
  const rtl = /^(fa|ar|ur)(-|$)/i.test(lang);
  const rows = (Array.isArray(card.rows) ? card.rows : []).filter((row) => row && row.symbol);
  const networks = (Array.isArray(card.networks) ? card.networks : []).filter(Boolean);
  const statusKey = ['live', 'partial', 'stale', 'pending', 'unavailable', 'empty'].includes(card.status) ? card.status : 'partial';
  const statusText = copy(`status.${statusKey}`);
  const totalValue = portfolioCurrency(card.totalValueUsd, lang);
  const stablecoinValue = portfolioCurrency(card.stablecoinValueUsd, lang);
  const stablecoinPct = portfolioPercent(card.stablecoinPct, lang);
  const concentrationPct = portfolioPercent(card.concentrationPct, lang);
  const initialRows = showAll ? rows : rows.slice(0, 4);
  const initialNetworks = showAll ? networks : networks.slice(0, 4);
  const fetchedAt = Number(card.fetchedAt);
  const updatedAt = Number.isFinite(fetchedAt) && fetchedAt > 0
    ? new Date(fetchedAt).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' })
    : null;
  const prompts = [
    { id: 'portfolio-risk', label: copy('action.risk'), prompt: copy('prompt.risk') },
    { id: 'portfolio-allocation', label: copy('action.allocation'), prompt: copy('prompt.allocation') },
    { id: 'portfolio-rebalance', label: copy('action.rebalance'), prompt: copy('prompt.rebalance') }
  ];

  return (
    <section className={`icc-portfolio icc-portfolio-v2 icc-portfolio-${statusKey}`} dir={rtl ? 'rtl' : 'ltr'} data-testid="intent-ai-portfolio-card">
      <header className="icc-portfolio-topline">
        <div className="icc-portfolio-title-wrap">
          <span className="icc-portfolio-mark" aria-hidden="true">◈</span>
          <div className="icc-portfolio-title-copy">
            <strong>{copy('title')}</strong>
            <small>{updatedAt ? copy('asOf', { time: updatedAt }) : copy('subtitle')}</small>
          </div>
        </div>
        <span className={`icc-portfolio-status icc-portfolio-status-${statusKey}`} role="status">
          <i aria-hidden="true" />{statusText}
        </span>
      </header>

      <div className="icc-portfolio-value-block">
        <small>{copy(card.displayedValueKind === 'total' ? 'metric.total' : 'metric.pricedValue')}</small>
        <strong dir="ltr">{totalValue || '—'}</strong>
        {['partial', 'stale', 'pending', 'unavailable'].includes(statusKey) ? <span>{copy('note.pricedSubtotal')}</span> : null}
      </div>

      <div className="icc-portfolio-metrics">
        <div className="icc-portfolio-metric">
          <small>{copy('metric.stablecoins')}</small>
          <strong dir="ltr">{stablecoinValue == null ? '—' : `${stablecoinValue}${stablecoinPct ? ` · ${stablecoinPct}` : card.stablecoinPct === 0 ? ` · ${portfolioPercent(0, lang)}` : ''}`}</strong>
          <span>{copy('metric.pricedOnly')}</span>
        </div>
        <div className="icc-portfolio-metric">
          <small>{copy('metric.concentration')}</small>
          <strong>{card.concentrationSymbol && concentrationPct ? `${card.concentrationSymbol} · ${concentrationPct}` : '—'}</strong>
          <span>{copy('metric.pricedOnly')}</span>
        </div>
      </div>

      <div className="icc-portfolio-unavailable" aria-label={copy('metric.notComputed')}>
        <div>
          <span>{copy('metric.pnl')}</span>
          <strong>{copy('metric.notAvailable')}</strong>
          <small>{copy('metric.noCostBasis')}</small>
        </div>
        <div>
          <span>{copy('metric.riskScore')}</span>
          <strong data-testid="intent-ai-portfolio-mix-score">
            {card.portfolioMixScore == null
              ? copy('metric.notAvailable')
              : `${Math.round(Number(card.portfolioMixScore))}/100${card.portfolioMixBand ? ` · ${copy(`riskBand.${card.portfolioMixBand}`)}` : ''}`}
          </strong>
          <small>{copy(card.portfolioMixScore == null ? 'metric.riskUnavailable' : 'metric.riskBasis')}</small>
        </div>
      </div>
      <p className="icc-portfolio-disclaimer">{copy('note.risk')}</p>

      <div className="icc-portfolio-tabs" role="tablist" aria-label={copy('title')}>
        <button type="button" role="tab" aria-selected={tab === 'assets'} className={tab === 'assets' ? 'is-active' : ''} onClick={() => { setTab('assets'); setShowAll(false); }}>
          {copy('tab.assets')} <span>{rows.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'networks'} className={tab === 'networks' ? 'is-active' : ''} onClick={() => { setTab('networks'); setShowAll(false); }}>
          {copy('tab.networks')} <span>{networks.length}</span>
        </button>
      </div>

      {tab === 'assets' ? (
        rows.length ? (
          <div className="icc-portfolio-list" role="tabpanel" data-testid="intent-ai-portfolio-assets">
            {initialRows.map((row, index) => {
              const network = portfolioNetwork(row.chainId, lang);
              const value = portfolioCurrency(row.valueUsd, lang);
              const pct = portfolioPercent(row.allocationPct, lang);
              const rowKey = row.key || `${row.chainId || 'unknown'}:${row.symbol}:${index}`;
              return (
                <div key={rowKey} className={`icc-portfolio-row ${row.valueUsd == null ? 'is-unpriced' : ''}`}>
                  <div className="icc-portfolio-row-head">
                    <div className="icc-portfolio-asset-name">
                      <strong>{row.symbol}</strong>
                      <span title={network.name}>{network.short}</span>
                    </div>
                    <div className="icc-portfolio-status-stack">
                      {row.networkStatus && row.networkStatus !== 'live' ? (
                        <span className={`icc-portfolio-mini-status is-${row.networkStatus}`}>{copy(`network.${row.networkStatus}`)}</span>
                      ) : null}
                      {row.networkStale && row.networkStatus === 'failed' ? (
                        <span className="icc-portfolio-mini-status is-stale">{copy('network.stale')}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="icc-portfolio-row-data">
                    <span dir="ltr">{portfolioAmount(row.amount, lang)} {row.symbol}</span>
                    <strong dir="ltr">{value || copy('row.priceUnavailable')}</strong>
                  </div>
                  {pct ? (
                    <div className="icc-portfolio-row-share">
                      <div><i style={{ width: `${Math.max(1, Math.min(100, Number(row.allocationPct) || 0))}%` }} /></div>
                      <small>{pct}</small>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {rows.length > 4 ? (
              <button type="button" className="icc-portfolio-show-more" onClick={() => setShowAll((value) => !value)}>
                {showAll ? copy('action.showLess') : copy('action.showAll', { count: rows.length })}
              </button>
            ) : null}
          </div>
        ) : <div className="icc-portfolio-empty" role="tabpanel">{copy('row.noHoldings')}</div>
      ) : (
        networks.length ? (
          <div className="icc-portfolio-list" role="tabpanel" data-testid="intent-ai-portfolio-networks">
            {initialNetworks.map((network, index) => {
              const title = portfolioNetwork(network.chainId, lang);
              const value = portfolioCurrency(network.valueUsd, lang);
              const pct = portfolioPercent(network.allocationPct, lang);
              const networkKey = `${network.chainId || 'unknown'}:${index}`;
              return (
                <div key={networkKey} className={`icc-portfolio-row icc-portfolio-network-row is-${network.status || 'live'}`}>
                  <div className="icc-portfolio-row-head">
                    <div className="icc-portfolio-asset-name">
                      <strong>{title.name}</strong>
                      <span>{title.short}</span>
                    </div>
                    <div className="icc-portfolio-status-stack">
                      <span className={`icc-portfolio-mini-status is-${network.status || 'live'}`}>
                        {copy(`network.${network.status || 'live'}`)}
                      </span>
                      {network.stale && network.status === 'failed' ? (
                        <span className="icc-portfolio-mini-status is-stale">{copy('network.stale')}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="icc-portfolio-row-data">
                    <span>{copy('network.assetCount', { count: network.holdingCount || 0 })}</span>
                    <strong dir="ltr">{value || copy('row.priceUnavailable')}</strong>
                  </div>
                  {pct ? <small className="icc-portfolio-network-share">{pct} {copy('metric.pricedOnly')}</small> : null}
                  {network.unpricedCount > 0 ? <small className="icc-portfolio-unpriced-note">{copy('note.unpricedCount', { count: network.unpricedCount })}</small> : null}
                </div>
              );
            })}
            {networks.length > 4 ? (
              <button type="button" className="icc-portfolio-show-more" onClick={() => setShowAll((value) => !value)}>
                {showAll ? copy('action.showLess') : copy('action.showAll', { count: networks.length })}
              </button>
            ) : null}
          </div>
        ) : <div className="icc-portfolio-empty" role="tabpanel">{copy('network.noNetworks')}</div>
      )}

      {card.unpricedCount > 0 || card.failedNetworks > 0 || card.staleNetworks > 0 ? (
        <div className="icc-portfolio-coverage">
          {card.unpricedCount > 0 ? <span>{copy('note.unpricedCount', { count: card.unpricedCount })}</span> : null}
          {card.failedNetworks > 0 ? <span>{copy('note.failedCount', { count: card.failedNetworks })}</span> : null}
          {card.staleNetworks > 0 ? <span>{copy('note.staleCount', { count: card.staleNetworks })}</span> : null}
        </div>
      ) : null}

      <div className="icc-portfolio-actions">
        {onQuickPrompt ? prompts.map((action) => (
          <button type="button" key={action.id} onClick={() => onQuickPrompt(action)}>{action.label}</button>
        )) : null}
        {onOpenRoute ? (
          <button type="button" className="icc-portfolio-open" onClick={() => onOpenRoute('/portfolio')}>
            {copy('action.fullPortfolio')} ↗
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * PHASE 217 — the cross-asset conditional allocation card.
 *
 * `ui` is the payload `server/aiIntentOS.js` builds (see
 * conditionalAllocationReply). The card is deliberately dumb: it renders the
 * state, the per-condition reading and the allocation exactly as computed, and
 * it has no path to a number the server did not send — which is why a dead
 * gold feed shows «unreadable» here instead of a plausible price.
 */
export function ConditionalAllocationCard({ ui, locale = 'fa', onOpenRoute }) {
  if (!ui || ui.type !== 'CONDITIONAL_ALLOCATION') return null;
  const { t } = useTranslation();
  const fa = String(locale || 'fa').startsWith('fa');
  const conditions = Array.isArray(ui.conditions) ? ui.conditions : [];
  const logic = ui.logic === 'OR' ? (fa ? 'یا' : 'OR') : (fa ? 'و' : 'AND');
  const plan = ui.plan && ui.plan.ok ? ui.plan : null;

  const STATE_TONE = { TRIGGERED: 'up', WAITING: 'na', ARMING: 'na', UNREADABLE: 'down', NEEDS_INPUT: 'na' };
  const STATE_LABEL = {
    TRIGGERED: fa ? 'شرط‌ها برقرار شد' : 'conditions met',
    WAITING: fa ? 'برقرار نیست' : 'not met',
    ARMING: t('intentAIOS.conditional.arming'),
    UNREADABLE: t('intentAIOS.conditional.unreadable'),
    NEEDS_INPUT: fa ? 'نیاز به تکمیل' : 'needs input'
  };

  /* One condition, said the way the user said it: «۵٪ اصلاح کند» not
     «PERCENT_CHANGE <= -5». This line is the whole point of the card — it is
     the user's own instruction reflected back for correction. */
  const conditionText = (c) => {
    if (!c) return '—';
    if (c.metric === 'PERCENT_CHANGE') {
      const pct = Math.abs(Number(c.threshold) || 0);
      if (c.threshold == null) return `${c.asset} — ${fa ? 'بدون حد نصاب' : 'no threshold'}`;
      return c.operator === 'BELOW'
        ? t('intentAIOS.conditional.declines', { pct })
        : t('intentAIOS.conditional.rises', { pct });
    }
    if (c.threshold == null) return `${c.asset} — ${fa ? 'بدون حد نصاب' : 'no threshold'}`;
    return c.operator === 'BELOW'
      ? t('intentAIOS.conditional.below', { value: c.threshold })
      : t('intentAIOS.conditional.above', { value: c.threshold });
  };

  const legState = (c) => {
    if (c?.armed) return { label: t('intentAIOS.conditional.arming'), tone: 'na' };
    if (!c?.ok) return { label: t('intentAIOS.conditional.unreadable'), tone: 'down' };
    return c.hit
      ? { label: t('intentAIOS.conditional.met'), tone: 'up' }
      : { label: t('intentAIOS.conditional.notMet'), tone: 'na' };
  };

  return (
    <div className="icc-conditional" data-testid="intent-ai-conditional-card">
      <div className="icc-conditional-head">
        <span>{t('intentAIOS.conditional.title')}</span>
        <b className={`icc-cond-state icc-cond-${STATE_TONE[ui.state] || 'na'}`}>
          {STATE_LABEL[ui.state] || ui.state || '—'}
        </b>
      </div>

      {conditions.length ? (
        <div className="icc-cond-list" data-testid="intent-ai-conditional-legs">
          {conditions.map((c, i) => {
            const st = legState(c);
            const shown = Number.isFinite(Number(c.sample)) && c.metric === 'PERCENT_CHANGE'
              ? `${Number(c.sample) >= 0 ? '+' : ''}${Math.round(Number(c.sample) * 100) / 100}%`
              : (c.value != null ? nf(Number(c.value), 2) : '—');
            return (
              <div key={c.id || c.asset || i} className="icc-cond-row">
                {i > 0 ? <em className="icc-cond-join">{logic}</em> : null}
                <div className="icc-cond-line">
                  <strong>{c.asset}</strong>
                  <span className="icc-cond-text">{conditionText(c)}</span>
                  <b className={`icc-cond-chip icc-cond-${st.tone}`}>{st.label}</b>
                </div>
                <div className="icc-cond-sub">
                  <span>{fa ? 'خوانده‌شده' : 'read'}: {shown}</span>
                  {c.source ? <i>{c.source}</i> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {plan ? (
        <div className="icc-cond-alloc" data-testid="intent-ai-conditional-allocation">
          <div className="icc-cond-alloc-line">
            <span>{t('intentAIOS.conditional.allocation')}</span>
            <b>{fmtPrice(plan.allocationUsd) || '—'}</b>
          </div>
          <div className="icc-cond-alloc-sub">
            <span>
              {plan.sizePct != null ? `${plan.sizePct}% ${t('intentAIOS.conditional.ofCapital')}` : '—'}
              {plan.capitalUsd != null ? ` (${fmtPrice(plan.capitalUsd)})` : ''}
            </span>
            {plan.target?.symbol ? <b>→ {plan.target.symbol}</b> : null}
          </div>
          {plan.units != null ? (
            <div className="icc-cond-alloc-sub">
              <span>≈ {nf(plan.units, 6)} {t('intentAIOS.conditional.units')}</span>
            </div>
          ) : null}
          {plan.execution && plan.execution.available === false ? (
            <p className="icc-cond-note">{t('intentAIOS.conditional.analysisOnly')}</p>
          ) : null}
          {plan.rail?.blockedByRail ? (
            <p className="icc-cond-note">
              {t('intentAIOS.conditional.aboveRail', { pct: plan.rail.maxSingleAllocationPct })}
            </p>
          ) : null}
        </div>
      ) : null}

      {Array.isArray(ui.missing) && ui.missing.length ? (
        <p className="icc-cond-note">{fa ? 'منتظر تکمیل:' : 'waiting on:'} {ui.missing.join(', ')}</p>
      ) : null}

      {onOpenRoute ? (
        <button type="button" className="icc-open" onClick={() => onOpenRoute('/intent?tab=automate')}>
          {t('intentAIOS.conditional.watch')} ↗
        </button>
      ) : null}
    </div>
  );
}

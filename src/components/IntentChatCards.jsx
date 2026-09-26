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

import { useTranslation } from 'react-i18next';

const nf = (v, digits = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
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

const pctLabel = (v) => (Number.isFinite(Number(v)) ? `${Number(v) >= 0 ? '+' : ''}${Math.round(Number(v) * 100) / 100}%` : '—');

function ChangeChip({ label, value }) {
  const n = Number(value);
  const has = Number.isFinite(n);
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

export function PortfolioChatCard({ card, locale = 'fa', onOpenRoute }) {
  if (!card || card.kind !== 'PORTFOLIO') return null;
  const fa = String(locale || 'fa').startsWith('fa');
  const rows = (card.rows || []).filter((r) => r && r.symbol);
  const maxPct = rows.reduce((m, r) => Math.max(m, Number(r.pct) || 0), 0) || 100;
  return (
    <div className="icc-portfolio" data-testid="intent-ai-portfolio-card">
      <div className="icc-portfolio-head">
        <span>{card.title || (fa ? 'پرتفوی من' : 'My portfolio')}</span>
        <b>{fmtPrice(card.totalValueUsd) || (fa ? 'ارزش N/A' : 'value N/A')}</b>
      </div>
      {rows.map((r) => (
        <div key={r.symbol} className="icc-holding">
          <div className="icc-holding-line">
            <strong>{r.symbol}</strong>
            <span>{r.amount != null ? nf(r.amount, 6) : ''}</span>
            <b>{fmtPrice(r.valueUsd) || '—'}</b>
          </div>
          <div className="icc-holding-bar">
            <i style={{ width: `${Math.max(3, ((Number(r.pct) || 0) / maxPct) * 100)}%` }} />
          </div>
          {r.pct != null ? <small>{Math.round(r.pct * 10) / 10}%</small> : null}
        </div>
      ))}
      {card.unpricedCount > 0 ? (
        <p className="icc-unpriced">{fa ? `${card.unpricedCount} دارایی بدون قیمت معتبر (N/A)` : `${card.unpricedCount} holding(s) without a live price`}</p>
      ) : null}
      {onOpenRoute ? (
        <button type="button" className="icc-open" onClick={() => onOpenRoute('/portfolio')}>
          {fa ? 'پرتفوی کامل ↗' : 'Full portfolio ↗'}
        </button>
      ) : null}
    </div>
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

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
 *
 * Both are presentational only: no fetches, no wallet access.
 */

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

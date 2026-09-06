import { useMemo } from 'react';
import { FLAG_SVG, NETWORK_SVG, STOCK_MARK, TOKEN_SVG } from '../lib/assetIconData';

/**
 * ASSET ICON — offline artwork for venue-curated pickers.
 * ---------------------------------------------------------------------------
 * ─── THE BUG ────────────────────────────────────────────────────────────────
 * «توکن‌ها عکس نداره» on the Bridge (tokens / native / tron), dYdX, the
 * Futures Engine and the Global-Horizon market lists. Every one of those
 * pickers resolved artwork from TrustWallet / CoinGecko hosts, and those
 * hosts are unreachable for a large share of our users (and from this
 * sandbox). A CDN that cannot be reached is the same as no icon, so the
 * lists showed three-letter monograms for USDT, BTC, EUR/USD and AAPL alike.
 *
 * ─── WHY SYMBOL-KEYED IS SAFE *HERE* AND NOWHERE ELSE ───────────────────────
 * lib/tokenIcon.jsx refuses symbol lookups because a scam token can call
 * itself "USDT". That rule stands for the swap screen, where the user can
 * import any address. The lists this component serves are different: every
 * entry is curated by us (bridge stablecoins) or by the venue (THORChain
 * pools, dYdX / Drift / Ostium markets). Nothing user-supplied reaches them,
 * so the symbol IS the identity and artwork keyed by it cannot be borrowed.
 *
 * ─── ALWAYS RENDERS SOMETHING ───────────────────────────────────────────────
 * Vendored inline SVG (no request, no CDN, no theme surprises) with the same
 * deterministic monogram as tokenIcon.jsx as the last resort. Never an empty
 * box.
 *
 * Kinds:
 *   token   {symbol}                   USDT, BTC, EUR, AAPL, XAU…
 *   chain   {chainId | 'tron' | …}     network mark
 *   pair    {base, quote}              two overlapping legs — EUR/USD, XAU/USD
 */

const METALS = {
  XAU: { label: 'Au', a: '#f5c451', b: '#b8860b' },
  XAG: { label: 'Ag', a: '#e6e9ef', b: '#8f98a8' },
  XPT: { label: 'Pt', a: '#dfe5ec', b: '#6f7d8f' },
  XPD: { label: 'Pd', a: '#d9dde3', b: '#5a6577' },
  COPPER: { label: 'Cu', a: '#e8875a', b: '#9a4b23' },
  HG: { label: 'Cu', a: '#e8875a', b: '#9a4b23' }
};
const ENERGY = {
  WTI: { label: 'OIL', a: '#3b3f4a', b: '#111318' },
  CL: { label: 'OIL', a: '#3b3f4a', b: '#111318' },
  BRENT: { label: 'OIL', a: '#3b3f4a', b: '#111318' },
  NGAS: { label: 'GAS', a: '#3fa9f5', b: '#155e9c' },
  NG: { label: 'GAS', a: '#3fa9f5', b: '#155e9c' }
};
const INDEX_OR_FUND = {
  SPX: ['S&P', '#c8102e'], SPY: ['SPY', '#c8102e'], NDX: ['NDQ', '#0090da'], QQQ: ['QQQ', '#0090da'],
  DJI: ['DOW', '#1b365d'], DIA: ['DIA', '#1b365d'], DAX: ['DAX', '#0a2540'], NKY: ['NKY', '#bc002d'],
  NIK: ['NKY', '#bc002d'], FTSE: ['FTS', '#003d7c'], HSI: ['HSI', '#c8102e'], IWM: ['IWM', '#5b6c8f'],
  VIX: ['VIX', '#7c3aed'], GLD: ['GLD', '#b8860b'], SLV: ['SLV', '#6b7686'], TLT: ['TLT', '#1f6f5f'],
  USO: ['USO', '#2b2f38'], EEM: ['EEM', '#2a6db0'], XLF: ['XLF', '#1d4f91'], ARKK: ['ARK', '#111827']
};
const FX_ALIAS = { CNH: 'CNH', CNY: 'CNY' };

function hueFor(symbol) {
  const s = String(symbol ?? '?');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/* One tile = one 24×24 SVG string. Everything below returns a string so the
   pair renderer can compose two of them without extra DOM. */
function tileSvg(label, a, b, { text = '#fff', size = 8.5 } = {}) {
  const l = String(label).slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g-${l}-${a.slice(1)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="24" height="24" fill="url(#g-${l}-${a.slice(1)})"/><text x="12" y="12.6" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace,JetBrains Mono,monospace" font-weight="800" font-size="${size}" fill="${text}">${l}</text></svg>`;
}

function stockSvg(sym) {
  const m = STOCK_MARK[sym];
  if (!m) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="${m.bg}"/><g transform="translate(4 4) scale(0.6667)"><path fill="${m.fg}" d="${m.d}"/></g></svg>`;
}

/** Resolve one symbol to an SVG string, or null when only the monogram fits. */
export function symbolSvg(rawSymbol) {
  const sym = String(rawSymbol || '').toUpperCase().replace(/[^A-Z0-9&]/g, '');
  if (!sym) return null;
  if (TOKEN_SVG[sym]) return TOKEN_SVG[sym];
  if (sym === 'WETH') return TOKEN_SVG.ETH || null;
  if (sym === 'WBNB') return TOKEN_SVG.BNB || null;
  if (sym === 'BTCB' || sym === 'CBBTC' || sym === 'TBTC') return TOKEN_SVG.BTC || null;
  if (sym === 'USDCE' || sym === 'USDBC') return TOKEN_SVG.USDC || null;
  if (FLAG_SVG[sym]) return FLAG_SVG[sym];
  if (FX_ALIAS[sym] && FLAG_SVG[FX_ALIAS[sym]]) return FLAG_SVG[FX_ALIAS[sym]];
  const stock = stockSvg(sym);
  if (stock) return stock;
  if (METALS[sym]) { const m = METALS[sym]; return tileSvg(m.label, m.a, m.b, { text: '#1b1b1b', size: 9.5 }); }
  if (ENERGY[sym]) { const m = ENERGY[sym]; return tileSvg(m.label, m.a, m.b); }
  if (INDEX_OR_FUND[sym]) { const [l, c] = INDEX_OR_FUND[sym]; return tileSvg(l, c, '#0b0f19'); }
  return null;
}

/** Network mark by chain id (1, 56, 'tron', 'solana', …) or THORChain chain code. */
export function chainSvg(chain) {
  const key = String(chain ?? '').toLowerCase();
  const THOR = { btc: 'bitcoin', eth: '1', bsc: '56', avax: '43114', base: '8453', ltc: 'litecoin', bch: 'bitcoin', doge: 'bitcoin', gaia: 'cosmos', thor: null, xrp: 'xrp', trx: 'tron', sol: 'solana', ton: 'ton' };
  const k = NETWORK_SVG[key] ? key : THOR[key];
  if (k && NETWORK_SVG[k]) return NETWORK_SVG[k];
  if (key === 'doge' && TOKEN_SVG.DOGE) return TOKEN_SVG.DOGE;
  if (key === 'bch' && TOKEN_SVG.BCH) return TOKEN_SVG.BCH;
  if (key === 'thor' && TOKEN_SVG.RUNE) return TOKEN_SVG.RUNE;
  return null;
}

function Monogram({ text, size, radius, className }) {
  const hue = hueFor(text);
  return (
    <span
      className={className}
      style={{
        width: size, height: size, borderRadius: radius, display: 'grid', placeItems: 'center',
        background: `linear-gradient(140deg, hsl(${hue} 70% 46%), hsl(${(hue + 42) % 360} 68% 36%))`,
        color: '#fff', fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: Math.max(9, Math.round(size * 0.27)),
        lineHeight: 1, letterSpacing: 0.3, textTransform: 'uppercase', flexShrink: 0, overflow: 'hidden'
      }}
      aria-hidden="true"
    >
      {String(text || '?').slice(0, 3)}
    </span>
  );
}

function Svg({ svg, size, radius, className, style }) {
  return (
    <span
      className={className}
      style={{ width: size, height: size, borderRadius: radius, display: 'block', overflow: 'hidden', flexShrink: 0, ...style }}
      /* Inline SVG so no request is made; every string comes from our own
         vendored file, never from a user or an API. */
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-hidden="true"
    />
  );
}

/**
 * <AssetIcon symbol="USDT" />            token / currency / stock
 * <AssetIcon chain={56} />               network
 * <AssetIcon base="EUR" quote="USD" />   pair — two legs, quote tucked behind
 * <AssetIcon symbol="USDT" chain={56} /> token with a network badge
 */
export default function AssetIcon({ symbol, chain, base, quote, size = 40, radius, className = 'asset-icon', style }) {
  const r = radius ?? Math.round(size * 0.28);

  const main = useMemo(() => {
    if (base) return symbolSvg(base);
    if (symbol) return symbolSvg(symbol);
    if (chain != null) return chainSvg(chain);
    return null;
  }, [symbol, chain, base]);
  const second = useMemo(() => (base && quote ? symbolSvg(quote) : null), [base, quote]);
  const badge = useMemo(() => (symbol && chain != null ? chainSvg(chain) : null), [symbol, chain]);

  /* PAIR: base in front, quote peeking from the bottom-end corner. Same
     layout for a forex pair (two flags), a commodity (metal + flag) and a
     stock (company + flag), so the list reads as one family. */
  if (base) {
    /* Base fills ~80% from the top-start corner; the quote leg is a small
       round badge on the bottom-end corner so it never covers the base mark
       (a gold tile with the US flag over its letters read as neither). */
    const big = Math.round(size * 0.8);
    const small = Math.round(size * 0.46);
    return (
      <span className={className} style={{ position: 'relative', width: size, height: size, display: 'block', flexShrink: 0, ...style }} aria-hidden="true">
        {main ? <Svg svg={main} size={big} radius={Math.round(r * 0.85)} /> : <Monogram text={base} size={big} radius={Math.round(r * 0.85)} />}
        <span className="asset-icon-leg2" style={{ position: 'absolute', insetInlineEnd: 0, bottom: 0, width: small, height: small, borderRadius: 999, boxShadow: '0 0 0 2px var(--bg-panel-solid)', overflow: 'hidden', display: 'block' }}>
          {second ? <Svg svg={second} size={small} radius={999} /> : <Monogram text={quote} size={small} radius={999} />}
        </span>
      </span>
    );
  }

  const body = main
    ? <Svg svg={main} size={size} radius={r} className={badge ? undefined : className} style={badge ? undefined : style} />
    : <Monogram text={symbol ?? String(chain ?? '?')} size={size} radius={r} className={badge ? undefined : className} />;

  if (!badge) return body;
  const b = Math.round(size * 0.42);
  return (
    <span className={className} style={{ position: 'relative', width: size, height: size, display: 'block', flexShrink: 0, ...style }} aria-hidden="true">
      {body}
      <span className="asset-icon-badge" style={{ position: 'absolute', insetInlineEnd: -2, bottom: -2, width: b, height: b, borderRadius: 999, boxShadow: '0 0 0 2px var(--bg-panel-solid)', overflow: 'hidden', display: 'block' }}>
        <Svg svg={badge} size={b} radius={999} />
      </span>
    </span>
  );
}

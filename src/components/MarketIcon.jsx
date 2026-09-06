import { useEffect, useState } from 'react';
import { flagEmoji, flagFallback, flagSupported } from '../lib/countryFlag';
import { tickerLogo } from '../lib/coinImage';

/**
 * MARKET / ASSET ICON — one visual for every picker.
 * ---------------------------------------------------------------------------
 * ModernSelect's fallback used to be a single lettered gradient square, so a
 * picker that never attached a real image (Thor pools, the dYdX / Futures /
 * Ostium market lists, the Tron origin) showed the same "letters in a box"
 * for everything. The reported complaint is exactly that: «توکن عکس نداره» —
 * a list where a forex pair, a precious metal and a stock each look identical.
 *
 * This component makes the *kind* of asset visible before an image even
 * arrives, so a market picker reads at a glance and never needs a fragile,
 * symbol-keyed external logo to be useful:
 *
 *   • Forex pair   (CAD/USD, EUR/GBP …)  → the two country flags side by side.
 *   • Metal        (XAU, XAG, XPT, XPD)   → a coin with the metallic gradient.
 *   • Index        (SPX500, NDX …)       → a mini candle/line glyph.
 *   • ETF / fund                          → a fund glyph.
 *   • Stock        (AAPL, TSLA …)         → a real company logo, then monogram.
 *   • Crypto       (BTC, ETH … native)    → the coin's own TrustWallet logo,
 *                                            then a modern coin monogram.
 *   • Anything else                       → a coloured monogram (never blank).
 *
 * Security note, and why crypto defaults to a monogram for anything not in the
 * curated native set: symbol-keyed artwork is how a fake token borrows a real
 * one's face. The curated set below is limited to the native coins the market
 * venue itself offers; a bogus "BTC" in a user-imported list still gets a
 * monogram, matching the rule lib/tokenIcon.jsx already documented.
 */

const FX_CODES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'MXN', 'TRY', 'ZAR', 'INR', 'CNY', 'RUB', 'BRL']);

/** Currency code → country/region code for a flag. EUR uses the EU flag. */
const CURRENCY_CC = {
  USD: 'US', EUR: 'EU', GBP: 'GB', JPY: 'JP', CHF: 'CH', CAD: 'CA',
  AUD: 'AU', NZD: 'NZ', SEK: 'SE', NOK: 'NO', DKK: 'DK', SGD: 'SG',
  HKD: 'HK', MXN: 'MX', TRY: 'TR', ZAR: 'ZA', INR: 'IN', CNY: 'CN',
  RUB: 'RU', BRL: 'BR',
};
const ccFor = (currency) => CURRENCY_CC[String(currency).toUpperCase()] || String(currency).toUpperCase();

/** Metal → short mark + gradient. Precious and industrial. */
const METALS = {
  XAU: { mark: 'Au', label: 'Gold', bg: 'linear-gradient(140deg, #f6d66a 0%, #c98a12 60%, #8a5c06 100%)', fg: '#3a2600' },
  GOLD: { mark: 'Au', label: 'Gold', bg: 'linear-gradient(140deg, #f6d66a 0%, #c98a12 60%, #8a5c06 100%)', fg: '#3a2600' },
  XAG: { mark: 'Ag', label: 'Silver', bg: 'linear-gradient(140deg, #e8ecef 0%, #9aa7b3 55%, #6b7885 100%)', fg: '#1c2229' },
  SILVER: { mark: 'Ag', label: 'Silver', bg: 'linear-gradient(140deg, #e8ecef 0%, #9aa7b3 55%, #6b7885 100%)', fg: '#1c2229' },
  XPT: { mark: 'Pt', label: 'Platinum', bg: 'linear-gradient(140deg, #d3dbe3 0%, #8f9ba8 55%, #5f6b78 100%)', fg: '#1c2229' },
  PLATINUM: { mark: 'Pt', label: 'Platinum', bg: 'linear-gradient(140deg, #d3dbe3 0%, #8f9ba8 55%, #5f6b78 100%)', fg: '#1c2229' },
  XPD: { mark: 'Pd', label: 'Palladium', bg: 'linear-gradient(140deg, #d8cdbf 0%, #9a8d78 55%, #6b5f4c 100%)', fg: '#251c10' },
  PALLADIUM: { mark: 'Pd', label: 'Palladium', bg: 'linear-gradient(140deg, #d8cdbf 0%, #9a8d78 55%, #6b5f4c 100%)', fg: '#251c10' },
  XCU: { mark: 'Cu', label: 'Copper', bg: 'linear-gradient(140deg, #e8a06a 0%, #b06a34 55%, #7a4218 100%)', fg: '#2a1405' },
  AL: { mark: 'Al', label: 'Aluminium', bg: 'linear-gradient(140deg, #e4eaf0 0%, #a8b4c1 55%, #727f8d 100%)', fg: '#1c2229' },
  WTI: { mark: 'OIL', label: 'Crude Oil', bg: 'linear-gradient(140deg, #4a4a58 0%, #26262e 60%, #14141a 100%)', fg: '#f2f4f8' },
  BRENT: { mark: 'OIL', label: 'Brent', bg: 'linear-gradient(140deg, #4a4a58 0%, #26262e 60%, #14141a 100%)', fg: '#f2f4f8' },
  NGAS: { mark: 'GAS', label: 'Nat Gas', bg: 'linear-gradient(140deg, #3f7f8f 0%, #25525f 55%, #16343d 100%)', fg: '#e7f5f8' },
  COPPER: { mark: 'Cu', label: 'Copper', bg: 'linear-gradient(140deg, #e8a06a 0%, #b06a34 55%, #7a4218 100%)', fg: '#2a1405' },
};

/**
 * Native coin logos from TrustWallet's asset repo — the same source
 * lib/tokenIcon.jsx already relies on, so no new host is introduced. A 404
 * here degrades to the coin monogram inside this component, never a blank.
 */
const NATIVE_LOGO = {
  BTC: 'https://assets-cdn.trustwallet.com/blockchains/bitcoin/info/logo.png',
  ETH: 'https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png',
  SOL: 'https://assets-cdn.trustwallet.com/blockchains/solana/info/logo.png',
  BNB: 'https://assets-cdn.trustwallet.com/blockchains/binance/info/logo.png',
  LTC: 'https://assets-cdn.trustwallet.com/blockchains/litecoin/info/logo.png',
  DOGE: 'https://assets-cdn.trustwallet.com/blockchains/dogecoin/info/logo.png',
  BCH: 'https://assets-cdn.trustwallet.com/blockchains/bitcoincash/info/logo.png',
  TRX: 'https://assets-cdn.trustwallet.com/blockchains/tron/info/logo.png',
  AVAX: 'https://assets-cdn.trustwallet.com/blockchains/avalanchec/info/logo.png',
  MATIC: 'https://assets-cdn.trustwallet.com/blockchains/polygon/info/logo.png',
  POL: 'https://assets-cdn.trustwallet.com/blockchains/polygon/info/logo.png',
  XRP: 'https://assets-cdn.trustwallet.com/blockchains/ripple/info/logo.png',
  ADA: 'https://assets-cdn.trustwallet.com/blockchains/cardano/info/logo.png',
  DOT: 'https://assets-cdn.trustwallet.com/blockchains/polkadot/info/logo.png',
  RUNE: 'https://assets-cdn.trustwallet.com/blockchains/thorchain/info/logo.png',
  ARB: 'https://assets-cdn.trustwallet.com/blockchains/arbitrum/info/logo.png',
  OP: 'https://assets-cdn.trustwallet.com/blockchains/optimism/info/logo.png',
  MNT: 'https://assets-cdn.trustwallet.com/blockchains/mantle/info/logo.png',
  BERA: 'https://assets-cdn.trustwallet.com/blockchains/berachain/info/logo.png',
  MON: 'https://assets-cdn.trustwallet.com/blockchains/monad/info/logo.png',
};

/* Stablecoins have addresses, not native logos; give them their own brand. */
const STABLECOIN = {
  USDT: { mark: '₮', name: 'Tether', bg: 'linear-gradient(140deg, #44b0a0 0%, #249ac3 55%, #1b7d93 100%)', fg: '#eafcf8' },
  USDC: { mark: '⊜', name: 'USD Coin', bg: 'linear-gradient(140deg, #4a90d9 0%, #2b6fc4 55%, #1f4f9c 100%)', fg: '#eaf3ff' },
  DAI: { mark: '◈', name: 'Dai', bg: 'linear-gradient(140deg, #e8b03f 0%, #c98a12 55%, #8a5c06 100%)', fg: '#2a1800' },
};

/** Stable colour — same asset, same colour, always. */
function hueFor(symbol) {
  const s = String(symbol ?? '?');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** Pull the base (first) symbol out of "CAD/USD", "BTC-USD", "XAU/USD". */
function baseSymbol(symbol) {
  const s = String(symbol ?? '').trim().toUpperCase();
  const m = s.match(/[A-Z0-9]{2,8}/);
  return m ? m[0] : s;
}

/** Is `sym` a forex-leg currency? */
function isFxCode(sym) {
  return FX_CODES.has(String(sym).toUpperCase());
}

/** Turn "CAD/USD" into legs, or null when it is not a forex pair. */
function fxLegs(symbol, category) {
  const s = String(symbol ?? '').trim().toUpperCase();
  const cat = String(category ?? '').toLowerCase();
  const parts = s.split(/[\/-]/).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 2 && isFxCode(parts[0]) && isFxCode(parts[1])) return [parts[0], parts[1]];
  /* Concatenated pair, e.g. "EURUSD" → ["EUR", "USD"]. */
  if (parts.length === 1 && s.length === 6 && isFxCode(s.slice(0, 3)) && isFxCode(s.slice(3))) {
    return [s.slice(0, 3), s.slice(3)];
  }
  if (cat.includes('forex') || cat.includes('fx')) {
    const base = baseSymbol(s);
    const rest = String(s).toUpperCase().replace(base, '').replace(/[^A-Z]/g, '');
    if (base && rest && isFxCode(rest)) return [base, rest];
  }
  return null;
}

/**
 * @param {object} props
 * @param {string} [symbol]   asset ticker/pair, e.g. "CAD/USD", "BTC", "XAU/USD"
 * @param {string} [category] asset category ("Forex", "Commodities", "Stocks", …)
 * @param {number} [size]     icon box size in px (default 42)
 */
export default function MarketIcon({ symbol, category, size = 42 }) {
  const [failed, setFailed] = useState(false);

  const sym = String(symbol ?? '').trim().toUpperCase();
  const cat = String(category ?? '').toLowerCase();
  const base = baseSymbol(sym);

  /* Reset the failed flag when the symbol changes (rows get recycled). */
  useEffect(() => setFailed(false), [base]);

  const radius = Math.round(size * 0.3);

  /* ── 1. Forex pair → two country flags ─────────────────────────────── */
  const legs = fxLegs(sym, cat);
  if (legs) {
    const supported = flagSupported();
    const d = Math.round(size * 0.66);
    return (
      <span style={{ position: 'relative', display: 'block', width: size, height: size, flex: `0 0 ${size}px` }} aria-hidden="true">
        {legs.map((code, i) => {
          const cc = ccFor(code);
          const label = supported ? flagEmoji(cc) : flagFallback(cc);
          const inset = Math.round(size * 0.06);
          const pos = i === 0
            ? { top: inset, left: inset }
            : { bottom: inset, right: inset };
          return (
            <span
              key={code}
              style={{
                position: 'absolute',
                ...pos,
                width: d,
                height: d,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                background: '#fff',
                border: '1px solid rgba(15,23,42,0.12)',
                boxShadow: i === 0
                  ? '0 2px 6px rgba(0,0,0,0.20)'
                  : '0 2px 6px rgba(0,0,0,0.28), inset 0 0 0 2px rgba(255,255,255,0.22)',
                fontSize: Math.round(d * 0.52),
                lineHeight: 1,
              }}
            >
              {label}
            </span>
          );
        })}
      </span>
    );
  }

  /* ── 2. Metal / commodity → metallic coin ───────────────────────────── */
  const metal = METALS[base] || METALS[sym];
  if (metal || cat.includes('commod') || cat.includes('metal')) {
    const m = metal || { mark: base.slice(0, 3), label: base, bg: 'linear-gradient(140deg, #7a7f8a 0%, #4a4e58 55%, #2a2d34 100%)', fg: '#f2f4f8' };
    return (
      <span
        style={{
          width: size, height: size, flex: `0 0 ${size}px`, borderRadius: radius,
          background: m.bg, color: m.fg, display: 'grid', placeItems: 'center',
          fontWeight: 900, fontFamily: 'var(--font-mono)', fontSize: Math.round(size * 0.26),
          letterSpacing: 0.4, lineHeight: 1, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14), 0 3px 10px rgba(0,0,0,0.18)',
        }}
        aria-hidden="true"
      >
        {m.mark}
      </span>
    );
  }

  /* ── 3. Index → candle/line glyph ────────────────────────────────────── */
  if (cat.includes('indice') || cat.includes('index')) {
    return (
      <span
        style={{
          width: size, height: size, flex: `0 0 ${size}px`, borderRadius: radius,
          background: 'linear-gradient(140deg, rgba(0,229,255,0.22), rgba(124,77,255,0.22))',
          display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)',
        }}
        aria-hidden="true"
      >
        <svg width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> 
          <path d="M4 17l4-5 3 3 5-7 4 4" />
          <path d="M16 5h4v4" />
        </svg>
      </span>
    );
  }

  /* ── 4. ETF / fund → fund glyph ─────────────────────────────────────── */
  if (cat.includes('etf') || cat.includes('fund')) {
    return (
      <span
        style={{
          width: size, height: size, flex: `0 0 ${size}px`, borderRadius: radius,
          background: 'linear-gradient(140deg, rgba(0,229,255,0.26), rgba(16,185,129,0.16))',
          display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)',
          color: 'var(--text-1)', fontWeight: 900, fontFamily: 'var(--font-mono)', fontSize: Math.round(size * 0.22),
        }}
        aria-hidden="true"
      >
        ETF
      </span>
    );
  }

  /* ── 5. Stock → real company logo (Parqet), then monogram ───────────── */
  if ((cat.includes('stock') || cat.includes('equit')) && /^[A-Z0-9.-]{1,12}$/.test(base) && !failed) {
    const src = tickerLogo(base);
    if (src) {
      return (
        <span style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: radius, overflow: 'hidden', background: 'linear-gradient(145deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02))', display: 'grid', placeItems: 'center' }} aria-hidden="true">
          <img
            src={src}
            alt=""
            width={size}
            height={size}
            style={{ width: size, height: size, objectFit: 'cover' }}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        </span>
      );
    }
  }

  /* ── 6. Crypto native coin → real logo, then coin monogram ───────────── */
  if (!failed && (cat.includes('crypto') || NATIVE_LOGO[base] || STABLECOIN[base] || STABLECOIN[sym])) {
    const stable = STABLECOIN[base] || STABLECOIN[sym];
    const native = NATIVE_LOGO[base];
    if (stable) {
      return (
        <span
          style={{
            width: size, height: size, flex: `0 0 ${size}px`, borderRadius: '50%',
            background: stable.bg, color: stable.fg, display: 'grid', placeItems: 'center',
            fontWeight: 900, fontFamily: 'var(--font-mono)', fontSize: Math.round(size * 0.5),
            lineHeight: 1, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16), 0 3px 10px rgba(0,0,0,0.18)',
          }}
          aria-hidden="true"
        >
          {stable.mark}
        </span>
      );
    }
    if (native) {
      return (
        <span style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: '50%', overflow: 'hidden', display: 'grid', placeItems: 'center' }} aria-hidden="true">
          <img
            src={native}
            alt=""
            width={size}
            height={size}
            style={{ width: size, height: size, objectFit: 'cover' }}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        </span>
      );
    }
  }

  return <CoinMonogram symbol={sym || base} size={size} />;
}

/** The universal fallback: same deterministic colour on every screen. */
function CoinMonogram({ symbol, size }) {
  const hue = hueFor(symbol || '?');
  const text = String(symbol || '?').slice(0, 3);
  return (
    <span
      style={{
        width: size, height: size, flex: `0 0 ${size}px`, borderRadius: Math.round(size * 0.3),
        background: `linear-gradient(140deg, hsl(${hue} 70% 46%), hsl(${(hue + 42) % 360} 68% 36%))`,
        color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900,
        fontFamily: 'var(--font-mono)', fontSize: Math.round(size * 0.26), letterSpacing: 0.3, lineHeight: 1,
      }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

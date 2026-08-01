import { useMemo, useState } from 'react';

/**
 * TOKEN ICONS.
 *
 * ─── THE BUG ────────────────────────────────────────────────────────────────
 * The swap token list rendered `tk.logoURI` when present and the first three
 * letters of the symbol otherwise. Not one of the ~46 built-in tokens in
 * lib/chains.js has a `logoURI` — the field only exists on tokens a user
 * imports by address. So every stock token showed bare text, and any imported
 * token whose image 404'd hit `onError` which set `display:none`, leaving an
 * empty circle: worse than the letters, because it reads as broken rather than
 * as a placeholder.
 *
 * ─── HOW ICONS ARE RESOLVED NOW ─────────────────────────────────────────────
 * Three sources, tried in order, then a coloured monogram that always renders:
 *
 *   1. `logoURI` — whatever the token list or the user's import supplied.
 *   2. TrustWallet's asset repository, keyed by CHAIN + CONTRACT ADDRESS. This
 *      is the standard set most wallets use, it is served from a CDN, and it
 *      needs no API key.
 *   3. CoinGecko's own image, keyed by the `coingeckoId` we already store for
 *      pricing.
 *
 * Why address-keyed rather than symbol-keyed: symbols are not unique and are
 * trivially spoofed. A scam token can call itself "USDT"; it cannot occupy
 * Tether's contract address. Resolving by symbol would let a fake token borrow
 * the real one's logo, which is the single most effective way to make a
 * phishing token look legitimate — so it is deliberately not done.
 *
 * ─── WHY THE FALLBACK IS DETERMINISTIC ──────────────────────────────────────
 * The monogram colour is derived from the symbol, so the same token always
 * gets the same colour on every screen and every launch. A colour that changed
 * between renders would make the list feel unstable and would stop users
 * recognising a token at a glance.
 */

/** TrustWallet's per-chain directory names. */
const TW_CHAIN = {
  1: 'ethereum',
  56: 'smartchain',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  43114: 'avalanchec'
};

/** Native coins have no contract address, so they are keyed by chain. */
const NATIVE_LOGO = {
  1: 'https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png',
  56: 'https://assets-cdn.trustwallet.com/blockchains/smartchain/info/logo.png',
  137: 'https://assets-cdn.trustwallet.com/blockchains/polygon/info/logo.png',
  42161: 'https://assets-cdn.trustwallet.com/blockchains/arbitrum/info/logo.png',
  10: 'https://assets-cdn.trustwallet.com/blockchains/optimism/info/logo.png',
  8453: 'https://assets-cdn.trustwallet.com/blockchains/base/info/logo.png',
  43114: 'https://assets-cdn.trustwallet.com/blockchains/avalanchec/info/logo.png'
};

/**
 * Ordered list of candidate URLs for a token.
 * Only https, because these are rendered as <img src> and a data: or
 * javascript: URL from an imported token list must never reach the DOM.
 */
export function iconCandidates(token, chainId) {
  if (!token) return [];
  const out = [];

  const supplied = String(token.logoURI ?? '').trim();
  if (supplied.startsWith('https://')) out.push(supplied);

  if (token.native || !token.address) {
    const n = NATIVE_LOGO[Number(chainId)];
    if (n) {
      out.push(n, n.replace(
        'https://assets-cdn.trustwallet.com/',
        'https://raw.githubusercontent.com/trustwallet/assets/master/'
      ));
    }
  } else {
    const dir = TW_CHAIN[Number(chainId)];
    if (dir && /^0x[a-fA-F0-9]{40}$/.test(token.address)) {
      /*
       * TrustWallet keys by EIP-55 checksummed address. We store mixed case
       * already, so pass it through unchanged — lowercasing produces a 404.
       */
      /*
       * Two hosts for the same file. assets-cdn is the fast CDN; the raw
       * GitHub path is the canonical source documented in the assets repo and
       * is the one guaranteed to exist. Trying both means a CDN change cannot
       * blank every icon at once.
       */
      out.push(
        `https://assets-cdn.trustwallet.com/blockchains/${dir}/assets/${token.address}/logo.png`,
        `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${dir}/assets/${token.address}/logo.png`
      );
    }
  }

  if (token.coingeckoId) {
    out.push(`https://assets.coingecko.com/coins/images/thumb/${token.coingeckoId}.png`);
  }

  return out;
}

/** Stable colour from a symbol — same token, same colour, always. */
function hueFor(symbol) {
  const s = String(symbol ?? '?');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/**
 * A token icon that always renders something.
 *
 * Walks the candidate list on each error rather than hiding the image, so a
 * dead CDN degrades to the next source and finally to a readable monogram —
 * never to an empty circle.
 */
export default function TokenIcon({ token, chainId, size = 34 }) {
  const candidates = useMemo(() => iconCandidates(token, chainId), [token, chainId]);
  const [idx, setIdx] = useState(0);

  const symbol = String(token?.symbol ?? '?');
  const src = candidates[idx];

  if (!src) {
    const hue = hueFor(symbol);
    return (
      <span
        className="tok-icon tok-icon-text"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(140deg, hsl(${hue} 70% 42%), hsl(${(hue + 40) % 360} 70% 32%))`
        }}
        aria-hidden="true"
      >
        {symbol.slice(0, 3)}
      </span>
    );
  }

  return (
    <span className="tok-icon" style={{ width: size, height: size }}>
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        /* The icon host does not need to learn which tokens our users browse. */
        referrerPolicy="no-referrer"
        onError={() => setIdx((i) => i + 1)}
      />
    </span>
  );
}

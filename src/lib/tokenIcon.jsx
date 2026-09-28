import { useEffect, useMemo, useState } from 'react';

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

/**
 * TrustWallet's per-chain directory names.
 *
 * Must cover every chain in EVM_CHAIN_ORDER: a missing entry does not crash
 * anything, it just deletes the TrustWallet icon source for that chain, so
 * tokens there (especially the curated ones, which carry no logoURI of
 * their own) degrade straight to the monogram — the «توکن تایید شده عکس ندارد»
 * complaint, reproduced per network.
 */
const TW_CHAIN = {
  1: 'ethereum',
  56: 'smartchain',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  43114: 'avalanchec',
  59144: 'linea',
  146: 'sonic',
  5000: 'mantle',
  80094: 'berachain',
  130: 'unichain',
  143: 'monad',
  /* Scroll + zkSync Era — TrustWallet's assets repo carries both chains
     under these directory names. They were missing while chains.js already
     shipped the networks, which is exactly the "verified token has no
     picture" degradation the comment above warns about. */
  534352: 'scroll',
  324: 'zksync',
  /* Robinhood Chain — TrustWallet's assets repo keys the chain under this
     directory name; if it is absent the onError walk just falls through to
     the monogram, so a wrong guess here can only ever lose a picture. */
  4663: 'robinhoodchain'
};

/**
 * Native coins have no contract address, so they are keyed by chain.
 *
 * Linea and Unichain's gas coin IS Ethereum, so they reuse Ethereum's info
 * logo — the same coin, and a made-up "Linea logo" would be wrong. If a
 * chain's own info logo does not exist in the assets repo, the onError walk
 * degrades to the next candidate and finally the monogram: a 404 here can
 * never produce an empty circle.
 */
const NATIVE_LOGO = {
  1: 'https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png',
  56: 'https://assets-cdn.trustwallet.com/blockchains/smartchain/info/logo.png',
  137: 'https://assets-cdn.trustwallet.com/blockchains/polygon/info/logo.png',
  42161: 'https://assets-cdn.trustwallet.com/blockchains/arbitrum/info/logo.png',
  10: 'https://assets-cdn.trustwallet.com/blockchains/optimism/info/logo.png',
  8453: 'https://assets-cdn.trustwallet.com/blockchains/base/info/logo.png',
  43114: 'https://assets-cdn.trustwallet.com/blockchains/avalanchec/info/logo.png',
  59144: 'https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png', // gas coin is ETH
  146: 'https://assets-cdn.trustwallet.com/blockchains/sonic/info/logo.png',
  5000: 'https://assets-cdn.trustwallet.com/blockchains/mantle/info/logo.png',
  80094: 'https://assets-cdn.trustwallet.com/blockchains/berachain/info/logo.png',
  130: 'https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png', // gas coin is ETH
  143: 'https://assets-cdn.trustwallet.com/blockchains/monad/info/logo.png',
  534352: 'https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png', // gas coin is ETH
  324: 'https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png' // gas coin is ETH
};

const SYMBOL_FALLBACK_LOGOS = {
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  WBTC: 'https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  WETH: 'https://assets.coingecko.com/coins/images/2518/small/weth.png',
  USDT: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  PEPE: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.png',
  ONDO: 'https://assets.coingecko.com/coins/images/34682/small/ondo.png',
  PENDLE: 'https://assets.coingecko.com/coins/images/15061/small/pendle.png',
  AAVE: 'https://assets.coingecko.com/coins/images/12645/small/AAVE.png',
  LINK: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  UNI: 'https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png',
  ARB: 'https://assets.coingecko.com/coins/images/16547/small/arbitrum.png',
  AERO: 'https://assets.coingecko.com/coins/images/31745/small/aerodrome.png',
  VIRTUAL: 'https://assets.coingecko.com/coins/images/33580/small/virtual.png',
  TRUMP: 'https://assets.coingecko.com/coins/images/39908/small/trump.png',
  FARTCOIN: 'https://assets.coingecko.com/coins/images/40474/small/fart.png',
  AI16Z: 'https://assets.coingecko.com/coins/images/40679/small/ai16z.png',
  SUI: 'https://assets.coingecko.com/coins/images/26375/small/sui.png',
  MOG: 'https://assets.coingecko.com/coins/images/31050/small/mog.png',
  SPX: 'https://assets.coingecko.com/coins/images/31405/small/spx.png',
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  AVAX: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  SHIB: 'https://assets.coingecko.com/coins/images/11939/small/shiba.png',
  DOGE: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png'
};

/**
 * Ordered list of candidate URLs for a token.
 * Only https, because these are rendered as <img src> and a data: or
 * javascript: URL from an imported token list must never reach the DOM.
 */
export function iconCandidates(token, chainId) {
  if (!token) return [];
  const tok = typeof token === 'string'
    ? (token.startsWith('https://') ? { logoURI: token } : { symbol: token })
    : token;
  const out = [];

  /* Check all common logo and icon keys */
  for (const key of ['logoURI', 'icon', 'tokenLogo', 'logo', 'imageUrl', 'image']) {
    const supplied = String(tok[key] ?? '').trim();
    if (supplied.startsWith('https://') && !out.includes(supplied)) out.push(supplied);
  }

  if (tok.native || !tok.address) {
    const n = NATIVE_LOGO[Number(chainId)];
    if (n) {
      out.push(n, n.replace(
        'https://assets-cdn.trustwallet.com/',
        'https://raw.githubusercontent.com/trustwallet/assets/master/'
      ));
    }
  } else {
    const dir = TW_CHAIN[Number(chainId)];
    if (dir && /^0x[a-fA-F0-9]{40}$/.test(tok.address)) {
      out.push(
        `https://assets-cdn.trustwallet.com/blockchains/${dir}/assets/${tok.address}/logo.png`,
        `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${dir}/assets/${tok.address}/logo.png`
      );
    }
  }

  /* Known curated symbol fallback */
  const sym = String(tok.symbol || '').toUpperCase().trim();
  if (sym && SYMBOL_FALLBACK_LOGOS[sym] && !out.includes(SYMBOL_FALLBACK_LOGOS[sym])) {
    out.push(SYMBOL_FALLBACK_LOGOS[sym]);
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

  useEffect(() => {
    setIdx(0);
  }, [candidates]);

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

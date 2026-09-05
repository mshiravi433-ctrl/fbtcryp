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
  143: 'monad'
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
  143: 'https://assets-cdn.trustwallet.com/blockchains/monad/info/logo.png'
};

/**
 * Ordered list of candidate URLs for a token.
 * Only https, because these are rendered as <img src> and a data: or
 * javascript: URL from an imported token list must never reach the DOM.
 */
export function iconCandidates(token, chainId) {
  if (!token) return [];
  const out = [];

  /*
   * `icon` as well as `logoURI`.
   *
   * Jupiter's token API calls the field `icon`, while EVM token lists call it
   * `logoURI`. The curated Solana assets carry the former, so reading only
   * `logoURI` meant every tokenized equity and staking token fell through to
   * the monogram — the exact bug this module was written to kill, reappearing
   * because a second data source spells the field differently.
   */
  for (const key of ['logoURI', 'icon']) {
    const supplied = String(token[key] ?? '').trim();
    if (supplied.startsWith('https://') && !out.includes(supplied)) out.push(supplied);
  }

  /*
   * NO EXTRA SOURCE FOR SOLANA MINTS, DELIBERATELY.
   *
   * The EVM path can add TrustWallet and CoinGecko because both are keyed by
   * contract address, so a clone cannot borrow the real token's artwork. The
   * equivalent Solana CDNs I could find are either symbol-keyed — which is
   * exactly how a fake AAPLx would inherit Apple's logo — or unverifiable from
   * here.
   *
   * So a Solana token gets the issuer's own `icon` and then the monogram. A
   * missing picture is a cosmetic problem; a fake token wearing the real one's
   * face is a financial one, and this app has already documented that trade-off
   * once for EVM symbols. Same answer here.
   */

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

  /*
   * NO CoinGecko GUESS HERE, ON PURPOSE.
   *
   * This used to push
   *   `https://assets.coingecko.com/coins/images/thumb/${token.coingeckoId}.png`
   * — but CoinGecko's image URLs are
   *   `/coins/images/<numeric-id>/<size>/<file>.png`,
   * and neither the numeric id nor the filename can be derived from the
   * `coingeckoId` string ("tether" is image 325, file "tether.png"; "usd-coin"
   * is image 2791, file "usdc.png"). The guessed URL 404'd for EVERY token,
   * burning a network round trip before the monogram could render.
   *
   * Real CoinGecko artwork still reaches icons the honest way: the token
   * lists (lib/tokenLists.js) carry a `logoURI` per entry, and that artwork
   * is now inherited onto curated entries that share the same verified
   * address — see merge() there.
   */

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

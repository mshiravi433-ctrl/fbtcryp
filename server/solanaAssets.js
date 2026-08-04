/**
 * LIVE DATA FOR THE CURATED SOLANA ASSETS.
 * ---------------------------------------------------------------------------
 * The list of mints lives in `src/lib/solanaAssets.js` and is shared with the
 * client. This module fetches what changes — price, liquidity, 24h move — and
 * re-verifies the issuer authority on every refresh.
 *
 * ─── WHY THE ISSUER CHECK RUNS ON THE SERVER, EVERY TIME ────────────────────
 * The hard-coded mint list is only as trustworthy as the moment it was typed,
 * and one of the six addresses in it WAS wrong on first write — a plausible
 * base58 string sharing a 20-character prefix with the real Nasdaq mint that
 * resolved to nothing at all. It was caught by querying the API rather than by
 * re-reading the file.
 *
 * So the authority is checked against live data on every fetch. An asset whose
 * issuer does not match is dropped from the response entirely. That fails
 * CLOSED: a bad address makes a row disappear, rather than quietly offering a
 * stranger's token under Apple's name.
 *
 * ─── WHY NOT JUST TRUST `isVerified` ────────────────────────────────────────
 * Jupiter's own flag is useful and not sufficient. It is a curation signal
 * about the token, not proof of who issued it, and the whole risk here is a
 * convincing impersonation. Matching the issuer's mint authority is the one
 * check a clone cannot pass, because passing it requires the issuer's key.
 */

import { EQUITY_ASSETS, LST_ASSETS, XSTOCK_FREEZE_AUTHORITY, XSTOCK_MINT_AUTHORITY } from '../src/lib/solanaAssets.js';

const JUP_TOKENS = 'https://lite-api.jup.ag/tokens/v2/search';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0' }
    });
    if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Does this live record really come from the issuer we expect?
 *
 * Exported so the tests can drive it with synthetic records — including the
 * real shape of a real fake, which is the case that matters.
 */
export function issuerMatches(live, asset, isEquity) {
  if (!live || !asset) return false;
  if (live.id !== asset.mint) return false;

  if (isEquity) {
    /*
     * The check the clones cannot pass. Every fake xStock carries
     * `mintAuthorityDisabled: true` — they minted a fixed supply and threw the
     * key away, because they never had the issuer's key to begin with.
     */
    if (live.mintAuthority !== XSTOCK_MINT_AUTHORITY) return false;
    if (live.freezeAuthority !== XSTOCK_FREEZE_AUTHORITY) return false;
    return true;
  }

  /*
   * LSTs have no shared issuer, so the available signals are weaker: Jupiter's
   * verification flag and the `lst` tag it applies. Stated plainly rather than
   * dressed up — this is a weaker guarantee than the equity check above.
   */
  return live.isVerified === true;
}

/** Normalise one live record. Everything rounded; raw feeds carry false precision. */
function shape(live, asset, kind) {
  return {
    id: asset.id,
    mint: asset.mint,
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    kind,
    icon: live.icon ?? null,
    usdPrice: Number(live.usdPrice) || null,
    /*
     * Liquidity is the number that decides whether a trade is safe, so it is
     * passed through to the client rather than being turned into a boolean
     * here. The client shows it AND gates on it.
     */
    liquidity: Math.round(Number(live.liquidity) || 0),
    holders: Number(live.holderCount) || 0,
    change24h: Number(live.stats24h?.priceChange) || 0,
    /* Present only for equities; the UI keys its freeze warning off this. */
    freezeAuthority: kind === 'equity' ? live.freezeAuthority ?? null : null,
    ...(asset.llamaProject ? { llamaProject: asset.llamaProject, llamaSymbol: asset.llamaSymbol } : {}),
    ...(asset.protocolFeePct != null ? { protocolFeePct: asset.protocolFeePct } : {}),
    ...(asset.capturesMev != null ? { capturesMev: asset.capturesMev } : {})
  };
}

/**
 * Fetch live data for every curated asset.
 *
 * One request per mint. That sounds wasteful and is not: there are eight of
 * them, the whole thing is cached for five minutes server-side, and the
 * alternative (Jupiter's bulk search by symbol) is what returns the seven
 * fake AAPLx tokens we are specifically avoiding. Querying BY MINT ADDRESS is
 * what makes impersonation impossible at the fetch step.
 */
export async function fetchSolanaAssets() {
  const jobs = [
    ...LST_ASSETS.map((a) => ({ asset: a, kind: 'lst' })),
    ...EQUITY_ASSETS.map((a) => ({ asset: a, kind: 'equity' }))
  ];

  const rows = await Promise.all(
    jobs.map(async ({ asset, kind }) => {
      try {
        const list = await fetchJson(`${JUP_TOKENS}?query=${encodeURIComponent(asset.mint)}`);
        const live = Array.isArray(list) ? list.find((r) => r.id === asset.mint) : null;
        if (!live) return { asset, kind, ok: false, why: 'notFound' };
        if (!issuerMatches(live, asset, kind === 'equity')) {
          return { asset, kind, ok: false, why: 'issuerMismatch' };
        }
        return { asset, kind, ok: true, row: shape(live, asset, kind) };
      } catch {
        /* One unreachable mint must not take down the whole screen. */
        return { asset, kind, ok: false, why: 'fetchFailed' };
      }
    })
  );

  const good = rows.filter((r) => r.ok);

  return {
    lst: good.filter((r) => r.kind === 'lst').map((r) => r.row),
    equities: good.filter((r) => r.kind === 'equity').map((r) => r.row),
    /*
     * Reported so a silent failure is visible. If an address goes stale or an
     * issuer rotates its authority, the row vanishes from the UI — and this
     * field is how anyone finds out WHY instead of assuming the API broke.
     */
    rejected: rows.filter((r) => !r.ok).map((r) => ({ symbol: r.asset.symbol, why: r.why })),
    at: Date.now()
  };
}

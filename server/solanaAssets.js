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

import { COMMODITY_ASSETS, EQUITY_ASSETS, LST_ASSETS, XSTOCK_FREEZE_AUTHORITY, XSTOCK_MINT_AUTHORITY } from '../src/lib/solanaAssets.js';
import { jupiterTokenHeaders, jupiterTokenUrl } from './jupiterTokenApi.js';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);

/*
 * ─── ONE REQUEST, NOT ONE PER MINT ──────────────────────────────────────────
 * Jupiter's search endpoint takes a comma-separated list of MINT ADDRESSES —
 * "Comma-separate to ONLY search for multiple mint addresses / limit to 100
 * mint addresses in query" (Tokens API reference, get /search). So the whole
 * curated list fits in a single upstream call.
 *
 * This module used to issue ONE REQUEST PER MINT: 26 upstream calls per
 * refresh, and the curated list has only ever grown — every ticker added made
 * the screen slower to load and the fan-out wider, on a route that is cached
 * for five minutes precisely because those calls are expensive. The safety
 * property is unchanged, and that is the point of the query form: the request
 * still names exact mint addresses. Jupiter is never asked "find me AAPLx"
 * (which returns six clones); it is told which addresses we already trust.
 *
 * 100 is Jupiter's documented ceiling for the list, so it is chunked rather
 * than assumed: a curated list longer than 100 keeps working.
 */
const MAX_MINTS_PER_REQUEST = 100;

/** Split mint addresses into request-sized chunks. Exported for the tests. */
export function mintBatches(mints, size = MAX_MINTS_PER_REQUEST) {
  const list = [...new Set((mints ?? []).filter(Boolean))];
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: jupiterTokenHeaders()
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
export function issuerMatches(live, asset, kind) {
  if (!live || !asset) return false;
  if (live.id !== asset.mint) return false;

  /*
   * Commodities carry their own per-asset authorities: Paxos and Tether are
   * different companies, so there is no shared issuer key to match against.
   * The property being checked is the same one — a clone cannot hold the
   * issuer's key, and "PAX Gold Punk" cannot forge Paxos's mint authority.
   */
  if (kind === 'commodity') {
    if (!asset.mintAuthority || !asset.freezeAuthority) return false;
    if (live.mintAuthority !== asset.mintAuthority) return false;
    if (live.freezeAuthority !== asset.freezeAuthority) return false;
    return true;
  }

  if (kind === 'equity') {
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

/** Preserve a genuinely reported finite value; absent data is not zero. */
function finiteOrNull(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
    change24h: finiteOrNull(live.stats24h?.priceChange),
    /*
     * Keep the curated asset classification. `kind` above tells the client
     * that this is an equity token; `assetKind` distinguishes a company from
     * an index so the intelligence screen never calls Nasdaq 100 a company.
     */
    ...(kind === 'equity' && asset.kind ? { assetKind: asset.kind } : {}),
    ...(asset.privateCompany ? { privateCompany: true } : {}),
    /*
     * Present for equities AND commodities; the UI keys its freeze warning off
     * this. Gold carries exactly the same risk — Tether has frozen over $5bn
     * across roughly 10,000 wallets under this same authority.
     */
    freezeAuthority: kind === 'lst' ? null : live.freezeAuthority ?? null,
    /*
     * The CoinGecko id the Stocks screen uses to pull a REAL 90-day price
     * series for the analysis panel on each row. Passed through rather than
     * re-derived on the client, because the curated entry is the only place
     * that knows it — and an id invented anywhere else would be a fabricated
     * history presented as a measured one. Absent when CoinGecko does not list
     * the ticker, which is the signal the panel reads to say so honestly.
     */
    ...(asset.coingeckoId ? { coingeckoId: asset.coingeckoId } : {}),
    ...(asset.unit ? { unit: asset.unit } : {}),
    ...(asset.llamaProject ? { llamaProject: asset.llamaProject, llamaSymbol: asset.llamaSymbol } : {}),
    ...(asset.protocolFeePct != null ? { protocolFeePct: asset.protocolFeePct } : {}),
    ...(asset.capturesMev != null ? { capturesMev: asset.capturesMev } : {})
  };
}

/**
 * Fetch live records for a list of mint addresses, in as few requests as
 * Jupiter allows.
 *
 * Returns the records keyed by mint, plus the set of mints whose request
 * FAILED — the two are different states and the caller reports them
 * differently: a mint missing from a successful response is not the same thing
 * as a mint we could not ask about, and collapsing them would hide an outage
 * behind the "notFound" label.
 */
async function fetchTokenRecords(mints) {
  const found = new Map();
  const failed = new Set();

  await Promise.all(
    mintBatches(mints).map(async (batch) => {
      const url = jupiterTokenUrl('search', { query: batch.join(',') });
      try {
        let list;
        try {
          list = await fetchJson(url);
        } catch {
          /* One retry. A batch is now the whole screen: a single dropped
             connection used to cost one row, and would now cost every row
             at once. */
          list = await fetchJson(url);
        }
        for (const record of Array.isArray(list) ? list : []) {
          if (record?.id) found.set(record.id, record);
        }
      } catch {
        for (const mint of batch) failed.add(mint);
      }
    })
  );

  return { found, failed };
}

/**
 * Fetch live data for every curated asset.
 *
 * Batched by mint address — see MAX_MINTS_PER_REQUEST above for why that is
 * both cheaper AND still impersonation-proof. The issuer check then runs per
 * asset exactly as before, so a mint that resolves to something unexpected
 * still disappears rather than being rendered.
 */
export async function fetchSolanaAssets() {
  const jobs = [
    ...LST_ASSETS.map((a) => ({ asset: a, kind: 'lst' })),
    ...EQUITY_ASSETS.map((a) => ({ asset: a, kind: 'equity' })),
    ...COMMODITY_ASSETS.map((a) => ({ asset: a, kind: 'commodity' }))
  ];

  const { found, failed } = await fetchTokenRecords(jobs.map((j) => j.asset.mint));

  const rows = jobs.map(({ asset, kind }) => {
    if (failed.has(asset.mint)) return { asset, kind, ok: false, why: 'fetchFailed' };
    const live = found.get(asset.mint);
    if (!live) return { asset, kind, ok: false, why: 'notFound' };
    if (!issuerMatches(live, asset, kind)) {
      return { asset, kind, ok: false, why: 'issuerMismatch' };
    }
    return { asset, kind, ok: true, row: shape(live, asset, kind) };
  });

  const good = rows.filter((r) => r.ok);

  return {
    lst: good.filter((r) => r.kind === 'lst').map((r) => r.row),
    equities: good.filter((r) => r.kind === 'equity').map((r) => r.row),
    commodities: good.filter((r) => r.kind === 'commodity').map((r) => r.row),
    /*
     * Reported so a silent failure is visible. If an address goes stale or an
     * issuer rotates its authority, the row vanishes from the UI — and this
     * field is how anyone finds out WHY instead of assuming the API broke.
     */
    rejected: rows.filter((r) => !r.ok).map((r) => ({ symbol: r.asset.symbol, why: r.why })),
    at: Date.now()
  };
}

/**
 * PORTFOLIO SNAPSHOT
 * ---------------------------------------------------------------------------
 * The last portfolio read we actually verified, kept on the device so the NEXT
 * document can show it.
 *
 * ─── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * Two reports, one cause:
 *
 *   • «موجودی را بخاد نمایش بده خیلی طول میکشه» — the Wallet page reads the
 *     connected address across sixteen chains, one `eth_getBalance` and one
 *     `balanceOf` per token per chain. Even in parallel that is a network
 *     round trip, and a cold document has nothing else to paint in the
 *     meantime, so the hero sat behind a shimmer for the whole of it.
 *   • «وقتی صفحه رفرش میشه اتصال از دست میره» — a reload is a new document,
 *     and a new document has no balances. The session re-attaches in the
 *     background (that is the lease in lib/wc/lease.js), but for the seconds
 *     it takes, the page shows a wallet with nothing in it.
 *
 * The snapshot answers both with the same record: the numbers the user was
 * looking at before the reload are on screen immediately, tagged as a previous
 * read, and replaced the moment the fresh cycle lands.
 *
 * ─── WHAT IT IS NOT ────────────────────────────────────────────────────────
 * Not a cache of truth. It is never used to answer "how much do I own" — it is
 * used to answer "what did we last see", and every consumer marks it stale.
 * No key, no seed, no signature, no private data: symbols, amounts and chain
 * ids, which the wallet page was already displaying on screen.
 *
 * Amounts are stored as NUMBERS, not as wei strings: the snapshot is a display
 * cache, and a BigInt would have to be serialised and re-parsed to be shown.
 * A number is imprecise past 15 significant digits, which is why nothing here
 * is ever used to build a transaction.
 */

const KEY = 'fbt-portfolio-snapshot-v1';
const VERSION = 1;

/** A snapshot older than this is not shown at all — it would be a lie. */
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Rows kept per chain and in total: the cache is for the first paint, not a database. */
export const SNAPSHOT_ROWS_PER_CHAIN = 20;
export const SNAPSHOT_ROWS_TOTAL = 160;

function storeOf(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

/**
 * Slim one chain's holdings down to what the first paint needs.
 *
 * Zero balances are dropped: a row the user has never held is noise in a cache
 * whose only job is to look like the screen they just left.
 */
export function slimChain(chain) {
  if (!chain || !Number.isFinite(Number(chain.chainId))) return null;
  const rows = [];
  for (const row of chain.rows ?? []) {
    const amount = num(row?.amount);
    if (amount == null || amount <= 0) continue;
    rows.push({
      key: String(row.key ?? `${chain.chainId}:${row.symbol ?? ''}:${row.address ?? 'native'}`),
      symbol: String(row.symbol ?? '').slice(0, 24),
      name: String(row.name ?? row.symbol ?? '').slice(0, 64),
      address: typeof row.address === 'string' ? row.address : null,
      decimals: Number.isFinite(Number(row.decimals)) ? Number(row.decimals) : 18,
      coingeckoId: typeof row.coingeckoId === 'string' ? row.coingeckoId : null,
      native: Boolean(row.native),
      chainId: Number(chain.chainId),
      amount
    });
    if (rows.length >= SNAPSHOT_ROWS_PER_CHAIN) break;
  }
  return {
    chainId: Number(chain.chainId),
    nativeAmount: num(chain.nativeAmount) ?? 0,
    error: null,
    rows
  };
}

/** The payload written for one address. Pure, so a test can assert it byte-for-byte. */
export function buildSnapshot({ address, chains = [], at = Date.now() } = {}) {
  if (!isAddress(address)) return null;
  const kept = [];
  for (const chain of chains) {
    const slim = slimChain(chain);
    if (!slim) continue;
    kept.push(slim);
    if (kept.reduce((n, c) => n + c.rows.length, 0) >= SNAPSHOT_ROWS_TOTAL) break;
  }
  return { v: VERSION, address: address.toLowerCase(), at, chains: kept };
}

/** Write the snapshot. Never throws — a blocked storage costs a faster repaint, nothing else. */
export function writePortfolioSnapshot({ address, chains, at = Date.now(), storage } = {}) {
  const payload = buildSnapshot({ address, chains, at });
  if (!payload) return false;
  const target = storeOf(storage);
  if (!target) return false;
  try {
    target.setItem(KEY, JSON.stringify(payload));
    return true;
  } catch {
    /* QuotaExceededError on a device in private mode: the snapshot is optional. */
    return false;
  }
}

/**
 * Read the snapshot for one address.
 *
 * Returns null for a different address, a corrupt record or one too old to
 * show: a balance from another account is worse than no balance at all.
 */
export function readPortfolioSnapshot(address, { storage, at = Date.now() } = {}) {
  if (!isAddress(address)) return null;
  const target = storeOf(storage);
  if (!target) return null;
  let parsed = null;
  try {
    const raw = target.getItem(KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.v !== VERSION) return null;
  if (String(parsed.address).toLowerCase() !== address.toLowerCase()) return null;
  const taken = Number(parsed.at);
  if (!Number.isFinite(taken) || taken <= 0) return null;
  if (at - taken > SNAPSHOT_MAX_AGE_MS) return null;
  if (!Array.isArray(parsed.chains)) return null;
  return { address: String(parsed.address).toLowerCase(), at: taken, chains: parsed.chains };
}

/** Forget it — used on disconnect and by the health panel's "clear data" paths. */
export function clearPortfolioSnapshot(storage) {
  const target = storeOf(storage);
  if (!target) return false;
  try {
    target.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

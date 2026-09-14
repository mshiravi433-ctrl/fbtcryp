/**
 * FBT LAUNCH — local launch history.
 *
 * NON-SENSITIVE-ONLY LAW (spec §23)
 * ---------------------------------------------------------------------------
 * The record set is a closed list. Anything not in `ALLOWED_FIELDS` is
 * dropped at the boundary — so a future caller cannot "accidentally" persist
 * a key, a seed, a password or a signing secret: the shape itself is the
 * policy. The same closed list is enforced server-side for the optional
 * public record endpoint (server/launch.js), so app and API agree.
 */

const KEY = 'fbt-launch-history-v1';
const CAP = 50;

export const ALLOWED_FIELDS = Object.freeze([
  'launchId',
  'creatorPublicAddress',
  'network',          // chainId number
  'networkName',
  'tokenAddress',
  'poolAddress',
  'tokenName',
  'symbol',
  'supply',
  'initialPrice',     // quote per token, human units
  'tokenLiquidity',
  'quoteLiquidity',
  'quoteSymbol',
  'provider',         // dex id (e.g. 'pancakeswap-v2')
  'status',           // LIVE / RETRYABLE / CANCELLED / FAILED / EXPIRED
  'riskScore',
  'txHashes',         // array of public transaction hashes
  'createdAt',
  'updatedAt'
]);

/** Strip any field outside the closed list. Pure, defensive, total. */
export function sanitizeRecord(record) {
  const src = record && typeof record === 'object' ? record : {};
  const out = {};
  for (const field of ALLOWED_FIELDS) {
    if (src[field] !== undefined) out[field] = src[field];
  }
  // Solana transactions are base58 signatures (64 bytes); Solana wallets
  // are base58 addresses (32 bytes). Either chain's shape is accepted, and
  // anything else is still dropped — the shape check stays exact per chain.
  const isEvmHash = (h) => /^0x[0-9a-fA-F]{64}$/.test(h);
  const isSolSig = (h) => /^[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(h);
  const isEvmAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
  const isSolAddr = (a) => /^[1-9A-HJ-NP-Za-km-z]{32,45}$/.test(a);
  if (out.txHashes != null) {
    out.txHashes = Array.isArray(out.txHashes)
      ? out.txHashes.filter((h) => typeof h === 'string' && (isEvmHash(h) || isSolSig(h)))
      : [];
  }
  // creatorPublicAddress is a PUBLIC address by definition; enforce the shape
  // so a malformed value can never masquerade as an identity.
  if (out.creatorPublicAddress && !isEvmAddr(out.creatorPublicAddress) && !isSolAddr(out.creatorPublicAddress)) {
    delete out.creatorPublicAddress;
  }
  return out;
}

function readAll() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
  } catch {
    /* storage full/blocked: history is a convenience, never a gate */
  }
}

export function listHistory() {
  return readAll();
}

/**
 * Record (or update) a launch. Returns the sanitized stored record.
 */
export function recordLaunch(record) {
  const clean = sanitizeRecord(record);
  if (!clean.launchId) clean.launchId = `launch-${Date.now().toString(36)}`;
  const list = readAll();
  const idx = list.findIndex((r) => r.launchId === clean.launchId);
  if (idx >= 0) list[idx] = { ...list[idx], ...clean };
  else list.unshift({ ...clean, createdAt: clean.createdAt || Date.now() });
  writeAll(list);
  return sanitizeRecord(idx >= 0 ? list[idx] : list[0]);
}

export function removeHistory(launchId) {
  const list = readAll().filter((r) => r.launchId !== launchId);
  writeAll(list);
  return list;
}

export function clearHistory() {
  writeAll([]);
}

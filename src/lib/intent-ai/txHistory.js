/**
 * FBT INTENT AI — LOCAL TRANSACTION HISTORY
 * ---------------------------------------------------------------------------
 * A phone's memory of what the Intent AI did, stored in EXACTLY ONE place:
 * localStorage under `fbt.intent.txHistory`.
 *
 *   · local-only by design — nothing in this file is ever sent to a server,
 *     and the server never holds keys or signs anything; the history records
 *     OUTCOMES (authorized / submitted / failed / queued...), never secrets
 *   · append-only from the product's point of view: one entry per decided
 *     receipt, newest first, capped so storage cannot grow without bound
 *   · honest statuses only: an entry is written when the pipeline produced a
 *     real receipt state (including `queued` for offline), never for a dry
 *     analysis turn and never with a fabricated `completed`
 *   · read-back is defensive: storage can hold anything (another build, a
 *     curious user in devtools), so every row is re-validated on load
 *
 * The Intent OS "History" tab and the Intent AI panel read the same rows
 * through these helpers, so the two surfaces can never disagree about what
 * happened.
 */

export const TX_HISTORY_KEY = 'fbt.intent.txHistory';
export const TX_HISTORY_SCHEMA = 'fbt.intent-tx-history.v1';
export const TX_HISTORY_MAX = 50;

/** Receipt statuses the history knows how to display. */
export const TX_HISTORY_STATUSES = Object.freeze([
  'completed', 'submitted', 'authorized', 'pending', 'partial',
  'failed', 'rejected', 'cancelled', 'blocked', 'reauthorize',
  'queued', 'unavailable'
]);

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* private mode / SSR */ }
  return null;
}

function id() {
  return `txh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const cleanStr = (v, max = 64) => (v == null ? null : String(v).slice(0, max));
const cleanNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Normalise an arbitrary row into a valid history entry, or null.
 * Deliberately strict about `status`: an unknown status string renders as a
 * raw key in the UI, so unknowns are collapsed to 'unavailable' (honest).
 */
function normalizeEntry(row) {
  if (!row || typeof row !== 'object') return null;
  const at = cleanNum(row.at);
  if (!at || at <= 0) return null;
  const status = TX_HISTORY_STATUSES.includes(row.status) ? row.status : 'unavailable';
  const amountUsd = cleanNum(row.amountUsd);
  const chainId = cleanNum(row.chainId);
  return {
    schema: TX_HISTORY_SCHEMA,
    id: cleanStr(row.id, 40) || id(),
    at,
    status,
    confirmed: row.confirmed === true,
    action: cleanStr(row.action, 24),
    fromSymbol: cleanStr(row.fromSymbol, 16),
    toSymbol: cleanStr(row.toSymbol, 16),
    amountUsd: amountUsd != null && amountUsd >= 0 ? amountUsd : null,
    chainId,
    txHash: /^0x[a-fA-F0-9]{64}$/.test(String(row.txHash || '')) ? String(row.txHash) : null,
    signerKind: cleanStr(row.signerKind, 24),
    reasonKey: cleanStr(row.reasonKey, 80),
    feeAmount: cleanNum(row.feeAmount),
    feeSymbol: cleanStr(row.feeSymbol, 12),
    source: cleanStr(row.source, 24) || 'intent-ai'
  };
}

/** Read every stored entry (newest first). Never throws. */
export function loadIntentTxHistory(storage = defaultStorage()) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(TX_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEntry).filter(Boolean).slice(0, TX_HISTORY_MAX);
  } catch {
    return [];
  }
}

/**
 * Append one receipt-shaped entry. Returns { ok, rows } — rows is the
 * resulting history (useful for immediate re-render). A malformed entry is
 * refused ({ ok: false }) rather than stored half-shaped.
 */
export function recordIntentTx(entry, storage = defaultStorage()) {
  const normalized = normalizeEntry({ ...entry, at: entry?.at ?? Date.now(), id: entry?.id || id() });
  if (!normalized) return { ok: false, rows: loadIntentTxHistory(storage) };
  const rows = [normalized, ...loadIntentTxHistory(storage)].slice(0, TX_HISTORY_MAX);
  if (storage) {
    try { storage.setItem(TX_HISTORY_KEY, JSON.stringify(rows)); } catch { /* quota — keep memory copy */ }
  }
  return { ok: true, rows };
}

/** Wipe the history (user control). Returns the now-empty list. */
export function clearIntentTxHistory(storage = defaultStorage()) {
  if (storage) {
    try { storage.removeItem(TX_HISTORY_KEY); } catch { /* private mode */ }
  }
  return [];
}

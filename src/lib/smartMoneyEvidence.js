/**
 * The only client/server promotion gate for Smart Money direction. Whale and
 * CEX transfer summaries remain useful context but NEVER pass this gate.
 * An empty/stale snapshot is unknown, not neutral and not $0.
 */
const WINDOWS = { '30m': 30 * 60_000, '1h': 3600_000, '4h': 4 * 3600_000,
  '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000, '30d': 30 * 24 * 3600_000 };
const finite = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));

/*
 * ── CHAIN-AWARE ROW IDENTITY (2026-10-26) ──────────────────────────────────
 * The silent trap this removes: every identity check below was EVM-shaped —
 * `finite(r.chain)` (Number('solana') is NaN), an 0x-token regex, and
 * `Number(r.chain) === Number(chain)` with a lowercased address compare. On
 * the day Solana verified promotion is switched on (replay coverage is
 * still 7/12, so that day is NOT today and this file does not switch it),
 * the server would emit `{ chain: 'solana', token: <base58 mint> }` rows and
 * this gate would have discarded every one of them without a word —
 * «insufficient evidence» forever, for a formatting reason.
 *
 * The fix is identity only, mirroring the server's own
 * `validTokenForChain` (server/smartMoney/consensus.js): a Solana row must
 * carry a base58 mint, an EVM row the exact checks it always carried. EVERY
 * eligibility threshold — ≥75 evidence, ≥3 swaps, ≥3 independent votes and
 * buyers/sellers, direction-of-net vs signal, freshness — is untouched, and
 * for any EVM row or EVM query the results are bit-identical to before.
 * Base58 mints are case-SENSITIVE: Solana addresses are compared as exact
 * strings, never via Number() and never lowercased.
 */
const EVM_TOKEN = /^0x[a-fA-F0-9]{40}$/;
const SOL_TOKEN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isSolanaChain = (c) => String(c ?? '').toLowerCase() === 'solana';
const validRowIdentity = (r) => (isSolanaChain(r.chain)
  ? SOL_TOKEN.test(String(r.token || ''))
  : EVM_TOKEN.test(r.token || '') && finite(r.chain));

export function verifiedSignals(payload, { now = Date.now(), window = null } = {}) {
  const snapshot = payload?.verified || payload;
  const win = window || snapshot?.window || payload?.window || '24h';
  const span = WINDOWS[win] || WINDOWS['24h'];
  if (snapshot?.dataStatus !== 'observed' || !finite(snapshot.indexedAt)
    || snapshot.indexedAt > now || now - snapshot.indexedAt > 36 * 3600_000) {
    return { rows: [], netFlowUsd: null, dataStatus: 'insufficient-evidence' };
  }
  const rows = (Array.isArray(snapshot.consensus) ? snapshot.consensus : []).filter((r) => {
    if (!r || !validRowIdentity(r) || !finite(r.confidence)
      || r.confidence < 75 || !finite(r.swaps) || r.swaps < 3 || !finite(r.independentVotes)
      || r.independentVotes < 3 || !finite(r.netFlowUsd) || !finite(r.lastAt)
      || r.lastAt > now || r.lastAt < now - span) return false;
    if (r.signal === 'ACCUMULATION') return finite(r.independentBuyers) && r.independentBuyers >= 3 && r.netFlowUsd > 0;
    if (r.signal === 'DISTRIBUTION') return finite(r.independentSellers) && r.independentSellers >= 3 && r.netFlowUsd < 0;
    return false;
  });
  // Opposite directions across different assets do not make a meaningful
  // market-wide directional vote; keep their per-contract evidence instead.
  const same = rows.length && rows.every((r) => r.signal === rows[0].signal);
  return { rows, netFlowUsd: same ? rows.reduce((sum, r) => sum + r.netFlowUsd, 0) : null,
    dataStatus: rows.length ? 'observed' : 'insufficient-evidence' };
}

export function verifiedToken(payload, chain, address, options = {}) {
  if (!chain || !address) return null;
  const rows = verifiedSignals(payload, options).rows;
  /* Solana compares as exact strings: Number('solana') is NaN (never equal,
   * not even to itself) and a lowercased base58 mint is a DIFFERENT mint.
   * EVM keeps the historic numeric chain + case-folded address compare,
   * unchanged — an EVM query can never match a Solana row and vice versa. */
  if (isSolanaChain(chain)) {
    return rows.find((r) => isSolanaChain(r.chain)
      && String(r.token) === String(address)) || null;
  }
  return rows.find((r) => !isSolanaChain(r.chain) && Number(r.chain) === Number(chain)
    && r.token.toLowerCase() === String(address).toLowerCase()) || null;
}

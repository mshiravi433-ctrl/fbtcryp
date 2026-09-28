/**
 * The only client/server promotion gate for Smart Money direction. Whale and
 * CEX transfer summaries remain useful context but NEVER pass this gate.
 * An empty/stale snapshot is unknown, not neutral and not $0.
 */
const WINDOWS = { '30m': 30 * 60_000, '1h': 3600_000, '4h': 4 * 3600_000,
  '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000, '30d': 30 * 24 * 3600_000 };
const finite = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));

export function verifiedSignals(payload, { now = Date.now(), window = null } = {}) {
  const snapshot = payload?.verified || payload;
  const win = window || snapshot?.window || payload?.window || '24h';
  const span = WINDOWS[win] || WINDOWS['24h'];
  if (snapshot?.dataStatus !== 'observed' || !finite(snapshot.indexedAt)
    || snapshot.indexedAt > now || now - snapshot.indexedAt > 36 * 3600_000) {
    return { rows: [], netFlowUsd: null, dataStatus: 'insufficient-evidence' };
  }
  const rows = (Array.isArray(snapshot.consensus) ? snapshot.consensus : []).filter((r) => {
    if (!r || !/^0x[a-fA-F0-9]{40}$/.test(r.token || '') || !finite(r.chain) || !finite(r.confidence)
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
  return verifiedSignals(payload, options).rows.find((r) => Number(r.chain) === Number(chain)
    && r.token.toLowerCase() === String(address).toLowerCase()) || null;
}

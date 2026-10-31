/**
 * Market search helpers shared by the browser and the API.
 *
 * A contract address is an exact identifier, never a fuzzy name query. Keeping
 * the detector in one place prevents the UI from offering autocomplete rows
 * for a different token that merely shares a ticker with the pasted address.
 */
export function contractQuery(value) {
  const q = String(value ?? '').trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) return { kind: 'evm', address: q.toLowerCase() };
  // Base58 excludes 0, O, I and l. Mint addresses are 32 bytes; the encoded
  // length is normally 32–44 characters.
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)) return { kind: 'solana', address: q };
  return null;
}

const norm = (value) => String(value ?? '').trim().toLowerCase();

/** Exact ticker/name matches first, then prefixes, then substrings. */
export function rankCoinMatches(rows, query, limit = 8) {
  const q = norm(query);
  if (!q || contractQuery(q)) return [];
  const seen = new Set();
  const scored = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.id || seen.has(row.id)) continue;
    const symbol = norm(row.symbol);
    const name = norm(row.name);
    const id = norm(row.id);
    let score = -1;
    if (symbol === q || id === q) score = 0;
    else if (name === q) score = 1;
    else if (symbol.startsWith(q)) score = 2;
    else if (name.startsWith(q) || id.startsWith(q)) score = 3;
    else if (symbol.includes(q) || name.includes(q) || id.includes(q)) score = 4;
    if (score < 0) continue;
    seen.add(row.id);
    scored.push({ score, rank: Number(row.rank) || Number.MAX_SAFE_INTEGER, row });
  }
  scored.sort((a, b) => a.score - b.score || a.rank - b.rank);
  return scored.slice(0, limit).map((entry) => entry.row);
}

/** Local rows paint immediately; the wider lookup fills the gaps without dupes. */
export function mergeSearchResults(localRows, remoteRows, query, limit = 8) {
  if (contractQuery(query)) return (remoteRows ?? []).slice(0, limit);
  const local = rankCoinMatches(localRows, query, limit);
  const have = new Set(local.map((row) => row.id));
  const remote = rankCoinMatches(remoteRows, query, limit).filter((row) => !have.has(row.id));
  return [...local, ...remote].slice(0, limit);
}

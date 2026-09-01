/**
 * FBT WALLET ENGINE — SMART ASSET RESOLVER
 * ---------------------------------------------------------------------------
 * When a user says «USDC من را نشان بده» — "show me my USDC" — the answer is
 * not one token. USDC exists on Ethereum, BNB Chain, Polygon, Arbitrum, Base,
 * Optimism, Avalanche, Linea AND Solana, each with a different contract/mint.
 * This resolver turns a symbol, a name or a bare address into the complete
 * list of chains + contracts + wallets that could satisfy the query, ranked
 * by confidence, and flagged when the query is ambiguous.
 *
 *   input:  "USDC"            → every chain that lists USDC + the right contract
 *   input:  "0xA0b8…eB48"     → exactly one EVM token (exact address match)
 *   input:  "So1111…11112"    → Solana's wrapped SOL mint
 *   input:  "bc1q…"           → Bitcoin address (resolves to the BTC network)
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · A bare symbol match returns EVERY candidate, ordered by confidence — it
 *   never silently picks one network. The caller chooses (or asks the user).
 * · `confidence` is `exact | high | medium | low`, and `low`/`medium` results
 *   carry a `hint` so the UI can say "did you mean…?" instead of guessing.
 * · Addresses are matched by exact string only (case-insensitive). Prefix
 *   "matching" of addresses is deliberately not offered — that is how funds
 *   go to a lookalike.
 * · An unknown query returns `{ resolved:false, candidates:[] }` — never a
 *   fabricated token.
 *
 * Pure and synchronous. The index is built with `buildTokenIndex()` from any
 * catalog (chains.js TOKENS, solana mints, the seed catalog, balances).
 */

import { SEED_CATALOG, mergeCatalogs } from './catalog.js';
import { structurallyValidAddress } from '../walletRisk.js';
import { isValidBtcAddress } from '../btcAddress.js';
import { isValidSolanaAddress } from './adapters.js';

export const RESOLVER_SCHEMA = 'fbt.asset-resolver.v1';

const normSymbol = (s) => String(s || '').trim().toUpperCase();

/** Build a normalized, deduplicated token index from one or more catalogs. */
export function buildTokenIndex(...catalogs) {
  const merged = mergeCatalogs(...catalogs, SEED_CATALOG);
  return merged.map((t) => ({
    schema: RESOLVER_SCHEMA,
    family: String(t.family || (t.chainId != null ? 'evm' : '')).toLowerCase(),
    chainId: t.chainId ?? null,
    symbol: normSymbol(t.symbol) || null,
    name: t.name ? String(t.name) : null,
    address: t.address || t.mint || null,
    decimals: Number.isFinite(Number(t.decimals)) ? Number(t.decimals) : 18,
    native: Boolean(t.native),
    coingeckoId: t.coingeckoId || null
  })).filter((t) => t.symbol || t.address);
}

function classifyAddress(query) {
  const q = query.trim();
  if (isValidBtcAddress(q)) return { kind: 'btc-address' };
  if (isValidSolanaAddress(q)) return { kind: 'solana-address' };
  if (structurallyValidAddress(q)) return { kind: 'evm-address' };
  return { kind: 'text' };
}

/**
 * Resolve a free-text query against the index.
 *
 * Returns `{ resolved, query, candidates, best, ambiguity }`.
 * `candidates` are ordered by confidence; `best` is the top candidate or null.
 */
export function resolveAsset(query, index = [], { balances = [] } = {}) {
  const q = String(query || '').trim();
  if (!q) return { resolved: false, query: q, candidates: [], best: null, ambiguity: null };

  const kind = classifyAddress(q);
  const tokens = Array.isArray(index) ? index : [];

  let candidates = [];
  if (kind.kind === 'evm-address') {
    candidates = tokens.filter((t) => t.address && String(t.address).toLowerCase() === q.toLowerCase())
      .map((t) => ({ ...t, confidence: 'exact', matchedOn: 'address' }));
    if (!candidates.length) {
      candidates = tokens.filter((t) => t.family === 'evm')
        .map((t) => ({ ...t, confidence: 'medium', matchedOn: 'network-only', hint: 'address not in the known catalog' }));
    }
  } else if (kind.kind === 'solana-address') {
    candidates = tokens.filter((t) => t.family === 'solana' && t.address && String(t.address).toLowerCase() === q.toLowerCase())
      .map((t) => ({ ...t, confidence: 'exact', matchedOn: 'address' }));
  } else if (kind.kind === 'btc-address') {
    candidates = [{ schema: RESOLVER_SCHEMA, family: 'bitcoin', chainId: 'bitcoin:mainnet', symbol: 'BTC', name: 'Bitcoin', address: null, decimals: 8, native: true, confidence: 'exact', matchedOn: 'address' }];
  } else {
    const up = normSymbol(q);
    const exact = tokens.filter((t) => t.symbol === up).map((t) => ({ ...t, confidence: 'exact', matchedOn: 'symbol' }));
    const prefix = tokens.filter((t) => t.symbol && t.symbol.startsWith(up) && t.symbol !== up)
      .map((t) => ({ ...t, confidence: 'medium', matchedOn: 'symbol-prefix', hint: 'did you mean this symbol?' }));
    const name = tokens.filter((t) => t.name && String(t.name).toLowerCase().includes(q.toLowerCase()))
      .map((t) => ({ ...t, confidence: 'low', matchedOn: 'name', hint: 'matched by name, not symbol' }));
    candidates = [...exact, ...prefix, ...name];
  }

  /* Attach the wallet's own holdings so the UI can say "you hold this on X". */
  const balBySym = new Map();
  for (const b of balances || []) {
    const s = normSymbol(b.symbol || b.token?.symbol);
    if (!s) continue;
    if (!balBySym.has(s)) balBySym.set(s, []);
    balBySym.get(s).push(b);
  }
  const seen = new Set();
  candidates = candidates.filter((c) => {
    const key = `${c.family}:${c.chainId}:${c.symbol}:${String(c.address || '').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((c) => ({
    ...c,
    holdings: balBySym.get(c.symbol) || []
  }));

  const best = candidates[0] || null;
  const ambiguity = candidates.filter((c) => c.confidence === 'exact').length > 1
    ? 'multiple-exact-matches'
    : (candidates.length > 1 ? 'multiple-candidates' : null);

  return { resolved: candidates.length > 0, query: q, candidates, best, ambiguity };
}

/** Every chain/contract for one symbol, regardless of the wallet's holdings. */
export function networksForAsset(symbol, index = []) {
  const up = normSymbol(symbol);
  return (Array.isArray(index) ? index : []).filter((t) => t.symbol === up);
}

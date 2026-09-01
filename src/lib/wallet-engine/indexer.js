/**
 * FBT WALLET ENGINE — UNIFIED TRANSACTION INDEXER
 * ---------------------------------------------------------------------------
 * One history, three ledgers. EVM receipts, Solana signatures and Bitcoin
 * transactions arrive in completely different shapes; this indexer normalizes
 * them into a single `fbt.tx.v1` record so the Wallet screen can render one
 * timeline instead of three.
 *
 * The store is an injectable, synchronous, in-memory structure (a Map keyed
 * by a content hash) so it is deterministic in tests and trivially swappable
 * for a server/Upstash store later. `ingest` is idempotent: the same tx
 * ingested twice does not duplicate.
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · `kind` (swap/send/receive/…) is decided by the Transaction Intelligence
 *   module, not invented here; an unclassified tx stays `unknown`.
 * · A tx with a missing timestamp is kept with `ts:null` and sorted last —
 *   dropping it would hide money that moved; guessing a time would lie about
 *   when.
 */

export const TX_SCHEMA = 'fbt.tx.v1';

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

function contentId(family, chainId, hash) {
  return `${family}:${chainId ?? ''}:${hash}`;
}

/**
 * Normalize a raw EVM/Solana/Bitcoin transaction into `fbt.tx.v1`.
 * The caller supplies the fields it has; the indexer fills the gaps honestly.
 */
export function normalizeTx(family, raw = {}) {
  const f = ['evm', 'solana', 'bitcoin', 'ton'].includes(String(family || '').toLowerCase())
    ? String(family).toLowerCase()
    : null;
  const hash = raw.hash || raw.txHash || raw.signature || raw.txid || null;
  return {
    schema: TX_SCHEMA,
    family: f,
    chainId: raw.chainId ?? null,
    hash: hash ? String(hash) : null,
    kind: raw.kind || raw.type || 'unknown',
    direction: raw.direction || null,
    from: raw.from ? String(raw.from) : null,
    to: raw.to ? String(raw.to) : null,
    asset: raw.asset || raw.symbol || null,
    amount: num(raw.amount) ?? null,
    valueUsd: num(raw.valueUsd) ?? null,
    feeNative: num(raw.feeNative ?? raw.fee) ?? null,
    feeUsd: num(raw.feeUsd) ?? null,
    status: raw.status || null,
    ts: num(raw.ts ?? raw.timestamp ?? raw.blockTime) ?? null,
    block: num(raw.blockNumber ?? raw.slot ?? raw.block) ?? null,
    raw: raw.raw && typeof raw.raw === 'object' ? raw.raw : null
  };
}

/** Create a unified indexer with an optional injected storage sink. */
export function createIndexer({ storage = null } = {}) {
  const map = new Map();
  const api = {
    schema: 'fbt.indexer.v1',
    storage,
    /** Ingest one or many txs. Idempotent by (family, chainId, hash). */
    ingest(family, raw) {
      if (Array.isArray(raw)) return raw.map((r) => api.ingest(family, r));
      const tx = normalizeTx(family, raw);
      if (!tx.hash) return { ok: false, code: 'HASH_REQUIRED', tx };
      const id = contentId(tx.family, tx.chainId, tx.hash);
      const exists = map.has(id);
      map.set(id, tx);
      return { ok: true, code: exists ? 'UPDATED' : 'INGESTED', id, tx };
    },
    byHash(family, chainId, hash) {
      return map.get(contentId(family, chainId, hash)) || null;
    },
    /** Query with filters; results are newest-first (null ts sorts last). */
    query({ family = null, chainId = null, address = null, asset = null, kind = null, limit = 100 } = {}) {
      let out = [...map.values()];
      if (family) out = out.filter((t) => t.family === family);
      if (chainId != null) out = out.filter((t) => String(t.chainId) === String(chainId));
      if (address) {
        const a = String(address).toLowerCase();
        out = out.filter((t) => (t.from && String(t.from).toLowerCase() === a) || (t.to && String(t.to).toLowerCase() === a));
      }
      if (asset) {
        const s = String(asset).toUpperCase();
        out = out.filter((t) => t.asset && String(t.asset).toUpperCase() === s);
      }
      if (kind) out = out.filter((t) => t.kind === kind);
      out.sort((a, b) => (b.ts ?? -1) - (a.ts ?? -1));
      return out.slice(0, limit);
    },
    /** One unified, newest-first timeline for everything. */
    history({ limit = 100 } = {}) {
      return api.query({ limit });
    },
    count() {
      return map.size;
    },
    /** Bulk-restore from a snapshot (e.g. persisted server state). */
    hydrate(snapshot = {}) {
      for (const t of snapshot.txs || []) api.ingest(t.family, t);
      return api.count();
    },
    snapshot() {
      return { schema: 'fbt.indexer-snapshot.v1', txs: [...map.values()] };
    }
  };
  return api;
}

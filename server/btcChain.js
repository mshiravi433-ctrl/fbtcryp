/**
 * BITCOIN CHAIN DATA — server-side Esplora proxy (the ONLY egress)
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * The app now has an internal bitcoin leg (src/lib/btcWallet.js, same seed,
 * BIP-84) and a P2WPKH transaction builder (src/lib/btcTx.js). Both need
 * chain facts — balance, UTXO set, fee rates, broadcast — and the browser is
 * not the place to get them: Esplora endpoints have per-IP budgets a
 * shared-proxy user population would burn through, CORS is not guaranteed on
 * every mirror, and a server hop lets ONE cache serve a hundred users looking
 * at the same fee table.
 *
 * So this module mirrors server/hodlhodl.js: the server is the sole speaker
 * to the upstream, an allow-list decides what the browser may ask for, and
 * every answer is normalised to exactly the fields the UI renders.
 *
 * ─── WHAT THE BROWSER MAY ASK FOR ─────────────────────────────────────────
 *   GET  /api/btc/address/:addr   balance + confirmed UTXOs of a MAINNET
 *                                address that passed the real checksum
 *                                (src/lib/btcAddress.js — the same module
 *                                the P2P paste box validates with; a
 *                                testnet/regtest/garbage string is refused
 *                                before any upstream call, not after)
 *   GET  /api/btc/fees            fee-estimates in sat/vB (fast/normal/slow)
 *   POST /api/btc/tx              broadcast a raw signed tx (hex in body)
 *
 * There is no route that touches a private key, a mnemonic, or any other
 * user secret — none exists in this module's vocabulary. Broadcast payloads
 * are signed in the BROWSER by the unlocked vault's in-memory key
 * (see btcTx.js); the server relays finished, public bytes only. The raw hex
 * is never logged and never echoed beyond the txid the upstream returns.
 *
 * ─── SATOSHI INTEGERS, ALWAYS ─────────────────────────────────────────────
 * Bitcoin money is integer satoshis. Floating point never touches a balance
 * here: upstream values arrive as JSON numbers or strings and are coerced
 * through Math.trunc(Number(...)) with a range check, so a JS float
 * representation bug cannot silently move a decimal point on a money screen.
 *
 * ─── HONEST ERRORS ─────────────────────────────────────────────────────────
 * 429 stays 429, upstream 503 stays 503, unreachable is 502 — a 500 would
 * mean OUR bug and this module has none it knows about. Validation failures
 * are 400 with the offending field named. Never a fake success.
 *
 * ─── UPSTREAM (Esplora / mempool.space) ───────────────────────────────────
 *   GET  /address/:addr          { chain_stats, mempool_stats, … }
 *   GET  /address/:addr/utxos    [ { txid, vout, value, status: { confirmed } } ]
 *   GET  /v1/fees/estimated      { fastestFee, halfHourFee, hourFee, minimumFee }
 *   POST /tx                     body = raw hex, returns txid as text
 *   BTC_API_BASE overrides the default (self-hosted Esplora, another mirror).
 */

import { withCache } from './cache.js';
import { btcAddressInfo } from '../src/lib/btcAddress.js';

const BTC_API_DEFAULT = 'https://mempool.space/api';

/**
 * Resolved on EVERY call, not at import: an env rotation (self-hosted
 * Esplora, another mirror) takes effect on the next request, and tests can
 * pin the base without owning the process's module cache.
 */
const apiBase = () => String(process.env.BTC_API_BASE || BTC_API_DEFAULT)
  .trim()
  .replace(/\/+$/, '');

const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);

/* Balances move the moment a block lands; 15s is a compromise between a
   stale-looking "unconfirmed" and hammering a public endpoint. Fees are the
   same table for everyone; 30s is plenty. Broadcast is NEVER cached. */
const ADDRESS_TTL_MS = 15_000;
const FEES_TTL_MS = 30_000;

/** Honest ceiling on a pushed payload: real P2WPKH spends are <10 KB; this
    stays under express.json's 256kb so OUR named 400 answers first, not a
    generic 413. */
const MAX_TX_HEX = 400_000; /* 200 KB binary when hex-decoded */
const RE_TX_HEX = /^[0-9a-f]+$/;
const RE_TXID = /^[0-9a-f]{64}$/;

/* ------------------------------ health ------------------------------------ */

const health = {
  lastOkAt: 0,
  lastErrAt: 0,
  lastErrCode: null,
  lastErrDetail: null,
  calls: 0
};

const markOk = () => { health.lastOkAt = Date.now(); health.lastErrCode = null; };
const markErr = (code, detail) => {
  health.lastErrAt = Date.now();
  health.lastErrCode = code;
  health.lastErrDetail = detail ? String(detail).slice(0, 160) : null;
};

/** A typed refusal, so routes answer honestly instead of 500ing. */
class UpstreamError extends Error {
  constructor(code, status, detail) {
    super(detail || code);
    this.code = code;
    this.status = status;
    this.detail = detail || null;
  }
}

export const upstreamBase = () => apiBase();

const errBody = (status, error, detail) => ({ status, body: { error, detail } });

/* ------------------------------ fetch ------------------------------------- */

async function esploraFetch(path, { method = 'GET', body = null } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  health.calls += 1;
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      signal: ctrl.signal,
      headers: body != null ? { 'content-type': 'text/plain' } : { accept: 'application/json' },
      body
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; } /* broadcast returns raw txid */

    if (res.status === 429) {
      markErr('UPSTREAM_RATE_LIMIT', `http_429`);
      throw new UpstreamError('UPSTREAM_RATE_LIMIT', 429, 'Upstream rate limit reached');
    }
    if (res.status === 503) {
      markErr('UPSTREAM_UNAVAILABLE', 'http_503');
      throw new UpstreamError('UPSTREAM_UNAVAILABLE', 503, 'Upstream reports itself temporarily unavailable');
    }
    if (!res.ok) {
      /* Esplora error bodies are plain text ("Invalid address", …) — surface
         the fact, never the raw bytes (they can echo parts of the request). */
      const detail = typeof parsed === 'string' && parsed.length <= 120 ? parsed.trim() : null;
      markErr('UPSTREAM_FAILED', `http_${res.status}`);
      if (res.status === 400) throw new UpstreamError('UPSTREAM_REJECTED', 400, detail || 'Upstream rejected the payload');
      throw new UpstreamError('UPSTREAM_FAILED', 502, `Upstream answered ${res.status}`);
    }

    markOk();
    return parsed;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    const timedOut = err?.name === 'AbortError';
    markErr('UPSTREAM_FAILED', timedOut ? 'timeout' : err?.message);
    throw new UpstreamError(
      'UPSTREAM_FAILED',
      502,
      timedOut ? `Upstream did not answer within ${TIMEOUT}ms` : 'Upstream unreachable'
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ helpers ----------------------------------- */

/** Integer satoshis or null — no float coercion on a money field. */
const toSats = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 2.1e15) return null; /* < 21M BTC in sats */
  return Math.trunc(n);
};

/**
 * THE ALLOW-LIST. An address is fetchable only if it passes the same real
 * checksum validation the P2P paste box uses (src/lib/btcAddress.js,
 * mainnet-only by design). This is upstream-shape-independent: no path
 * parameter ever reaches the URL builder without passing here, so no
 * traversal or testnet probe can piggyback on the proxy.
 */
function requireMainnetAddress(raw) {
  const addr = String(raw ?? '').trim();
  if (!addr || addr.length > 90) return null;
  const info = btcAddressInfo(addr);
  if (!info?.valid) return null;
  /* belt-and-braces: the validator is mainnet-only, and the upstream path is
     built from the VALIDATED string only, never from the raw input */
  return addr;
}

/* ----------------------------- endpoints ---------------------------------- */

/**
 * Balance + confirmed UTXO set of a mainnet address.
 * Only UTXOs Esplora marks confirmed are returned — an unconfirmed "utxo"
 * is not spendable money and showing it as such is how wallets lose coins
 * to RBF double-spends. The unconfirmed sat total is reported separately so
 * the UI can say "incoming", never "spendable".
 */
export async function btcAddress(rawAddr) {
  const addr = requireMainnetAddress(rawAddr);
  if (!addr) return errBody(400, 'BAD_ADDRESS', 'address must be valid mainnet bitcoin (bc1…, 1…, 3…)');

  const cacheKey = `btc:addr:${addr}`;
  try {
    const { value, stale } = await withCache(cacheKey, ADDRESS_TTL_MS, async () => {
      /* two upstream calls, one cache entry — the balance is useless without
         the utxo set (and vice versa) for the send flow */
      const [info, utxosRaw] = await Promise.all([
        esploraFetch(`/address/${encodeURIComponent(addr)}`),
        esploraFetch(`/address/${encodeURIComponent(addr)}/utxos`)
      ]);

      const confirmedSats = toSats(info?.chain_stats?.funded_txo_sum) ?? 0;
      const spentConfirmed = toSats(info?.chain_stats?.spent_txo_sum) ?? 0;
      const unconfirmedSats =
        ((toSats(info?.mempool_stats?.funded_txo_sum) ?? 0) - (toSats(info?.mempool_stats?.spent_txo_sum) ?? 0));

      const utxos = [];
      for (const u of Array.isArray(utxosRaw) ? utxosRaw.slice(0, 500) : []) {
        if (!u || typeof u !== 'object') continue;
        const value = toSats(u.value);
        if (value == null) continue;
        if (!RE_TXID.test(String(u.txid ?? ''))) continue;
        if (!u.status?.confirmed) continue;
        utxos.push({
          txid: String(u.txid),
          vout: Number.isInteger(u.vout) && u.vout >= 0 ? u.vout : null,
          value,
          confirmations: Number.isInteger(u.status?.block_height) ? 1 : 0 /* presence flag; height itself is chain gossip */
        });
        if (utxos[utxos.length - 1].vout == null) utxos.pop();
      }

      return {
        address: addr,
        /* integers, always — see the header note */
        confirmedSats: Math.max(0, confirmedSats - spentConfirmed),
        unconfirmedSats,
        utxoCount: utxos.length,
        utxos
      };
    });
    return { status: 200, body: { stale: Boolean(stale), ...value } };
  } catch (err) {
    if (err instanceof UpstreamError) return { status: err.status, body: { error: err.code, detail: err.detail, retryable: true } };
    return { status: 502, body: { error: 'UPSTREAM_FAILED', retryable: true } };
  }
}

/**
 * Fee estimates in sat/vB, mapped once to the three words the send sheet
 * speaks (fast/normal/slow). The upstream vocabulary changes; OURS does not.
 */
export async function btcFees() {
  try {
    const { value, stale } = await withCache('btc:fees', FEES_TTL_MS, async () => {
      const raw = await esploraFetch('/v1/fees/estimated');
      const pick = (v, fallback) => {
        const s = toSats(v);
        return s != null && s > 0 ? Math.min(s, 5000) : fallback; /* sane ceiling: 5000 sat/vB */
      };
      const fast = pick(raw?.fastestFee, null);
      const normal = pick(raw?.halfHourFee, fast);
      const slow = pick(raw?.hourFee, normal);
      if (fast == null && normal == null && slow == null) {
        throw new UpstreamError('UPSTREAM_FAILED', 502, 'Upstream fee table was empty');
      }
      return { fast: fast ?? normal ?? slow, normal: normal ?? fast, slow: slow ?? normal ?? fast };
    });
    return { status: 200, body: { stale: Boolean(stale), satPerVb: value } };
  } catch (err) {
    if (err instanceof UpstreamError) return { status: err.status, body: { error: err.code, detail: err.detail, retryable: true } };
    return { status: 502, body: { error: 'UPSTREAM_FAILED', retryable: true } };
  }
}

/**
 * Relay a fully-signed raw transaction. The server never sees a key and
 * never modifies a byte — it forwards public, signed data and reports the
 * txid the network assigned. No caching, ever: each POST is a real action.
 */
export async function btcBroadcast(rawHex) {
  const hex = String(rawHex ?? '').trim().toLowerCase();
  if (!hex || hex.length % 2 !== 0 || !RE_TX_HEX.test(hex)) {
    return errBody(400, 'BAD_TX_HEX', 'body must be an even-length hex string');
  }
  if (hex.length > MAX_TX_HEX) {
    return errBody(400, 'TX_TOO_LARGE', 'raw transaction exceeds the size limit');
  }

  try {
    const txid = await esploraFetch('/tx', { method: 'POST', body: hex });
    const id = typeof txid === 'string' ? txid.trim() : (txid && typeof txid === 'object' && typeof txid.txid === 'string' ? txid.txid.trim() : '');
    if (!RE_TXID.test(id)) {
      /* the tx very likely DID broadcast — refusing to fake a txid we did
         not receive; the UI treats "sent, id unknown" honestly */
      markErr('BROADCAST_ID_MISSING', String(id).slice(0, 40));
      return { status: 200, body: { broadcast: true, txid: null } };
    }
    return { status: 200, body: { broadcast: true, txid: id } };
  } catch (err) {
    if (err instanceof UpstreamError) {
      const code = err.code === 'UPSTREAM_REJECTED' ? 'TX_REJECTED' : err.code;
      return { status: err.status, body: { error: code, detail: err.detail, retryable: true } };
    }
    return { status: 502, body: { error: 'UPSTREAM_FAILED', retryable: true } };
  }
}

/* ------------------------------- status ----------------------------------- */

/**
 * Traffic-derived health, same honesty rule as p2pStatus: `unknown`, never a
 * made-up `ok`. No secret ever appears here — the upstream base is public.
 */
export function btcStatus() {
  return {
    upstream: apiBase(),
    upstreamState:
      health.calls === 0 ? 'unknown'
      : health.lastOkAt >= health.lastErrAt ? 'ok'
      : 'error',
    lastOkAt: health.lastOkAt || null,
    lastErrorAt: health.lastErrAt || null,
    lastErrorCode: health.lastErrCode,
    lastErrorDetail: health.lastErrDetail,
    addressTtlSeconds: ADDRESS_TTL_MS / 1000,
    feesTtlSeconds: FEES_TTL_MS / 1000,
    notes: [
      'read-only proxy: address facts, fee estimates, raw-tx relay',
      'addresses must pass mainnet checksum validation (src/lib/btcAddress.js)',
      'the server never holds keys; transactions arrive fully signed'
    ]
  };
}

/** Test seam: reset health lines without a process restart. */
export function _resetHealthForTests() {
  health.lastOkAt = 0;
  health.lastErrAt = 0;
  health.lastErrCode = null;
  health.lastErrDetail = null;
  health.calls = 0;
}

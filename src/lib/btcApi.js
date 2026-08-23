/**
 * BITCOIN CHAIN FACTS — client side.
 * ---------------------------------------------------------------------------
 * Thin, like thorswap.js: the browser talks ONLY to our own /api/btc/* proxy
 * (server/btcChain.js). It never learns an Esplora host, never holds a key,
 * and never builds a transaction — building and signing happen in
 * lib/btcTx.js inside the unlocked vault's memory, and only the finished,
 * signed, public hex is POSTed from here.
 *
 * Money is INTEGER SATOSHIS on this wire, in and out. No float conversions
 * live in this file: the server already guarantees integers, and converting
 * here would be the one place a decimal point could silently move.
 */

import { apiBase } from './apiBase';

async function getJson(path, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      /* Surface the server's own error CODE — 429 means wait, 503 means the
         explorer is down, and the UI must be able to say which. */
      const err = new Error(body?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.detail = body?.detail ?? null;
      err.retryAfter = res.headers?.get?.('retry-after') ?? null;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Balance + confirmed UTXOs of a mainnet address.
 * The server has ALREADY validated the address against the real checksum —
 * this helper still refuses to call for an invalid string, because the
 * request URL should never even carry one.
 */
export function getBtcAddressInfo(address) {
  return getJson(`/btc/address/${encodeURIComponent(address)}`);
}

/** Fee estimates in sat/vB: { fast, normal, slow }. */
export const getBtcFees = () => getJson('/btc/fees');

/**
 * Broadcast a fully-signed raw transaction. `txHex` is public data the moment
 * it leaves this call — no secret has ever been part of it.
 */
export async function broadcastBtcTx(txHex) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${apiBase()}/btc/tx`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawTx: String(txHex ?? '').toLowerCase() })
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.detail = body?.detail ?? null;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

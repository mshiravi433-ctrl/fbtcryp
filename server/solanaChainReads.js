/**
 * SOLANA CHAIN READS, SERVER SIDE — the second door for a blocked first one.
 * ==========================================================================
 *
 * WHY THIS EXISTS
 * The Solana swap screen refuses to sign until it knows what the wallet holds,
 * and that read goes to public RPC nodes from the USER'S device. On Iranian
 * mobile networks and inside Telegram's WebView those hosts are regularly
 * blocked (403), throttled (429) or simply unreachable, so the screen answered
 * «موجودی سولانای این کیف پول قابل تأیید نیست … وقتی RPC در دسترس شد دوباره
 * تلاش کن» most of the time — reported 2026-09-23 as «برای امضا و خرید با
 * سولانا در بیشتر اوقات می‌زنه موجودی کیف پول کم یا RPC را چک کنید».
 *
 * The quote on the same screen arrives through THIS server (see
 * server/solana.js). A device that can price a swap through us can therefore
 * also read a balance through us, whatever it cannot reach directly. That is
 * the whole product argument for the endpoint, and it is why the client treats
 * it as a fallback rather than as the primary path.
 *
 * WHAT IT IS NOT
 * Not a source of truth about money and not a custodial read: it returns
 * public chain state for an address the caller supplies, exactly like a block
 * explorer does. Nothing is signed here, nothing is stored, and no key is used.
 *
 * ─── THE ONE OPERATIONAL WARNING ────────────────────────────────────────────
 * Every user's read leaves from OUR IP. Public nodes rate-limit per IP, so a
 * busy deployment will collect 429s that no individual user caused. Set
 * `SOLANA_RPC_URL` (comma-separated for more than one) to a private endpoint —
 * the same variable server/smartMoney and the Drift adapter already read — and
 * it is used FIRST, with the public list behind it.
 */

import { solanaRpcCall, SOLANA_CLUSTER_RPCS } from '../src/lib/solanaRpc.js';
import {
  readMintInfoAcross,
  readSwapBalancesAcross
} from '../src/lib/solana/chainReads.js';

export const SOLANA_BALANCES_SCHEMA = 'fbt.solana-balances.v1';
export const SOLANA_TOKEN_INFO_SCHEMA = 'fbt.solana-token-info.v1';

/** Jupiter's token list — used only for a symbol and a name, never for a scale. */
const JUP_TOKENS = 'https://lite-api.jup.ag/tokens/v2/search';

const RPC_TIMEOUT_MS = Number(process.env.SOLANA_RPC_TIMEOUT_MS || 8000);

/** Same base58 shape guard the client uses (src/lib/solana.js). */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSolanaPubkey(value) {
  return typeof value === 'string' && BASE58.test(value.trim());
}

/**
 * The nodes a server-side read may try, in order.
 *
 * `SOLANA_RPC_URL` first (a deliberate, private choice), then the SAME public
 * list the client walks, imported rather than retyped so the two can never
 * disagree about which endpoints exist.
 */
export function solanaReadCandidates() {
  const env = String(process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC || '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => /^https:\/\//i.test(u));
  const publicList = SOLANA_CLUSTER_RPCS['mainnet-beta'] || [];
  return [...new Set([...env, ...publicList])];
}

/** Collapse a double-tap into one set of node calls. Balances are money-adjacent,
    so this is a de-duplicator, not a cache: 1.5 s is shorter than a block. */
const inflight = new Map();
const INFLIGHT_TTL_MS = 1500;

async function dedupe(key, work) {
  const now = Date.now();
  const hit = inflight.get(key);
  if (hit && now - hit.at < INFLIGHT_TTL_MS) return hit.promise;
  const promise = (async () => {
    try {
      return await work();
    } finally {
      setTimeout(() => {
        const row = inflight.get(key);
        if (row && row.promise === promise) inflight.delete(key);
      }, INFLIGHT_TTL_MS).unref?.();
    }
  })();
  inflight.set(key, { at: now, promise });
  return promise;
}

/**
 * GET /api/solana/balances — what an address holds, read for a device that
 * cannot reach the nodes itself.
 *
 * @returns {Promise<{ok:true, schema:string, ...}|{ok:false, code:string, hosts?:Array, detail?:string|null}>}
 */
export async function readSolanaBalances({ owner, inputMint, outputMint, rawAmount = null }) {
  if (!isSolanaPubkey(owner)) return { ok: false, code: 'BAD_OWNER' };
  if (!isSolanaPubkey(inputMint) || !isSolanaPubkey(outputMint)) return { ok: false, code: 'BAD_MINT' };

  const amount = rawAmount != null && /^\d{1,30}$/.test(String(rawAmount)) ? BigInt(String(rawAmount)) : null;
  const key = `${owner}|${inputMint}|${outputMint}|${amount?.toString() || ''}`;

  return dedupe(key, async () => {
    const r = await readSwapBalancesAcross({
      call: solanaRpcCall,
      candidates: solanaReadCandidates(),
      owner: owner.trim(),
      inputMint: inputMint.trim(),
      outputMint: outputMint.trim(),
      rawAmount: amount,
      timeoutMs: RPC_TIMEOUT_MS
    });
    if (!r.ok) {
      return {
        ok: false,
        schema: SOLANA_BALANCES_SCHEMA,
        code: r.code,
        detail: r.detail || null,
        hosts: (r.hosts || []).slice(0, 8)
      };
    }
    return {
      ok: true,
      schema: SOLANA_BALANCES_SCHEMA,
      owner: owner.trim(),
      inputMint: inputMint.trim(),
      outputMint: outputMint.trim(),
      /* Strings, because JSON has no integer type wide enough for lamports
         and a number that lost precision is a wrong balance. */
      solLamports: r.solLamports.toString(),
      sourceRaw: r.sourceRaw.toString(),
      sourceDecimals: r.sourceDecimals,
      sourceDecimalsVerified: r.sourceDecimalsVerified !== false,
      sourceProgram: r.sourceProgram || null,
      outputAccountExists: r.outputAccountExists !== false,
      outputAssumed: r.outputAssumed === true,
      outputDecimals: r.outputDecimals ?? null,
      calls: r.calls || 0,
      host: (() => { try { return new URL(r.url).hostname; } catch { return null; } })(),
      at: Date.now()
    };
  });
}

/* A mint's scale never changes, so this cache is permanent for the process and
   the HTTP layer caches it for a day. Symbol/name are a convenience on top. */
const mintInfoCache = new Map();

async function jupiterTokenMeta(mint) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${JUP_TOKENS}?query=${encodeURIComponent(mint)}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0' }
    });
    if (!res.ok) return null;
    const list = await res.json().catch(() => null);
    const row = Array.isArray(list) ? list.find((r) => r?.id === mint) : null;
    if (!row) return null;
    return {
      symbol: typeof row.symbol === 'string' ? row.symbol.slice(0, 24) : null,
      name: typeof row.name === 'string' ? row.name.slice(0, 64) : null,
      decimals: Number.isInteger(Number(row.decimals)) ? Number(row.decimals) : null,
      verified: row.isVerified === true
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/solana/token-info — the scale of a mint.
 *
 * The chain is the authority (a mint account cannot lie about its own
 * decimals); Jupiter's list is consulted for a human symbol and, only when the
 * chain could not be reached at all, as a second opinion on the scale.
 */
export async function readSolanaTokenInfo({ mint }) {
  if (!isSolanaPubkey(mint)) return { ok: false, code: 'BAD_MINT' };
  const key = String(mint).trim();
  if (mintInfoCache.has(key)) return { ...mintInfoCache.get(key), cached: true };

  const chain = await readMintInfoAcross({
    call: solanaRpcCall,
    candidates: solanaReadCandidates(),
    mint: key,
    timeoutMs: RPC_TIMEOUT_MS
  });

  /* Best-effort and never load-bearing: a symbol is decoration, a scale is not. */
  const meta = await jupiterTokenMeta(key);

  const decimals = chain.ok && chain.decimals != null ? chain.decimals : (meta?.decimals ?? null);
  if (decimals == null) {
    return {
      ok: false,
      schema: SOLANA_TOKEN_INFO_SCHEMA,
      code: chain.ok ? 'DECIMALS_UNREADABLE' : (chain.code || 'RPC_UNAVAILABLE'),
      detail: chain.detail || null,
      hosts: (chain.hosts || []).slice(0, 8),
      symbol: meta?.symbol || null,
      name: meta?.name || null
    };
  }

  const out = {
    ok: true,
    schema: SOLANA_TOKEN_INFO_SCHEMA,
    mint: key,
    decimals,
    /* Where the scale came from: the chain, or Jupiter's list when every node
       refused us. Stated rather than implied, because the two are not equally
       authoritative and the client says so on screen. */
    source: chain.ok && chain.decimals != null ? 'chain' : 'jupiter',
    token2022: chain.ok ? chain.token2022 === true : false,
    program: chain.ok ? chain.program || null : null,
    supply: chain.ok ? chain.supply ?? null : null,
    symbol: meta?.symbol || null,
    name: meta?.name || null,
    verified: meta?.verified === true,
    at: Date.now()
  };
  mintInfoCache.set(key, out);
  return { ...out };
}

/** Test/diagnostic hook. */
export function _resetSolanaReadCaches() {
  inflight.clear();
  mintInfoCache.clear();
}

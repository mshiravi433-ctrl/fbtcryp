/**
 * WHERE A SOLANA BALANCE COMES FROM — two doors, first honest answer wins.
 * =========================================================================
 *
 * The swap screen cannot sign without knowing what the wallet holds, and on
 * the networks this app is actually used on, ONE door is not enough:
 *
 *   · the public RPC nodes (lib/solanaRpc.js owns the list) are blocked,
 *     throttled or slow from Iranian mobile networks and from inside a
 *     Telegram WebView — which is precisely why the screen used to answer
 *     «موجودی سولانای این کیف پول قابل تأیید نیست … وقتی RPC در دسترس شد دوباره
 *     تلاش کن» most of the time;
 *   · OUR OWN backend is reachable — the quote that produced the number on
 *     screen came through it (lib/solana.js → /api/solana/order). A phone that
 *     can price a swap can therefore also read a balance through us, whatever
 *     it cannot reach directly.
 *
 * So both are asked, and the first one to answer WINS:
 *
 *   1. the public nodes, immediately (fastest when they work, and no load on
 *      our server);
 *   2. our backend, started `SERVER_DELAY_MS` later — but only if the nodes
 *      have not answered yet. On a good network this never fires; on a blocked
 *      one it costs the user 1.2 s instead of four timeouts.
 *
 * Starting them one after the other was the obvious shape and it is the wrong
 * one: walking four candidates that each time out at 9 s means the user waits
 * half a minute for an answer our server could have given in one second.
 * Starting both at once, always, would put every balance read on our server
 * even when the direct path is fine. Delaying the second door by a beat gets
 * both properties.
 *
 * Nothing here is a source of truth about money: it is a read of public chain
 * state, and the transaction the user signs is still simulated by the wallet
 * and by the chain before anything lands.
 */

import { apiBase } from '../apiBase.js';
import {
  solanaRpcCall,
  solanaRpcCandidates,
  readSolanaNetworkSettings,
  resetSolanaRpcChoice,
  solanaPublicsBlocked
} from '../solanaRpc.js';
import {
  readSwapBalancesAcross,
  readMintInfoAcross,
  SOL_DECIMALS,
  SOL_MINT
} from './chainReads.js';

/** Per-request ceiling for one node. Mirrors lib/solanaRpc.js's own default. */
const RPC_TIMEOUT_MS = 9000;

/** How long the public nodes get before our backend is asked as well —
    WHEN the public list has not already proved useless (see below). */
const SERVER_DELAY_MS = 1200;

/** Ceiling for the backend call. It is a proxy to the same nodes, not a cache. */
const SERVER_TIMEOUT_MS = 10000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The candidate nodes for a READ, or an empty list.
 *
 * The app's own JSON-RPC relay (POST /api/solana/rpc — read-only, allowlisted
 * methods, never a broadcaster) is opted IN here, deliberately. These are pure
 * reads, which is the only thing the relay is for, and `solanaRpcCandidates`
 * positions it on its own: behind the warm public nodes on a healthy network,
 * FIRST when the persisted hint says this network path's publics all refuse —
 * the 2026-09-23 report, where eight hosts produced eight refusals and the
 * relay was the one door that could answer. Cooling never applies to it (see
 * solanaRpcCall), so it can always be retried.
 */
async function rpcCandidates(settings = null) {
  try {
    const s = settings || await readSolanaNetworkSettings();
    const list = solanaRpcCandidates({ ...s, relay: true }).filter(Boolean);
    return [...new Set(list)];
  } catch {
    return [];
  }
}

/**
 * GET one of our own JSON endpoints, with a deadline, and never throw.
 *
 * Returns null when there is nothing usable to hand back — a build with no
 * backend, a deployed server older than this endpoint (404), or a network that
 * cannot see us either. The caller then reports the RPC failure, which is the
 * part the user can act on.
 *
 * An already-cancelled request is not sent at all: the second door is scheduled
 * a beat after the first, and if a node answered in that beat the backend call
 * would be pure waste — ours to pay for, since every user's read leaves from
 * our one IP.
 */
async function serverJson(path, { timeoutMs = SERVER_TIMEOUT_MS, signal = null } = {}) {
  if (signal?.aborted) return null;
  let base = '';
  try { base = apiBase(); } catch { return null; }
  if (!base) return null;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  const onOuterAbort = () => ctrl?.abort();
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); return null; }
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { accept: 'application/json' },
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json().catch(() => null);
    return body && typeof body === 'object' ? body : { ok: false, status: 0 };
  } catch (err) {
    return { ok: false, status: 0, detail: String(err?.message || err || '').slice(0, 120) };
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
}

const toBig = (v) => {
  try { return BigInt(String(v ?? 0)); } catch { return 0n; }
};

/** The backend's answer in the same shape the direct read produces. */
function normalizeServerBalances(body, args) {
  if (!body || body.ok !== true) return null;
  return {
    ok: true,
    via: 'server',
    url: body.host || null,
    solLamports: toBig(body.solLamports),
    sourceRaw: toBig(body.sourceRaw),
    sourceDecimals: Number.isInteger(Number(body.sourceDecimals)) ? Number(body.sourceDecimals) : SOL_DECIMALS,
    sourceDecimalsVerified: body.sourceDecimalsVerified !== false,
    sourceProgram: body.sourceProgram || null,
    outputAccountExists: body.outputAccountExists !== false,
    outputAssumed: body.outputAssumed === true,
    outputDecimals: Number.isInteger(Number(body.outputDecimals)) ? Number(body.outputDecimals) : null,
    calls: Number(body.calls) || 0,
    attempts: [],
    hosts: [],
    detail: null,
    args
  };
}

/**
 * The first successful answer from a set of read attempts.
 *
 * Resolves as soon as one attempt says `ok`, and CANCELS the others: an
 * abandoned backend request is our bill to pay, and an abandoned node request
 * is the user's battery and data. When ALL of them fail, the direct-RPC failure
 * is the one reported: it carries the per-host reasons (BLOCKED vs RATE_LIMITED
 * vs TIMEOUT) that tell the user whether to retry or to put their own RPC in
 * Settings.
 */
function firstOk(attempts, onCancel = null) {
  return new Promise((resolve) => {
    const results = [];
    let pending = attempts.length;
    const finish = () => {
      if (pending > 0) return;
      const direct = results.find((r) => r?.via === 'rpc');
      resolve(direct || results.find(Boolean) || { ok: false, code: 'RPC_UNAVAILABLE', attempts: [], hosts: [], detail: null });
    };
    for (const attempt of attempts) {
      attempt.then((r) => {
        results.push(r);
        pending -= 1;
        if (r?.ok) { pending = 0; if (onCancel) onCancel(); resolve(r); return; }
        finish();
      }).catch((err) => {
        results.push({ ok: false, code: 'READ_FAILED', detail: String(err?.message || err || '').slice(0, 160), attempts: [], hosts: [] });
        pending -= 1;
        finish();
      });
    }
    if (!attempts.length) resolve({ ok: false, code: 'RPC_UNAVAILABLE', attempts: [], hosts: [], detail: null });
  });
}

/**
 * Read what a wallet holds, from whichever door answers first.
 *
 * @param {object} p
 * @param {string} p.owner
 * @param {string} p.inputMint
 * @param {string} p.outputMint
 * @param {bigint|null} [p.rawAmount] input amount in base units (only used to
 *        decide whether the output-account read can change the verdict)
 * @param {boolean} [p.allowServer] set false to stay on the public nodes
 * @returns {Promise<{ok:true, via:'rpc'|'server', solLamports:bigint, sourceRaw:bigint,
 *   sourceDecimals:number, sourceDecimalsVerified:boolean, outputAccountExists:boolean,
 *   outputAssumed:boolean, url:string|null, calls:number}
 *  |{ok:false, code:string, detail:string|null, hosts:Array, attempts:Array, serverTried:boolean}>}
 */
export async function readSolanaSwapBalances({ owner, inputMint, outputMint, rawAmount = null, allowServer = true }) {
  if (!owner || !inputMint || !outputMint) {
    return { ok: false, code: 'BAD_ARGS', detail: 'owner/inputMint/outputMint are required', hosts: [], attempts: [], serverTried: false };
  }
  const amountArg = typeof rawAmount === 'bigint' ? rawAmount : null;
  /* Fired the moment either door answers, so the loser stops asking. */
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const signal = ctrl ? ctrl.signal : null;
  const cancel = () => { try { ctrl?.abort(); } catch { /* cancelling is hygiene */ } };

  /*
   * Settings read ONCE for both doors — and the answer decides the SHAPE of
   * the race. When the persisted hint says every public node refused this
   * network path recently, waiting 1.2 s before asking our own backend is
   * 1.2 s of known-dead air: the doors start TOGETHER. A healthy network
   * keeps the stagger, so the free nodes still win when they work.
   */
  const settings = await readSolanaNetworkSettings();
  const publicsRefuse = solanaPublicsBlocked(settings.cluster);
  const serverDelayMs = publicsRefuse ? 0 : SERVER_DELAY_MS;

  const direct = (async () => {
    const candidates = await rpcCandidates(settings);
    const r = await readSwapBalancesAcross({
      call: solanaRpcCall,
      candidates,
      owner,
      inputMint,
      outputMint,
      rawAmount: amountArg,
      timeoutMs: RPC_TIMEOUT_MS,
      signal
    });
    if (r.ok) return { ...r, via: 'rpc' };
    /* Nothing answered: forget the remembered winner so the NEXT read probes
       again instead of starting with a host that just refused us. This is the
       feedback the old single-node reader never gave. */
    if (candidates.length) {
      try { resetSolanaRpcChoice(); } catch { /* hygiene, never load-bearing */ }
    }
    return { ...r, via: 'rpc', serverTried: false };
  })();

  const server = allowServer
    ? delay(serverDelayMs).then(async () => {
      if (signal?.aborted) return { ok: false, via: 'server', code: 'CANCELLED', attempts: [], hosts: [] };
      const params = new URLSearchParams({ owner, inputMint, outputMint });
      if (amountArg != null) params.set('rawAmount', amountArg.toString());
      const body = await serverJson(`/solana/balances?${params.toString()}`, { timeoutMs: SERVER_TIMEOUT_MS, signal });
      return normalizeServerBalances(body, { owner, inputMint, outputMint }) || {
        ok: false,
        via: 'server',
        code: body?.status === 404 ? 'SERVER_ENDPOINT_MISSING' : 'SERVER_UNAVAILABLE',
        status: body?.status ?? 0,
        detail: body?.detail || null,
        attempts: [],
        hosts: []
      };
    })
    : Promise.resolve({ ok: false, via: 'server', code: 'SERVER_DISABLED', attempts: [], hosts: [] });

  const winner = await firstOk([direct, server], cancel);
  if (winner.ok) return winner;
  cancel();

  /* Both doors shut. Report the DIRECT failure — it is the one with per-host
     reasons — and say whether our own backend was even an option, because
     «the app has no backend deployed here» and «these nodes refuse this
     network path» lead to different fixes. */
  const directResult = await direct.catch(() => null);
  const serverResult = await server.catch(() => null);
  const base = directResult && directResult.code ? directResult : (winner || {});
  return {
    ok: false,
    code: base.code || 'RPC_UNAVAILABLE',
    detail: base.detail || null,
    hosts: base.hosts || [],
    attempts: base.attempts || [],
    serverTried: allowServer,
    serverCode: serverResult?.code || null,
    serverStatus: serverResult?.status ?? null
  };
}

/**
 * The native SOL balance of an address, through the same two doors.
 *
 * Every other Solana screen (the wallet tab, the bridge panel, Intent AI) read
 * this with `new Connection(await solanaRpcUrl())` — one node, no deadline, no
 * fallback — so a throttled endpoint showed as a wallet with 0 SOL, which is
 * indistinguishable from an empty wallet to the person looking at it. Asking
 * the swap reader for SOL→SOL costs exactly one `getBalance` call on whichever
 * door answers first, so it is the same read with the resilience attached.
 *
 * @returns {Promise<bigint>} lamports
 * @throws {Error} named code, exactly like {@link readSolanaSwapBalances}
 */
export async function readSolanaNativeLamports(owner) {
  const r = await readSolanaSwapBalances({ owner, inputMint: SOL_MINT, outputMint: SOL_MINT });
  if (!r?.ok) {
    const err = new Error(r?.code || 'RPC_UNAVAILABLE');
    err.code = r?.code || 'RPC_UNAVAILABLE';
    err.detail = r?.detail || null;
    err.hosts = r?.hosts || [];
    throw err;
  }
  return r.solLamports;
}

const mintCache = new Map();

/**
 * The scale (and program) of a mint — read once per session per mint.
 *
 * This is the fix for the pasted-mint guess. A token imported by address used
 * to be stored as 9 decimals, and that guess converted the amount the user
 * typed into base units: for a 6-decimal token every amount became 1000× too
 * big, the balance line showed a number 1000× too small, and the pre-flight
 * answered «موجودی کافی نیست» to a wallet that was funded. Decimals are
 * immutable for the life of a mint, so caching them is not a staleness risk.
 *
 * @returns {Promise<{ok:true, decimals:number|null, token2022:boolean, program:string|null,
 *   symbol?:string|null, name?:string|null, via:'rpc'|'server'|'cache'}|{ok:false, code:string, detail?:string|null}>}
 */
export async function readSolanaTokenInfo(mint) {
  const key = String(mint || '').trim();
  if (!key) return { ok: false, code: 'BAD_MINT' };
  if (key === SOL_MINT) return { ok: true, decimals: SOL_DECIMALS, token2022: false, program: null, via: 'cache', symbol: 'SOL', name: 'Solana' };
  if (mintCache.has(key)) return { ...mintCache.get(key), via: 'cache' };

  /* Same settings-once rule as the balances reader above: the shape of the
     race (staggered vs simultaneous doors) follows the publics-blocked hint. */
  const settings = await readSolanaNetworkSettings();
  const serverDelayMs = solanaPublicsBlocked(settings.cluster) ? 0 : SERVER_DELAY_MS;

  const candidates = await rpcCandidates(settings);
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const signal = ctrl ? ctrl.signal : null;
  const cancel = () => { try { ctrl?.abort(); } catch { /* hygiene */ } };

  const direct = readMintInfoAcross({ call: solanaRpcCall, candidates, mint: key, timeoutMs: RPC_TIMEOUT_MS, signal });

  const server = delay(serverDelayMs).then(async () => {
    if (signal?.aborted) return { ok: false, via: 'server', code: 'CANCELLED' };
    const body = await serverJson(`/solana/token-info?mint=${encodeURIComponent(key)}`, { signal });
    if (!body || body.ok !== true) return { ok: false, via: 'server', code: body?.status === 404 ? 'SERVER_ENDPOINT_MISSING' : 'SERVER_UNAVAILABLE' };
    return {
      ok: true,
      via: 'server',
      mint: key,
      decimals: Number.isInteger(Number(body.decimals)) ? Number(body.decimals) : null,
      token2022: body.token2022 === true,
      program: body.program || null,
      supply: body.supply != null ? String(body.supply) : null,
      symbol: body.symbol || null,
      name: body.name || null
    };
  });

  const winner = await firstOk([
    direct.then((r) => ({ ...r, via: 'rpc' })),
    server
  ], cancel);
  if (!winner?.ok) cancel();

  if (winner?.ok && winner.decimals != null) {
    const value = {
      ok: true,
      mint: key,
      decimals: winner.decimals,
      token2022: winner.token2022 === true,
      program: winner.program || null,
      symbol: winner.symbol || null,
      name: winner.name || null,
      via: winner.via || 'rpc'
    };
    mintCache.set(key, value);
    return { ...value };
  }
  const directResult = await direct.catch(() => null);
  return {
    ok: false,
    code: directResult?.code || winner?.code || 'RPC_UNAVAILABLE',
    detail: directResult?.detail || null,
    hosts: directResult?.hosts || []
  };
}

/** Forget every cached mint scale (a cluster switch, or a test). */
export function clearSolanaTokenInfoCache() { mintCache.clear(); }

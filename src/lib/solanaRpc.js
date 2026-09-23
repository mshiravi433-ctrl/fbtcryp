/**
 * SOLANA RPC — the ONE place that decides which node the app talks to.
 * ============================================================================
 *
 * WHY THIS MODULE EXISTS
 * Three call sites each had their own private copy of "read the Settings
 * cluster, else the public endpoint": the launch signing path
 * (lib/launch/solana/signing.js), the wallet/broadcast path
 * (lib/solanaWallet.js) and, implicitly, every screen that reads a balance.
 * All three hard-failed on the FIRST endpoint and reported the failure as a
 * dead network — and the first endpoint is `api.mainnet-beta.solana.com`, the
 * Solana Foundation's public node, which answers a browser with HTTP 429 as
 * soon as it is busy. On a phone in Iran, where that host is also frequently
 * unreachable, "the app cannot read Solana" was the normal state, not an
 * outage.
 *
 * WHAT CHANGED
 *   · an ORDERED CANDIDATE LIST per cluster (the user's own RPC first, always,
 *     then the public ones), probed with a real `getHealth` call;
 *   · the winner is remembered for the session, keyed by cluster + custom URL,
 *     so a screen that reads five accounts does not probe five times;
 *   · failures are NAMED (429 → RATE_LIMITED, 401/403/451 → BLOCKED, TIMEOUT,
 *     UNREACHABLE, HTTP_xxx) instead of collapsing into one string, because
 *     "the node is throttling us" and "this provider refuses us" have
 *     different remedies and only one of them is fixed by retrying;
 *   · `probeSolanaRpc()` is exported so Settings can offer a TEST button — a
 *     network selector that cannot be verified is a selector nobody trusts.
 *
 * https ONLY, for the reason spelled out in WalletContext: the Android WebView
 * blocks cleartext anyway, and quietly downgrading a wallet's RPC to plaintext
 * is worth refusing outright rather than failing obscurely.
 */

/** Per-request ceiling. A public node that has not answered in 9s is not
    going to; the next candidate is cheaper than waiting. */
const RPC_TIMEOUT_MS = 9000;

/** How long a chosen endpoint is trusted before it is re-probed. */
const CHOICE_TTL_MS = 5 * 60 * 1000;

/**
 * Public, key-less, CORS-enabled clusters endpoints.
 *
 * ORDER MATTERS, and this list changed on 2026-09-23. The Foundation endpoint
 * used to be FIRST "because it is the one every wallet and explorer agrees
 * on" — which is true of wallets and false of browsers: `api.mainnet-beta`.
 * `solana.com` answers a web page with HTTP 429 when it is busy and with a
 * flat HTTP 403 ("access forbidden", region/provider block) when it does not
 * like the caller at all, and it is the host that produced the loan page's
 * «RPC_RATE_LIMITED» report. The community endpoints after it are exactly the
 * nodes that exist to serve browsers, so the Foundation node stays on the list
 * as the LAST resort — kept, not deleted: it is still the canonical node, and
 * a network where the others are blocked is a real network.
 */
export const SOLANA_CLUSTER_RPCS = Object.freeze({
  'mainnet-beta': Object.freeze([
    'https://solana-rpc.publicnode.com',
    'https://solana.drpc.org',
    'https://solana.api.onfinality.io/public',
    'https://api.mainnet-beta.solana.com'
  ]),
  devnet: Object.freeze([
    'https://api.devnet.solana.com',
    'https://solana-devnet-rpc.publicnode.com',
    'https://solana-devnet.drpc.org'
  ]),
  testnet: Object.freeze([
    'https://api.testnet.solana.com',
    'https://solana-testnet-rpc.publicnode.com'
  ])
});

/** Anything unrecognised is mainnet — the real network, never a guess at a
    test one. Mirrors the rule the launch flow and the wallet already used. */
export function normalizeSolanaCluster(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'devnet') return 'devnet';
  if (v === 'testnet') return 'testnet';
  return 'mainnet-beta';
}

/** Read the network settings without dragging the store into this chunk. */
export async function readSolanaNetworkSettings() {
  try {
    const { useSettingsStore } = await import('../store/useSettingsStore');
    const st = useSettingsStore.getState();
    return {
      cluster: normalizeSolanaCluster(st.solanaCluster),
      custom: String(st.solanaRpc || '').trim()
    };
  } catch {
    return { cluster: 'mainnet-beta', custom: '' };
  }
}

/**
 * The ordered candidate list for a cluster: the user's own RPC first (never
 * cooled — it is a deliberate choice), then the public list with any host that
 * recently refused or throttled us moved to the BACK.
 *
 * The order is stable for hosts in the same state, so two reads in a row do not
 * shuffle the list under each other.
 */
export function solanaRpcCandidates({ cluster = 'mainnet-beta', custom = '' } = {}) {
  const c = normalizeSolanaCluster(cluster);
  const customUrl = /^https:\/\//i.test(String(custom || '')) ? String(custom).trim() : '';
  pruneCooling();
  const publicList = (SOLANA_CLUSTER_RPCS[c] || SOLANA_CLUSTER_RPCS['mainnet-beta'])
    .filter((url) => url !== customUrl);
  const warm = publicList.filter((url) => !cooling.has(url));
  const cold = publicList.filter((url) => cooling.has(url));
  const list = customUrl ? [customUrl, ...warm, ...cold] : [...warm, ...cold];
  return [...new Set(list)];
}

/**
 * One JSON-RPC call with a hard timeout.
 *
 * Returns a plain result object and NEVER throws: the caller's job is to
 * compare candidates, and a throw from the first one would hide the second.
 */
export async function solanaRpcCall(url, method, params = [], { timeoutMs = RPC_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      /* 429 is throttling: waiting fixes it. 401/403/451 are REFUSALS — the
         host has decided not to serve this caller (region block, WAF, provider
         policy) and no amount of retrying changes it; only another node does.
         Collapsing the two into one reason is how a 403 came to be reported to
         a user as «the node is rate limiting us», which is a different fact
         with a different remedy. */
      const refusal = res.status === 401 || res.status === 403 || res.status === 451;
      const reason = res.status === 429 ? 'RATE_LIMITED' : refusal ? 'BLOCKED' : `HTTP_${res.status}`;
      /* The one place every RPC failure passes through — so it is the one place
         that has to remember the host refused us. */
      noteSolanaRpcFailure(url, reason, { status: res.status });
      return { ok: false, ms, url, reason, detail: `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => null);
    if (!body) return { ok: false, ms, url, reason: 'BAD_RESPONSE' };
    if (body.error) return { ok: false, ms, url, reason: 'RPC_ERROR', detail: String(body.error?.message || '').slice(0, 160) };
    /* It answered — whatever it did before is history. */
    clearSolanaRpcCooldown(url);
    return { ok: true, ms, url, result: body.result };
  } catch (e) {
    const ms = Date.now() - started;
    const msg = String(e?.message || e || '');
    /* An abort we started ourselves is a timeout; anything else is the browser
       refusing the request (offline, DNS, CORS, a blocked host). Naming them
       differently is the whole point of this module. */
    const reason = /abort/i.test(msg) ? 'TIMEOUT' : 'UNREACHABLE';
    return { ok: false, ms, url, reason, detail: msg.slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

/* Chosen endpoint per `cluster|custom`, with the moment it was proven. */
const chosen = new Map();

const keyOf = (cluster, custom) => `${normalizeSolanaCluster(cluster)}|${custom || ''}`;

/**
 * Hosts that just refused or throttled us: url → { until, reason, status }.
 *
 * WHY A COOLDOWN AND NOT JUST A REORDER (2026-09-23)
 * --------------------------------------------------
 * The loan page read the market once per refresh, and every refresh began with
 * the FIRST candidate. `api.mainnet-beta.solana.com` answers a browser with
 * HTTP 403 from some networks and 429 when it is busy, so a user in that
 * situation paid a failing round trip on every single read, then read the
 * failure of the first host as the reason nothing worked. A host that just
 * refused us is by far the least likely one to answer in the next few minutes;
 * it moves to the back of the queue for a while, and comes back on its own.
 *
 * Nothing is ever removed from the list — a cooled host is still tried when
 * everything else fails, and the user's own RPC is never cooled at all (a
 * deliberate choice stays a choice, and it is the caller's to change).
 */
const cooling = new Map();

/** A throttle clears quickly; a refusal does not. */
const COOLDOWN_RATE_LIMIT_MS = 3 * 60 * 1000;
const COOLDOWN_REFUSAL_MS = 30 * 60 * 1000;

const pruneCooling = (now = Date.now()) => {
  for (const [url, row] of cooling) if (row.until <= now) cooling.delete(url);
};

/**
 * Record that a host just failed in a way that says «not right now».
 *
 * Called from `solanaRpcCall` for every failure, so every caller — the probe,
 * the lending reads, the balance reads — teaches the same map.
 *
 * @param {string} url
 * @param {string} reason RATE_LIMITED | BLOCKED | HTTP_xxx
 * @param {{status?:number|null}} [meta]
 * @returns {number|null} the moment the cooldown ends, or null when nothing was recorded
 */
export function noteSolanaRpcFailure(url, reason, { status = null } = {}) {
  const u = String(url || '').trim();
  if (!u) return null;
  const refused = reason === 'BLOCKED' || status === 401 || status === 403 || status === 451;
  const throttled = reason === 'RATE_LIMITED' || status === 429;
  if (!refused && !throttled) return null;
  const ms = refused ? COOLDOWN_REFUSAL_MS : COOLDOWN_RATE_LIMIT_MS;
  const until = Date.now() + ms;
  cooling.set(u, { until, reason: refused ? 'BLOCKED' : 'RATE_LIMITED', status: status ?? null });
  return until;
}

/** Is this host cooling right now? */
export function solanaRpcCooling(url) {
  pruneCooling();
  return cooling.get(String(url || '').trim()) || null;
}

/** Everything currently cooling — diagnostics, and the Settings screen. */
export function solanaRpcCooldowns() {
  pruneCooling();
  return [...cooling.entries()].map(([url, row]) => ({ url, ...row }));
}

/** Forget one host's cooldown (a successful call does this by itself). */
export function clearSolanaRpcCooldown(url = null) {
  if (url) cooling.delete(String(url).trim());
  else cooling.clear();
}

/** Drop the remembered choice (Settings changed, or a caller hit a wall). */
export function resetSolanaRpcChoice() {
  chosen.clear();
}

/**
 * Prove which endpoint answers, and remember it.
 *
 * Sequential on purpose: probing four nodes at once from a phone on a metered
 * connection is four requests where one would do, and the first one usually
 * answers in well under a second.
 */
export async function probeSolanaRpc({ cluster, custom, timeoutMs = RPC_TIMEOUT_MS, signal } = {}) {
  const settings = cluster ? { cluster: normalizeSolanaCluster(cluster), custom: custom || '' } : await readSolanaNetworkSettings();
  const candidates = solanaRpcCandidates(settings);
  const attempts = [];
  for (const url of candidates) {
    if (signal?.aborted) break;
    const r = await solanaRpcCall(url, 'getHealth', [], { timeoutMs, signal });
    attempts.push({ url, ok: r.ok, ms: r.ms, reason: r.ok ? null : r.reason, detail: r.detail || null });
    if (r.ok) {
      const key = keyOf(settings.cluster, settings.custom);
      chosen.set(key, { url, at: Date.now(), ms: r.ms });
      return { ok: true, url, cluster: settings.cluster, ms: r.ms, attempts };
    }
  }
  /* Nothing answered. Report the MOST INFORMATIVE reason, not the last one:
     four timeouts and one 429 should read as throttling, because that is the
     one a retry can fix.
     A BLOCKED attempt (401/403/451) counts as UNREACHABLE here on purpose: the
     existing vocabulary and its translations already say the honest thing
     («no Solana node is reachable from this network path — access to these
     services is most likely blocked»), and the per-host detail below still
     carries the exact status. Reporting a refusal as RATE_LIMITED was the bug;
     reporting it as "we cannot get through from here" is the truth. */
  const isBlocked = (a) => a.reason === 'BLOCKED';
  const dead = (a) => isBlocked(a) || a.reason === 'UNREACHABLE';
  const rateLimited = attempts.some((a) => a.reason === 'RATE_LIMITED');
  const unreachable = attempts.every(dead);
  const timedOut = !unreachable && attempts.every((a) => a.reason === 'TIMEOUT' || a.reason === 'RATE_LIMITED');
  return {
    ok: false,
    url: null,
    cluster: settings.cluster,
    attempts,
    blocked: attempts.some(isBlocked),
    reason: rateLimited && !unreachable ? 'RATE_LIMITED' : unreachable ? 'UNREACHABLE' : timedOut ? 'TIMEOUT' : 'UNAVAILABLE'
  };
}

/** The endpoint to use right now — the remembered winner, or a fresh probe. */
export async function getSolanaRpcUrl({ cluster, custom, force = false } = {}) {
  const settings = cluster ? { cluster: normalizeSolanaCluster(cluster), custom: custom || '' } : await readSolanaNetworkSettings();
  const key = keyOf(settings.cluster, settings.custom);
  const hit = chosen.get(key);
  if (!force && hit && Date.now() - hit.at < CHOICE_TTL_MS) return hit.url;
  /* A custom RPC is a deliberate choice: use it even if it does not answer a
     health probe, because the user may be pointing at a node that serves their
     own methods only. The public list is the fallback, not the override. */
  if (/^https:\/\//i.test(settings.custom)) return settings.custom;
  const probe = await probeSolanaRpc(settings);
  return probe.ok ? probe.url : (SOLANA_CLUSTER_RPCS[settings.cluster]?.[0] || 'https://api.mainnet-beta.solana.com');
}

/** A `Connection` for the user's cluster, built on the endpoint above. */
export async function makeSolanaConnection(commitment = 'confirmed', opts = {}) {
  const { Connection } = await import('@solana/web3.js');
  return new Connection(await getSolanaRpcUrl(opts), commitment);
}

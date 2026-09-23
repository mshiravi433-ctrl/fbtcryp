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

import { apiBase } from './apiBase.js';

/** Per-request ceiling. A public node that has not answered in 9s is not
    going to; the next candidate is cheaper than waiting. */
const RPC_TIMEOUT_MS = 9000;

/** How long a chosen endpoint is trusted before it is re-probed. */
const CHOICE_TTL_MS = 5 * 60 * 1000;

/**
 * Public, key-less, CORS-enabled clusters endpoints.
 *
 * ORDER MATTERS, and this list changed twice on 2026-09-23.
 *
 * First change: the Foundation endpoint used to be FIRST "because it is the one
 * every wallet and explorer agrees on" — which is true of wallets and false of
 * browsers: `api.mainnet-beta.solana.com` answers a web page with HTTP 429 when
 * it is busy and with a flat HTTP 403 ("access forbidden", region/provider
 * block) when it does not like the caller at all, and it is the host that
 * produced the loan page's «RPC_RATE_LIMITED» report.
 *
 * Second change: the four hosts below were then ALL of them refused by one real
 * user's network path — publicnode and the Foundation node with 403, drpc with
 * a 200 whose body the SDK could not use, onfinality with a 429 — and a list
 * where every entry can refuse a browser is not a failover list, it is four
 * ways to fail. Independent probes of ~50 keyless endpoints from deployed
 * workers (2026-09) found which ones still answer, and the three that did are
 * here now: Solana Tracker's public endpoint (keyless, documented for
 * @solana/web3.js), MagicBlock's public mainnet, and LeoRPC's shared FREE key —
 * the last one kept near the back, because a key somebody else published can be
 * revoked and it is a last resort, not a plan.
 *
 * `api.mainnet.solana.com` is the host the Solana Foundation's own RPC
 * documentation lists for mainnet today; `api.mainnet-beta.solana.com` is the
 * long-standing alias every wallet still uses. Both stay, both at the end: the
 * canonical node is kept rather than deleted, because a network where the
 * community nodes are blocked is a real network.
 *
 * AND NONE OF THIS IS THE WHOLE ANSWER. A 403 is a decision about the CALLER —
 * their IP, their provider, their region — so no ordering of public hosts makes
 * a blocked network path work. The app's own relay (below, and
 * server/solanaRpcRelay.js) is the candidate that is reachable whenever the app
 * itself is, which is why reads may opt into it.
 */
export const SOLANA_CLUSTER_RPCS = Object.freeze({
  'mainnet-beta': Object.freeze([
    'https://solana-rpc.publicnode.com',
    'https://rpc.solanatracker.io/public',
    'https://rpc.magicblock.app/mainnet',
    'https://solana.drpc.org',
    'https://solana.api.onfinality.io/public',
    'https://solana.leorpc.com/?api_key=FREE',
    'https://api.mainnet.solana.com',
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

/* ── THE APP'S OWN RELAY ─────────────────────────────────────────────────────
 *
 * A public node that answers HTTP 403 has made a decision about the CALLER: the
 * phone's IP, its provider, its region. No ordering, retry or cooldown in this
 * file changes that decision — the 2026-09-23 report is four hosts and four
 * refusals, and the honest reading is «this network path cannot reach the public
 * Solana nodes», not «pick a better public node».
 *
 * The app's own backend can. So `POST /api/solana/rpc` (server/solanaRpcRelay.js)
 * forwards an ALLOWLIST of read-only JSON-RPC methods from a datacentre IP that
 * those nodes do serve, and speaks plain JSON-RPC 2.0 — which means
 * `new Connection(relayUrl)` from @solana/web3.js works against it with no
 * adapter, no special casing in the SDK path and no second client.
 *
 * Two properties are load-bearing and both are enforced by the server:
 *   · it is NOT an open proxy (there is no url parameter — the upstream list
 *     lives there), and
 *   · it never broadcasts (`sendTransaction` is not relayed), so §30 still holds:
 *     the wallet signs AND sends its own transaction.
 *
 * That second point decides where the relay may appear. It is a candidate for
 * READS, and `getSolanaRpcUrl()` — the endpoint a broadcast is sent to — never
 * returns it.
 */

/** The relay's path under the app's own API base. */
export const SOLANA_RELAY_PATH = '/solana/rpc';

/**
 * The absolute URL of this app's Solana relay for one cluster, or null when
 * there is no origin to build one from (a Node test with no window, an SSR
 * render). Resolved through apiBase() rather than open-coded, because inside
 * the packaged APK a relative '/api' points at the phone's own asset server and
 * is a guaranteed 404 — the exact bug apiBase exists for.
 */
/**
 * The pure half of the relay URL, exported so the two rules below can be tested
 * without bending a browser's `location` (which jsdom makes unforgeable).
 *
 * @param {{ base?: string|null, origin?: string|null, cluster?: string }} input
 * @returns {string|null} an absolute URL, or null when there is no honest one
 */
export function relayUrlFrom({ base = null, origin = null, cluster = 'mainnet-beta' } = {}) {
  try {
    const c = normalizeSolanaCluster(cluster);
    const resolved = String(base ?? '').replace(/\/+$/, '');
    if (!resolved) return null;
    const path = `${resolved}${SOLANA_RELAY_PATH}?cluster=${c}`;
    /* An absolute base (VITE_API_BASE, or apiBase()'s answer inside the packaged
       app) is already a URL the phone can reach. */
    if (/^https?:\/\//i.test(path)) return path;
    const o = String(origin ?? '').replace(/\/+$/, '');
    /* Only a real http(s) origin can host the relay. Inside the WebView the page
       origin is https://localhost — the phone's OWN asset server, which serves
       the bundle and has no /api at all — and apiBase() already refuses to hand
       back a relative base there. Belt and braces on purpose: a relative path
       plus a localhost origin is not a relay, and inventing one would send every
       Solana read to the phone itself and report the network as dead. */
    if (!/^https?:\/\//i.test(o) || /^https:\/\/localhost$/i.test(o)) return null;
    return `${o}${path}`;
  } catch {
    return null;
  }
}

export function solanaRelayUrl({ cluster = 'mainnet-beta', base = null } = {}) {
  let resolvedBase = base;
  if (resolvedBase == null) {
    try { resolvedBase = apiBase(); } catch { resolvedBase = null; }
  }
  const origin = typeof window !== 'undefined' ? String(window.location?.origin || '') : '';
  return relayUrlFrom({ base: resolvedBase, origin, cluster });
}

/** Is this candidate the app's own relay? (It is never cooled, never broadcast
    through, and never remembered as a general-purpose endpoint.) */
export function isSolanaRelayUrl(url) {
  const u = String(url || '');
  return u.includes(SOLANA_RELAY_PATH);
}

/* ── «the public nodes are blocked from here» ──────────────────────────────
 *
 * The cooldown map below already knows this within a session: when every public
 * host is cooling as BLOCKED, the relay should be tried FIRST, not last, because
 * walking four hosts that have each already said no costs the user seconds and
 * teaches us nothing new.
 *
 * Across sessions that knowledge was lost, so every app start repeated the same
 * four refusals before reaching the relay — a slow, guaranteed-failing preamble
 * on the exact page the user opened. One localStorage line, written only when a
 * whole public list has just been refused and cleared the moment any public node
 * answers, keeps the next start honest. Six hours, because a block is a property
 * of a network path and network paths change (the user switches from Wi-Fi to
 * mobile data, the provider unblocks the host).
 */
const PUBLIC_BLOCKED_KEY = 'fbt.solana.rpc.publicsBlocked.v1';
const PUBLIC_BLOCKED_TTL_MS = 6 * 60 * 60 * 1000;

const readBlockedHint = () => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(PUBLIC_BLOCKED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!(Number(parsed.at) > 0) || Date.now() - Number(parsed.at) > PUBLIC_BLOCKED_TTL_MS) return null;
    return parsed;
  } catch { return null; }
};

/**
 * Remember that this cluster's public nodes refused us — every one of them.
 * Called from the read paths that walk the whole list, never from a single
 * host's failure (one refusal is a fact about one host, and the cooldown map
 * already handles that).
 */
export function noteSolanaPublicsBlocked(cluster = 'mainnet-beta') {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(PUBLIC_BLOCKED_KEY, JSON.stringify({ at: Date.now(), cluster: normalizeSolanaCluster(cluster) }));
    return true;
  } catch { return false; }
}

/** Forget the hint — a public node answered, or the user switched network. */
export function clearSolanaPublicsBlocked() {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.removeItem(PUBLIC_BLOCKED_KEY);
    return true;
  } catch { return false; }
}

/**
 * Should the relay be tried before the public nodes right now?
 *
 * True when the persisted hint says this cluster's publics were refused
 * recently, OR when every public candidate is cooling as BLOCKED in this
 * session. A throttle (429) alone does NOT qualify: waiting genuinely fixes
 * throttling, and a relay hop costs us upstream quota that a retry would not.
 */
export function solanaPublicsBlocked(cluster = 'mainnet-beta') {
  const c = normalizeSolanaCluster(cluster);
  const hint = readBlockedHint();
  if (hint && hint.cluster === c) return true;
  pruneCooling();
  const publics = SOLANA_CLUSTER_RPCS[c] || SOLANA_CLUSTER_RPCS['mainnet-beta'];
  if (!publics.length) return false;
  return publics.every((url) => cooling.get(url)?.reason === 'BLOCKED');
}

/**
 * The ordered candidate list for a cluster: the user's own RPC first (never
 * cooled — it is a deliberate choice), then the public list with any host that
 * recently refused or throttled us moved to the BACK.
 *
 * `relay` opts the app's own read-only relay in (see above): `true` resolves it
 * for this cluster, a string pins one (tests), and the default `null` leaves the
 * list exactly as it was — public nodes only. Its POSITION is decided by
 * `solanaPublicsBlocked`: first when the public nodes are known to be refusing
 * this network path, otherwise after the warm ones and before the cooled ones,
 * so a healthy network never spends a hop on our server.
 *
 * The order is stable for hosts in the same state, so two reads in a row do not
 * shuffle the list under each other.
 */
export function solanaRpcCandidates({ cluster = 'mainnet-beta', custom = '', relay = null } = {}) {
  const c = normalizeSolanaCluster(cluster);
  const customUrl = /^https:\/\//i.test(String(custom || '')) ? String(custom).trim() : '';
  pruneCooling();
  const publicList = (SOLANA_CLUSTER_RPCS[c] || SOLANA_CLUSTER_RPCS['mainnet-beta'])
    .filter((url) => url !== customUrl);
  const warm = publicList.filter((url) => !cooling.has(url));
  const cold = publicList.filter((url) => cooling.has(url));
  const relayUrl = relay === true
    ? solanaRelayUrl({ cluster: c })
    : (typeof relay === 'string' && /^https?:\/\//i.test(relay) ? relay : null);
  const relayFirst = Boolean(relayUrl) && solanaPublicsBlocked(c);
  const list = [
    ...(customUrl ? [customUrl] : []),
    ...(relayFirst ? [relayUrl] : []),
    ...warm,
    ...(relayUrl && !relayFirst ? [relayUrl] : []),
    ...cold
  ];
  return [...new Set(list.filter(Boolean))];
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
         that has to remember the host refused us.
         EXCEPT the relay: it is our own origin and the last resort, and cooling
         it would push the one candidate that is reachable whenever the app is
         behind hosts that have already said no. Its own failure is still
         reported to the caller, with the upstream's status intact. */
      if (!isSolanaRelayUrl(url)) noteSolanaRpcFailure(url, reason, { status: res.status });
      return { ok: false, ms, url, reason, detail: `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => null);
    if (!body) return { ok: false, ms, url, reason: 'BAD_RESPONSE' };
    if (body.error) return { ok: false, ms, url, reason: 'RPC_ERROR', detail: String(body.error?.message || '').slice(0, 160) };
    /* It answered — whatever it did before is history. */
    clearSolanaRpcCooldown(url);
    /* And if a PUBLIC node answered, the «publics are blocked from here» hint is
       stale: the network path changed, or the block lifted. Dropping it puts the
       free nodes back in front of our own relay, where they belong. */
    if (!isSolanaRelayUrl(url)) clearSolanaPublicsBlocked();
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
export async function probeSolanaRpc({ cluster, custom, timeoutMs = RPC_TIMEOUT_MS, signal, relay = false } = {}) {
  const settings = cluster ? { cluster: normalizeSolanaCluster(cluster), custom: custom || '' } : await readSolanaNetworkSettings();
  /* `relay` is opt-in and defaults OFF: the winner of this probe is remembered
     as the cluster's endpoint, and a remembered endpoint is what a BROADCAST is
     sent through (lib/solanaWallet.js → sendTransaction). The relay is read-only
     by construction, so it must never become that endpoint. Settings asks for it
     explicitly, because «can this app read Solana at all» is a different
     question from «which node should my wallet's transaction go to». */
  const candidates = solanaRpcCandidates({ ...settings, relay });
  const attempts = [];
  for (const url of candidates) {
    if (signal?.aborted) break;
    const r = await solanaRpcCall(url, 'getHealth', [], { timeoutMs, signal });
    attempts.push({ url, ok: r.ok, ms: r.ms, reason: r.ok ? null : r.reason, detail: r.detail || null, relay: isSolanaRelayUrl(url) });
    if (r.ok) {
      if (!isSolanaRelayUrl(url)) {
        const key = keyOf(settings.cluster, settings.custom);
        chosen.set(key, { url, at: Date.now(), ms: r.ms });
      }
      return { ok: true, url, cluster: settings.cluster, ms: r.ms, relay: isSolanaRelayUrl(url), attempts };
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
  /* Every PUBLIC host refused (403/401/451): that is a fact about this network
     path, not about one node, so the next start begins with the relay instead of
     repeating four known refusals first. A list that merely timed out is NOT
     written — an unreachable host may be a dead Wi-Fi, and the remedy there is a
     retry, not a hop through our server. */
  const publicAttempts = attempts.filter((a) => !a.relay);
  if (publicAttempts.length > 0 && publicAttempts.every(isBlocked)) noteSolanaPublicsBlocked(settings.cluster);
  return {
    ok: false,
    url: null,
    cluster: settings.cluster,
    attempts,
    blocked: attempts.some(isBlocked),
    reason: rateLimited && !unreachable ? 'RATE_LIMITED' : unreachable ? 'UNREACHABLE' : timedOut ? 'TIMEOUT' : 'UNAVAILABLE'
  };
}

/**
 * The endpoint to use right now — the remembered winner, or a fresh probe.
 *
 * NEVER the relay. This URL is what a signed transaction is broadcast through,
 * and the relay does not forward sendTransaction (deliberately: the wallet signs
 * AND sends, §30). Reads that may use the relay ask for the candidate list
 * directly — `solanaRpcCandidates({ relay: true })`.
 */
export async function getSolanaRpcUrl({ cluster, custom, force = false } = {}) {
  const settings = cluster ? { cluster: normalizeSolanaCluster(cluster), custom: custom || '' } : await readSolanaNetworkSettings();
  const key = keyOf(settings.cluster, settings.custom);
  const hit = chosen.get(key);
  /* Defensive: a relay URL can only reach `chosen` from a caller that probed with
     `relay: true` and ignored the guard in probeSolanaRpc. Believing it would
     send somebody's broadcast to an endpoint that refuses to broadcast. */
  if (!force && hit && Date.now() - hit.at < CHOICE_TTL_MS && !isSolanaRelayUrl(hit.url)) return hit.url;
  /* A custom RPC is a deliberate choice: use it even if it does not answer a
     health probe, because the user may be pointing at a node that serves their
     own methods only. The public list is the fallback, not the override. */
  if (/^https:\/\//i.test(settings.custom)) return settings.custom;
  const probe = await probeSolanaRpc(settings);
  if (probe.ok && !isSolanaRelayUrl(probe.url)) return probe.url;
  return SOLANA_CLUSTER_RPCS[settings.cluster]?.[0] || 'https://api.mainnet-beta.solana.com';
}

/** A `Connection` for the user's cluster, built on the endpoint above. */
export async function makeSolanaConnection(commitment = 'confirmed', opts = {}) {
  const { Connection } = await import('@solana/web3.js');
  return new Connection(await getSolanaRpcUrl(opts), commitment);
}

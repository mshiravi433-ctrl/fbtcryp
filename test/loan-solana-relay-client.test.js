// @vitest-environment jsdom
/**
 * THE RELAY AS A CANDIDATE — where the app's own door sits in the list, and the
 * one place it must never be allowed to stand.
 *
 * The server half is pinned in test/loan-solana-relay.test.js. This is the
 * client half, and it has two properties that matter more than convenience:
 *
 *   · A relay hop costs us upstream quota, so a network that can already reach a
 *     public node must NOT be routed through our server. The relay sits behind
 *     the warm public nodes — and moves to the FRONT only when this network path
 *     has already proved it cannot reach them (every one of them cooling as
 *     BLOCKED, or a remembered refusal from a previous session). That memory is
 *     what stops every app start from paying four known-dead round trips before
 *     the page can read anything, which is what the 2026-09-23 report looked like.
 *
 *   · The relay is READ-ONLY. `getSolanaRpcUrl()` is the endpoint a signed
 *     transaction is broadcast through (lib/solanaWallet.js → sendTransaction),
 *     so it must never return the relay — not from a remembered choice, not from
 *     a probe. §30 keeps its meaning: the wallet signs AND sends.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  SOLANA_CLUSTER_RPCS, SOLANA_RELAY_PATH,
  solanaRelayUrl, relayUrlFrom, isSolanaRelayUrl, solanaRpcCandidates, solanaPublicsBlocked,
  noteSolanaPublicsBlocked, clearSolanaPublicsBlocked,
  noteSolanaRpcFailure, solanaRpcCall, solanaRpcCooling, clearSolanaRpcCooldown, solanaRpcCooldowns,
  resetSolanaRpcChoice, probeSolanaRpc, getSolanaRpcUrl
} from '../src/lib/solanaRpc.js';
import { lendingRpcFailure } from '../src/lib/solanaLending.js';

const PUBLICS = SOLANA_CLUSTER_RPCS['mainnet-beta'];
const realFetch = globalThis.fetch;

/** Every public node refuses the browser (the reported network path); our own
    relay answers. */
function installBlockedPublics() {
  globalThis.fetch = async (url) => {
    if (isSolanaRelayUrl(url)) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('Your IP or provider is blocked from this endpoint', { status: 403 });
  };
}

/** Every public node answers; the relay is never needed. */
function installHealthyPublics() {
  globalThis.fetch = async (url) => new Response(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: isSolanaRelayUrl(url) ? 'relay' : 'ok' }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

const reset = () => {
  clearSolanaRpcCooldown();
  clearSolanaPublicsBlocked();
  resetSolanaRpcChoice();
  try { localStorage.clear(); } catch { /* no storage in this env */ }
};

beforeEach(reset);
afterEach(() => {
  reset();
  globalThis.fetch = realFetch;
});

/* ═══════════════════════════ the relay's own URL ══════════════════════════ */

describe('the relay is reached at this app’s own origin, never at the phone’s', () => {
  it('builds an absolute same-origin URL, tagged with the cluster', () => {
    const url = solanaRelayUrl({ cluster: 'mainnet-beta' });
    expect(url).toContain(SOLANA_RELAY_PATH);
    expect(url).toContain('cluster=mainnet-beta');
    expect(url.startsWith(window.location.origin)).toBe(true);
    expect(isSolanaRelayUrl(url)).toBe(true);
    /* A query string must survive, or a devnet read would silently go to
       mainnet — the same class of lie the cluster selector exists to prevent. */
    expect(solanaRelayUrl({ cluster: 'devnet' })).toContain('cluster=devnet');
  });

  it('refuses to invent a relay inside the packaged app, where the page origin is the phone itself', () => {
    /* apiBase() already rejects a relative base in the native shell; this is the
       second layer, and it is the one that stops a WebView from POSTing RPC reads
       at https://localhost — its own asset server, which has no /api at all. */
    expect(relayUrlFrom({ base: '/api', origin: 'https://localhost' })).toBe(null);
    expect(relayUrlFrom({ base: '/api', origin: 'http://127.0.0.1:5173' })).toBe('http://127.0.0.1:5173/api/solana/rpc?cluster=mainnet-beta');
    /* An absolute base (what apiBase returns in the shell, resolved from the
       configured production origin) is still a relay. */
    expect(relayUrlFrom({ base: 'https://app.example.com/api', origin: 'https://localhost' }))
      .toBe('https://app.example.com/api/solana/rpc?cluster=mainnet-beta');
    expect(relayUrlFrom({ base: 'https://app.example.com/api/', cluster: 'devnet' }))
      .toBe('https://app.example.com/api/solana/rpc?cluster=devnet');
    expect(solanaRelayUrl({ base: 'https://app.example.com/api' })).toBe('https://app.example.com/api/solana/rpc?cluster=mainnet-beta');
    expect(relayUrlFrom({ base: '', origin: '' })).toBe(null);
  });
});

/* ═══════════════════════════ candidate ordering ═══════════════════════════ */

describe('a healthy network never spends a hop on our server', () => {
  it('leaves the list untouched unless a caller opts the relay in', () => {
    const without = solanaRpcCandidates({ cluster: 'mainnet-beta' });
    expect(without).toEqual([...PUBLICS]);
    expect(without.some(isSolanaRelayUrl)).toBe(false);

    const withRelay = solanaRpcCandidates({ cluster: 'mainnet-beta', relay: true });
    expect(withRelay.filter(isSolanaRelayUrl).length).toBe(1);
    expect(withRelay.length).toBe(PUBLICS.length + 1);
    /* Behind the warm public nodes: they are free, and ours is not. */
    expect(withRelay.indexOf(withRelay.find(isSolanaRelayUrl))).toBeGreaterThan(PUBLICS.length - 1);
  });

  it('keeps the user’s own RPC in front of everything, relay included', () => {
    const custom = 'https://my-own-node.example.com/rpc';
    noteSolanaPublicsBlocked('mainnet-beta');
    const list = solanaRpcCandidates({ cluster: 'mainnet-beta', custom, relay: true });
    expect(list[0]).toBe(custom);
    expect(isSolanaRelayUrl(list[1]), 'the relay is next, ahead of nodes this path cannot reach').toBe(true);
  });

  it('moves the relay to the front once every public node has refused this path', () => {
    expect(solanaPublicsBlocked('mainnet-beta')).toBe(false);
    for (const url of PUBLICS) noteSolanaRpcFailure(url, 'BLOCKED', { status: 403 });
    expect(solanaPublicsBlocked('mainnet-beta')).toBe(true);

    const list = solanaRpcCandidates({ cluster: 'mainnet-beta', relay: true });
    expect(isSolanaRelayUrl(list[0]), 'the first thing tried is the one that can answer').toBe(true);
    /* Cooled publics are still on the list — a refusal is a fact about a moment,
       and the last resort is never deleted. */
    expect(list.filter((u) => PUBLICS.includes(u)).length).toBe(PUBLICS.length);
  });

  it('a throttle is not a verdict on the network path — it reorders, and is not remembered', () => {
    /* 429 is fixed by waiting, so it must NOT be written down as «this path
       cannot reach the public nodes»: that hint would outlive the throttle and
       route a healthy network through our server for hours. */
    for (const url of PUBLICS) noteSolanaRpcFailure(url, 'RATE_LIMITED', { status: 429 });
    expect(solanaPublicsBlocked('mainnet-beta')).toBe(false);

    /* Within the session, though, every public node is busy right now — so there
       is nothing warm left to try and the relay is the next door, ahead of the
       throttled hosts. Waiting is the remedy for a throttle; showing an empty
       page while we wait is not. */
    const list = solanaRpcCandidates({ cluster: 'mainnet-beta', relay: true });
    expect(isSolanaRelayUrl(list[0])).toBe(true);
    expect(list.filter((u) => PUBLICS.includes(u)).length).toBe(PUBLICS.length);

    /* One warm public node puts the free path back in front of our server. */
    clearSolanaRpcCooldown(PUBLICS[0]);
    expect(isSolanaRelayUrl(solanaRpcCandidates({ cluster: 'mainnet-beta', relay: true })[0])).toBe(false);
  });

  it('remembers a whole-list refusal across sessions, and forgets it the moment a public node answers', () => {
    expect(noteSolanaPublicsBlocked('mainnet-beta')).toBe(true);
    expect(solanaPublicsBlocked('mainnet-beta')).toBe(true);
    expect(isSolanaRelayUrl(solanaRpcCandidates({ cluster: 'mainnet-beta', relay: true })[0])).toBe(true);

    clearSolanaPublicsBlocked();
    expect(solanaPublicsBlocked('mainnet-beta')).toBe(false);
    expect(isSolanaRelayUrl(solanaRpcCandidates({ cluster: 'mainnet-beta', relay: true })[0])).toBe(false);
  });

  it('is a hint for THIS cluster, not for every network', () => {
    noteSolanaPublicsBlocked('devnet');
    expect(solanaPublicsBlocked('devnet')).toBe(true);
    expect(solanaPublicsBlocked('mainnet-beta')).toBe(false);
  });

  it('never cools its own relay — the last resort cannot be pushed behind the hosts that already failed', async () => {
    const relay = solanaRelayUrl({ cluster: 'mainnet-beta' });
    installBlockedPublics();
    await probeSolanaRpc({ cluster: 'mainnet-beta', relay: true });
    expect(solanaRpcCooldowns().map((row) => row.url), 'the relay is not in the cooldown map').not.toContain(relay);
    expect(solanaRpcCooldowns().length).toBeGreaterThan(0);

    noteSolanaRpcFailure(relay, 'BLOCKED', { status: 403 });
    const list = solanaRpcCandidates({ cluster: 'mainnet-beta', relay: true });
    expect(list).toContain(relay);
    expect(isSolanaRelayUrl(list[0])).toBe(true);
  });
});

/* ═════════════════ the boundary that keeps §30 true ═══════════════════════ */

describe('the read-only relay can never become the broadcast endpoint', () => {
  it('a probe may win through the relay, and says so', async () => {
    installBlockedPublics();
    const probe = await probeSolanaRpc({ cluster: 'mainnet-beta', relay: true });
    expect(probe.ok).toBe(true);
    expect(probe.relay).toBe(true);
    expect(isSolanaRelayUrl(probe.url)).toBe(true);
    expect(probe.attempts.filter((a) => a.relay).length).toBe(1);
    /* Every public refusal is a fact about this network path, and it is written
       down so the next start does not repeat it. */
    expect(solanaPublicsBlocked('mainnet-beta')).toBe(true);
  });

  it('the endpoint a transaction is sent to is never the relay', async () => {
    installBlockedPublics();
    await probeSolanaRpc({ cluster: 'mainnet-beta', relay: true });
    const forBroadcast = await getSolanaRpcUrl({ cluster: 'mainnet-beta' });
    expect(isSolanaRelayUrl(forBroadcast), 'sendTransaction is not relayed, so this URL must not be the relay').toBe(false);
    expect(forBroadcast).toBe(PUBLICS[0]);
  });

  it('a probe that is not asked for the relay cannot put one in the remembered choice', async () => {
    installHealthyPublics();
    const probe = await probeSolanaRpc({ cluster: 'mainnet-beta' });
    expect(probe.ok).toBe(true);
    expect(probe.relay).toBe(false);
    expect(await getSolanaRpcUrl({ cluster: 'mainnet-beta' })).toBe(probe.url);
    expect(PUBLICS).toContain(probe.url);
  });

  it('a custom RPC still wins outright, relay or not', async () => {
    installBlockedPublics();
    const custom = 'https://my-own-node.example.com/rpc';
    const url = await getSolanaRpcUrl({ cluster: 'mainnet-beta', custom });
    expect(url).toBe(custom);
  });
});

/* ═══════════════════════ the incident panel’s honesty ═════════════════════ */

describe('our own domain is never listed among the public nodes that refused you', () => {
  it('labels the relay row so the panel can name it in the user’s language', () => {
    const relay = 'https://app.example.com/api/solana/rpc?cluster=mainnet-beta';
    const error = lendingRpcFailure([
      { url: 'https://solana-rpc.publicnode.com', error: 'Error: 403 : {"jsonrpc":"2.0","error":{' },
      { url: relay, error: 'Error: 403 : every Solana node this relay tried refused the request' }
    ]);
    expect(error.code).toBe('RPC_BLOCKED');
    expect(error.hosts.length).toBe(2);
    expect(error.hosts[0]).toMatchObject({ host: 'solana-rpc.publicnode.com', reason: 'RPC_BLOCKED', relay: false });
    expect(error.hosts[1].relay, 'the relay row is flagged, not shown as a hostname').toBe(true);
    expect(error.hosts[1].reason).toBe('RPC_BLOCKED');
  });

  it('still names the honest class when only the relay was tried', () => {
    const error = lendingRpcFailure([
      { url: 'https://app.example.com/api/solana/rpc?cluster=mainnet-beta', error: 'Error: 429 : the relay budget for this caller is spent' }
    ]);
    expect(error.code).toBe('RPC_RATE_LIMITED');
    expect(error.hosts[0].relay).toBe(true);
  });

  /*
   * Report 2026-09-23 (second), the app's own relay row:
   *
   *   «رلهٔ خود برنامه — آن گره پاسخ داد، ولی پاسخی که نتوانستیم استفاده کنیم»
   *
   * The relay had answered the market account and then refused the RESERVE
   * batch with `-32601 … is not relayed` — because the allowlist carried the
   * JS-level name `getMultipleAccountsInfo` and web3.js sends
   * `getMultipleAccounts`. Every sentence in the old vocabulary pointed the
   * user at the network («try again», «enter your own RPC»), for a bug that
   * lived in this repo. The row and the headline now say so.
   */
  it('names our own relay’s method refusal as OURS, not as a node failure', () => {
    const error = lendingRpcFailure([
      {
        url: 'https://app.example.com/api/solana/rpc?cluster=mainnet-beta',
        code: -32601,
        error: 'failed to get info for accounts 7u3He…: method getMultipleAccounts is not relayed: this endpoint is read-only and forwards an allowlist'
      }
    ]);
    expect(error.code).toBe('RELAY_METHOD_UNAVAILABLE');
    expect(error.hosts[0]).toMatchObject({ relay: true, reason: 'RELAY_METHOD_UNAVAILABLE' });
    expect(error.hosts[0].reason).not.toBe('RPC_UNAVAILABLE');
  });

  it('does not put OUR word in a public node’s mouth', () => {
    /* Only the relay carries the app’s own refusal text. A public node that
       happens to answer the same words is not «our relay» and gets no such
       label — the row must keep meaning what it says. */
    const error = lendingRpcFailure([
      { url: 'https://solana-rpc.publicnode.com', code: -32601, error: 'method getMultipleAccounts is not relayed' }
    ]);
    expect(error.hosts[0].reason).not.toBe('RELAY_METHOD_UNAVAILABLE');
    expect(error.code).not.toBe('RELAY_METHOD_UNAVAILABLE');
  });
});

/* ═════════ a node that answered with something unusable is not warm ═══════ */

describe('an unusable answer is remembered, so the next read is not a repeat', () => {
  it('cools a host that answered 200 with something that is not JSON-RPC', async () => {
    const host = PUBLICS[0];
    globalThis.fetch = async () => new Response('<html>blocked by a middlebox</html>', {
      status: 200, headers: { 'content-type': 'text/html' }
    });
    const out = await solanaRpcCall(host, 'getAccountInfo', ['7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF']);
    expect(out.reason).toBe('BAD_RESPONSE');
    /* Remembered as its own class: not a refusal (the host did not say no) and
       not a throttle (waiting changes nothing about the body). */
    expect(solanaRpcCooling(host)?.reason).toBe('UNUSABLE');
    /* It is therefore not «warm» any more: the next read walks the list past the
       relay before it reaches this host again. */
    const list = solanaRpcCandidates({ cluster: 'mainnet-beta', relay: true });
    expect(list.indexOf(host)).toBeGreaterThan(list.findIndex(isSolanaRelayUrl));
  });

  it('a whole list of unusable answers is the same verdict as a whole list of refusals', async () => {
    /* Report 2026-09-23 (second): the path produced a MIX — 403s, a 429, a
       connection error and two unusable 200s — so the old rule («every host
       BLOCKED») never fired and all nine candidates were walked again on the
       next load. Unusable answers now count towards the same verdict. */
    globalThis.fetch = async () => new Response('<!doctype html><html>nope</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    for (const url of PUBLICS) await solanaRpcCall(url, 'getHealth', []);
    expect(PUBLICS.every((url) => solanaRpcCooling(url)?.reason === 'UNUSABLE')).toBe(true);
    expect(solanaPublicsBlocked('mainnet-beta')).toBe(true);
    expect(isSolanaRelayUrl(solanaRpcCandidates({ cluster: 'mainnet-beta', relay: true })[0])).toBe(true);
  });
});

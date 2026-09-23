/**
 * THE SOLANA RPC RELAY — the door that stays open when every public node has
 * refused the browser.
 *
 * Report 2026-09-23: «هر گره RPC عمومی که امتحان کردیم پاسخ نداد» — four hosts,
 * four refusals (two HTTP 403, one 429, one 200 whose body the SDK could not
 * use), so the loan page could not read Kamino and correctly refused to send any
 * transaction. A 403 is a decision about the CALLER, so the fix cannot be a
 * better-ordered public list; it has to be a different caller. This suite pins
 * the relay that provides one, and the properties that keep it from becoming a
 * liability:
 *
 *   1. READ-ONLY BY CONSTRUCTION — no sendTransaction, no airdrop, no block
 *      dumps. The wallet signs AND broadcasts (§30); a relay that could broadcast
 *      would be a relay somebody else could aim.
 *   2. NOT AN OPEN PROXY — a caller picks a method, never a host.
 *   3. HONEST FAILURES — an upstream's own status is forwarded, because the
 *      client's classifier is status-first and 403 (blocked, another node will
 *      not help) and 429 (throttled, retry) have different remedies.
 *   4. A NODE THAT ANSWERS IS NOT A NODE THAT SERVES — a 200 with
 *      «Request blocked» is a method refusal, remembered per host AND method.
 *   5. CHEAP FOR US — the global market read is shared for a couple of seconds;
 *      the inputs to a signature never are.
 *   6. NO SECRET EVER LEAVES — a keyed upstream is redacted in every response.
 *   7. IT SPEAKS THE SDK'S LANGUAGE — the methods it forwards are the ones that
 *      go on the wire, and the JS-level names web3.js exposes are resolved onto
 *      them. Report 2026-09-23 (second): `getMultipleAccountsInfo` was allowed
 *      and `getMultipleAccounts` was not, so the relay refused the second call
 *      of every Kamino market load and the page blamed the network.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  relaySolanaRpc, relayStatus, relayUpstreams, redactUpstream,
  RELAY_METHODS, relayMethodNames, resetRelayMemory
} from '../server/solanaRpcRelay.js';

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };

/** Record every upstream call so a test can assert WHO was asked, not just what
    came back. */
let calls = [];
/** Per-host behaviour: host → (method, params) => response spec. */
let behaviour = () => ({ status: 200, result: 'ok' });

function installFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const host = new URL(url).host;
    calls.push({ url, host, method: body.method, params: body.params });
    const spec = await behaviour({ host, url, method: body.method, params: body.params });
    if (spec.huge) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'x'.repeat(spec.huge) }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (spec.status !== 200) {
      return new Response(spec.text || 'nope', { status: spec.status, headers: { 'content-type': 'text/plain' } });
    }
    const payload = spec.error
      ? { jsonrpc: '2.0', id: 1, error: spec.error }
      : { jsonrpc: '2.0', id: 1, result: spec.result ?? null };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

beforeEach(() => {
  resetRelayMemory();
  calls = [];
  behaviour = () => ({ status: 200, result: 'ok' });
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in realEnv)) delete process.env[key];
  for (const [key, value] of Object.entries(realEnv)) process.env[key] = value;
  resetRelayMemory();
});

const rpc = (method, params = [], id = 7, extra = {}) => ({ jsonrpc: '2.0', id, method, params, ...extra });
const hostsAsked = () => calls.map((c) => c.host);

/**
 * The host the relay asks FIRST, derived at call time.
 *
 * Three tests below used to hardcode `rpc.solanatracker.io` as "the first
 * upstream", and the server's order is deliberately re-measured from deployed
 * workers now and then (see DEFAULT_UPSTREAMS in server/solanaRpcRelay.js) — so
 * a reorder silently turned "the walk continued past a refusal" into "the first
 * host answered at once", and the tests went red without anything being broken.
 * What is under test is the WALK, not which vendor happens to be first, so the
 * refusing host is read from the same function the relay uses.
 */
const firstUpstreamHost = () => new URL(relayUpstreams('mainnet-beta')[0]).host;

/* ═══════════════════════════ 1. read-only by construction ═════════════════ */

describe('the relay forwards reads and nothing that can move money', () => {
  it('has no write method in its allowlist at all', () => {
    const names = relayMethodNames();
    expect(names.length).toBeGreaterThan(20);
    for (const banned of ['sendTransaction', 'sendRawTransaction', 'requestAirdrop', 'sendPrivilegedTransaction', 'setLogFilter']) {
      expect(names, `${banned} must never be relayed`).not.toContain(banned);
      expect(RELAY_METHODS[banned]).toBeUndefined();
    }
    /* The reads the Kamino market load and the wallet balance read actually
       make — a relay missing one of these would send the page back to the
       public nodes it exists to replace.
       THE NAMES HERE ARE THE ONES THAT GO ON THE WIRE, not the JS method names
       (2026-09-23, second report). This list used to say
       `getMultipleAccountsInfo` — the name of the web3.js METHOD — while the
       request web3.js sends is `getMultipleAccounts`, so the allowlist held a
       method no node serves and refused the real one. The Kamino market load
       makes exactly that call second (klend-sdk market.js:239), which is why
       the page could read the market account and nothing else. */
    for (const needed of ['getHealth', 'getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts',
      'getTokenAccountsByOwner', 'getBalance', 'getLatestBlockhash', 'getSlot',
      'getSignatureStatuses', 'getMinimumBalanceForRentExemption']) {
      expect(names, `${needed} is needed by the loan page`).toContain(needed);
    }
  });

  it('refuses sendTransaction the way a node refuses a method it does not serve', async () => {
    const out = await relaySolanaRpc({ body: rpc('sendTransaction', ['base64tx']), ip: '1.1.1.1' });
    /* -32601 inside a 200 is deliberate: an SDK walking endpoints treats this
       relay exactly like a node that lacks the method, and moves on. */
    expect(out.status).toBe(200);
    expect(out.body.error.code).toBe(-32601);
    expect(out.body.id).toBe(7);
    expect(calls.length, 'nothing may reach an upstream for a refused method').toBe(0);
  });

  it('refuses the expensive dumps no screen in this app reads', async () => {
    for (const method of ['getBlock', 'getBlocks', 'getSupply', 'getClusterNodes', 'requestAirdrop', 'madeUpMethod']) {
      const out = await relaySolanaRpc({ body: rpc(method, []), ip: '1.1.1.2' });
      expect(out.body.error.code, method).toBe(-32601);
    }
    expect(calls.length).toBe(0);
  });

  it('refuses a batch and a malformed body before anything is dialled', async () => {
    const batch = await relaySolanaRpc({ body: [rpc('getHealth'), rpc('getSlot')], ip: '1.1.1.3' });
    expect(batch.status).toBe(400);
    expect(batch.body.error.code).toBe(-32600);

    const noMethod = await relaySolanaRpc({ body: { jsonrpc: '2.0', id: 1 }, ip: '1.1.1.3' });
    expect(noMethod.status).toBe(400);

    const badParams = await relaySolanaRpc({ body: { jsonrpc: '2.0', id: 1, method: 'getBalance', params: 'nope' }, ip: '1.1.1.3' });
    expect(badParams.status).toBe(400);
    expect(badParams.body.error.code).toBe(-32602);
    expect(calls.length).toBe(0);
  });

  it('answers 503 when it is switched off, so the client falls through to the public nodes', async () => {
    process.env.SOLANA_RELAY_ENABLED = 'false';
    const out = await relaySolanaRpc({ body: rpc('getHealth'), ip: '1.1.1.4' });
    expect(out.status).toBe(503);
    expect(out.body.error.code).toBe(-32001);
    expect(calls.length).toBe(0);
    expect(relayStatus().enabled).toBe(false);
  });
});

/* ══════════ the wire method behind the SDK call, not the JS name ══════════
 *
 * THE DEFECT THIS PINS (2026-09-23, second report: the app's own relay listed
 * among the nodes that «answered, but with something we could not use»).
 *
 * `connection.getMultipleAccountsInfo(pks)` does NOT send a method called
 * `getMultipleAccountsInfo`: web3.js puts `getMultipleAccounts` on the wire
 * (dist/index.cjs.js, `_rpcRequest('getMultipleAccounts', args)`). The relay's
 * allowlist was written from the JS side, so it allowed the name no node has
 * and refused the one the Kamino reserve load actually sends — and because
 * that call is the SECOND one `KaminoMarket.load()` makes (market.js:239,
 * `loadReserves`), the page read the market account and then died on the
 * reserves, reporting a node-shaped failure for an app-shaped bug.
 *
 * A list of names cannot catch that, so this drives the REAL web3.js
 * `Connection` into the REAL relay with no network at all: what the SDK sends
 * is what the relay must serve.
 */
describe('the SDK’s own calls reach an upstream through this relay', () => {
  const RELAY = 'https://app.example.com/api/solana/rpc?cluster=mainnet-beta';
  const MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';

  /**
   * web3.js → our relay → the stub upstreams the outer harness controls.
   *
   * Handed to the `Connection` as its `fetch` option rather than patched onto
   * `globalThis`: web3.js resolves its transport's fetch when the module is
   * first evaluated, so a global patch applied later silently does nothing and
   * the test would pass against the harness's own stub — a false green in
   * exactly the file that exists because a name was assumed instead of
   * measured.
   */
  const relayFetch = (ip) => async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const out = await relaySolanaRpc({ body, cluster: 'mainnet-beta', ip });
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { 'content-type': 'application/json' } });
  };

  it('serves getMultipleAccounts — the call behind connection.getMultipleAccountsInfo', async () => {
    const { Connection, PublicKey } = await import('@solana/web3.js');
    /* A missing account is a legitimate answer, and it keeps this test about the
       METHOD rather than about decoding real Kamino bytes. */
    behaviour = () => ({ status: 200, result: { context: { slot: 1 }, value: [null] } });
    const connection = new Connection(RELAY, { commitment: 'confirmed', fetch: relayFetch('5.5.5.5') });
    const infos = await connection.getMultipleAccountsInfo([new PublicKey(MARKET)]);
    expect(infos).toEqual([null]);
    /* Served — so it was dialled, under the wire name the SDK actually used. */
    expect(calls.map((c) => c.method)).toEqual(['getMultipleAccounts']);
  });

  it('still serves a caller that asks using the JS-level name', async () => {
    /* A name no node has is NOT refused: see RELAY_METHOD_ALIASES. Serving it is
       the difference between an app-side gap and a working read. */
    const out = await relaySolanaRpc({
      body: rpc('getMultipleAccountsInfo', [[MARKET]]),
      ip: '5.5.5.6'
    });
    expect(out.body.error, 'a JS-level name must not be refused').toBeUndefined();
    expect(calls.map((c) => c.method)).toEqual(['getMultipleAccounts']);
  });

  it('names the refusal as ours when it really is ours', async () => {
    /* The other half of the honesty rule: when the relay DOES refuse a method,
       the caller must be able to tell «this endpoint does not forward it» from
       «a node failed» without reading English prose. */
    const out = await relaySolanaRpc({ body: rpc('getLeaderSchedule', []), ip: '5.5.5.7' });
    expect(out.status).toBe(200);
    expect(out.body.error.code).toBe(-32601);
    expect(out.body.error.data).toMatchObject({ relay: true, stage: 'allowlist', method: 'getLeaderSchedule' });
    expect(calls.length).toBe(0);
  });
});

/* ═══════════════════════════ 2. not an open proxy ═════════════════════════ */

describe('a caller picks a method, never a host', () => {
  it('ignores every way of smuggling an upstream into the request', async () => {
    const out = await relaySolanaRpc({
      body: rpc('getHealth', [], 3, { url: 'https://evil.example/rpc', endpoint: 'https://evil.example/rpc' }),
      ip: '2.2.2.2',
      /* A cluster is the one thing a caller may choose, and only among the three
         the app itself supports. */
      cluster: 'https://evil.example/rpc'
    });
    expect(out.status).toBe(200);
    expect(out.body.id).toBe(3);
    expect(hostsAsked().every((h) => !h.includes('evil.example'))).toBe(true);
    expect(hostsAsked().length).toBe(1);
    /* An unrecognised cluster is mainnet — the real network, never a guess. */
    expect(hostsAsked()[0]).toBe(new URL(relayUpstreams('mainnet-beta')[0]).host);
  });

  it('only ever dials https upstreams from its own list', async () => {
    process.env.SOLANA_RELAY_UPSTREAMS = 'https://a.example/rpc, http://plain.example/rpc, not-a-url, https://b.example/rpc';
    behaviour = () => ({ status: 403 });
    await relaySolanaRpc({ body: rpc('getHealth'), ip: '2.2.2.3' });
    expect(hostsAsked()).toEqual(['a.example', 'b.example']);
  });

  it('puts the app’s own node first when one is configured', async () => {
    process.env.SOLANA_RPC_URL = 'https://mainnet.example/?api-key=SECRET123';
    behaviour = () => ({ status: 200, result: { context: { slot: 1 }, value: 'ok' } });
    await relaySolanaRpc({ body: rpc('getAccountInfo', ['7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF']), ip: '2.2.2.4' });
    expect(calls[0].host).toBe('mainnet.example');
    /* …and the key never leaves the server. */
    const status = JSON.stringify(relayStatus());
    expect(status).not.toContain('SECRET123');
    expect(redactUpstream('https://mainnet.example/?api-key=SECRET123')).toBe('https://mainnet.example');
    expect(redactUpstream('https://mainnet.example/rpc?api-key=SECRET123')).toBe('https://mainnet.example/rpc');
    expect(relayStatus().ownUpstreamConfigured).toBe(true);
  });
});

/* ═══════════════════════════ 3. honest failures ═══════════════════════════ */

describe('the failure a user is told about is the failure that happened', () => {
  it('forwards an upstream refusal with the upstream’s own status, not a generic 502', async () => {
    behaviour = () => ({ status: 403, text: 'Your IP or provider is blocked from this endpoint' });
    const out = await relaySolanaRpc({ body: rpc('getHealth'), ip: '3.3.3.1' });
    expect(out.status).toBe(403);
    expect(out.body.error.message).toMatch(/403/);
    expect(out.body.error.message).toMatch(/refused|blocked/i);
    expect(out.body.error.data.attempts.length).toBeGreaterThan(1);
    expect(out.body.error.data.attempts.every((a) => a.ok === false)).toBe(true);
  });

  it('reports throttling as throttling when that is what every upstream said', async () => {
    behaviour = () => ({ status: 429 });
    const out = await relaySolanaRpc({ body: rpc('getHealth'), ip: '3.3.3.2' });
    expect(out.status).toBe(429);
    expect(out.body.error.message).toMatch(/429/);
  });

  it('does not let one 403 hide a node that would have answered', async () => {
    /* The FIRST host in the server's own order has to be the one that refuses,
       or the walk is not the thing under test. */
    const refusing = firstUpstreamHost();
    behaviour = ({ host }) => (host === refusing ? { status: 403 } : { status: 200, result: 'served' });
    const out = await relaySolanaRpc({ body: rpc('getHealth'), ip: '3.3.3.3' });
    expect(out.status).toBe(200);
    expect(out.body.result).toBe('served');
    expect(calls.length).toBe(2);
    expect(out.meta.upstream).not.toContain(refusing);
  });

  it('keeps the caller’s JSON-RPC id on every answer, so web3.js can match it', async () => {
    behaviour = () => ({ status: 403 });
    const out = await relaySolanaRpc({ body: rpc('getSlot', [], 4242), ip: '3.3.3.4' });
    expect(out.body.id).toBe(4242);
    expect(out.body.jsonrpc).toBe('2.0');
  });

  it('passes a protocol-level error through untouched — that answer belongs to the request', async () => {
    behaviour = () => ({ status: 200, error: { code: -32602, message: 'Invalid param: account not found' } });
    const out = await relaySolanaRpc({ body: rpc('getAccountInfo', ['11111111111111111111111111111111']), ip: '3.3.3.5' });
    expect(out.status).toBe(200);
    expect(out.body.error.message).toBe('Invalid param: account not found');
    expect(calls.length, 'a real answer is not retried against another node').toBe(1);
  });

  it('names an oversized answer instead of truncating somebody’s JSON', async () => {
    behaviour = () => ({ huge: 4_200_000 });
    const out = await relaySolanaRpc({ body: rpc('getProgramAccounts', ['KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD']), ip: '3.3.3.6' });
    expect(out.status).toBe(502);
    expect(out.body.error.code).toBe(-32003);
    expect(out.body.error.message).toMatch(/larger than this relay forwards/);
    expect(calls.length, 'the next node would return the same megabytes').toBe(1);
  });
});

/* ════════════════ 4. a node that answers is not a node that serves ════════ */

describe('a 200 that says «I do not serve that» is remembered per method', () => {
  it('walks on from a method refusal, and skips that host for that method next time', async () => {
    const refusing = firstUpstreamHost();
    behaviour = ({ host }) => (host === refusing
      ? { status: 200, error: { code: -32602, message: 'Request blocked: method not permitted' } }
      : { status: 200, result: 'served-elsewhere' });

    const first = await relaySolanaRpc({ body: rpc('getTokenAccountsByOwner', ['owner', {}]), ip: '4.4.4.1' });
    expect(first.body.result).toBe('served-elsewhere');
    expect(calls.length).toBe(2);

    calls = [];
    const second = await relaySolanaRpc({ body: rpc('getTokenAccountsByOwner', ['owner2', {}]), ip: '4.4.4.2' });
    expect(second.body.result).toBe('served-elsewhere');
    expect(hostsAsked(), 'the host that refused this method is not asked for it again').not.toContain(refusing);

    /* …but it still serves what it does serve. This is the whole reason the
       memory is per method and not per host. */
    calls = [];
    behaviour = () => ({ status: 200, result: 'health-ok' });
    const third = await relaySolanaRpc({ body: rpc('getHealth'), ip: '4.4.4.3' });
    expect(third.body.result).toBe('health-ok');
    expect(hostsAsked()[0]).toBe(refusing);
  });

  it('cools a host that refused the caller entirely, for every method', async () => {
    const refusing = firstUpstreamHost();
    behaviour = ({ host }) => (host === refusing ? { status: 403 } : { status: 200, result: 'ok' });
    await relaySolanaRpc({ body: rpc('getHealth'), ip: '4.4.4.4' });
    expect(relayStatus().cooling.hosts.some((row) => row.host === refusing && row.reason === 'BLOCKED')).toBe(true);

    calls = [];
    await relaySolanaRpc({ body: rpc('getSlot'), ip: '4.4.4.5' });
    expect(hostsAsked(), 'a caller-level refusal is about the caller, so the host waits').not.toContain(refusing);
  });

  it('still tries a cooled host when nothing else answers — the last resort is never deleted', async () => {
    behaviour = () => ({ status: 403 });
    await relaySolanaRpc({ body: rpc('getHealth'), ip: '4.4.4.6' });
    const upstreamCount = relayUpstreams('mainnet-beta').length;

    calls = [];
    const again = await relaySolanaRpc({ body: rpc('getHealth'), ip: '4.4.4.7' });
    expect(calls.length, 'every host is still walked, cooled ones last').toBe(upstreamCount);
    expect(again.status).toBe(403);
  });
});

/* ═══════════════════════════ 5. cheap for us ══════════════════════════════ */

describe('the global read is shared and the signing input never is', () => {
  it('serves an identical market read to a second caller from the shared cache', async () => {
    behaviour = () => ({ status: 200, result: { context: { slot: 100 }, value: { data: ['AAAA', 'base64'] } } });
    const market = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
    const first = await relaySolanaRpc({ body: rpc('getAccountInfo', [market, { encoding: 'base64' }], 1), ip: '5.5.5.1' });
    const second = await relaySolanaRpc({ body: rpc('getAccountInfo', [market, { encoding: 'base64' }], 2), ip: '5.5.5.2' });
    expect(calls.length, 'one upstream call served both users').toBe(1);
    expect(second.body.result).toEqual(first.body.result);
    expect(second.body.id, 'each caller gets its own id back').toBe(2);
    expect(second.meta.cache).toBe('hit');
    expect(relayStatus().cache.hits).toBe(1);
  });

  it('does not let key order invent a second cache entry', async () => {
    behaviour = () => ({ status: 200, result: 'r' });
    await relaySolanaRpc({ body: rpc('getAccountInfo', ['addr', { encoding: 'base64', commitment: 'confirmed' }]), ip: '5.5.5.3' });
    await relaySolanaRpc({ body: rpc('getAccountInfo', ['addr', { commitment: 'confirmed', encoding: 'base64' }]), ip: '5.5.5.4' });
    expect(calls.length).toBe(1);
  });

  it('never caches the inputs to a signature or a confirmation', async () => {
    behaviour = () => ({ status: 200, result: { blockhash: 'abc', lastValidBlockHeight: 1 } });
    for (const method of ['getLatestBlockhash', 'isBlockhashValid', 'getSignatureStatuses', 'simulateTransaction']) {
      expect(RELAY_METHODS[method].cacheMs, `${method} must stay fresh`).toBe(0);
    }
    await relaySolanaRpc({ body: rpc('getLatestBlockhash', []), ip: '5.5.5.5' });
    await relaySolanaRpc({ body: rpc('getLatestBlockhash', []), ip: '5.5.5.5' });
    expect(calls.length, 'a cached blockhash is a rejected transaction').toBe(2);
  });

  it('spends a weighted budget per caller, and a heavy read costs more than a light one', async () => {
    behaviour = () => ({ status: 200, result: 'ok' });
    process.env.SOLANA_RELAY_BUDGET = '10';
    /* getProgramAccounts weighs 8: two of them are over a budget of 10. */
    await relaySolanaRpc({ body: rpc('getProgramAccounts', ['prog', {}]), ip: '6.6.6.1' });
    await relaySolanaRpc({ body: rpc('getProgramAccounts', ['prog2', {}]), ip: '6.6.6.1' });
    const over = await relaySolanaRpc({ body: rpc('getBalance', ['someone']), ip: '6.6.6.1' });
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe(-32002);
    expect(over.meta.retryAfterMs).toBeGreaterThan(0);

    /* Another caller is untouched, and a cached answer costs nobody anything. */
    const other = await relaySolanaRpc({ body: rpc('getBalance', ['someone-else']), ip: '6.6.6.2' });
    expect(other.status).toBe(200);
  });

  it('gives heavy methods their own, much smaller budget', async () => {
    behaviour = () => ({ status: 200, result: { value: [] } });
    process.env.SOLANA_RELAY_HEAVY_BUDGET = '2';
    for (let i = 0; i < 2; i += 1) {
      const out = await relaySolanaRpc({ body: rpc('getParsedTokenAccountsByOwner', [`owner${i}`, {}]), ip: '6.6.6.3' });
      expect(out.status, `call ${i}`).toBe(200);
    }
    const third = await relaySolanaRpc({ body: rpc('getParsedTokenAccountsByOwner', ['owner3', {}]), ip: '6.6.6.3' });
    expect(third.status).toBe(429);
    expect(third.meta.stage).toBe('heavy-budget');
    /* …while a light read from the same caller still goes through. */
    const light = await relaySolanaRpc({ body: rpc('getSlot', []), ip: '6.6.6.3' });
    expect(light.status).toBe(200);
  });

  it('reports what it did, with no credentials, for the diagnostics route', () => {
    const status = relayStatus();
    expect(status.meta.schema).toBe('fbt.solana-rpc-relay.v1');
    expect(status.methods).toContain('getAccountInfo');
    expect(status.upstreams.every((u) => /^https:\/\//.test(u) && !u.includes('?'))).toBe(true);
    expect(status.limits.maxResponseBytes).toBeGreaterThan(0);
  });
});

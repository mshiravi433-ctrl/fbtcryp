// @vitest-environment jsdom
/**
 * THE TWO DOORS OF THE SOLANA LOAN — client half.
 *
 * The server half is pinned in test/solana-lending-server-door.test.js. This is
 * the half the user actually waits on, and the report it answers is the third
 * one of 2026-09-23: «در وام تب سولنا بهم خورده دوباره», with nine candidates
 * listed and nine refusals — including our own relay, whose answer came back as
 * «آن گره پاسخ داد، ولی پاسخی که نتوانستیم استفاده کنیم» («the node answered, but
 * we could not use the response»).
 *
 * Pinned here, with no mainnet call and no vendored SDK bundle:
 *
 *   1. when the browser door is dead — no vendor bundle, every public node 403 —
 *      the SERVER door answers and the panel gets a snapshot it can render;
 *   2. the beat before the second door is asked is DROPPED when this network
 *      path has already proved the public nodes refuse it, so a known-blocked
 *      user does not pay 1.2 s of dead air on top of nine timeouts;
 *   3. when BOTH doors are shut the failure still carries the per-host verdicts
 *      (the part a user can act on) plus what our own server said;
 *   4. the relay's «no node behind me answered» (-32004 / HTTP 502) is named
 *      RELAY_UPSTREAM_UNAVAILABLE and never again dressed up as «the node
 *      answered but we could not use it» — a sentence that sends the reader
 *      looking for a better RPC when the honest remedy is the other door;
 *   5. a transaction built by the server door arrives in the SAME shape the
 *      wallet layer already signs: `{ id, transaction, versioned }`, per
 *      transaction, with the version the builder reported and not an assumed one.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readSolanaLendingMarket,
  buildSolanaLendingTransactions,
  lendingRpcFailure
} from '../src/lib/solanaLending.js';
import {
  readSolanaLendingMarketViaServer,
  buildSolanaLendingTransactionsViaServer
} from '../src/lib/solanaLendingServer.js';
import { noteSolanaPublicsBlocked, clearSolanaPublicsBlocked, clearSolanaRpcCooldown } from '../src/lib/solanaRpc.js';

const MARKET_PATH = '/api/lending/solana/market';
const TX_PATH = '/api/lending/solana/transaction';

/** A snapshot the way the server serializes it (same function, other process). */
const SERVER_SNAPSHOT = {
  ok: true,
  chainId: 900001,
  protocol: 'kamino-klend',
  marketAddress: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
  rpcUrl: 'https://rpc.example/solana',
  slot: 314159,
  readAt: '2026-09-23T10:00:00.000Z',
  dataStatus: 'live',
  via: 'server',
  source: 'server-kamino',
  loadMode: 'sliced',
  assets: [{
    id: 'reserveUsdc', symbol: 'USDC', name: 'USDC',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    chain: 900001, decimals: 6, listed: true, status: 'active',
    supplyApyPct: 4.31, borrowApyPct: 5.02, loanToValuePct: 65,
    liquidationThresholdPct: 70, availableLiquidity: 1234567, borrowed: 7654321,
    supplyCap: 9000000, borrowCap: 9000000, priceUsd: 1
  }],
  reserves: [],
  positions: { reserveUsdc: { supplied: '0', borrowed: '0', suppliedUsd: 0, borrowedUsd: 0, walletBalance: '25.5' } },
  balances: { reserveUsdc: '25500000' },
  account: { ok: false, unknown: false, balancesUnknown: false, totalCollateralUsd: 0, totalDebtUsd: 0, availableBorrowsUsd: 0, healthFactor: null, ltvPct: 0, liquidationThresholdPct: null },
  failures: []
};

const realFetch = globalThis.fetch;

/**
 * The reported network path: no vendored SDK bundle (so the browser door cannot
 * even start), every public node refusing with 403, and our own backend
 * answering. `server` overrides what the second door says.
 */
function installDoors({ server = 'ok', serverStatus = 200 } = {}) {
  const calls = { market: 0, tx: 0, rpc: 0, vendor: 0 };
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/vendor/kamino-klend-sdk')) {
      calls.vendor += 1;
      return new Response('not found', { status: 404 });
    }
    if (href.includes(MARKET_PATH)) {
      calls.market += 1;
      if (server === 'missing') return new Response('nope', { status: 404 });
      if (server === 'refused') {
        return new Response(JSON.stringify({
          ok: false, code: 'KAMINO_MARKET_UNAVAILABLE', detail: 'every upstream refused',
          hosts: [{ host: 'https://rpc.example/solana', reason: '403 : blocked' }]
        }), { status: 502, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        ok: true, snapshot: SERVER_SNAPSHOT, meta: { schema: 'fbt.solana-kamino.v1', dataStatus: 'live' }
      }), { status: serverStatus, headers: { 'content-type': 'application/json' } });
    }
    if (href.includes(TX_PATH)) {
      calls.tx += 1;
      return new Response(JSON.stringify({
        ok: true,
        action: 'supply',
        amount: '10',
        amountWei: '10000000',
        transactions: [{ id: 'supply', transaction: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', versioned: false }],
        protocol: 'kamino-klend',
        chainId: 900001
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    /* Every public Solana node, and the read-only relay behind them. */
    calls.rpc += 1;
    return new Response('Your IP or provider is blocked from this endpoint', { status: 403 });
  };
  return calls;
}

const reset = () => {
  clearSolanaRpcCooldown();
  clearSolanaPublicsBlocked();
  try { localStorage.clear(); } catch { /* no storage in this env */ }
};

beforeEach(reset);
afterEach(() => {
  globalThis.fetch = realFetch;
  reset();
});

describe('the second door answers when the first one cannot', () => {
  it('renders a market the browser could not read at all', async () => {
    const calls = installDoors();
    /* The persisted hint says this path's public nodes all refuse, so the second
       door is asked immediately rather than one beat later. */
    noteSolanaPublicsBlocked('mainnet-beta');

    const snapshot = await readSolanaLendingMarket({ wallet: null });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.via).toBe('server');
    expect(snapshot.assets[0].symbol).toBe('USDC');
    expect(snapshot.loadMode).toBe('sliced');
    expect(calls.market).toBe(1);
  }, 20_000);

  it('asks the server door straight away on a known-blocked path', async () => {
    installDoors();
    noteSolanaPublicsBlocked('mainnet-beta');
    const started = Date.now();
    const snapshot = await readSolanaLendingMarket({ wallet: null });
    expect(snapshot.via).toBe('server');
    /* SERVER_DOOR_DELAY_MS is 1200; a dropped beat lands well inside that. */
    expect(Date.now() - started).toBeLessThan(1100);
  }, 20_000);

  it('reports both doors when both are shut', async () => {
    installDoors({ server: 'refused' });
    noteSolanaPublicsBlocked('mainnet-beta');
    let failure = null;
    try {
      await readSolanaLendingMarket({ wallet: null });
    } catch (cause) { failure = cause; }
    expect(failure).toBeTruthy();
    /* The browser door's verdict leads — it is the one with per-host reasons —
       and the server's own answer travels with it instead of vanishing. */
    expect(failure.serverTried).toBe(true);
    expect(String(failure.serverCode || '')).toMatch(/KAMINO_MARKET_UNAVAILABLE|SERVER_UPSTREAM_FAILED/);
    expect(String(failure.code || failure.message)).toBeTruthy();
  }, 20_000);

  it('names a deployment that has no such route', async () => {
    installDoors({ server: 'missing' });
    const answer = await readSolanaLendingMarketViaServer({ wallet: null });
    expect(answer.ok).toBe(false);
    expect(answer.code).toBe('SERVER_ENDPOINT_MISSING');
  });

  it('passes the server refusal through with its own code and hosts', async () => {
    installDoors({ server: 'refused' });
    const answer = await readSolanaLendingMarketViaServer({ wallet: null });
    expect(answer.ok).toBe(false);
    expect(answer.code).toBe('KAMINO_MARKET_UNAVAILABLE');
    expect(answer.hosts).toHaveLength(1);
  });
});

describe('a server-built transaction is signed by the same wallet layer', () => {
  it('arrives as { id, transaction, versioned } — the version reported, not assumed', async () => {
    installDoors();
    const built = await buildSolanaLendingTransactionsViaServer({
      action: 'supply',
      asset: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      amount: '10',
      wallet: '11111111111111111111111111111111'
    });
    expect(built.ok).toBe(true);
    expect(built.transactions).toHaveLength(1);
    expect(built.transactions[0]).toMatchObject({ id: 'supply', versioned: false });
    expect(typeof built.transactions[0].transaction).toBe('string');
    expect(built.chainId).toBe(900001);
  });

  it('the panel-facing builder falls through to it and keeps the shape', async () => {
    installDoors();
    noteSolanaPublicsBlocked('mainnet-beta');
    const built = await buildSolanaLendingTransactions({
      action: 'supply',
      asset: { id: 'reserveUsdc', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      amount: '10',
      wallet: '11111111111111111111111111111111'
    });
    expect(built.ok).toBe(true);
    expect(built.via).toBe('server');
    expect(built.transactions[0].versioned).toBe(false);
  }, 25_000);

  it('refuses locally before spending a round trip', async () => {
    const calls = installDoors();
    expect(await buildSolanaLendingTransactions({ action: 'supply', asset: null, amount: '10', wallet: 'x' }))
      .toMatchObject({ ok: false, code: 'SOLANA_ASSET_REQUIRED' });
    expect(await buildSolanaLendingTransactions({ action: 'supply', asset: { address: 'EPjF', decimals: 6 }, amount: '', wallet: 'x' }))
      .toMatchObject({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(calls.tx).toBe(0);
  });
});

describe('the relay\'s own failure is named as the relay\'s', () => {
  const RELAY = 'https://fbtswap.ir/api/solana/rpc?cluster=mainnet-beta';

  it('«no Solana node answered this relay» is not «the node answered unusably»', () => {
    const failure = lendingRpcFailure([{
      url: RELAY,
      code: -32004,
      error: '502 Bad Gateway: {"jsonrpc":"2.0","id":1,"error":{"code":-32004,"message":"no Solana node answered this relay for getProgramAccounts"}}'
    }]);
    expect(failure.code).toBe('RELAY_UPSTREAM_UNAVAILABLE');
    expect(failure.hosts[0]).toMatchObject({ relay: true, reason: 'RELAY_UPSTREAM_UNAVAILABLE' });
  });

  it('a public node\'s own 403 still outranks it — that is the actionable one', () => {
    const failure = lendingRpcFailure([
      { url: 'https://api.mainnet-beta.solana.com', error: 'Error: 403 : {"jsonrpc":"2.0","error":{' },
      { url: RELAY, code: -32004, error: 'no Solana node answered this relay for getProgramAccounts' }
    ]);
    expect(failure.code).toBe('RPC_BLOCKED');
    expect(failure.hosts.map((row) => row.reason)).toEqual(['RPC_BLOCKED', 'RELAY_UPSTREAM_UNAVAILABLE']);
  });

  it('a relay that does not forward a method is still an app-version gap', () => {
    const failure = lendingRpcFailure([{
      url: RELAY,
      code: -32601,
      error: 'method getMultipleAccountsInfo is not relayed: this endpoint is read-only and forwards an allowlist'
    }]);
    expect(failure.code).toBe('RELAY_METHOD_UNAVAILABLE');
  });
});

/* ═══════════════════ the vocabulary of the second door ═══════════════════ */

/**
 * Every machine code the two doors can put in front of a user, pinned against
 * BOTH ends of the sentence:
 *
 *   · the code must still be emitted by the source that this list names — so
 *     the list cannot drift into fiction after a refactor renames a code;
 *   · every one of the 12 locales must have a real sentence for it — so a
 *     deployment cannot ship a door whose failures print as raw machine text.
 *
 * `src/lib/loanErrors.js` already guarantees an UNKNOWN code reaches the screen
 * as a translated generic that keeps the code; this test is the stricter half,
 * the one that keeps «translated generic» from becoming the normal path.
 */
describe('every code the server door can name has a sentence in every language', () => {
  const root = resolve(__dirname, '..');
  const read = (relative) => readFileSync(resolve(root, relative), 'utf8');
  const sources = {
    'server/solanaLending.js': read('server/solanaLending.js'),
    'src/lib/solanaLendingServer.js': read('src/lib/solanaLendingServer.js'),
    'src/lib/solanaLending.js': read('src/lib/solanaLending.js')
  };
  const locales = ['ar', 'en', 'es', 'fa', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh'];

  /** code → the module that emits it. */
  const VOCABULARY = {
    /* the client door: what our own fetch can report before any server answers */
    SERVER_DOOR_UNAVAILABLE: 'src/lib/solanaLendingServer.js',
    SERVER_BAD_RESPONSE: 'src/lib/solanaLendingServer.js',
    SERVER_TIMEOUT: 'src/lib/solanaLendingServer.js',
    SERVER_UNREACHABLE: 'src/lib/solanaLendingServer.js',
    CANCELLED: 'src/lib/solanaLendingServer.js',
    SIGNATURE_REQUIRED: 'src/lib/solanaLendingServer.js',
    /* the client door: what an HTTP status from our own backend means */
    SERVER_ENDPOINT_MISSING: 'src/lib/solanaLendingServer.js',
    SERVER_THROTTLED: 'src/lib/solanaLendingServer.js',
    SERVER_UPSTREAM_FAILED: 'src/lib/solanaLendingServer.js',
    SERVER_UNAVAILABLE: 'src/lib/solanaLendingServer.js',
    /* the server door: its own answers, forwarded verbatim by the client */
    SERVER_DOOR_DISABLED: 'server/solanaLending.js',
    BUILD_THROTTLED: 'server/solanaLending.js',
    KAMINO_MARKET_UNAVAILABLE: 'server/solanaLending.js',
    KAMINO_RESERVE_LIST_UNAVAILABLE: 'server/solanaLending.js',
    KAMINO_RESERVES_EMPTY: 'server/solanaLending.js',
    KAMINO_ORACLES_UNAVAILABLE: 'server/solanaLending.js',
    KAMINO_SDK_INCOMPLETE: 'server/solanaLending.js',
    KAMINO_SDK_FAILED: 'server/solanaLending.js',
    KAMINO_TX_BUILD_EMPTY: 'server/solanaLending.js',
    KAMINO_TX_BUILD_FAILED: 'server/solanaLending.js',
    ASSET_NOT_SUPPORTED: 'server/solanaLending.js',
    AMOUNT_REQUIRED: 'server/solanaLending.js',
    UNKNOWN_ACTION: 'server/solanaLending.js',
    BAD_WALLET: 'server/solanaLending.js',
    BAD_SIGNATURE: 'server/solanaLending.js',
    SERIALIZATION_FAILED: 'server/solanaLending.js',
    SOLANA_WALLET_REQUIRED: 'server/solanaLending.js',
    SOLANA_ASSET_REQUIRED: 'server/solanaLending.js',
    SOLANA_COLLATERAL_REQUIRED: 'server/solanaLending.js',
    SOLANA_POSITION_REQUIRED: 'server/solanaLending.js',
    TRANSACTION_FAILED: 'server/solanaLending.js',
    TRANSACTION_NOT_FOUND: 'server/solanaLending.js',
    /* the classifier: the relay's «nothing behind me answered» */
    RELAY_UPSTREAM_UNAVAILABLE: 'src/lib/solanaLending.js'
  };

  it('names no code the source has stopped emitting', () => {
    for (const [code, module] of Object.entries(VOCABULARY)) {
      expect(sources[module], `${code} is listed as coming from ${module}`).toContain(`'${code}'`);
    }
  });

  it('translates every one of them in all 12 locales', () => {
    for (const locale of locales) {
      const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
      /* A sentence, not a stub. The length floor is per script because four
         Chinese characters carry what twelve Latin ones do. */
      const floor = locale === 'zh' ? 4 : 8;
      for (const code of Object.keys(VOCABULARY)) {
        const sentence = messages?.loan?.error?.[code];
        expect(typeof sentence === 'string' && sentence.trim().length > floor,
          `${locale}: loan.error.${code}`).toBe(true);
      }
    }
  });

  it('says which door served the data, and says so when the second one was tried and failed', () => {
    for (const locale of locales) {
      const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
      /* the badge over a snapshot that came from our own server */
      expect(messages?.loan?.solana?.serverDoor, `${locale}: loan.solana.serverDoor`).toBeTruthy();
      /* the row label + the line under the per-host table when both doors shut */
      expect(messages?.loan?.rpc?.serverHost, `${locale}: loan.rpc.serverHost`).toBeTruthy();
      expect(messages?.loan?.rpc?.serverTried, `${locale}: loan.rpc.serverTried`).toBeTruthy();
    }
  });
});

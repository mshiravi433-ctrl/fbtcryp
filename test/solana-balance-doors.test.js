// @vitest-environment jsdom
/**
 * «۸ HOSTS, ۸ REFUSALS, AND A DASH WHERE THE BALANCE SHOULD BE» — the doors
 * that must still open.
 * ========================================================================
 * The 2026-09-23 report: every public Solana node refused the caller's
 * network path (403/400/429…), the balance rendered as «—», and NOTHING on
 * screen said whether the app's own backend had even been asked.
 *
 * lib/solana/balanceSource.js races two doors (public nodes, then our own
 * backend). The properties pinned here are the ones the report turned from
 * nice-to-have into load-bearing:
 *
 *   1. when the persisted hint says this network path's publics all refuse,
 *      the backend door is asked IMMEDIATELY — the old fixed 1.2 s stagger is
 *      known-dead air on exactly the network the hint describes;
 *   2. the read still SUCCEEDS through that second door while every public
 *      node is refusing — a funded wallet must not render as «—»;
 *   3. the app's own JSON-RPC relay is a READ candidate (opted in by the
 *      balance reader), so the client has three routes to the truth, not two.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  SOLANA_RELAY_PATH,
  clearSolanaPublicsBlocked,
  isSolanaRelayUrl,
  noteSolanaPublicsBlocked,
  resetSolanaRpcChoice,
  clearSolanaRpcCooldown
} from '../src/lib/solanaRpc.js';
import { clearSolanaTokenInfoCache, readSolanaSwapBalances } from '../src/lib/solana/balanceSource.js';

const OWNER = 'AMU6pRs8Hs9FEcA2hgcvrWeVprqvMPSJoQzEkB3kqFoR';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const MEME_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

const realFetch = globalThis.fetch;

const SERVER_BODY = {
  ok: true,
  schema: 'fbt.solana-balances.v1',
  owner: OWNER,
  inputMint: MEME_MINT,
  outputMint: SOL_MINT,
  solLamports: '1_500_000_000'.replace(/_/g, ''),
  sourceRaw: '42000000',
  sourceDecimals: 5,
  sourceDecimalsVerified: true,
  sourceProgram: null,
  outputAccountExists: true,
  outputAssumed: false,
  calls: 2,
  host: 'unit-test',
  at: Date.now()
};

/** Every public node refuses; our backend answers the balances endpoint. */
function installBlockedPublicsHealthyServer({ track = null } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (track) track.push({ url: u, at: Date.now() });
    if (u.includes('/solana/balances')) {
      return new Response(JSON.stringify(SERVER_BODY), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('Your IP or provider is blocked', { status: 403 });
  };
}

beforeEach(() => {
  localStorage.clear();
  clearSolanaRpcCooldown();
  resetSolanaRpcChoice();
  clearSolanaPublicsBlocked();
  clearSolanaTokenInfoCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.clear();
  clearSolanaPublicsBlocked();
  clearSolanaRpcCooldown();
  resetSolanaRpcChoice();
  clearSolanaTokenInfoCache();
});

describe('the balance read when every public node refuses', () => {
  it('succeeds through the backend door — a funded wallet is not «—»', async () => {
    installBlockedPublicsHealthyServer();
    noteSolanaPublicsBlocked('mainnet-beta'); // this network path's publics are known-dead
    const r = await readSolanaSwapBalances({ owner: OWNER, inputMint: MEME_MINT, outputMint: SOL_MINT });
    expect(r.ok).toBe(true);
    expect(r.via).toBe('server');
    expect(r.sourceRaw.toString()).toBe('42000000');
    expect(r.solLamports.toString()).toBe('1500000000');
    expect(r.sourceDecimals).toBe(5);
  });

  it('with the blocked hint set, the backend is asked at once — no 1.2 s of dead air', async () => {
    noteSolanaPublicsBlocked('mainnet-beta');
    const calls = [];
    installBlockedPublicsHealthyServer({ track: calls });
    const started = Date.now();
    const r = await readSolanaSwapBalances({ owner: OWNER, inputMint: MEME_MINT, outputMint: SOL_MINT });
    const elapsed = Date.now() - started;
    expect(r.ok).toBe(true);
    const serverCall = calls.find((c) => c.url.includes('/solana/balances'));
    expect(serverCall).toBeTruthy();
    /* The stub answers everything instantly, so the whole read is fast; the
       property that matters is that the server fetch STARTED inside the first
       ~300 ms instead of after a fixed 1.2 s stagger. */
    expect(serverCall.at - started).toBeLessThan(300);
    expect(elapsed).toBeLessThan(1500);
  });

  it('the app\'s own JSON-RPC relay is among the DIRECT read candidates', async () => {
    noteSolanaPublicsBlocked('mainnet-beta');
    const seenRelay = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (isSolanaRelayUrl(u)) {
        seenRelay.push(u);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'refused by test' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('blocked', { status: 403 });
    };
    await readSolanaSwapBalances({ owner: OWNER, inputMint: MEME_MINT, outputMint: SOL_MINT });
    expect(seenRelay.length).toBeGreaterThan(0);
    expect(seenRelay[0]).toContain(SOLANA_RELAY_PATH);
  });
});

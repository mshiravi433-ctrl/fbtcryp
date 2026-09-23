// @vitest-environment node
/**
 * «موجودی کیف پول کم یا RPC را چک کنید» — THE TWO SENTENCES, AND THE READS
 * BEHIND THEM.
 * ==========================================================================
 *
 * Reported 2026-09-23: the wallet connects (EVM and Solana, MWA registered,
 * every signing capability supported — the diagnostics prove it), but signing
 * and buying with SOL fail MOST OF THE TIME with either «the wallet balance is
 * too low» or «check the RPC».
 *
 * Both sentences came out of the swap's PRE-FLIGHT, and both were wrong:
 *
 *   A. «CHECK THE RPC» — the balance read was ONE `Connection` on ONE
 *      remembered endpoint, three web3.js calls with no deadline, no failover
 *      and no named failure. A node that answered `getHealth` and then started
 *      answering 429 stayed the only node asked for five minutes, and every tap
 *      in that window died as BALANCE_UNAVAILABLE. On the networks this app is
 *      used on that window is most of the day.
 *
 *   B. «BALANCE TOO LOW» — two independent ways. A token-2022 mint came back
 *      from a `{mint}`-filtered query as an EMPTY list on nodes that do not
 *      resolve the mint's program, and empty read as zero. And a pasted mint
 *      was stored with `decimals: 9`, a guess that converts the typed amount
 *      into base units: for a 6-decimal token every amount became 1000× too
 *      big, so the screen showed a balance 1000× too small and refused a funded
 *      wallet.
 *
 * Nothing here touches the network, a wallet or React. The reads take an
 * injected `call(url, method, params)` and the decision is a pure function,
 * which is the only way a money-path verdict can be pinned at all.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  ATA_RENT_LAMPORTS,
  BASE_FEE_LAMPORTS,
  SOL_DECIMALS,
  SOL_MINT,
  SPL_TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  detailOf,
  nameSolanaReadFailure,
  outputAccountCheckNeeded,
  parseMintAccount,
  parseTokenAccountRows,
  readMintInfoAcross,
  readSwapBalancesAcross,
  readSwapBalancesOn
} from '../src/lib/solana/chainReads.js';
import { lamportsToSol, solanaSwapPreflight } from '../src/lib/solana/swapPreflight.js';

const OWNER = 'AMU6pRs8Hs9FEcA2hgcvrWeVprqvMPSJoQzEkB3kqFoR';
/** A 6-DECIMAL token — the shape most modern SPL tokens (and every pump.fun
    token) actually have, and the one the old guess of 9 got 1000× wrong. */
const MEME_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const NODE_A = 'https://solana-rpc.publicnode.com';
const NODE_B = 'https://solana.drpc.org';
const NODE_DEAD = 'https://api.mainnet-beta.solana.com';

/* ── node answer builders: the real JSON-RPC shapes, not invented ones ────── */

const tokenAccountRow = (mint, amount, decimals, program = SPL_TOKEN_PROGRAM) => ({
  pubkey: 'TokenAccount111111111111111111111111111111111',
  account: {
    lamports: 2039280,
    owner: program,
    data: {
      program: 'spl-token',
      parsed: {
        type: 'account',
        info: {
          mint,
          owner: OWNER,
          tokenAmount: { amount: String(amount), decimals, uiAmountString: '1' }
        }
      }
    }
  }
});

const mintAccount = (decimals, program = SPL_TOKEN_PROGRAM) => ({
  lamports: 1461600,
  owner: program,
  executable: false,
  data: {
    program: 'spl-token',
    parsed: {
      type: 'mint',
      info: {
        mintAuthority: null,
        supply: '1000000000000',
        decimals,
        isInitialized: true,
        freezeAuthority: null
      }
    }
  }
});

/**
 * A fake node.
 *
 * `answers` maps `method` → a function of the params returning `{ok, result}`
 * or `{ok:false, reason}`; anything unmapped fails, so a test that stops
 * asserting a call notices the call being made.
 */
function fakeNode(answers) {
  const calls = [];
  const call = async (url, method, params) => {
    calls.push({ url, method, params });
    const handler = answers[method];
    if (!handler) return { ok: false, url, ms: 1, reason: 'RPC_ERROR', detail: `unexpected ${method}` };
    return handler(params, url);
  };
  return { call, calls };
}

const okRpc = (value) => ({ ok: true, ms: 5, result: { value } });
const failRpc = (reason, detail = null) => ({ ok: false, ms: 5, reason, detail });

describe('chainReads — parsers read the shapes nodes actually answer with', () => {
  it('sums every token account of a mint and reports the chain’s own scale', () => {
    const parsed = parseTokenAccountRows([
      tokenAccountRow(MEME_MINT, '1000000', 6),
      tokenAccountRow(MEME_MINT, '2500000', 6)
    ], MEME_MINT);
    expect(parsed.raw).toBe(3500000n);
    expect(parsed.decimals).toBe(6);
    expect(parsed.exists).toBe(true);
    expect(parsed.accounts).toBe(2);
    expect(parsed.program).toBe(SPL_TOKEN_PROGRAM);
  });

  it('filters by mint when the query was made by PROGRAM, not by mint', () => {
    /* The token-2022 re-ask is program-filtered, so the answer carries every
       token-2022 account the wallet has. Summing all of them as one balance
       would invent funds the user does not have. */
    const parsed = parseTokenAccountRows([
      tokenAccountRow(MEME_MINT, '1000000', 6, TOKEN_2022_PROGRAM),
      tokenAccountRow(USDC_MINT, '99999999999', 6, TOKEN_2022_PROGRAM)
    ], MEME_MINT);
    expect(parsed.raw).toBe(1000000n);
    expect(parsed.accounts).toBe(1);
  });

  it('reads a mint account’s scale and recognises token-2022 by its program', () => {
    expect(parseMintAccount(mintAccount(6)).decimals).toBe(6);
    expect(parseMintAccount(mintAccount(6)).token2022).toBe(false);
    const t22 = parseMintAccount(mintAccount(6, TOKEN_2022_PROGRAM));
    expect(t22.token2022).toBe(true);
    expect(t22.program).toBe(TOKEN_2022_PROGRAM);
    expect(parseMintAccount(null)).toBe(null);
    expect(parseMintAccount({ data: {} })).toBe(null);
  });

  it('never invents a scale from a malformed answer', () => {
    expect(parseMintAccount({ owner: SPL_TOKEN_PROGRAM, data: { parsed: { info: { decimals: 'x' } } } }).decimals).toBe(null);
    expect(parseTokenAccountRows([], MEME_MINT).decimals).toBe(null);
  });
});

describe('chainReads — the third read is only made when it can change the verdict', () => {
  it('skips the output-account question when SOL already covers the worst case', () => {
    /* 1 SOL, selling 0.1 SOL: even if the destination account must be created,
       the rent is covered — so asking is a wasted request on a throttled node. */
    expect(outputAccountCheckNeeded(1_000_000_000n, 100_000_000n)).toBe(false);
    expect(outputAccountCheckNeeded(ATA_RENT_LAMPORTS + 100_000_000n, 100_000_000n)).toBe(false);
    expect(outputAccountCheckNeeded(ATA_RENT_LAMPORTS + 99_999_999n, 100_000_000n)).toBe(true);
    expect(outputAccountCheckNeeded(0n, null)).toBe(true);
  });

  it('makes TWO node calls for a wallet that is not running on empty', async () => {
    const node = fakeNode({
      getBalance: () => okRpc(1_500_000_000),
      getParsedTokenAccountsByOwner: (params) => {
        /* Only the INPUT is ever asked for here — an output query would be the
           third call this test exists to forbid. */
        expect(params[1]).toEqual({ mint: SOL_MINT });
        return okRpc([]);
      }
    });
    const r = await readSwapBalancesOn(NODE_A, {
      call: node.call,
      owner: OWNER,
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      rawAmount: 100_000_000n
    });
    expect(r.ok).toBe(true);
    expect(node.calls.map((c) => c.method)).toEqual(['getBalance']);
    expect(r.outputAssumed).toBe(true);
    expect(r.calls).toBe(1);
  });

  it('makes the third call, and reports the missing account, when SOL is tight', async () => {
    const node = fakeNode({
      getBalance: () => okRpc(1_000_000),
      getParsedTokenAccountsByOwner: (params) => {
        if (params[1]?.mint === MEME_MINT) return okRpc([tokenAccountRow(MEME_MINT, '5000000', 6)]);
        if (params[1]?.mint === USDC_MINT) return okRpc([]);
        return okRpc([mintAccount(6)] && []);
      },
      getAccountInfo: () => okRpc(mintAccount(6))
    });
    const r = await readSwapBalancesOn(NODE_A, {
      call: node.call,
      owner: OWNER,
      inputMint: MEME_MINT,
      outputMint: USDC_MINT,
      rawAmount: null
    });
    expect(r.ok).toBe(true);
    expect(r.sourceRaw).toBe(5000000n);
    expect(r.sourceDecimals).toBe(6);
    expect(r.sourceDecimalsVerified).toBe(true);
    expect(r.outputAccountExists).toBe(false);
    expect(r.outputAssumed).toBe(false);
  });
});

describe('chainReads — a zero balance is VERIFIED before it is believed', () => {
  it('finds a token-2022 balance the mint-filtered query could not see', async () => {
    /* The reported failure: the node answers an empty list for `{mint}` because
       the accounts live under token-2022, and empty read as «no funds». */
    const node = fakeNode({
      getBalance: () => okRpc(2_000_000_000),
      getParsedTokenAccountsByOwner: (params) => {
        if (params[1]?.mint === MEME_MINT) return okRpc([]);
        if (params[1]?.programId === TOKEN_2022_PROGRAM) {
          return okRpc([tokenAccountRow(MEME_MINT, '7500000', 6, TOKEN_2022_PROGRAM)]);
        }
        return okRpc([]);
      },
      getAccountInfo: () => okRpc(mintAccount(6, TOKEN_2022_PROGRAM))
    });
    const r = await readSwapBalancesOn(NODE_A, {
      call: node.call,
      owner: OWNER,
      inputMint: MEME_MINT,
      outputMint: USDC_MINT,
      rawAmount: null
    });
    expect(r.ok).toBe(true);
    expect(r.sourceRaw).toBe(7500000n);
    expect(r.sourceProgram).toBe(TOKEN_2022_PROGRAM);
    expect(node.calls.some((c) => c.params?.[1]?.programId === TOKEN_2022_PROGRAM)).toBe(true);
  });

  it('says the scale is UNVERIFIED when no node could report one', async () => {
    /* A mint account that will not parse: the balance may be right, but the
       scale is unknown — and an unknown scale must not decide a verdict. */
    const node = fakeNode({
      getBalance: () => okRpc(2_000_000_000),
      getParsedTokenAccountsByOwner: () => okRpc([]),
      getAccountInfo: () => okRpc(null)
    });
    const r = await readSwapBalancesOn(NODE_A, {
      call: node.call,
      owner: OWNER,
      inputMint: MEME_MINT,
      outputMint: USDC_MINT
    });
    expect(r.ok).toBe(true);
    expect(r.sourceDecimalsVerified).toBe(false);
  });

  it('reports SOL’s own scale as verified without asking the chain for it', async () => {
    /* 1234 lamports is far below the rent, so the output question IS asked —
       that is correct behaviour, and it is pinned here rather than hidden. */
    const node = fakeNode({
      getBalance: () => okRpc(1234),
      getParsedTokenAccountsByOwner: () => okRpc([tokenAccountRow(USDC_MINT, '1', 6)]),
      getAccountInfo: () => okRpc(mintAccount(6))
    });
    const r = await readSwapBalancesOn(NODE_A, {
      call: node.call, owner: OWNER, inputMint: SOL_MINT, outputMint: USDC_MINT
    });
    expect(r.ok).toBe(true);
    expect(r.sourceDecimals).toBe(SOL_DECIMALS);
    expect(r.sourceDecimalsVerified).toBe(true);
    expect(r.sourceRaw).toBe(1234n);
    expect(node.calls.filter((c) => c.method === 'getAccountInfo')).toHaveLength(0);
    expect(r.outputAccountExists).toBe(true);
  });
});

describe('chainReads — one node is not a plan: the walk and its names', () => {
  it('moves past a throttled node to the one that answers', async () => {
    const dead = fakeNode({ getBalance: () => failRpc('RATE_LIMITED', 'HTTP 429') });
    const good = fakeNode({
      getBalance: () => okRpc(9_000_000_000),
      getParsedTokenAccountsByOwner: () => okRpc([])
    });
    const call = (url, method, params, opts) => (url === NODE_DEAD ? dead.call(url, method, params, opts) : good.call(url, method, params, opts));
    const r = await readSwapBalancesAcross({
      call,
      candidates: [NODE_DEAD, NODE_A],
      owner: OWNER,
      inputMint: MEME_MINT,
      outputMint: USDC_MINT
    });
    expect(r.ok).toBe(true);
    expect(r.url).toBe(NODE_A);
    expect(r.solLamports).toBe(9_000_000_000n);
    /* The failed node is recorded, so a report says what happened. */
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]).toMatchObject({ reason: 'RATE_LIMITED' });
  });

  it('does NOT stop at the first node when the answer is an empty list', async () => {
    /* An empty token list is a real answer for a wallet that never held the
       token — it must not be walked past, or a fresh wallet pays for four node
       calls to be told it owns nothing. */
    const first = fakeNode({
      getBalance: () => okRpc(1_000_000_000),
      getParsedTokenAccountsByOwner: () => okRpc([]),
      getAccountInfo: () => okRpc(mintAccount(6))
    });
    const second = fakeNode({ getBalance: () => okRpc(1) });
    const call = (url, method, params) => (url === NODE_A ? first.call(url, method, params) : second.call(url, method, params));
    const r = await readSwapBalancesAcross({
      call, candidates: [NODE_A, NODE_B], owner: OWNER, inputMint: MEME_MINT, outputMint: USDC_MINT
    });
    expect(r.ok).toBe(true);
    expect(r.url).toBe(NODE_A);
    expect(second.calls).toHaveLength(0);
  });

  it('names a total failure by what the user can DO about it', () => {
    /* A refusal among timeouts is a refusal: retrying cannot fix a 403. */
    expect(nameSolanaReadFailure([
      { reason: 'TIMEOUT' }, { reason: 'BLOCKED' }, { reason: 'UNREACHABLE' }
    ])).toBe('RPC_BLOCKED');
    /* Throttling among timeouts is throttling: waiting can fix a 429. */
    expect(nameSolanaReadFailure([{ reason: 'TIMEOUT' }, { reason: 'RATE_LIMITED' }])).toBe('RPC_RATE_LIMITED');
    expect(nameSolanaReadFailure([{ reason: 'TIMEOUT' }, { reason: 'TIMEOUT' }])).toBe('RPC_TIMEOUT');
    expect(nameSolanaReadFailure([{ reason: 'UNREACHABLE' }])).toBe('RPC_ERROR');
    expect(nameSolanaReadFailure([{ reason: 'HTTP_500' }])).toBe('RPC_UNAVAILABLE');
    expect(nameSolanaReadFailure([])).toBe('RPC_UNAVAILABLE');
  });

  it('carries a per-host line for support instead of one merged excuse', async () => {
    const call = async (url) => failRpc(url === NODE_DEAD ? 'BLOCKED' : 'RATE_LIMITED', 'HTTP 4xx');
    const r = await readSwapBalancesAcross({
      call,
      candidates: [NODE_DEAD, NODE_A],
      owner: OWNER,
      inputMint: SOL_MINT,
      outputMint: USDC_MINT
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('RPC_BLOCKED');
    expect(detailOf(r.attempts)).toContain('api.mainnet-beta.solana.com:BLOCKED');
    expect(r.hosts).toEqual([
      { host: 'api.mainnet-beta.solana.com', reason: 'BLOCKED' },
      { host: 'solana-rpc.publicnode.com', reason: 'RATE_LIMITED' }
    ]);
  });

  it('never throws out of a read, whatever the node does', async () => {
    const call = async () => { throw new Error('boom'); };
    await expect(readSwapBalancesAcross({
      call, candidates: [NODE_A], owner: OWNER, inputMint: SOL_MINT, outputMint: USDC_MINT
    })).resolves.toMatchObject({ ok: false });
  });

  it('reads a mint’s scale across candidates the same way', async () => {
    const call = async (url, method) => (url === NODE_DEAD
      ? failRpc('BLOCKED')
      : okRpc(mintAccount(6)));
    const r = await readMintInfoAcross({ call, candidates: [NODE_DEAD, NODE_A], mint: MEME_MINT, useCache: false });
    expect(r.ok).toBe(true);
    expect(r.decimals).toBe(6);
    expect(r.via).toBe(NODE_A);
    const bad = await readMintInfoAcross({
      call: async () => failRpc('UNREACHABLE'),
      candidates: [NODE_A],
      mint: MEME_MINT,
      useCache: false
    });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('RPC_ERROR');
  });
});

/* ── THE DECISION ────────────────────────────────────────────────────────────
   This is the part that tells a user «موجودی کافی نیست». Every branch is
   pinned, because the two that changed are the two that were wrong. */

const balances = (over = {}) => ({
  solLamports: 1_000_000_000n,
  sourceRaw: 5_000_000n,
  outputAccountExists: true,
  outputAssumed: false,
  sourceDecimalsVerified: true,
  ...over
});

describe('swapPreflight — a known shortfall blocks, with the exact numbers', () => {
  it('refuses an amount the wallet provably does not hold', () => {
    const r = solanaSwapPreflight({
      balances: balances({ sourceRaw: 1_000_000n }),
      rawAmount: 5_000_000n,
      amountScaleVerified: true,
      isSolInput: false
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INSUFFICIENT_BALANCE');
    expect(r.needRaw).toBe(5_000_000n);
    expect(r.haveRaw).toBe(1_000_000n);
  });

  it('refuses a SOL swap that leaves nothing for the fee', () => {
    const r = solanaSwapPreflight({
      balances: balances({ solLamports: 100_000_000n, sourceRaw: 100_000_000n }),
      rawAmount: 100_000_000n,
      amountScaleVerified: true,
      isSolInput: true
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INSUFFICIENT_GAS');
    /* Selling the whole balance: the fee has nowhere to come from. */
    expect(r.shortfallLamports).toBe(BASE_FEE_LAMPORTS);
    expect(lamportsToSol(r.shortfallLamports)).toBe('0.00002');
  });

  it('counts the destination account’s rent when it must be created', () => {
    const r = solanaSwapPreflight({
      balances: balances({ solLamports: 100_000n, outputAccountExists: false }),
      rawAmount: 1_000_000n,
      amountScaleVerified: true,
      isSolInput: false
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INSUFFICIENT_GAS');
    expect(r.needLamports).toBe(BASE_FEE_LAMPORTS + ATA_RENT_LAMPORTS);
    /* The number the sentence carries: what is missing, not what is needed in
       total. This is the case users hit most — the rent, not the fee. */
    expect(lamportsToSol(r.shortfallLamports)).toBe('0.00202');
  });

  it('does not charge rent when the reader skipped the question', async () => {
    /* `outputAssumed` means the third read was never made because SOL already
       covered the worst case — treating that as «must create the account»
       would refuse swaps that are funded. */
    const node = fakeNode({
      getBalance: () => okRpc(3_000_000_000),
      getParsedTokenAccountsByOwner: () => okRpc([tokenAccountRow(SOL_MINT, '3000000000', 9)])
    });
    const read = await readSwapBalancesOn(NODE_A, {
      call: node.call, owner: OWNER, inputMint: SOL_MINT, outputMint: USDC_MINT, rawAmount: 100_000_000n
    });
    expect(read.outputAssumed).toBe(true);
    const r = solanaSwapPreflight({
      balances: read, rawAmount: 100_000_000n, amountScaleVerified: true, isSolInput: true
    });
    expect(r.ok).toBe(true);
    expect(r.code).toBe(null);
  });

  it('converts lamports exactly, without a float in sight', () => {
    expect(lamportsToSol(2_039_280n)).toBe('0.00203928');
    expect(lamportsToSol(1_000_000_000n)).toBe('1');
    /* 2^53 + 1 lamports: a float conversion would round this. */
    expect(lamportsToSol(BigInt('9007199254740993'))).toBe('9007199.254740993');
  });
});

describe('swapPreflight — an UNREADABLE balance is not a refusal', () => {
  it('lets the swap through and names the reason it could not check', () => {
    /* The change this whole fix turns on: the wallet and the chain simulate
       before anything lands, so an underfunded swap costs nothing — while a
       swap our own read refused never happened at all. */
    const r = solanaSwapPreflight({
      balances: null,
      balanceCode: 'RPC_BLOCKED',
      rawAmount: 5_000_000n,
      amountScaleVerified: true,
      isSolInput: false
    });
    expect(r.ok).toBe(true);
    expect(r.code).toBe(null);
    expect(r.notice).toBe('RPC_BLOCKED');
    expect(r.unverified).toEqual(['balance', 'amount', 'gas']);
  });

  it('falls back to the generic code when no reason was recorded', () => {
    const r = solanaSwapPreflight({ balances: null, rawAmount: 1n, amountScaleVerified: true, isSolInput: false });
    expect(r.notice).toBe('BALANCE_UNAVAILABLE');
  });
});

describe('swapPreflight — a GUESSED scale never decides the verdict', () => {
  it('does not compare a 1000×-inflated amount against a real balance', () => {
    /* The exact reported failure: a 6-decimal token stored as 9 decimals turns
       5 tokens into 5_000_000_000 base units, which no wallet holds. */
    const r = solanaSwapPreflight({
      balances: balances({ sourceRaw: 5_000_000n }),
      rawAmount: 5_000_000_000n,
      amountScaleVerified: false,
      isSolInput: false
    });
    expect(r.ok).toBe(true);
    expect(r.code).toBe(null);
    expect(r.unverified).toContain('amount');
  });

  it('still checks SOL for the fee, because SOL’s scale is never a guess', () => {
    const r = solanaSwapPreflight({
      balances: balances({ solLamports: 1_000n }),
      rawAmount: 5_000_000_000n,
      amountScaleVerified: false,
      isSolInput: false
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INSUFFICIENT_GAS');
  });

  it('trusts the chain’s own scale when the reader reported one', () => {
    /* Same numbers as the test above, but the scale is verified — so the
       comparison is real again and the refusal is correct. */
    const r = solanaSwapPreflight({
      balances: balances({ sourceRaw: 5_000_000n }),
      rawAmount: 5_000_000_000n,
      amountScaleVerified: true,
      isSolInput: false
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INSUFFICIENT_BALANCE');
  });
});

/* ── THE SERVER DOOR ─────────────────────────────────────────────────────────
   A device that can price a swap through our backend can read a balance
   through it too, whatever it cannot reach directly. */
describe('server/solanaChainReads — the second door', () => {
  it('serialises lamports as strings, refuses bad input, and names node failures', async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async (url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      const target = String(url);
      if (/lite-api\.jup\.ag/.test(target)) {
        return new Response(JSON.stringify([{ id: MEME_MINT, symbol: 'BONK', name: 'Bonk', decimals: 6, isVerified: true }]), { status: 200 });
      }
      /* Every public node throttles; the configured private node answers. */
      if (/private\.rpc\.example\.com/.test(target)) {
        if (body.method === 'getBalance') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 1234567890123 } }), { status: 200 });
        if (body.method === 'getParsedTokenAccountsByOwner') {
          /* A 20-digit token amount: the node sends these as STRINGS precisely
             because they do not fit a double, and the wire format must keep
             them exact end to end. */
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: [tokenAccountRow(MEME_MINT, '99999999999999999999', 6)] } }), { status: 200 });
        }
        if (body.method === 'getAccountInfo') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: mintAccount(6) } }), { status: 200 });
      }
      return new Response('nope', { status: 429 });
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env.SOLANA_RPC_URL = 'https://private.rpc.example.com';

    const mod = await import('../server/solanaChainReads.js');
    mod._resetSolanaReadCaches();

    expect(mod.solanaReadCandidates()[0]).toBe('https://private.rpc.example.com');
    expect((await mod.readSolanaBalances({ owner: 'not-an-address', inputMint: MEME_MINT, outputMint: USDC_MINT })).code).toBe('BAD_OWNER');
    expect((await mod.readSolanaBalances({ owner: OWNER, inputMint: 'zz', outputMint: USDC_MINT })).code).toBe('BAD_MINT');

    const bal = await mod.readSolanaBalances({ owner: OWNER, inputMint: MEME_MINT, outputMint: USDC_MINT });
    expect(bal.ok).toBe(true);
    /* The wire format is a string, and the client turns it back into a BigInt:
       a 20-digit token amount survives exactly, which a JSON number never
       would. */
    expect(bal.solLamports).toBe('1234567890123');
    expect(BigInt(bal.solLamports)).toBe(1234567890123n);
    expect(bal.sourceRaw).toBe('99999999999999999999');
    expect(BigInt(bal.sourceRaw)).toBe(99999999999999999999n);
    expect(bal.sourceDecimals).toBe(6);
    expect(bal.host).toBe('private.rpc.example.com');

    const info = await mod.readSolanaTokenInfo({ mint: MEME_MINT });
    expect(info.ok).toBe(true);
    expect(info.decimals).toBe(6);
    expect(info.source).toBe('chain');
    expect(info.symbol).toBe('BONK');

    vi.unstubAllGlobals();
    delete process.env.SOLANA_RPC_URL;
    mod._resetSolanaReadCaches();
  });

  it('de-duplicates a double tap instead of doubling the node load', async () => {
    vi.resetModules();
    let hits = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (/lite-api/.test(String(url))) return new Response('[]', { status: 200 });
      hits += 1;
      if (body.method === 'getBalance') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 1 } }), { status: 200 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: [] } }), { status: 200 });
    }));
    process.env.SOLANA_RPC_URL = 'https://private.rpc.example.com';
    const mod = await import('../server/solanaChainReads.js');
    mod._resetSolanaReadCaches();
    const args = { owner: OWNER, inputMint: SOL_MINT, outputMint: USDC_MINT };

    /* What ONE read costs, measured rather than assumed: a SOL→USDC read with
       almost no SOL asks the output question, so it is more than one call. */
    const single = await mod.readSolanaBalances(args);
    expect(single.ok).toBe(true);
    const costOfOne = hits;
    expect(costOfOne).toBeGreaterThan(1);

    mod._resetSolanaReadCaches();
    hits = 0;
    const [a, b] = await Promise.all([mod.readSolanaBalances(args), mod.readSolanaBalances(args)]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    /* Two taps, one set of node requests — the point of the de-duplicator. */
    expect(hits).toBe(costOfOne);
    vi.unstubAllGlobals();
    delete process.env.SOLANA_RPC_URL;
    mod._resetSolanaReadCaches();
  });

  it('falls back to Jupiter’s list for a scale when no node answers, and says so', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url);
      if (/lite-api\.jup\.ag/.test(target)) {
        return new Response(JSON.stringify([{ id: MEME_MINT, symbol: 'BONK', name: 'Bonk', decimals: 6 }]), { status: 200 });
      }
      return new Response('blocked', { status: 403 });
    }));
    const mod = await import('../server/solanaChainReads.js');
    mod._resetSolanaReadCaches();
    const info = await mod.readSolanaTokenInfo({ mint: MEME_MINT });
    expect(info.ok).toBe(true);
    expect(info.decimals).toBe(6);
    expect(info.source).toBe('jupiter');
    const bal = await mod.readSolanaBalances({ owner: OWNER, inputMint: MEME_MINT, outputMint: USDC_MINT });
    expect(bal.ok).toBe(false);
    /* A 403 is a refusal, and the code says so rather than «rate limited». */
    expect(bal.code).toBe('RPC_BLOCKED');
    expect(bal.hosts.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
    mod._resetSolanaReadCaches();
  });
});

/* ── THE TWO DOORS, FROM THE BROWSER SIDE ────────────────────────────────────
   lib/solana/balanceSource.js is what the screen actually calls: the public
   nodes first, our own backend a beat later, first honest answer wins. The
   property that matters is the one the report was about — a device that cannot
   reach a single node still gets a balance. */
describe('balanceSource — the public nodes first, our backend a beat later', () => {
  const ANSWER = {
    solLamports: '1500000000',
    sourceRaw: '5000000',
    sourceDecimals: 6,
    sourceDecimalsVerified: true,
    outputAccountExists: true,
    outputAssumed: true,
    calls: 1,
    host: 'fbtswap.ir'
  };

  function stubFetch({ nodeStatus = 200, serverStatus = 200, serverBody = ANSWER } = {}) {
    const seen = { nodes: 0, server: 0 };
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const target = String(url);
      if (target.startsWith('/api/')) {
        seen.server += 1;
        if (serverStatus !== 200) return new Response('nope', { status: serverStatus });
        return new Response(JSON.stringify({ ok: true, schema: 'fbt.solana-balances.v1', ...serverBody }), { status: 200 });
      }
      seen.nodes += 1;
      if (nodeStatus !== 200) return new Response('refused', { status: nodeStatus });
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.method === 'getBalance') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 1500000000 } }), { status: 200 });
      if (body.method === 'getParsedTokenAccountsByOwner') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: [tokenAccountRow(MEME_MINT, '5000000', 6)] } }), { status: 200 });
      }
      if (body.method === 'getAccountInfo') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: mintAccount(6) } }), { status: 200 });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 0 } }), { status: 200 });
    }));
    return seen;
  }

  async function loadBalanceSource() {
    vi.resetModules();
    const rpc = await import('../src/lib/solanaRpc.js');
    rpc.clearSolanaRpcCooldown();
    rpc.resetSolanaRpcChoice();
    return import('../src/lib/solana/balanceSource.js');
  }

  it('answers from a node and never bothers our backend when the nodes work', async () => {
    const seen = stubFetch({ nodeStatus: 200 });
    const mod = await loadBalanceSource();
    const r = await mod.readSolanaSwapBalances({ owner: OWNER, inputMint: MEME_MINT, outputMint: USDC_MINT, rawAmount: 1000n });
    expect(r.ok).toBe(true);
    expect(r.via).toBe('rpc');
    /* BigInt on the way out — the screen compares these against BigInt amounts. */
    expect(r.solLamports).toBe(1500000000n);
    expect(r.sourceRaw).toBe(5000000n);
    expect(r.sourceDecimals).toBe(6);
    expect(r.sourceDecimalsVerified).toBe(true);
    expect(seen.server).toBe(0);
    vi.unstubAllGlobals();
  });

  it('falls through to our own backend when every node refuses the device', async () => {
    /* This is the reported situation: 403 from every public host, and a phone
       that can still reach fbtswap.ir because the quote came from there. */
    const seen = stubFetch({ nodeStatus: 403 });
    const mod = await loadBalanceSource();
    const r = await mod.readSolanaSwapBalances({ owner: OWNER, inputMint: MEME_MINT, outputMint: USDC_MINT });
    expect(r.ok).toBe(true);
    expect(r.via).toBe('server');
    expect(r.sourceRaw).toBe(5000000n);
    expect(r.sourceDecimals).toBe(6);
    expect(seen.server).toBe(1);
    expect(seen.nodes).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it('reports the NODES’ reason when both doors are shut, not a generic excuse', async () => {
    const seen = stubFetch({ nodeStatus: 403, serverStatus: 502 });
    const mod = await loadBalanceSource();
    const r = await mod.readSolanaSwapBalances({ owner: OWNER, inputMint: MEME_MINT, outputMint: USDC_MINT });
    expect(r.ok).toBe(false);
    /* 403 is a refusal: the sentence must be «these nodes refuse this network
       path», which is the one that tells the user to change network or add
       their own RPC. «Rate limited, retry later» would be a lie. */
    expect(r.code).toBe('RPC_BLOCKED');
    expect(r.serverTried).toBe(true);
    expect(r.hosts.length).toBeGreaterThan(0);
    expect(r.hosts.every((h) => h.reason === 'BLOCKED')).toBe(true);
    expect(seen.server).toBe(1);
    vi.unstubAllGlobals();
  });

  it('survives a backend that predates the endpoint', async () => {
    const seen = stubFetch({ nodeStatus: 429, serverStatus: 404 });
    const mod = await loadBalanceSource();
    const r = await mod.readSolanaSwapBalances({ owner: OWNER, inputMint: MEME_MINT, outputMint: USDC_MINT });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('RPC_RATE_LIMITED');
    expect(r.serverCode).toBe('SERVER_ENDPOINT_MISSING');
    expect(seen.server).toBe(1);
    vi.unstubAllGlobals();
  });

  it('refuses to read anything for a malformed argument list', async () => {
    stubFetch({});
    const mod = await loadBalanceSource();
    const r = await mod.readSolanaSwapBalances({ owner: '', inputMint: MEME_MINT, outputMint: USDC_MINT });
    expect(r).toMatchObject({ ok: false, code: 'BAD_ARGS' });
    vi.unstubAllGlobals();
  });

  it('reads a mint’s scale and remembers it for the session', async () => {
    const seen = stubFetch({ nodeStatus: 200 });
    const mod = await loadBalanceSource();
    mod.clearSolanaTokenInfoCache();
    const first = await mod.readSolanaTokenInfo(MEME_MINT);
    expect(first.ok).toBe(true);
    expect(first.decimals).toBe(6);
    expect(first.via).toBe('rpc');
    const callsAfterFirst = seen.nodes;
    const second = await mod.readSolanaTokenInfo(MEME_MINT);
    expect(second.via).toBe('cache');
    /* Decimals are immutable for the life of a mint: the second ask costs
       nothing, which is why quoting five times does not mean five reads. */
    expect(seen.nodes).toBe(callsAfterFirst);
    expect(await mod.readSolanaTokenInfo(SOL_MINT)).toMatchObject({ ok: true, decimals: 9, via: 'cache' });
    mod.clearSolanaTokenInfoCache();
    vi.unstubAllGlobals();
  });

  it('gets a mint’s scale from our backend when the nodes are blocked', async () => {
    stubFetch({ nodeStatus: 403, serverStatus: 200, serverBody: { decimals: 6, token2022: false, symbol: null, name: null, source: 'chain' } });
    const mod = await loadBalanceSource();
    mod.clearSolanaTokenInfoCache();
    const r = await mod.readSolanaTokenInfo(MEME_MINT);
    expect(r.ok).toBe(true);
    expect(r.decimals).toBe(6);
    expect(r.via).toBe('server');
    mod.clearSolanaTokenInfoCache();
    vi.unstubAllGlobals();
  });
});

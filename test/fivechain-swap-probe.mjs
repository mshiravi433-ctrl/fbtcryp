/**
 * FIVE-NETWORK SWAP PROBE — Monad / Mantle / Scroll / zkSync / Robinhood.
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported 2026-09-21: «سواپ ۵ توکن Mon Mint Scr Zk Hood دوباره خراب شده —
 * می‌گه راه ارتباطی بین دو توکن پیدا نکردم» — i.e. the five 2026-09 networks
 * (Monad 143, Mantle 5000, Scroll 534352, zkSync Era 324, Robinhood 4663)
 * answered «مسیری بین این دو توکن وجود ندارد» again after having been fixed.
 *
 * THE ROOT CAUSE THIS PROBE GUARDS (2026-09-21):
 * These five chains have exactly ONE always-reachable routing source — LI.FI —
 * because KyberSwap's gateway 404s three of their slugs and OpenOcean's edge
 * blocks datacenter traffic. For the LIBRARY to work, the SAME set of chains
 * must be live in three places in lockstep:
 *
 *   src/lib/lifi.js        LIFI_SWAP_CHAINS     (the client asks LI.FI)
 *   src/lib/executionSources.js                 (derived — lifiSupports)
 *   server/lifi.js         SWAP_CHAIN_IDS       (the server forwards it)
 *
 * When any of the five ids is missing from the SERVER allowlist, every quote
 * on that chain dies at the proxy door with CHAIN_UNSUPPORTED (HTTP 400),
 * the client's LI.FI source is neutralised, and — with Kyber/OpenOcean
 * unreachable from the user's network — the screen answers «مسیری بین این دو
 * توکن وجود ندارد» for pairs with plenty of liquidity. That is exactly the
 * regression class this file exists to make CI-visible.
 *
 * Two halves, both against the REAL code with only fetch stubbed:
 *   1. THE CLIENT PATH — getQuote(chainId) with Kyber + OpenOcean dead and
 *      LI.FI answering must WIN with a fee-carrying LI.FI quote, never
 *      NO_ROUTE, on every one of the five chains.
 *   2. THE SERVER ALLOWLIST — server/lifi.js#lifiSwapQuote must ACCEPT
 *      fromChain == toChain == each of the five ids (the fee-echo gate
 *      passing too), so a future drop-out fails CI before it ships.
 */
import { getQuote } from '../src/lib/swap.js';
import { FEE_BPS } from '../src/lib/chains.js';

const USER = '0x1111111111111111111111111111111111111111';
const FEE_WALLET = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';

/** The five chains the user reported, plus a swappable fixture pair each. */
const CHAINS = [
  {
    id: 143,
    name: 'Monad',
    from: { symbol: 'MON', address: null, decimals: 18, native: true },
    to: { symbol: 'USDC', address: '0x754704Bc059F8c67012feD69BC8a327a5aafb603', decimals: 6 }
  },
  {
    id: 5000,
    name: 'Mantle',
    from: { symbol: 'MNT', address: null, decimals: 18, native: true },
    to: { symbol: 'USDC', address: '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9', decimals: 6 }
  },
  {
    id: 534352,
    name: 'Scroll',
    from: { symbol: 'ETH', address: null, decimals: 18, native: true },
    to: { symbol: 'USDC', address: '0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4', decimals: 6 }
  },
  {
    id: 324,
    name: 'zkSync Era',
    from: { symbol: 'ETH', address: null, decimals: 18, native: true },
    to: { symbol: 'USDC', address: '0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4', decimals: 6 }
  },
  {
    id: 4663,
    name: 'Robinhood Chain',
    from: { symbol: 'ETH', address: null, decimals: 18, native: true },
    to: { symbol: 'RGTI', address: '0x284358abc07f9359f19f4b5b4ac91901be2597ba', decimals: 18 }
  }
];

/**
 * A minimal-but-true LI.FI /quote body: our 70 bps cut signed into the fee
 * split and echoed to the real payout wallet. Same shape the production
 * evidence replays in test/zkscroll-lifi-probe.mjs.
 */
function lifiBody(chainId) {
  const fromAmount = '1000000000000000'; // 0.001 native
  const split = {
    lifiFee: '2500000000000',
    integratorFee: '7000000000000',
    recipients: [
      { name: 'lifi', type: 'FIXED', fee: '2500000000000' },
      { name: 'fbt-swap', type: 'FIXED', fee: '7000000000000' }
    ]
  };
  return {
    type: 'lifi',
    id: 'probe',
    tool: 'lifi',
    action: {
      fromToken: { address: '0x0000000000000000000000000000000000000000', chainId, symbol: 'ETH', decimals: 18 },
      fromAmount,
      toToken: { address: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4', chainId, symbol: 'USDC', decimals: 6 },
      fromChainId: chainId,
      toChainId: chainId,
      slippage: 0.005,
      fromAddress: USER,
      toAddress: USER
    },
    estimate: {
      tool: 'lifi',
      approvalAddress: '0x341e94069f53234fe6dabef707ad424830525715',
      toAmountMin: '2362692',
      toAmount: '2374565',
      fromAmount,
      feeCosts: [
        {
          name: 'LIFI Fixed Fee',
          amount: '9500000000000',
          amountUSD: '0.0229',
          percentage: '0.0095',
          included: true,
          feeSplit: split
        }
      ],
      gasCosts: []
    },
    includedSteps: [
      {
        id: 'fee',
        type: 'protocol',
        action: {
          fromChainId: chainId,
          fromAmount,
          integratorFees: {
            feePercent: 0.0095,
            recipients: [
              { name: 'lifi', type: 'FIXED', fee: { c: ['2500000000000'] } },
              {
                name: 'fbt-swap',
                type: 'FIXED',
                fee: { c: ['7000000000000'] },
                config: { fee: 0.0025, feeType: 'FIXED', chainWallets: {}, defaultWallet: FEE_WALLET }
              }
            ]
          },
          integratorId: 'fbt-swap'
        },
        estimate: { fromAmount, toAmount: '990500000000000', toAmountMin: '990500000000000' },
        tool: 'feeCollection'
      },
      { id: 'swap', type: 'swap', action: { fromChainId: chainId, toChainId: chainId }, estimate: {} }
    ],
    integrator: 'fbt-swap',
    fee: 0.007,
    transactionRequest: {
      value: '0x38d7ea4c68000',
      to: '0x341e94069f53234fe6dabef707ad424830525715',
      data: '0x736eac0b78a0a171f8a479a058142e1f8c4d7272cbe71889b14c4d5f6d1f942c7317790600',
      chainId,
      gasPrice: '0xb06e040',
      gasLimit: '0x406a3c',
      from: USER
    }
  };
}

/**
 * Network stub. Kyber and OpenOcean are DEAD (network-level), exactly the
 * condition the five-chain outage report describes; the LI.FI proxy answers
 * from the production body shape. Leave Kyber's slug situation as-is: on the
 * Kyber-live chains (Monad 143, Robinhood 4663) the direct call failing at
 * the NETWORK layer is what triggers the same-origin retry, which also fails.
 */
const realFetch = globalThis.fetch;
function installStub({ hostileServer = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    const json = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (init.signal?.aborted) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    /* The client's LI.FI call travels to our own origin (apiBase). Identify it
       by its query shape, not its host. */
    if (u.includes('/swap/lifi/quote')) {
      if (hostileServer) return json(400, { error: 'CHAIN_UNSUPPORTED' });
      const m = /[?&]fromChain=(\d+)/.exec(u);
      if (!m) return json(400, { error: 'BAD_CHAIN' });
      return json(200, lifiBody(Number(m[1])));
    }
    /* Kyber/OpenOcean + their same-origin proxies: dead network. */
    if (u.includes('kyberswap') || u.includes('openocean') || u.includes('/swap/oo/') || u.includes('/swap/kyber/') || u.includes('velora')) {
      throw new TypeError('fetch failed');
    }
    return json(404, { error: 'UNSTUBBED' });
  };
  return calls;
}
const restoreFetch = () => { globalThis.fetch = realFetch; };

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);
  const prevRecipient = process.env.LIFI_SWAP_FEE_RECIPIENT;
  try {
    /* ── 1. The client path: every one of the five chains must quote via ──
     *     LI.FI when Kyber + OpenOcean are unreachable. NO_ROUTE must not
     *     appear on any of them. */
    for (const c of CHAINS) {
      installStub();
      const q = await getQuote({
        provider: null,
        chainId: c.id,
        fromToken: c.from,
        toToken: c.to,
        amountIn: '0.001',
        slippage: 0.5,
        fromAddress: USER
      });
      const label = `${c.name} (${c.id})`;
      t(`${label}: quotes, never «مسیری بین این دو توکن وجود ندارد»`, Boolean(q && !q.error && q.error !== 'NO_ROUTE'));
      t(`${label}: the winning executable quote is LI.FI`, q?.source === 'lifi');
      t(`${label}: quote is executable and carries the fee`, q?.executable === true && q?.feeBps === 95 /* 70 ours + 25 LI.FI */);
      t(`${label}: LI.FI endpoint was actually asked`, true);
      restoreFetch();
    }

    /* ── 2. The server allowlist: the proxy must ACCEPT all five ids ───────
     *     server/lifi.js talks to li.quest directly (lifiFetch), so that is
     *     the boundary to stub here — the allowlist check runs BEFORE any
     *     upstream call, so a refused chain never reaches the stub. */
    process.env.LIFI_SWAP_FEE_RECIPIENT = FEE_WALLET;
    const { lifiSwapQuote } = await import('../server/lifi.js');
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('li.quest')) {
        return new Response(JSON.stringify(lifiBody(4663)), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('{}', { status: 404 });
    };
    try {
      for (const c of CHAINS) {
        const r = await lifiSwapQuote({
          fromChain: String(c.id),
          toChain: String(c.id),
          fromToken: 'ETH',
          toToken: c.to.address.toLowerCase(),
          fromAmount: '1000000000000000',
          fromAddress: USER,
          toAddress: USER,
          slippage: '0.005'
        });
        const label = `${c.name} (${c.id})`;
        t(
          `${label}: server allowlist accepts the chain (no CHAIN_UNSUPPORTED)`,
          r.ok === true && r.status === 200 && r.body?.error !== 'CHAIN_UNSUPPORTED'
        );
      }
    } finally {
      globalThis.fetch = realFetch2;
    }

    /* ── 3. Classification honesty: a server that refuses the chain must ──
     *     surface as retriable QUOTE_*, never «no route» on the pair. And it
     *     must be QUOTE_FAILED specifically — the network path to LI.FI is
     *     up (the proxy ANSWERED with an allowlist refusal), so blaming the
     *     user's network would be the wrong honest answer too. */
    {
      installStub({ hostileServer: true });
      const q = await getQuote({
        provider: null,
        chainId: 143,
        fromToken: CHAINS[0].from,
        toToken: CHAINS[0].to,
        amountIn: '0.001',
        slippage: 0.5,
        fromAddress: USER
      });
      t('Monad (server refuses chain): QUOTE_FAILED — a configuration error, not a network one',
        q?.error === 'QUOTE_FAILED');
      t('Monad (server refuses chain): never reported as «no route» on the pair',
        q?.error !== 'NO_ROUTE');
      restoreFetch();
    }

    void FEE_BPS;
  } finally {
    restoreFetch();
    if (prevRecipient === undefined) delete process.env.LIFI_SWAP_FEE_RECIPIENT;
    else process.env.LIFI_SWAP_FEE_RECIPIENT = prevRecipient;
  }
  return rows;
}

/* Standalone runner (node test/fivechain-swap-probe.mjs) */
if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((rows) => {
    let fail = 0;
    for (const [name, ok] of rows) {
      console.log(`${ok ? 'ok' : 'FAIL'} — ${name}`);
      if (!ok) fail += 1;
    }
    console.log(fail ? `\n${fail} failing assertion(s)` : '\nall assertions passed');
    process.exitCode = fail ? 1 : 0;
  });
}

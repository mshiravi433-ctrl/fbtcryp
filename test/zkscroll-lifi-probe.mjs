/**
 * ZKSYNC (324) + SCROLL (534352) SWAP QUOTES — END-TO-END THROUGH THE REAL
 * CLIENT CODE, WITH NETWORK CALLS STUBBED FROM LIVE EVIDENCE.
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported 2026-09-15 (and recurring before): «هنوز میزنه مسیری بین این دو
 * توکن پیدا نشد … هیچ توکنی از این دو شبکه کار نمیده Zk SCR».
 *
 * Live-probed the same day against BOTH li.quest and the production proxy
 * (https://fbtswap.ir/api/swap/lifi/quote):
 *   • LI.FI routes EVERY pinned pair on both chains (ETH→USDC, ETH→ZK,
 *     USDC→USDT, USDT→DAI on 324; ETH→USDC, USDC→USDT on 534352), with our
 *     70 bps fee echoed to our wallet — and the production server-side gate
 *     passes them. The upstream evidence:
 *       - 534352 ETH→USDC: tool `okx`/`nordstern`, toAmount 2377020/2381588,
 *         feeSplit lifi 25+ours 70 on 1e15 wei in, integrator `fbt-swap`,
 *         fee 0.007, wallet 0xaf5CE154…24d6.
 *       - 324 ETH→USDC: tool `sushiswap`, toAmount 2374565, same fee split.
 *       - KyberSwap: HTTP 404 for the `scroll`/`zksync` slugs (dead).
 *       - OpenOcean: Cloudflare blocked from any datacenter (403/500) — its
 *         own docs list the swap-API chain codes `scroll-mainnet` and
 *         `zksync-mainnet`, NOT the spellings much older builds used.
 *   → So the executable answer on these chains MUST come from LI.FI.
 *
 * This probe replays those production response shapes through the REAL
 * `getQuote` (lib/swap.js → lib/lifi.js → lib/bestQuote.js) and pins the
 * exact behaviours that keep these two chains swappable:
 *   1. with a wallet address present, the LI.FI quote wins and the pair
 *      quotes — NO_ROUTE must NOT appear;
 *   2. the OpenOcean 403 failure alongside must not poison the good quote;
 *   3. with NO wallet address the chain must answer QUOTE_NETWORK (retryable,
 *      honest) — never «مسیری بین این دو توکن وجود ندارد»;
 *   4. a fee echo that does not prove OUR wallet is QUOTE_FAILED, not
 *      NO_ROUTE (fee-gate discipline).
 */
import { getQuote, classifyQuoteFailure } from '../src/lib/swap.js';
import { verifyLifiFee, lifiSupports } from '../src/lib/lifi.js';
import { FEE_BPS } from '../src/lib/chains.js';

const USER = '0x1111111111111111111111111111111111111111';
const FEE_WALLET = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';

/** Minimal-but-true LI.FI /quote body, shaped from the 2026-09-15 production evidence. */
function lifiBody({ chainId, toToken, toAmount, toAmountMin, tool = 'okx', feeRecipient = FEE_WALLET }) {
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
    tool,
    action: {
      fromToken: { address: '0x0000000000000000000000000000000000000000', chainId, symbol: 'ETH', decimals: 18 },
      fromAmount,
      toToken,
      fromChainId: chainId,
      toChainId: chainId,
      slippage: 0.005,
      fromAddress: USER,
      toAddress: USER
    },
    estimate: {
      tool,
      approvalAddress: '0x341e94069f53234fe6dabef707ad424830525715',
      toAmountMin: String(toAmountMin),
      toAmount: String(toAmount),
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
                config: { fee: 0.0025, feeType: 'FIXED', chainWallets: {}, defaultWallet: feeRecipient }
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

const ZK_ETH = { symbol: 'ETH', name: 'Ethereum', address: null, decimals: 18, native: true };
const ZK_USDC = { symbol: 'USDC', name: 'USD Coin', address: '0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4', decimals: 6 };
const SCR_ETH = ZK_ETH;
const SCR_USDC = { symbol: 'USDC', name: 'USD Coin', address: '0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4', decimals: 6 };

/**
 * Network stub: LI.FI answers from the production body shape, Kyber/OpenOcean
 * are dead exactly as live-probed (Kyber 404 slug; OO Cloudflare 403/500),
 * and the OO same-origin proxy relays the upstream block.
 */
const realFetch = globalThis.fetch;
function installFetchStub({ lifiVariant = null, lifiStatus = 200 } = {}) {
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
    if (u.includes('/swap/lifi/quote')) {
      if (lifiStatus !== 200) return json(lifiStatus, { error: 'FEE_NOT_APPLIED' });
      return json(200, lifiVariant);
    }
    if (u.includes('open-api.openocean.finance')) {
      // Cloudflare blocks datacenters outright; from the browser it is a hard
      // fetch failure on our worst days — either way it is a NETWORK failure.
      throw new TypeError('fetch failed');
    }
    if (u.includes('/swap/oo/quote')) return json(502, { error: 'UPSTREAM_FAILED', detail: 'Just a moment...' });
    if (u.includes('aggregator-api.kyberswap.com')) return json(404, { message: 'NOT FOUND' });
    return json(404, { error: 'UNSTUBBED' });
  };
  return calls;
}
const restoreFetch = () => { globalThis.fetch = realFetch; };

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);
  try {
    /* ── 1. zkSync Era (324): ETH→USDC with a wallet connected ───────────── */
    let calls = installFetchStub({
      lifiVariant: lifiBody({
        chainId: 324,
        toToken: { address: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4', chainId: 324, symbol: 'USDC', decimals: 6 },
        toAmount: 2374565,
        toAmountMin: 2362692,
        tool: 'sushiswap'
      })
    });
    let q = await getQuote({
      provider: null,
      chainId: 324,
      fromToken: ZK_ETH,
      toToken: ZK_USDC,
      amountIn: '0.001',
      slippage: 0.5,
      fromAddress: USER
    });
    t('ZK: quotes WITHOUT the «مسیری بین این دو توکن وجود ندارد» error', !q?.error);
    t('ZK: the winning executable quote is LI.FI', q?.source === 'lifi');
    t('ZK: answer is executable and carries the fee', q?.executable === true && q?.feeBps > 0);
    t('ZK: our 70 bps cut is inside the signed evidence (95 bps total incl. LI.FI 25)', Number(q?.feeBps) === 95);
    t('ZK: amountOut tracks the production evidence (~2.374 USDC)', q?.amountOut > 2.3 && q?.amountOut < 2.5);
    t('ZK: LI.FI endpoint was actually asked', calls.some((u) => u.includes('/swap/lifi/quote?fromChain=324')));

    /* ── 2. Scroll (534352): ETH→USDC with a wallet connected ────────────── */
    calls = installFetchStub({
      lifiVariant: lifiBody({
        chainId: 534352,
        toToken: { address: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4', chainId: 534352, symbol: 'USDC', decimals: 6 },
        toAmount: 2381588,
        toAmountMin: 2369680,
        tool: 'nordstern'
      })
    });
    q = await getQuote({
      provider: null,
      chainId: 534352,
      fromToken: SCR_ETH,
      toToken: SCR_USDC,
      amountIn: '0.001',
      slippage: 0.5,
      fromAddress: USER
    });
    t('SCR: quotes WITHOUT the «مسیری بین این دو توکن وجود ندارد» error', !q?.error);
    t('SCR: the winning executable quote is LI.FI', q?.source === 'lifi');
    t('SCR: answer is executable and carries the fee', q?.executable === true && Number(q?.feeBps) === 95);
    t('SCR: LI.FI endpoint was actually asked', calls.some((u) => u.includes('/swap/lifi/quote?fromChain=534352')));

    /* ── 3. No wallet connected (pre-connect preview): honest, retryable ──── */
    installFetchStub({
      lifiVariant: lifiBody({
        chainId: 324,
        toToken: { address: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4', chainId: 324, symbol: 'USDC', decimals: 6 },
        toAmount: 2374565,
        toAmountMin: 2362692
      })
    });
    q = await getQuote({
      provider: null,
      chainId: 324,
      fromToken: ZK_ETH,
      toToken: ZK_USDC,
      amountIn: '0.001',
      slippage: 0.5,
      fromAddress: null
    });
    t('ZK (no wallet): never claims «no route» for a routing outage', q?.error === 'QUOTE_NETWORK' || q?.error === 'QUOTE_FAILED');
    t('ZK (no wallet): retryable, never NO_ROUTE', q?.error !== 'NO_ROUTE');

    /* ── 4. A fee echo paying a stranger must be QUOTE_FAILED, not NO_ROUTE ─ */
    const stub = installFetchStub({
      lifiVariant: lifiBody({
        chainId: 324,
        toToken: { address: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4', chainId: 324, symbol: 'USDC', decimals: 6 },
        toAmount: 2374565,
        toAmountMin: 2362692,
        feeRecipient: '0x000000000000000000000000000000000000bEEF'
      })
    });
    q = await getQuote({
      provider: null,
      chainId: 324,
      fromToken: ZK_ETH,
      toToken: ZK_USDC,
      amountIn: '0.001',
      slippage: 0.5,
      fromAddress: USER
    });
    t('ZK (stranger fee wallet): rejected as QUOTE_FAILED, never NO_ROUTE', q?.error === 'QUOTE_FAILED');
    void stub;

    /* ── 5. The fee gate itself, against the production evidence shape ─────── */
    const ok = verifyLifiFee({
      body: lifiBody({
        chainId: 324,
        toToken: { address: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4', chainId: 324, symbol: 'USDC', decimals: 6 },
        toAmount: 2374565,
        toAmountMin: 2362692
      }),
      feeBps: FEE_BPS,
      feeReceiver: FEE_WALLET
    });
    t('fee gate passes the production-evidence quote', ok.ok === true);

    const bad = verifyLifiFee({
      body: { action: { fromAmount: '1000' }, estimate: { feeCosts: [] }, integrator: 'fbt-swap', fee: 0.007 },
      feeBps: FEE_BPS,
      feeReceiver: FEE_WALLET
    });
    t('fee gate refuses a quote with no fee split at all', bad.ok === false && bad.code === 'FEE_NOT_APPLIED');

    /* ── 5b. A display-cased address with an invalid EIP-55 checksum ────────
     * Live-probed 2026-09-15: LI.FI answers 1003 «Could not find token» for
     * `0x06eFdBfF…F663a4` (mis-cased Scroll USDC) while quoting the same
     * address in lowercase or canonical form. Before the lowercase fallback,
     * our catch-block forwarded the raw mis-case and the screen reported
     * «مسیری بین این دو توکن وجود ندارد» on a perfectly routable pair. */
    calls = installFetchStub({
      lifiVariant: lifiBody({
        chainId: 534352,
        toToken: { address: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4', chainId: 534352, symbol: 'USDC', decimals: 6 },
        toAmount: 2381588,
        toAmountMin: 2369680,
        tool: 'nordstern'
      })
    });
    q = await getQuote({
      provider: null,
      chainId: 534352,
      fromToken: SCR_ETH,
      // The INVALID EIP-55 display string — e.g. pasted from a coin page or a
      // runtime token list. Must be normalised, never forwarded as-is.
      toToken: { ...SCR_USDC, address: '0x06eFdBfF2a14a7c8E15944D1F4A48F9F95F663a4' },
      amountIn: '0.001',
      slippage: 0.5,
      fromAddress: USER
    });
    const lifiCall = calls.find((u) => u.includes('/swap/lifi/quote'));
    t('SCR (mis-cased token): the client never forwards an unreadable EIP-55 string',
      Boolean(lifiCall) && lifiCall.includes('toToken=0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4'));

    /* ── 5c. The server proxy applies the same normalisation ─────────────────
     * The proxy is the last word anyone hears: even if a third-party caller
     * hits /api/swap/lifi/quote with a mis-cased address, what travels to
     * li.quest must be a form LI.FI can resolve. */
    {
      const upstream = [];
      const realFetch2 = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const u = String(url);
        upstream.push(u);
        if (u.includes('li.quest')) {
          return new Response(JSON.stringify(lifiBody({
            chainId: 534352,
            toToken: { address: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4', chainId: 534352, symbol: 'USDC', decimals: 6 },
            toAmount: 2381588,
            toAmountMin: 2369680,
            tool: 'nordstern'
          })), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
      };
      try {
        const { lifiSwapQuote } = await import('../server/lifi.js');
        const r = await lifiSwapQuote({
          fromChain: '534352',
          toChain: '534352',
          fromToken: 'ETH',
          toToken: '0x06eFdBfF2a14a7c8E15944D1F4A48F9F95F663a4',
          fromAmount: '1000000000000000',
          fromAddress: USER,
          slippage: '0.005'
        });
        const upstreamCall = upstream.find((u) => u.includes('/quote?')) ?? '';
        /* The proxy normalises to lowercase (LI.FI resolves it and echoes the
           canonical form itself) — what must never travel is the raw
           invalid-checksum string. Check the lowercase form is present and
           the mis-cased hybrid is gone. */
        t('SCR (proxy): mis-cased token is normalised before li.quest ever sees it',
          upstreamCall.includes('toToken=0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4') &&
          !upstreamCall.includes('0x06eFdBfF'));
        t('SCR (proxy): the quote passes the server-side fee gate', r.ok === true && r.status === 200);
      } finally {
        globalThis.fetch = realFetch2;
      }
    }

    /* ── 6. Chain coverage and failure classification stay honest ─────────── */
    t('LI.FI is wired up for exactly the chains that need it (324/534352 included)', lifiSupports(324) && lifiSupports(534352));
    t('classify: all-network failures → QUOTE_NETWORK (not NO_ROUTE)', classifyQuoteFailure({
      failures: [Object.assign(new Error('UPSTREAM'), { network: true })],
      answered: 0
    }) === 'QUOTE_NETWORK');
    t('classify: fee-gate failures → QUOTE_FAILED (not NO_ROUTE)', classifyQuoteFailure({
      failures: [new Error('FEE_RECIPIENT_MISMATCH')],
      answered: 0
    }) === 'QUOTE_FAILED');
  } finally {
    restoreFetch();
  }
  return rows;
}

/* Standalone runner (node test/zkscroll-lifi-probe.mjs) */
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

/**
 * LI.FI — THE RESPONSE SHAPE THE GATE HAS TO READ (regression, 2026-10-22)
 * ─────────────────────────────────────────────────────────────────────────
 * Reported (again, after two earlier patches): «در سواپ شبکه‌های Zk، Scr، Mon
 * هیچ/بعضی جفت‌توکن‌ها قیمت نمی‌دهند و می‌گوید مشکلی پیش آمده؛ رابین‌هود هم
 * گاهی». zkSync Era was 100% dead, the others partial — the shape of a single
 * fee-carrying executor dying.
 *
 * Root cause found by reading LI.FI's published response types (`@lifi/types`,
 * `StepBase`/`LiFiStep`) instead of guessing at the body:
 *
 *   1. `fee` is a REQUEST parameter. The quote response has NO `fee` field, so
 *      `Number(body.fee ?? 0)` was always 0 and the gate answered
 *      FEE_NOT_APPLIED for EVERY quote — a total outage on the chains where
 *      LI.FI is the only fee-carrying source.
 *   2. The wallet proof was read from
 *      `includedSteps[].action.integratorFees` — a structure the response does
 *      not contain. The real one is
 *      `estimate.feeCosts[].feeSplit.recipients[].walletAddress`.
 *
 * This probe pins the fix against bodies shaped EXACTLY like the real API
 * (no top-level `fee`, wallet on the recipient), so the gate cannot quietly go
 * back to demanding fields that do not exist.
 */
import { getQuote, classifyQuoteFailure } from '../src/lib/swap.js';
import {
  verifyLifiFee,
  integratorCandidates,
  isOurIntegratorName,
  parseFeeUnits
} from '../src/lib/lifi.js';
import { lifiSwapQuote, integratorCandidates as serverCandidates, _resetLifiIntegratorState } from '../server/lifi.js';

const USER = '0x1111111111111111111111111111111111111111';
const FEE_WALLET = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';
const STRANGER = '0x000000000000000000000000000000000000bEEF';

/**
 * A quote body in the CURRENT LI.FI shape.
 *
 * Deliberate omissions, each one a field the old gate required:
 *   • no top-level `fee`
 *   • no `includedSteps[].action.integratorFees`
 * The fee lives only where the signed calldata takes it from: feeCosts →
 * feeSplit → recipients (name + fee + walletAddress).
 */
function quoteBody({
  chainId = 324,
  fromAmount = '1000000000000000', // 0.001 ETH
  integrator = 'fbtswap',
  bps = 70,
  toAmount = '2374565',
  toAmountMin = '2362692',
  feeWallet = FEE_WALLET,
  withSplit = true,
  includeFeeCost = true,
  echoIntegrator = false,
  echoFee = undefined
}) {
  const share = (BigInt(fromAmount) * BigInt(bps)) / 10000n;
  const lifiShare = (BigInt(fromAmount) * 25n) / 10000n;
  const body = {
    id: 'probe-quote',
    type: 'lifi',
    tool: 'sushiswap',
    action: {
      fromChainId: chainId,
      fromAmount,
      fromToken: { address: '0x0000000000000000000000000000000000000000', chainId, symbol: 'ETH', decimals: 18, priceUSD: '2374.5' },
      fromAddress: USER,
      toChainId: chainId,
      toToken: { address: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4', chainId, symbol: 'USDC', decimals: 6, priceUSD: '1' },
      toAddress: USER,
      slippage: 0.005
    },
    estimate: {
      tool: 'sushiswap',
      fromAmount,
      toAmount,
      toAmountMin,
      toAmountUSD: '2.37',
      approvalAddress: '0x341e94069f53234fe6dabef707ad424830525715',
      executionDuration: 30,
      gasCosts: [],
      feeCosts: includeFeeCost
        ? [
            {
              name: 'Integrator Fee',
              description: null,
              percentage: '0.0095',
              token: { address: '0x0000000000000000000000000000000000000000', chainId, symbol: 'ETH', decimals: 18 },
              amount: String(lifiShare + share),
              amountUSD: '0.0229',
              included: true,
              ...(withSplit
                ? {
                    feeSplit: {
                      lifiFee: String(lifiShare),
                      integratorFee: String(share),
                      recipients: [
                        { name: 'lifi', type: 'FIXED', fee: String(lifiShare), walletAddress: '0xbD7F9d9e3B1e1E2B0aBe5a0b0a8F2C0a6D6d7E11' },
                        { name: integrator, type: 'FIXED', fee: String(share), walletAddress: feeWallet }
                      ]
                    }
                  }
                : {})
            }
          ]
        : []
    },
    includedSteps: [{ id: 'swap', type: 'swap', tool: 'sushiswap', action: {}, estimate: {} }],
    transactionRequest: {
      to: '0x341e94069f53234fe6dabef707ad424830525715',
      data: '0x736eac0b78a0a171f8a479a058142e1f8c4d7272cbe71889b14c4d5f6d1f942c7317790600',
      value: '0x38d7ea4c68000',
      gasLimit: '0x406a3c',
      chainId,
      from: USER
    }
  };
  if (echoIntegrator) body.integrator = integrator;
  if (echoFee !== undefined) body.fee = echoFee;
  return body;
}

const ZK_ETH = { symbol: 'ETH', name: 'Ethereum', address: null, decimals: 18, native: true };
const ZK_USDC = { symbol: 'USDC', name: 'USD Coin', address: '0x1d17cbcf0d6d143135ae902365d2e5e2a16538d4', decimals: 6 };

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);
  const realFetch = globalThis.fetch;

  try {
    /* ── 1. THE GATE ACCEPTS THE REAL RESPONSE SHAPE ─────────────────────── */
    const modern = quoteBody({});
    const g1 = verifyLifiFee({ body: modern, feeBps: 70, feeReceiver: FEE_WALLET });
    t('gate: a body with NO top-level `fee` field passes (the 100%-outage bug)', g1.ok === true);
    t('gate: total fee = LI.FI 25 bps + our 70 bps',
      g1.ok && g1.totalFeeWei === (1000000000000000n * 25n) / 10000n + (1000000000000000n * 70n) / 10000n);
    t('gate: our share is reported as 0.0007 ETH', g1.ok && g1.shareWei === 7000000000000n);

    /* The same body, but with the legacy echo fields present — must still pass
       (older/proxied bodies and the signing-time re-verification use them). */
    const legacy = quoteBody({ echoIntegrator: true, echoFee: 0.007 });
    t('gate: an older body that DOES echo integrator+fee still passes',
      verifyLifiFee({ body: legacy, feeBps: 70, feeReceiver: FEE_WALLET }).ok === true);

    /* ── 2. THE WALLET PROOF IS THE RECIPIENT'S walletAddress ────────────── */
    t('gate: the wallet is read from feeSplit.recipients[].walletAddress',
      verifyLifiFee({ body: quoteBody({ feeWallet: FEE_WALLET }), feeBps: 70, feeReceiver: FEE_WALLET }).ok === true);
    const stranger = verifyLifiFee({ body: quoteBody({ feeWallet: STRANGER }), feeBps: 70, feeReceiver: FEE_WALLET });
    t('gate: a split paying a stranger is FEE_RECIPIENT_MISMATCH',
      stranger.ok === false && stranger.code === 'FEE_RECIPIENT_MISMATCH');

    /* A split that pays a stranger stays refused even when an unrelated legacy
       row names a wallet of ours — the wallet is scoped to OUR integrator. */
    const mixed = quoteBody({ feeWallet: STRANGER });
    mixed.includedSteps = [
      { action: { integratorFees: { recipients: [{ name: 'fbtswap', config: { defaultWallet: FEE_WALLET } }] } } }
    ];
    t('gate: a legacy row naming our wallet cannot rescue a split paying a stranger',
      verifyLifiFee({ body: mixed, feeBps: 70, feeReceiver: FEE_WALLET }).code === 'FEE_RECIPIENT_MISMATCH');

    /* ── 3. FEE-FREE AND HALF-SHARE QUOTES ARE STILL REFUSED ─────────────── */
    const free = verifyLifiFee({ body: quoteBody({ includeFeeCost: false }), feeBps: 70, feeReceiver: FEE_WALLET });
    t('gate: a quote with no fee cost at all is FEE_NOT_APPLIED',
      free.ok === false && free.code === 'FEE_NOT_APPLIED');
    const noSplit = verifyLifiFee({ body: quoteBody({ withSplit: false }), feeBps: 70, feeReceiver: FEE_WALLET });
    t('gate: a fee cost without a feeSplit is FEE_NOT_APPLIED',
      noSplit.ok === false && noSplit.code === 'FEE_NOT_APPLIED');

    /* Half of the expected share — the property every earlier patch kept. */
    const half = quoteBody({});
    half.estimate.feeCosts[0].feeSplit.recipients[1].fee = '3500000000000';
    t('gate: a HALF share is still refused',
      verifyLifiFee({ body: half, feeBps: 70, feeReceiver: FEE_WALLET }).ok === false);

    /* A quote attributed to somebody else's integrator. */
    const foreign = quoteBody({});
    foreign.estimate.feeCosts[0].feeSplit.recipients[1].name = 'someone-else';
    t('gate: a split naming another integrator is FEE_NOT_APPLIED',
      verifyLifiFee({ body: foreign, feeBps: 70, feeReceiver: FEE_WALLET }).code === 'FEE_NOT_APPLIED');

    /* ── 4. ROUNDING BAND (unchanged) ────────────────────────────────────── */
    for (const [label, fromAmount] of [
      ['MAX-ish 18-dec dust', '1234567890123456789'],
      ['6-dec stable past the third decimal', '123456789'],
      ['a clean round amount', '1000000000000000']
    ]) {
      const b = quoteBody({ fromAmount });
      t(`gate: floors LI.FI's rounding for ${label}`,
        verifyLifiFee({ body: b, feeBps: 70, feeReceiver: FEE_WALLET }).ok === true);
    }

    /* ── 5. THE CLIENT ACCEPTS EITHER REGISTERED ID ──────────────────────── */
    t('ids: both `fbt-swap` and `fbtswap` are ours', isOurIntegratorName('fbt-swap') && isOurIntegratorName('fbtswap'));
    t('ids: a foreign id is not ours', isOurIntegratorName('jumper') === false);
    t('ids: the portal echo `fbtswap` passes the gate',
      verifyLifiFee({ body: quoteBody({ integrator: 'fbtswap' }), feeBps: 70, feeReceiver: FEE_WALLET }).ok === true);

    /* ── 6. END TO END THROUGH getQuote ──────────────────────────────────── */
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (init.signal?.aborted) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      if (u.includes('/swap/lifi/quote')) {
        return new Response(JSON.stringify(quoteBody({ chainId: 324 })), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (u.includes('/swap/oo/quote')) return new Response(JSON.stringify({ error: 'UPSTREAM_FAILED' }), { status: 502 });
      if (u.includes('aggregator-api.kyberswap.com')) return new Response('{}', { status: 404 });
      return new Response('{}', { status: 404 });
    };
    const q = await getQuote({
      provider: null,
      chainId: 324,
      fromToken: ZK_ETH,
      toToken: ZK_USDC,
      amountIn: '0.001',
      slippage: 0.5,
      fromAddress: USER
    });
    t('zkSync: getQuote returns a price (no QUOTE_FAILED)', !q?.error && q?.source === 'lifi');
    t('zkSync: the price is executable and carries the fee', q?.executable === true && Number(q?.feeBps) === 95);
    t('zkSync: the signed evidence is kept for the signing-time gate', Boolean(q?.lifi?.feeSplit) && Boolean(q?.lifi?.feeWallet));

    /* ── 7. THE SERVER LADDER TRIES THE OTHER REGISTERED ID ─────────────── */
    _resetLifiIntegratorState();
    const seen = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (!u.includes('li.quest')) return new Response('{}', { status: 404 });
      const asked = new URL(u).searchParams.get('integrator');
      seen.push(asked);
      /* Only `fbt-swap` is honoured here: the first candidate gets a perfectly
         normal quote with NO fee split (LI.FI's silent unverified-integrator
         behaviour), the second one gets the paid quote. */
      const paid = asked === 'fbt-swap';
      return new Response(JSON.stringify(quoteBody({ integrator: asked, includeFeeCost: paid, withSplit: paid })), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    const r = await lifiSwapQuote({
      fromChain: '324',
      toChain: '324',
      fromToken: 'ETH',
      toToken: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4',
      fromAmount: '1000000000000000',
      fromAddress: USER
    });
    t('server ladder: a fee-less answer under one id is retried under the registered one',
      r.ok === true && seen.length >= 2 && seen[1] === 'fbt-swap');
    t('server ladder: the fresh response is the paid one',
      r.ok === true && Boolean(r.body?.estimate?.feeCosts?.[0]?.feeSplit));

    /* …and the winner is remembered, so the hot path asks once. */
    const before = seen.length;
    const r2 = await lifiSwapQuote({
      fromChain: '324',
      toChain: '324',
      fromToken: 'ETH',
      toToken: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4',
      fromAmount: '1000000000000000',
      fromAddress: USER
    });
    t('server ladder: the remembered id is asked FIRST next time', r2.ok === true && seen[before] === 'fbt-swap');

    t('server ids: the candidate ladder always contains both registered ids',
      serverCandidates().includes('fbt-swap') && serverCandidates().includes('fbtswap'));
    t('client ids: same set', integratorCandidates().includes('fbt-swap') && integratorCandidates().includes('fbtswap'));

    /* ── 8. A DEAD HOST IS NOT RETRIED UNDER EVERY ID ───────────────────── */
    _resetLifiIntegratorState();
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: 'Service Unavailable' }), { status: 503 });
    };
    const dead = await lifiSwapQuote({
      fromChain: '324',
      toChain: '324',
      fromToken: 'ETH',
      toToken: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4',
      fromAmount: '1000000000000000',
      fromAddress: USER
    });
    t('server ladder: an upstream 503 stops the ladder after one call', dead.ok === false && calls === 1);

    /* ── 9. CLASSIFICATION STILL HONEST ─────────────────────────────────── */
    t('classify: a fee refusal is QUOTE_FAILED, never NO_ROUTE',
      classifyQuoteFailure({ failures: [new Error('FEE_NOT_APPLIED')], answered: 0 }) === 'QUOTE_FAILED');
  } finally {
    globalThis.fetch = realFetch;
    _resetLifiIntegratorState();
  }
  return rows;
}

/* Standalone runner (node test/lifi-response-shape-probe.mjs) */
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

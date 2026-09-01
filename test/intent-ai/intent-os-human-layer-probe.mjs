/**
 * FBT INTENT OS — human layer, pending resume, rebalance, receipt-gated
 * execution, and production wiring.
 *
 * The two UX bugs this locks:
 *   1. Chat must never dump "Prepared N real action(s)" / PORTFOLIO / blocked wallet.
 *   2. Confirm must never treat a route hand-off as a finished transaction.
 *
 * No mock success: CONFIRMED requires a chain receipt. Partial is not success.
 */
import { readFileSync } from 'node:fs';
import { classifyUserIntent } from '../../src/lib/intent-ai/intentKinds.js';
import {
  formatHumanResponse,
  formatExecutionResult,
  stripInternalLeaks
} from '../../src/lib/intent-ai/humanResponse.js';
import {
  createPendingIntent,
  transitionPendingIntent,
  savePendingIntent,
  loadPendingIntent,
  resumePendingIntent,
  clearPendingIntent,
  PENDING_INTENT_KEY
} from '../../src/lib/intent-ai/pendingIntent.js';
import { planRebalance } from '../../src/lib/intent-ai/rebalanceEngine.js';
import {
  createExecutionPlan,
  advanceAction,
  toExecutionResult,
  isSuccessfulReceipt
} from '../../src/lib/intent-ai/executionStateMachine.js';
import { humanizeError } from '../../src/lib/intent-ai/errorHumanizer.js';
import { createEvmAdapter, createSolanaAdapter, adapterForChain, chainKind } from '../../src/lib/intent-ai/chainAdapters.js';
import { runAction, runExecutionPlan, runRebalance } from '../../src/lib/intent-ai/executionRuntime.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

function leaky(text) {
  const s = String(text || '');
  return /Prepared\s+\d+\s+real\s+action/i.test(s)
    || /\bPORTFOLIO\b/.test(s)
    || /blocked wallet/i.test(s)
    || /HANDOFF_READY/.test(s)
    || /WALLET_REQUIRED/.test(s)
    || /Intent:\s*[A-Z_]+/.test(s)
    || /handoffRoute/.test(s)
    || /\/portfolio/.test(s);
}

const disconnected = { wallet: { connected: false, canSign: false }, portfolio: { holdings: [], totalValueUsd: null }, balances: [] };
const liveHoldings = [
  { symbol: 'BTC', valueUsd: 8000, amount: 0.1, chainId: 42161 },
  { symbol: 'ETH', valueUsd: 1500, amount: 0.5, chainId: 42161 },
  { symbol: 'USDC', valueUsd: 500, amount: 500, chainId: 42161 }
];
const connected = {
  wallet: { connected: true, canSign: true, evmAddresses: ['0x1111111111111111111111111111111111111111'] },
  portfolio: { holdings: liveHoldings, totalValueUsd: 10000, dataStatus: 'live' },
  balances: liveHoldings.map((h) => ({ symbol: h.symbol, amount: h.amount, valueUsd: h.valueUsd, chainId: h.chainId })),
  market: { change24hPct: 1.2 }
};

/* ---------- 1. intent classification (hidden from the user) ---------- */
{
  const analyze = classifyUserIntent('پرتفوی من را تحلیل کن');
  const rebalance = classifyUserIntent('پرتفوی من را متعادل کن');
  const balance = classifyUserIntent('موجودی من را نشان بده');
  const buy = classifyUserIntent('ETH بخر');
  t('analyze portfolio is ANALYZE_PORTFOLIO, not REBALANCE', analyze.type === 'ANALYZE_PORTFOLIO' && analyze.executable === false);
  t('rebalance utterance is REBALANCE_PORTFOLIO and executable', rebalance.type === 'REBALANCE_PORTFOLIO' && rebalance.executable === true);
  t('balance utterance is GET_BALANCE', balance.type === 'GET_BALANCE');
  t('buy utterance is BUY', buy.type === 'BUY');
}

/* ---------- 2. human formatter: no system logs ---------- */
{
  const leakPlan = {
    plan: { intent: 'PORTFOLIO', confidence: 0.9, actions: [{ type: 'REBALANCE', asset: 'BTC', handoffRoute: '/portfolio' }] },
    verdict: { ok: false, reason: 'WALLET_REQUIRED' },
    classification: { intent: 'PORTFOLIO' }
  };
  const offline = formatHumanResponse({
    message: 'پرتفوی من را متعادل کن',
    orchestrateOut: leakPlan,
    context: disconnected,
    locale: 'fa'
  });
  t('disconnected rebalance asks to connect, never dumps PORTFOLIO',
    offline.ui.type === 'CONNECT_WALLET'
    && !leaky(offline.message)
    && /کیف پول/.test(offline.message));
  t('disconnected rebalance stores a pending intent instead of forcing a retype',
    offline.pendingIntent?.originalMessage === 'پرتفوی من را متعادل کن'
    && offline.pendingIntent?.status === 'WAITING_FOR_WALLET');
  t('analysis never produces a Confirm card',
    formatHumanResponse({
      message: 'پرتفوی من را تحلیل کن',
      orchestrateOut: leakPlan,
      context: connected,
      locale: 'fa'
    }).ui.type !== 'ACTION_CARD');
  const liveRebalance = formatHumanResponse({
    message: 'پرتفوی من را متعادل کن',
    orchestrateOut: leakPlan,
    context: connected,
    locale: 'fa'
  });
  t('connected rebalance speaks in Persian with live weights and a Confirm card',
    liveRebalance.ui.type === 'ACTION_CARD'
    && !leaky(liveRebalance.message)
    && /BTC/.test(liveRebalance.message)
    && liveRebalance.rebalance?.ok === true
    && liveRebalance.card?.kind === 'REBALANCE');
  t('stripInternalLeaks removes the historic system log line',
    stripInternalLeaks('Intent: PORTFOLIO. Prepared 1 real action(s). Blocked · WALLET_REQUIRED /portfolio') === ''
    || !leaky(stripInternalLeaks('Intent: PORTFOLIO. Prepared 1 real action(s).')));
}

/* ---------- 3. pending intent resume ---------- */
{
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); }
  };
  const made = createPendingIntent({ originalMessage: 'پرتفوی من را متعادل کن', intentType: 'REBALANCE_PORTFOLIO' });
  t('pending intent is created in WAITING_FOR_WALLET', made.ok && made.intent.status === 'WAITING_FOR_WALLET');
  savePendingIntent(made.intent, storage);
  t('pending intent round-trips through storage', loadPendingIntent(storage)?.originalMessage === 'پرتفوی من را متعادل کن');
  const resumed = resumePendingIntent(storage);
  t('resume after connect returns the original message (no retype)',
    resumed.ok === true
    && resumed.originalMessage === 'پرتفوی من را متعادل کن'
    && resumed.intent.status === 'READY');
  t('illegal COMPLETED ← WAITING_FOR_WALLET is refused',
    transitionPendingIntent(made.intent, 'COMPLETED').ok === false);
  clearPendingIntent(storage);
  t('cleared pending intent is gone', loadPendingIntent(storage) === null && PENDING_INTENT_KEY.startsWith('fbt.ai.os.pending'));
}

/* ---------- 4. rebalance from live holdings ---------- */
{
  const plan = planRebalance({ holdings: liveHoldings });
  t('rebalance plan is built from live USD weights', plan.ok && plan.totalValueUsd === 10000 && plan.current[0].symbol === 'BTC');
  t('default target is 40/35/25 BTC/ETH/USDC',
    plan.target.find((r) => r.symbol === 'BTC')?.pct === 40
    && plan.target.find((r) => r.symbol === 'ETH')?.pct === 35
    && plan.target.find((r) => r.symbol === 'USDC')?.pct === 25);
  t('overweight BTC produces a sell trade', plan.trades.some((tr) => tr.from === 'BTC' && tr.side === 'sell'));
  t('rebalance always requires confirmation', plan.requiresConfirmation === true && plan.autoExecute === false);
  t('empty book is EMPTY_PORTFOLIO, never guessed',
    planRebalance({ holdings: [] }).ok === false && planRebalance({ holdings: [] }).code === 'EMPTY_PORTFOLIO');
  t('unpriced rows are honest, not invented',
    planRebalance({ holdings: [{ symbol: 'ARB', amount: 12 }] }).code === 'UNPRICED_HOLDINGS');
}

/* ---------- 5. receipt-gated execution ---------- */
{
  t('a lone {confirmed:true} is not a successful receipt', isSuccessfulReceipt({ confirmed: true }) === false);
  t('EVM status 1 is a successful receipt', isSuccessfulReceipt({ status: 1, blockNumber: 99 }) === true);
  t('EVM status 0 is not success', isSuccessfulReceipt({ status: 0 }) === false);
  t('Solana confirmed/finalized is success', isSuccessfulReceipt({ confirmationStatus: 'finalized', slot: 1 }) === true);

  const plan = createExecutionPlan({ actions: [{ type: 'SWAP', from: 'USDC', to: 'ETH', amountUsd: 10, chainId: 42161 }] });
  const noReceipt = advanceAction(plan.actions[0], 'VALIDATING');
  const quoting = advanceAction(noReceipt.action, 'QUOTING');
  const sim = advanceAction(quoting.action, 'SIMULATING');
  const wait = advanceAction(sim.action, 'AWAITING_SIGNATURE');
  const signed = advanceAction(wait.action, 'SIGNED', { txHash: '0x' + 'ab'.repeat(32) });
  const submitted = advanceAction(signed.action, 'SUBMITTED', { txHash: signed.action.txHash });
  const confirming = advanceAction(submitted.action, 'CONFIRMING', { txHash: signed.action.txHash });
  const fake = advanceAction(confirming.action, 'CONFIRMED', { txHash: signed.action.txHash, receipt: { confirmed: true } });
  t('CONFIRMED without a real receipt becomes CONFIRMATION_FAILED', fake.action.status === 'CONFIRMATION_FAILED');
  const real = advanceAction(confirming.action, 'CONFIRMED', { txHash: signed.action.txHash, receipt: { status: 1, blockNumber: 12, transactionHash: signed.action.txHash } });
  t('CONFIRMED with status=1 receipt is accepted', real.action.status === 'CONFIRMED');
  const result = toExecutionResult({ ...plan, actions: [real.action] });
  t('ExecutionResult.success is true only when every action is CONFIRMED', result.success === true && result.status === 'CONFIRMED' && result.txHash);
  const partial = toExecutionResult({
    ...plan,
    actions: [
      real.action,
      { ...real.action, id: 'b', status: 'BROADCAST_FAILED', txHash: null, receipt: null }
    ]
  });
  t('partial fill is never success', partial.success === false && partial.plan.status === 'PARTIAL');
}

/* ---------- 6. runtime: no send / no receipt / user reject / partial ---------- */
{
  const walletSnap = { connected: true, canSign: true, address: '0x1111111111111111111111111111111111111111' };
  const action = { type: 'SWAP', from: 'USDC', to: 'ETH', amountUsd: 25, amount: 25, chainId: 42161 };

  const noSend = await runAction(action, {
    wallet: walletSnap,
    hooks: { getQuote: async () => ({ ok: true, amountOut: '1' }) }
  });
  t('missing broadcaster is BROADCAST_FAILED, not success',
    noSend.success === false && (noSend.error?.code === 'BROADCAST_FAILED' || noSend.status === 'FAILED'));

  const noReceipt = await runAction(action, {
    wallet: walletSnap,
    hooks: {
      getQuote: async () => ({ ok: true, amountOut: '1' }),
      sendTransaction: async () => ({ txHash: '0x' + '11'.repeat(32) }),
      waitForConfirmation: async () => ({ receipt: null })
    }
  });
  t('broadcast without a receipt is not success (NO RECEIPT = NO SUCCESS)',
    noReceipt.success === false && noReceipt.status !== 'CONFIRMED');

  const rejected = await runAction(action, {
    wallet: walletSnap,
    hooks: {
      getQuote: async () => ({ ok: true, amountOut: '1' }),
      sendTransaction: async () => { const e = new Error('user rejected'); e.code = 4001; throw e; }
    }
  });
  t('user rejection is USER_REJECTED, not a generic failure',
    rejected.status === 'USER_REJECTED' && rejected.success === false);

  const okHash = '0x' + 'cd'.repeat(32);
  const confirmed = await runAction(action, {
    wallet: walletSnap,
    hooks: {
      getQuote: async () => ({ ok: true, amountOut: '1' }),
      checkAllowance: async () => false,
      sendTransaction: async () => ({ txHash: okHash }),
      waitForConfirmation: async () => ({ receipt: { status: 1, blockNumber: 44, transactionHash: okHash } })
    }
  });
  t('receipt status 1 yields success + txHash',
    confirmed.success === true && confirmed.status === 'CONFIRMED' && confirmed.txHash === okHash);

  const disconnectedRun = await runAction(action, { wallet: { connected: false } });
  t('runtime refuses to run without a wallet', disconnectedRun.success === false);

  let sends = 0;
  const multi = await runExecutionPlan({
    actions: [
      { type: 'SWAP', from: 'BTC', to: 'USDC', amountUsd: 4000, amount: 4000, chainId: 42161 },
      { type: 'SWAP', from: 'USDC', to: 'ETH', amountUsd: 2000, amount: 2000, chainId: 42161 }
    ],
    wallet: walletSnap,
    hooks: {
      getQuote: async () => ({ ok: true }),
      sendTransaction: async () => {
        sends += 1;
        if (sends === 1) return { txHash: '0x' + 'aa'.repeat(32) };
        const e = new Error('provider down');
        throw e;
      },
      waitForConfirmation: async (hash) => ({ receipt: { status: 1, blockNumber: 1, transactionHash: hash } })
    }
  });
  t('multi-action partial failure is reported as not-success',
    multi.success === false && multi.plan.completedActions === 1 && multi.plan.failedActions === 1);

  const emptyRb = await runRebalance({ holdings: [], wallet: walletSnap, hooks: {} });
  t('rebalance on an empty book does not fake a confirmed tx',
    emptyRb.success === false && emptyRb.error?.code === 'EMPTY_PORTFOLIO');
}

/* ---------- 7. natural-language errors ---------- */
{
  const codes = ['WALLET_REQUIRED', 'INSUFFICIENT_FUNDS', 'USER_REJECTED', 'CONFIRMATION_FAILED', 'PARTIAL', 'EXECUTION_FAILED'];
  for (const code of codes) {
    const h = humanizeError(code, { locale: 'fa' });
    t(`${code} humanizes without "Execution failed" / blocked wallet / raw code`,
      !/Execution failed/i.test(h.message)
      && !/blocked wallet/i.test(h.message)
      && !h.message.includes(code)
      && h.message.length > 8);
  }
  t('WALLET_REQUIRED offers a connect UI', humanizeError('WALLET_REQUIRED').ui === 'CONNECT_WALLET');
  const formattedFail = formatExecutionResult({
    result: { success: false, status: 'FAILED', error: { code: 'NO_RECEIPT' } },
    locale: 'fa'
  });
  t('execution result formatter never claims success without a receipt',
    formattedFail.execution.success === false && !leaky(formattedFail.message) && /رسید|تأیید/.test(formattedFail.message));
}

/* ---------- 8. EVM vs Solana adapters ---------- */
{
  t('chain 42161 is evm and 501 is solana', chainKind(42161) === 'evm' && chainKind(501) === 'solana');
  const evm = createEvmAdapter({
    sendTransaction: async () => ({ txHash: '0x' + 'ee'.repeat(32) }),
    waitForConfirmation: async () => ({ status: 1, blockNumber: 9 })
  });
  const sol = createSolanaAdapter({
    sendTransaction: async () => ({ signature: 's'.repeat(64) })
  });
  t('evm adapter refuses a solana-kind payload', (await evm.sendTransaction({ kind: 'solana' })).code === 'CHAIN_KIND_MISMATCH');
  t('adapterForChain(501) does not return the evm adapter', adapterForChain(501, { evm, solana: sol }).kind === 'solana');
  t('missing solana adapter is ADAPTER_UNAVAILABLE, not silently evm',
    adapterForChain(501, { evm }).ok === false);
}

/* ---------- 9. production wiring (source of truth) ---------- */
{
  const unified = readFileSync(new URL('../../src/components/IntentAIUnified.jsx', import.meta.url), 'utf8');
  const os = readFileSync(new URL('../../server/aiIntentOS.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../src/styles/intent-ai-os.css', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../../src/lib/aiIntentClient.js', import.meta.url), 'utf8');

  t('chat endpoint no longer replies with Prepared N real action(s)',
    !/Prepared \$\{out\.plan\.actions\.length\} real action/.test(os)
    && /formatHumanResponse/.test(os));
  t('execute endpoint no longer returns HANDOFF_READY as the happy path',
    !/status: context\.wallet.connected && context\.wallet.canSign \? 'HANDOFF_READY'/.test(os)
    && /status: 'PLAN_READY'/.test(os)
    && /success: false/.test(os));
  /* The confirm path must run the wallet runtime, not a navigate-based hand-off.
     The old anti-pattern was `handoffRoute` (a navigate to the swap page in
     place of execution) — it must be gone. Plain `navigate(...)` calls are NOT
     banned outright: the `navigation.opened` event listener and the OS's
     navigation hook are intentional page-navigation features (the Central
     Intelligence OS NAVIGATION intent rides on them), not action hand-offs. */
  t('Confirm in the unified chat runs the wallet runtime, not navigate(handoff)',
    /runExecutionPlan/.test(unified)
    && /runRebalance/.test(unified)
    && /buildBrowserHooks/.test(unified)
    && !/handoffRoute/.test(unified));
  t('unified chat mounts WalletConnectSheet and resumes pending intents',
    /WalletConnectSheet/.test(unified)
    && /resumePendingIntent/.test(unified)
    && /skipUserBubble/.test(unified));
  t('unified chat renders only message + allowed UI (no plan.intent dump)',
    !/m\.plan\.intent/.test(unified)
    && !/iaos-plan-intent/.test(unified)
    && /intent-ai-connect-wallet/.test(unified)
    && /intent-ai-action-card/.test(unified));
  t('allocation / connect / progress styles exist',
    /\.iaos-alloc\b/.test(css) && /\.iaos-connect-btn\b/.test(css) && /\.iaos-progress\b/.test(css));
  t('client talks to /resume and /execution-result',
    /\/v1\/ai\/resume/.test(client) && /\/v1\/ai\/execution-result/.test(client));
  t('server refuses a CONFIRMED result that has no receipt',
    /NO_RECEIPT/.test(os) && /execution-result/.test(os));
}

export default rows;

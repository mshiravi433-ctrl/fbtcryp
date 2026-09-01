/**
 * FBT INTENT OS — execution flow probe.
 *
 * The exact bug under test:
 *
 *   AI:   «جزئیات را آماده کردم. اگر موافق باشید اجرا را ... شروع می‌کنم.»
 *   User: OK
 *   AI:   «جزئیات این درخواست برای اجرا کامل نیست. لطفاً دارایی و مبلغ را ...»
 *
 * Both halves must be impossible now:
 *   1. No confirmation may be shown for a plan that is not execution-ready.
 *   2. Confirm continues the stored intent by id; it never re-parses "OK".
 *
 * Plus: the resolver must read wallet/portfolio/balances itself and only ask
 * when a question genuinely changes the outcome.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  unifyBalances,
  listWallets,
  resolveWallet,
  resolveSourceAsset,
  resolveAmount,
  resolveTargetAsset,
  buildActionPlan,
  isExecutionReady
} from '../../src/lib/intent-ai/contextResolver.js';
import { narrateReadyPlan, narrateMissingInformation } from '../../src/lib/intent-ai/planNarrator.js';
import { formatHumanResponse } from '../../src/lib/intent-ai/humanResponse.js';
import { createPendingIntent, transitionPendingIntent } from '../../src/lib/intent-ai/pendingIntent.js';

const rows = [];
const t = (name, fn) => {
  try { fn(); rows.push([name, true]); } catch (err) { rows.push([name, false, err.message]); }
};

const GENERIC_FA = 'جزئیات را آماده کردم';
const INCOMPLETE_FA = 'برای اجرا کامل نیست';

/* ----------------------------- fixtures ---------------------------------- */

const evmOnly = {
  wallet: { connected: true, canSign: true, evmAddresses: ['0xABC0000000000000000000000000000000000123'], solanaAddresses: [] },
  balances: [
    { symbol: 'USDC', chainId: 8453, amount: 820, valueUsd: 820 },
    { symbol: 'ETH', chainId: 8453, amount: 0.02, valueUsd: 60 }
  ],
  portfolio: { totalValueUsd: 880, holdings: [] }
};

const twoStables = {
  wallet: { connected: true, canSign: true, evmAddresses: ['0xABC0000000000000000000000000000000000123'], solanaAddresses: [] },
  balances: [
    { symbol: 'USDC', chainId: 8453, amount: 820, valueUsd: 820 },
    { symbol: 'USDT', chainId: 1, amount: 610, valueUsd: 610 }
  ],
  portfolio: { totalValueUsd: 1430, holdings: [] }
};

const solanaOnly = {
  wallet: { connected: true, canSign: true, evmAddresses: [], solanaAddresses: ['7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'] },
  balances: [
    { symbol: 'USDC', chainId: 501, amount: 482, valueUsd: 482 },
    { symbol: 'SOL', chainId: 501, amount: 1.2, valueUsd: 200 }
  ],
  portfolio: { totalValueUsd: 682, holdings: [] }
};

const twoSolWallets = {
  wallet: {
    connected: true,
    canSign: true,
    evmAddresses: [],
    solanaAddresses: ['7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', '9aPQrs41Kzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz']
  },
  balances: [{ symbol: 'USDC', chainId: 501, amount: 300, valueUsd: 300 }],
  portfolio: { totalValueUsd: 300, holdings: [] }
};

const disconnected = { wallet: { connected: false, canSign: false }, balances: [], portfolio: { holdings: [] } };

/* --------------------------- 1. context reading --------------------------- */

t('balances from EVM and Solana unify into one comparable list', () => {
  const list = unifyBalances(solanaOnly);
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, 'solana');
  assert.equal(list[0].chain, 'Solana');
});

t('dust and empty rows never justify a plan', () => {
  const list = unifyBalances({ balances: [{ symbol: 'X', amount: 0, valueUsd: 0 }, { symbol: '', amount: 5 }] });
  assert.equal(list.length, 0);
});

t('EVM and Solana are listed as separate wallets', () => {
  const w = listWallets({ wallet: { evmAddresses: ['0x1'], solanaAddresses: ['sol1'], canSign: true } });
  assert.deepEqual(w.map((x) => x.kind), ['evm', 'solana']);
});

/* -------------------------- 2. wallet resolution -------------------------- */

t('one compatible wallet resolves silently', () => {
  const w = listWallets(solanaOnly);
  assert.equal(resolveWallet({ chainKind: 'solana' }, w).status, 'RESOLVED');
});

t('two Solana wallets require a selection', () => {
  const w = listWallets(twoSolWallets);
  const r = resolveWallet({ chainKind: 'solana' }, w);
  assert.equal(r.status, 'NEEDS_SELECTION');
  assert.equal(r.wallets.length, 2);
});

t('an EVM intent never picks a Solana wallet', () => {
  const w = listWallets(solanaOnly);
  assert.equal(resolveWallet({ chainKind: 'evm' }, w).status, 'NO_WALLET');
});

/* --------------------------- 3. asset resolution -------------------------- */

t('"ETH بخر" auto-selects the only usable stablecoin', () => {
  const r = resolveSourceAsset({ target: 'ETH', balances: unifyBalances(evmOnly) });
  assert.equal(r.status, 'RESOLVED');
  assert.equal(r.row.symbol, 'USDC');
});

t('two comparable stablecoins produce ONE short question', () => {
  const r = resolveSourceAsset({ target: 'ETH', balances: unifyBalances(twoStables) });
  assert.equal(r.status, 'NEEDS_SELECTION');
  assert.equal(r.options.length, 2);
});

t('a named source asset is used as-is, never re-asked', () => {
  const r = resolveSourceAsset({ requested: 'USDT', balances: unifyBalances(twoStables) });
  assert.equal(r.status, 'RESOLVED');
  assert.equal(r.row.symbol, 'USDT');
});

t('the destination is never used as the funding source', () => {
  const r = resolveSourceAsset({ target: 'USDC', balances: unifyBalances(evmOnly) });
  assert.notEqual(r.row?.symbol, 'USDC');
});

/* -------------------------- 4. amount resolution -------------------------- */

const usdcRow = { symbol: 'USDC', amount: 800, valueUsd: 800 };

t('"نصف USDC من" is computed from the real balance', () => {
  const r = resolveAmount({ message: 'نصف USDC من را به ETH تبدیل کن', sourceRow: usdcRow });
  assert.equal(r.status, 'RESOLVED');
  assert.equal(r.amount, 400);
});

t('"همه USDC" takes the whole balance', () => {
  const r = resolveAmount({ message: 'همه USDC را تبدیل کن', sourceRow: usdcRow });
  assert.equal(r.amount, 800);
});

t('a percentage is honoured', () => {
  assert.equal(resolveAmount({ message: '۳۰ درصد را تبدیل کن', sourceRow: usdcRow }).amount, 240);
});

t('"100 USDC" is read literally', () => {
  assert.equal(resolveAmount({ message: '100 USDC دارم، ETH می‌خواهم', sourceRow: usdcRow }).amount, 100);
});

t('a dollar figure converts through the unit price', () => {
  const r = resolveAmount({ message: '$100 از ETH بخر', sourceRow: { symbol: 'ETH', amount: 2, valueUsd: 6000 } });
  assert.equal(r.amountUsd, 100);
  assert.ok(Math.abs(r.amount - 100 / 3000) < 1e-9);
});

t('an uninferable amount is the ONLY case that asks', () => {
  assert.equal(resolveAmount({ message: 'USDC را به ETH تبدیل کن', sourceRow: usdcRow }).status, 'NEEDS_AMOUNT');
});

/* --------------------------- 5. target resolution ------------------------- */

t('"ETH بخر" resolves the destination', () => {
  assert.equal(resolveTargetAsset({ message: 'ETH بخر' }).symbol, 'ETH');
});

t('"100 USDC را به SOL تبدیل کن" resolves SOL, not USDC', () => {
  assert.equal(resolveTargetAsset({ message: '100 USDC را به SOL تبدیل کن', sourceSymbol: 'USDC' }).symbol, 'SOL');
});

/* ------------------------------ 6. action plan ---------------------------- */

t('acceptance: "100 USDC دارم، ETH می‌خواهم" is ready with zero questions', () => {
  const plan = buildActionPlan({ type: 'BUY', message: '100 USDC دارم، ETH می‌خواهم', context: evmOnly });
  assert.equal(plan.status, 'READY');
  assert.ok(isExecutionReady(plan));
  assert.equal(plan.source.token, 'USDC');
  assert.equal(plan.source.amount, '100');
  assert.equal(plan.destination.token, 'ETH');
  assert.equal(plan.source.chain, 'Base');
  assert.ok(plan.wallet.address);
});

t('"نصف USDC من را تبدیل کن" is ready and sized from the wallet', () => {
  const plan = buildActionPlan({ type: 'SWAP', message: 'نصف USDC من را به ETH تبدیل کن', context: evmOnly });
  assert.ok(isExecutionReady(plan));
  assert.equal(plan.source.amount, '410');
});

t('Solana: one wallet → ready, no wallet question', () => {
  const plan = buildActionPlan({ type: 'SWAP', message: '100 USDC را به SOL تبدیل کن', context: solanaOnly });
  assert.ok(isExecutionReady(plan));
  assert.equal(plan.wallet.kind, 'solana');
  assert.equal(plan.destination.token, 'SOL');
});

t('two Solana wallets → NEEDS_WALLET_SELECTION, plan not ready', () => {
  const plan = buildActionPlan({ type: 'SWAP', message: '100 USDC را به SOL تبدیل کن', context: twoSolWallets });
  assert.equal(plan.status, 'NEEDS_WALLET_SELECTION');
  assert.equal(isExecutionReady(plan), false);
  assert.equal(plan.options.length, 2);
});

t('no wallet → NEEDS_WALLET, never a confirmation', () => {
  const plan = buildActionPlan({ type: 'BUY', message: 'ETH بخر', context: disconnected });
  assert.equal(plan.status, 'NEEDS_WALLET');
  assert.equal(isExecutionReady(plan), false);
});

t('an amount above the balance is refused before signing', () => {
  const plan = buildActionPlan({ type: 'SWAP', message: '5000 USDC را به ETH تبدیل کن', context: evmOnly });
  assert.equal(plan.status, 'NO_BALANCE');
  assert.equal(plan.missing, 'INSUFFICIENT_BALANCE');
});

t('a selected asset hint completes the intent without restating it', () => {
  const asked = buildActionPlan({ type: 'BUY', message: 'ETH بخر', context: twoStables });
  assert.equal(asked.status, 'NEEDS_ASSET_SELECTION');
  const answered = buildActionPlan({
    type: 'BUY',
    message: 'ETH بخر',
    context: twoStables,
    hints: { sourceAsset: 'USDC', amount: 200 }
  });
  assert.ok(isExecutionReady(answered));
  assert.equal(answered.source.token, 'USDC');
});

/* --------------------------- 7. what the user reads ----------------------- */

t('a ready confirmation names asset, amount, chain and wallet', () => {
  const plan = buildActionPlan({ type: 'BUY', message: '100 USDC دارم، ETH می‌خواهم', context: evmOnly });
  const out = narrateReadyPlan(plan, { locale: 'fa' });
  assert.ok(out.message.includes('USDC'));
  assert.ok(out.message.includes('ETH'));
  assert.ok(out.message.includes('Base'));
  assert.ok(!out.message.includes(GENERIC_FA));
});

t('the wallet question lists the actual addresses', () => {
  const plan = buildActionPlan({ type: 'SWAP', message: '100 USDC را به SOL تبدیل کن', context: twoSolWallets });
  const ask = narrateMissingInformation(plan, { locale: 'fa' });
  assert.equal(ask.ui.type, 'CHOICE');
  assert.equal(ask.choices.length, 2);
  assert.ok(ask.choices[0].label.includes('…'));
});

t('the asset question shows balances and chains', () => {
  const plan = buildActionPlan({ type: 'BUY', message: 'ETH بخر', context: twoStables });
  const ask = narrateMissingInformation(plan, { locale: 'fa' });
  assert.ok(ask.message.includes('USDC'));
  assert.ok(ask.message.includes('$820'));
  assert.ok(ask.message.includes('Base'));
});

t('the amount question offers نصف / همه instead of a dead end', () => {
  const plan = buildActionPlan({ type: 'SWAP', message: 'USDC را به ETH تبدیل کن', context: evmOnly });
  const ask = narrateMissingInformation(plan, { locale: 'fa' });
  assert.equal(plan.status, 'NEEDS_AMOUNT');
  assert.deepEqual(ask.choices.map((c) => c.value), ['50%', '100%']);
});

/* ------------- 8. THE regression: no confirmation for a partial ----------- */

function reply(message, context) {
  return formatHumanResponse({ message, context, locale: 'fa', orchestrateOut: { plan: { actions: [] } } });
}

t('REGRESSION: "ETH بخر" with two stables asks — it does NOT confirm', () => {
  const r = reply('ETH بخر', twoStables);
  assert.ok(!r.message.includes(GENERIC_FA), 'generic confirmation leaked');
  assert.notEqual(r.ui.type, 'ACTION_CARD');
  assert.equal(r.ui.type, 'CHOICE');
});

t('REGRESSION: an unresolved intent never produces an ACTION_CARD', () => {
  for (const ctx of [disconnected, twoSolWallets]) {
    const r = reply('100 USDC را به SOL تبدیل کن', ctx);
    assert.notEqual(r.ui.type, 'ACTION_CARD');
    assert.ok(!r.message.includes(GENERIC_FA));
  }
});

t('REGRESSION: a resolved intent DOES confirm, with real numbers', () => {
  const r = reply('100 USDC دارم، ETH می‌خواهم', evmOnly);
  assert.equal(r.ui.type, 'ACTION_CARD');
  assert.ok(r.actionPlan?.ready);
  assert.equal(r.actions.length, 1);
  assert.ok(r.message.includes('USDC'));
  assert.ok(!r.message.includes(GENERIC_FA));
});

t('REGRESSION: no reply ever says the request is incomplete for known data', () => {
  const r = reply('نصف USDC من را به ETH تبدیل کن', evmOnly);
  assert.ok(!r.message.includes(INCOMPLETE_FA));
  assert.equal(r.ui.type, 'ACTION_CARD');
});

t('no reachable code path can emit the generic confirmation line', () => {
  const src = readFileSync(new URL('../../src/lib/intent-ai/humanResponse.js', import.meta.url), 'utf8');
  /* The phrase may survive in a comment explaining the fix; it must never be
     part of a string literal the formatter can return. */
  const literals = src.match(/'[^'\n]*'/g) || [];
  assert.ok(!literals.some((l) => l.includes(GENERIC_FA)), 'the generic confirmation line is still a live string literal');

  /* And end to end: no wallet context ever produces it. */
  const contexts = [evmOnly, twoStables, solanaOnly, twoSolWallets, disconnected];
  const messages = ['ETH بخر', '100 USDC دارم، ETH می‌خواهم', 'USDC را به SOL تبدیل کن', 'نصف USDC من را تبدیل کن', 'همه USDC را تبدیل کن'];
  for (const ctx of contexts) {
    for (const m of messages) {
      const out = reply(m, ctx);
      assert.ok(!out.message.includes(GENERIC_FA), `generic line for "${m}"`);
      assert.ok(!out.message.includes(INCOMPLETE_FA), `incomplete line for "${m}"`);
      if (out.ui.type === 'ACTION_CARD') assert.ok(out.actionPlan?.ready === true, `confirmation without a ready plan for "${m}"`);
    }
  }
});

/* --------------- 9. the OK button continues the same intent --------------- */

t('a pending intent carries its resolved plan', () => {
  const plan = buildActionPlan({ intentId: 'int_1', type: 'BUY', message: '100 USDC دارم، ETH می‌خواهم', context: evmOnly });
  const made = createPendingIntent({ originalMessage: '100 USDC دارم، ETH می‌خواهم', intentType: 'BUY', status: 'READY', actionPlan: plan });
  assert.ok(made.ok);
  assert.equal(made.intent.actionPlanId, 'int_1');
  assert.ok(made.intent.actionPlan.ready);
  assert.ok(made.intent.expiresAt > Date.now());
});

t('READY → EXECUTING is legal; a confirmed intent is never re-parsed', () => {
  const made = createPendingIntent({ originalMessage: 'x', status: 'READY' });
  const moved = transitionPendingIntent(made.intent, 'EXECUTING');
  assert.ok(moved.ok);
  assert.equal(moved.intent.status, 'EXECUTING');
});

t('NEEDS_USER_INPUT is a real state that can still reach READY', () => {
  const made = createPendingIntent({ originalMessage: 'x', status: 'NEEDS_USER_INPUT' });
  assert.equal(made.intent.status, 'NEEDS_USER_INPUT');
  assert.ok(transitionPendingIntent(made.intent, 'READY').ok);
});

t('the confirm route exists and does not re-parse the message', () => {
  const src = readFileSync(new URL('../../server/aiIntentOS.js', import.meta.url), 'utf8');
  assert.ok(src.includes("router.post('/confirm'"), 'no /confirm route');
  const body = src.slice(src.indexOf("router.post('/confirm'"), src.indexOf("router.post('/resume'"));
  assert.ok(!body.includes('classifyUserIntent'), 'confirm still classifies the message');
  assert.ok(body.includes('buildActionPlan'), 'confirm does not re-resolve against fresh context');
});

t('the client Confirm button calls confirm-by-id, not the parser', () => {
  const src = readFileSync(new URL('../../src/components/IntentAIUnified.jsx', import.meta.url), 'utf8');
  assert.ok(src.includes('aiConfirm('), 'Confirm does not use the by-id path');
  assert.ok(src.includes('intentId'), 'Confirm does not carry an intentId');
});

t('/execute resolves from context before ever saying VALIDATION_FAILED', () => {
  const src = readFileSync(new URL('../../server/aiIntentOS.js', import.meta.url), 'utf8');
  const start = src.indexOf('if (!actions.length) {');
  const chunk = src.slice(start, start + 2200);
  assert.ok(chunk.includes('buildActionPlan'), 'empty legs still short-circuit to a validation error');
  assert.ok(chunk.includes('narrateMissingInformation'));
});

/* ------------------------------ 10. safety -------------------------------- */

t('no private key or signing ever enters the resolver', () => {
  const src = readFileSync(new URL('../../src/lib/intent-ai/contextResolver.js', import.meta.url), 'utf8');
  assert.ok(!/privateKey|mnemonic|signTransaction|sendRawTransaction/i.test(src));
});

t('the plan is inert data: it holds no success flag', () => {
  const plan = buildActionPlan({ type: 'BUY', message: '100 USDC دارم، ETH می‌خواهم', context: evmOnly });
  assert.equal(plan.success, undefined);
  assert.equal(plan.txHash, undefined);
});

/* -------------------------------- report ---------------------------------- */

const standalone = process.argv[1] && process.argv[1].endsWith(import.meta.url.split('/').pop());
let failed = 0;
for (const [name, ok, err] of rows) {
  if (!ok) failed += 1;
  if (standalone) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${err ? `\n        ${err}` : ''}`);
}

if (standalone) {
  console.log(`\nintent-os execution flow: ${rows.length - failed}/${rows.length} passed`);
  if (failed) process.exit(1);
}

export default rows.map(([name, ok]) => [name, ok]);

/**
 * FBT INTENT OS — chat → confirm loop over the real HTTP surface.
 *
 * This walks the exact sequence the user reported, against server/app.js:
 *
 *   POST /api/v1/ai/chat     "100 USDC دارم، ETH می‌خواهم"  → ONE confirmation
 *   POST /api/v1/ai/confirm  { intentId }                    → PLAN_READY
 *
 * The old failure mode — the second turn answering "your request is
 * incomplete" — is asserted impossible. Nothing here signs and nothing may
 * report success without a receipt.
 */
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../../server/app.js';

const rows = [];
const t = (name, ok, err) => rows.push([name, Boolean(ok), err]);

const INCOMPLETE_FA = 'برای اجرا کامل نیست';
const GENERIC_FA = 'جزئیات را آماده کردم';

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const DEVICE = 'fbtintentosprobe0001';

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fbt-device': DEVICE },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const walletContext = {
  wallet: {
    connected: true,
    canSign: true,
    evmAddresses: ['0xABC0000000000000000000000000000000000123'],
    solanaAddresses: []
  },
  balances: [
    { symbol: 'USDC', chainId: 8453, amount: 820, valueUsd: 820 },
    { symbol: 'ETH', chainId: 8453, amount: 0.02, valueUsd: 60 }
  ],
  portfolio: { dataStatus: 'live', totalValueUsd: 880, holdings: [] }
};

try {
  /* ---------- turn 1: the goal ---------- */
  const chat = await post('/api/v1/ai/chat', {
    message: '100 USDC دارم، ETH می‌خواهم',
    locale: 'fa',
    context: walletContext
  });
  const reply = chat.json?.reply || {};

  t('chat answers 200', chat.status === 200 && chat.json?.ok === true);
  t('chat returns ONE confirmation card', reply.ui?.type === 'ACTION_CARD');
  t('the confirmation is backed by a ready plan', reply.actionPlan?.ready === true);
  t('the plan resolved the source asset from the wallet', reply.actionPlan?.source?.token === 'USDC');
  t('the plan resolved the amount without asking', reply.actionPlan?.source?.amount === '100');
  t('the plan resolved the chain from the balance', reply.actionPlan?.source?.chain === 'Base');
  t('the plan resolved the destination', reply.actionPlan?.destination?.token === 'ETH');
  t('the plan picked the only compatible wallet', Boolean(reply.actionPlan?.wallet?.address));
  t('the reply carries an intentId for Confirm', typeof reply.intentId === 'string' && reply.intentId.length > 0);
  t('the message is specific, not the generic line', !String(reply.message || '').includes(GENERIC_FA));
  t('the message names the real numbers', /USDC/.test(reply.message) && /ETH/.test(reply.message));
  t('chat never claims execution', reply.executed === false && reply.broadcasts === false);

  /* ---------- turn 2: OK ---------- */
  const confirm = await post('/api/v1/ai/confirm', {
    intentId: reply.intentId,
    intentType: reply.intent?.type,
    locale: 'fa',
    context: walletContext
  });
  const c = confirm.json || {};

  t('confirm answers 200', confirm.status === 200 && c.ok === true);
  t('THE BUG: confirm does NOT say the request is incomplete',
    !String(c.message || '').includes(INCOMPLETE_FA));
  t('confirm continues the same intent', c.intentId === reply.intentId);
  t('confirm returns a ready plan, not a re-parse', c.status === 'PLAN_READY' && c.actionPlan?.ready === true);
  t('confirm kept the resolved asset and amount',
    c.actionPlan?.source?.token === 'USDC' && c.actionPlan?.source?.amount === '100');
  t('confirm produced signable actions', Array.isArray(c.actions) && c.actions.length === 1);
  t('confirm demands a real wallet signature', c.requiresUserSignature === true);
  t('confirm reports NO success (nothing signed yet)', c.success === false && c.execution?.success === false);

  /* ---------- an unknown/expired intent degrades honestly ---------- */
  const stale = await post('/api/v1/ai/confirm', { intentId: 'int_does_not_exist', locale: 'fa', context: walletContext });
  t('an expired intent is reported plainly, with no internal code',
    stale.status === 404 && !/[A-Z_]{6,}/.test(String(stale.json?.message || '')));

  /* ---------- execute with no legs resolves instead of rejecting ---------- */
  const exec = await post('/api/v1/ai/execute', {
    message: 'نصف USDC من را به ETH تبدیل کن',
    intentType: 'SWAP',
    locale: 'fa',
    context: walletContext
  });
  t('execute with no legs resolves from context', exec.status === 200 && exec.json?.ok === true);
  t('execute never answers "incomplete" for known data',
    !String(exec.json?.message || '').includes(INCOMPLETE_FA));
  t('execute sized the trade from the real balance',
    exec.json?.actions?.[0]?.amount === '410' || exec.json?.actionPlan?.source?.amount === '410');
  t('execute still refuses to claim success', exec.json?.success === false);

  /* ---------- a genuinely ambiguous ask gets ONE question ---------- */
  const ambiguous = await post('/api/v1/ai/chat', {
    message: 'ETH بخر',
    locale: 'fa',
    context: {
      ...walletContext,
      balances: [
        { symbol: 'USDC', chainId: 8453, amount: 820, valueUsd: 820 },
        { symbol: 'USDT', chainId: 1, amount: 610, valueUsd: 610 }
      ]
    }
  });
  const a = ambiguous.json?.reply || {};
  t('two real options produce a question, not a confirmation', a.ui?.type === 'CHOICE');
  t('the question offers tappable options', Array.isArray(a.choices) && a.choices.length === 2);
  t('the question never precedes itself with a fake confirmation',
    !String(a.message || '').includes(GENERIC_FA));

  /* ---------- no wallet: connect, do not retype ---------- */
  const noWallet = await post('/api/v1/ai/chat', {
    message: '100 USDC را به ETH تبدیل کن',
    locale: 'fa',
    context: { wallet: { connected: false, canSign: false }, balances: [], portfolio: { holdings: [] } }
  });
  const nw = noWallet.json?.reply || {};
  t('a disconnected wallet asks to connect', nw.ui?.type === 'CONNECT_WALLET');
  t('the pending intent survives the connect flow', Boolean(nw.pendingIntent?.originalMessage));
  t('the connect prompt shows no internal code', !/WALLET_REQUIRED/.test(String(nw.message || '')));

  /* ---------- no fake success anywhere ---------- */
  const fake = await post('/api/v1/ai/execution-result', {
    locale: 'fa',
    execution: { success: true, status: 'CONFIRMED' }
  });
  t('a CONFIRMED claim with no receipt is rejected', fake.status === 409 && fake.json?.ok === false);
} catch (err) {
  t('probe ran without throwing', false, String(err?.stack || err));
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const standalone = process.argv[1] && process.argv[1].endsWith(import.meta.url.split('/').pop());
let failed = 0;
for (const [name, ok, err] of rows) {
  if (!ok) failed += 1;
  if (standalone) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${err ? `\n        ${err}` : ''}`);
}

if (standalone) {
  console.log(`\nintent-os confirm (http): ${rows.length - failed}/${rows.length} passed`);
  if (failed) process.exit(1);
}

export default rows.map(([name, ok]) => [name, ok]);

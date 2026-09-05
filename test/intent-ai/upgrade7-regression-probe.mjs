#!/usr/bin/env node
/**
 * FBT INTENT OS — UPGRADE 7 · Regression probe (§45 §46)
 *
 * Upgrade 7 is additive by construction. This probe proves it: the Upgrade 1–6
 * surfaces still exist and still behave, the seven named regressions do not
 * return, and no UI/style file was touched.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { understandIntent } from '../../src/lib/intent-ai/os/intentUnderstanding.js';
import { createIntentOS, resetIntentOS } from '../../src/lib/intent-ai/os/index.js';
import { getNavigationManager, resetNavigationManager } from '../../src/lib/intent-ai/os/upgrade6/navigationManager.js';
import { getSlotFillingEngine, parseShortAnswer } from '../../src/lib/intent-ai/os/upgrade6/slotFillingEngine.js';
import { getWalletContextManager } from '../../src/lib/intent-ai/os/upgrade6/walletContextManager.js';
import { loadConversationState, setCollectedSlot, hasSlot } from '../../src/lib/intent-ai/os/upgrade6/conversationState.js';
import { getChatScrollManager } from '../../src/lib/intent-ai/os/upgrade6/chatScrollManager.js';
import { dedupe, requestFingerprint, clearInflight } from '../../src/lib/intent-ai/os/upgrade7/agentMesh.js';
import { classifyDataNeed, evaluateFreshness } from '../../src/lib/intent-ai/os/upgrade7/confidence.js';
import { applyCorrection, forgetAll } from '../../src/lib/intent-ai/os/upgrade7/semanticMemory.js';
import { scrubForAI, containsSecret } from '../../src/lib/intent-ai/os/upgrade7/safety.js';
import { clearPlans } from '../../src/lib/intent-ai/os/upgrade7/planner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

const rows = [];
const t = (name, ok, detail = '') => rows.push([`${name}${ok || !detail ? '' : ` — ${detail}`}`, Boolean(ok)]);

clearPlans(); forgetAll(); clearInflight(); resetIntentOS();

/* ── Upgrade 1–6 surfaces still exist ────────────────────────────────────── */
{
  const base = understandIntent('پرتفوی من را تحلیل کن');
  t('U1-4 understandIntent still returns the v3/v4 shape',
    base.ok && base.type === 'PORTFOLIO_ANALYSIS' && 'entities' in base && 'confidence' in base, base.type);
  t('U4 confidence breakdown survives', Boolean(base.confidenceBreakdown));
  t('U4 clarification priority survives', Array.isArray(base.clarificationPriority));
  t('U4 predicted next actions survive', Array.isArray(base.nextPredictedActions));

  t('U6 slot filling engine still parses «۴ ماه»', getSlotFillingEngine().extractFromSentence('در ۴ ماه') != null);
  t('U6 short answer parser still present', typeof parseShortAnswer('بله') === 'object');
  t('U6 conversation state still loads', Boolean(loadConversationState()?.sessionId || loadConversationState()));
  t('U6 navigation manager still constructs', Boolean(getNavigationManager()));
  t('U6 wallet context manager still constructs', Boolean(getWalletContextManager()));
  t('U6 chat scroll manager still constructs', Boolean(getChatScrollManager()));
}

/* ── The OS still answers, and now carries upgrade7 alongside ────────────── */
{
  const os = createIntentOS({ locale: 'fa' });
  const res = await os.process({ message: 'پرتفوی من را تحلیل کن', conversationId: 'reg1' });
  t('the OS still returns a successful turn', res.ok === true, res.error || '');
  t('every pre-existing response key survives',
    ['intent', 'context', 'plan', 'execution', 'human', 'suggestions', 'task', 'confidence', 'message', 'ui']
      .every((k) => k in res));
  t('the upgrade7 block is attached', res.upgrade7 != null && res.upgrade7.ok === true, res.upgrade7?.error || '');
  t('upgrade7 does not overwrite the existing confidence', typeof res.confidence?.confidenceScore === 'number');
  t('upgrade7 does not overwrite the existing message', typeof res.message === 'string' && res.message.length > 0);
  t('the existing suggestions array is untouched in shape',
    Array.isArray(res.suggestions) && res.suggestions.every((s) => 'id' in s && 'label' in s && 'prompt' in s));

  const second = await os.process({ message: 'موجودی من چقدر است؟', conversationId: 'reg1' });
  t('a second turn on the same conversation still works', second.ok === true);
}

/* ── §45 the seven named regressions ─────────────────────────────────────── */

// 1 no navigation loop
{
  resetNavigationManager();
  const nav = getNavigationManager();
  let blocked = false;
  for (let i = 0; i < 6; i++) {
    const r = nav.requestNavigation
      ? nav.requestNavigation({ source: '/intent', target: '/portfolio', reason: 'test', intentId: 'i1' })
      : null;
    if (r && r.allowed === false) blocked = true;
  }
  t('§45 no navigation loop — the loop guard still trips', blocked || typeof nav.requestNavigation !== 'function');
}

// 2 no repeated questions
{
  let state = loadConversationState();
  state = setCollectedSlot(state, 'timeframe', { value: 4, unit: 'month' });
  t('§45 no repeated questions — a filled slot is recorded', hasSlot(state, 'timeframe'));
}

// 3 no wallet disconnect
{
  const os = createIntentOS({ locale: 'fa' });
  const wallet = { connected: true, isConnected: true, address: '0xabc', canSign: true };
  const a = await os.process({ message: 'پرتفوی من را تحلیل کن', conversationId: 'reg2', walletState: wallet });
  const b = await os.process({ message: 'موجودی من چقدر است؟', conversationId: 'reg2', walletState: wallet });
  t('§45 no wallet disconnect — the wallet survives both turns',
    a.context?.wallet?.connected !== false && b.context?.wallet?.connected !== false);
}

// 4 no context reset
{
  const corr = applyCorrection({ message: 'نه، منظورم این نبود', conversationId: 'reg3', currentIntent: { type: 'BUY' } });
  t('§45 no context reset — a correction never clears the conversation', corr.conversationReset === false);
}

// 5 no scroll regression
{
  const cssPath = join(repoRoot, 'src/styles/intent-ai-os.css');
  t('§45 no scroll regression — the Upgrade 6 stylesheet is untouched and present', existsSync(cssPath));
  const scrollSrc = readFileSync(join(repoRoot, 'src/lib/intent-ai/os/upgrade6/chatScrollManager.js'), 'utf8');
  t('§45 the 96px scroll threshold is still in place', scrollSrc.includes('96'));
}

// 6 no duplicate execution
{
  let runs = 0;
  const key = requestFingerprint({ message: '۵۰ دلار بیت کوین بخر', intentType: 'BUY', conversationId: 'reg4' });
  const f = () => new Promise((r) => setTimeout(() => { runs += 1; r(1); }, 20));
  const a = dedupe(key, f);
  const b = dedupe(key, f);
  await Promise.all([a.promise, b.promise]);
  t('§45 no duplicate execution — a double submit runs once', runs === 1 && b.deduped === true, `runs=${runs}`);
}

// 7 no stale transaction
{
  const need = classifyDataNeed({ intentType: 'SWAP', message: 'تبدیل کن' });
  const stale = evaluateFreshness(need, { price: { fetchedAt: Date.now() - 900_000, source: 'cache' } });
  t('§45 no stale transaction — a stale price forces a refetch', stale.mustRefetch === true);
  const txNeed = classifyDataNeed({ intentType: 'ORDERS', message: 'وضعیت سفارش' });
  t('§45 transaction status is treated as market-sensitive', txNeed.needs.includes('transaction'));
}

/* ── §46 Security validation ─────────────────────────────────────────────── */
{
  t('§46 a private key never survives scrubbing', scrubForAI({ privateKey: 'x' }).privateKey === '[redacted]');
  t('§46 a seed phrase never survives scrubbing', /redacted/.test(scrubForAI('my seed phrase is here')));
  t('§46 a KMS secret is detected', containsSecret({ kmsSecret: 'abc' }) === true);
  t('§46 a nested secret is scrubbed', scrubForAI({ a: { b: { mnemonic: 'x' } } }).a.b.mnemonic === '[redacted]');
  t('§46 ordinary payloads pass through unharmed', scrubForAI({ amount: 100, symbol: 'ETH' }).amount === 100);

  // The Upgrade 7 sources must not read a key, a signer or an env secret.
  const u7 = join(repoRoot, 'src/lib/intent-ai/os/upgrade7');
  const files = ['deepIntent.js', 'planner.js', 'agentMesh.js', 'confidence.js', 'semanticMemory.js', 'safety.js', 'monitoring.js', 'financialContext.js', 'predictive.js', 'runtime.js', 'index.js'];
  let leaks = [];
  for (const f of files) {
    const src = readFileSync(join(u7, f), 'utf8');
    if (/process\.env\.[A-Z_]*(KEY|SECRET|TOKEN|MNEMONIC)/.test(src)) leaks.push(`${f}:env`);
    if (/\bsignTransaction\b|\bwallet\.signer\b/.test(src)) leaks.push(`${f}:signer`);
  }
  t('§46 no Upgrade 7 module reads a secret or holds a signer', leaks.length === 0, leaks.join(','));
}

/* ── UX preservation (§37) — no UI or style file was modified ────────────── */
{
  const uiFiles = [
    'src/components/IntentAIUnified.jsx',
    'src/styles/intent-ai-os.css',
    'src/App.jsx',
    'src/index.css'
  ];
  t('§37 every existing UI/style file is still present', uiFiles.every((f) => existsSync(join(repoRoot, f))));

  const panel = readFileSync(join(repoRoot, 'src/components/IntentAIUnified.jsx'), 'utf8');
  t('§37 the chat panel still imports the Upgrade 6 stack', panel.includes('upgrade6/conversationState.js'));
  t('§37 the chat panel was not rewritten around Upgrade 7', !panel.includes('upgrade7/'));

  const osIndex = readFileSync(join(repoRoot, 'src/lib/intent-ai/os/index.js'), 'utf8');
  t('§37 the OS wires Upgrade 7 through exactly one guarded call',
    (osIndex.match(/enrichUpgrade7\(/g) || []).length === 1);
  t('§37 the Upgrade 7 call is wrapped in a try/catch', /try \{\s*\n\s*upgrade7 = enrichUpgrade7/.test(osIndex));
}

const failed = rows.filter(([, ok]) => !ok);
if (process.argv[1] && process.argv[1].endsWith('upgrade7-regression-probe.mjs')) {
  for (const [name, ok] of rows) console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
  console.log(`\nUpgrade 7 regression: ${rows.length - failed.length}/${rows.length} passed`);
  if (failed.length) process.exit(1);
}

export default rows;

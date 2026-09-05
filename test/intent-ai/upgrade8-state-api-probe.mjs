#!/usr/bin/env node
/**
 * FBT Intent OS Upgrade 8 — state persistence and route wiring probe
 *
 * The sandbox this repository ships in does not always have installed runtime
 * packages, so this probe validates the server-side Upgrade 8 contract through
 * source wiring plus the shared persistence primitives the router uses.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { storeGet, storeSet } from '../../server/store.js';
import { createIntentOSState, createQuestionRecord } from '../../src/lib/intent-ai/os/upgrade8/contracts.js';
import { bindAnswerToState } from '../../src/lib/intent-ai/os/upgrade8/questionEngine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

const rows = [];
const t = (name, ok, detail = '') => rows.push([`${name}${ok || !detail ? '' : ` — ${detail}`}`, Boolean(ok)]);

const appSrc = readFileSync(join(repoRoot, 'server/app.js'), 'utf8');
const routerSrc = readFileSync(join(repoRoot, 'server/intentOsUpgrade8.js'), 'utf8');

t('server/app.js mounts the Upgrade 8 router under /api/v1/ai/os',
  appSrc.includes("app.use('/api/v1/ai/os', intentOsUpgrade8Routes)"));
t('server/intentOsUpgrade8.js exposes GET /state', routerSrc.includes("router.get('/state'"));
t('server/intentOsUpgrade8.js exposes POST /state', routerSrc.includes("router.post('/state'"));
t('server/intentOsUpgrade8.js exposes POST /questions/:id/answers', routerSrc.includes("router.post('/questions/:id/answers'"));
t('server/intentOsUpgrade8.js strips secrets before persistence', routerSrc.includes('stripSecrets') && routerSrc.includes('SECRET_RE'));

const key = `probe:upgrade8:${Date.now()}`;
const base = createIntentOSState({
  collectedSlots: { timeframe: 4 },
  currentRoute: '/intent',
  walletContext: { address: '0xabc', connected: true, chainId: 42161 },
  questions: [
    createQuestionRecord({
      questionId: 'q-risk',
      slot: 'riskProfile',
      prompt: 'ریسک‌پذیری؟',
      expectedType: 'riskProfile'
    })
  ],
  pendingQuestion: 'q-risk'
});

await storeSet(key, { state: base, createdAt: Date.now(), updatedAt: Date.now() });
const loaded = await storeGet(key, null);
t('store.js can persist an Upgrade 8 row shape', loaded?.state?.schema === 'fbt.intent-os.state.v8');

afterBind: {
  const bound = bindAnswerToState({ state: loaded.state, text: 'ریسک متوسط', question: loaded.state.questions[0] });
  t('questionEngine binds a short Persian risk answer to medium', bound.bound?.value === 'medium', JSON.stringify(bound.bound));
  t('binding clears the pending question', bound.state?.pendingQuestion == null, String(bound.state?.pendingQuestion));
  t('binding moves the slot into collectedSlots', bound.state?.collectedSlots?.riskProfile === 'medium');
}

const failed = rows.filter(([, ok]) => !ok);
for (const [name, ok] of rows) console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
console.log(`\nUpgrade 8 state/persistence probe: ${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) process.exit(1);

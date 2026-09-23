/**
 * FBT AI STRENGTHENING — probe.
 *
 * Covers the patterns adopted from the external-repo review (original code,
 * no dependency on those repos):
 *
 *   1. content-bound plan digest (Gordon)           src/lib/intent-ai/planDigest.js
 *   2. signed approvals                             server/aiApproval.js
 *   3. immutable constitution (Gordon)              src/lib/intent-ai/constitution.js
 *   4. Bull / Bear / Judge debate (TradingAgents)   server/aiConsensus.js
 *   5. decision log + reflection (Zetryn)           server/aiLearning.js
 *   6. point-in-time integrity (TradingAgents)      src/lib/intent-ai/pointInTime.js
 *   7. BM25 retrieval (LlamaIndex idea, zero-dep)   src/lib/intent-ai/retrieval.js
 *   8. tool-call loop detector (Gordon)             server/central/toolRouter.js
 *   9. the HTTP surface + client wiring
 *
 * Nothing here signs, sends or reaches a real model.
 */
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
process.env.AI_RATE_LIMIT = '100000';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { planDigest, sha256Hex, verifyPlanBinding } from '../../src/lib/intent-ai/planDigest.js';
import { issueApproval, verifyApproval } from '../../server/aiApproval.js';
import { checkConstitution, explainConstitution, CONSTITUTION } from '../../src/lib/intent-ai/constitution.js';
import { runAdversarialDebate, ADVERSARIAL_DEBATE_SCHEMA } from '../../server/aiConsensus.js';
import {
  recordDecision, resolveDecisions, buildReflection, decisionStats, _resetDecisionMemory
} from '../../server/aiLearning.js';
import { pointInTimeView, assertPointInTime, toMs } from '../../src/lib/intent-ai/pointInTime.js';
import { retrieve, groundingBlock, retrievalStats, tokenize } from '../../src/lib/intent-ai/retrieval.js';
import { runHonestBacktest } from '../../src/lib/intent-ai/honestBacktest.js';
import { noteToolCall, runTool, _resetToolLoopGuard, LOOP_LIMITS } from '../../server/central/toolRouter.js';
import { faqCorpus } from '../../src/lib/faqLocal.js';

const rows = [];
const t = (name, ok, err) => rows.push([name, Boolean(ok), err]);
const safely = async (name, fn) => {
  try { await fn(); } catch (err) { t(`${name} ran without throwing`, false, String(err?.stack || err)); }
};

const SWAP = { type: 'SWAP', from: 'USDC', to: 'ETH', amount: 100, chainId: 8453, slippagePct: 0.5, label: 'Swap 100 USDC' };

/* ─── 1. plan digest ──────────────────────────────────────────────────── */
await safely('plan digest', () => {
  for (const s of ['', 'abc', 'فارسی ✓', 'x'.repeat(1000)]) {
    t(`sha256Hex matches node:crypto (${s.length} chars)`, sha256Hex(s) === createHash('sha256').update(s, 'utf8').digest('hex'));
  }
  const d = planDigest([SWAP]);
  t('digest is 64 hex chars', /^[0-9a-f]{64}$/.test(d));
  t('key order does not change the digest', d === planDigest([{ chainId: 8453, amount: 100, to: 'ETH', from: 'USDC', slippagePct: 0.5, type: 'SWAP' }]));
  t('cosmetic fields do not change the digest', d === planDigest([{ ...SWAP, label: 'another label', id: 'x1', ui: { color: 'red' } }]));
  t('a changed amount changes the digest', d !== planDigest([{ ...SWAP, amount: 1000 }]));
  t('a changed token changes the digest', d !== planDigest([{ ...SWAP, to: 'WBTC' }]));
  t('a changed chain changes the digest', d !== planDigest([{ ...SWAP, chainId: 1 }]));
  t('a changed slippage changes the digest', d !== planDigest([{ ...SWAP, slippagePct: 3 }]));
  t('a changed recipient changes the digest', d !== planDigest([{ ...SWAP, recipient: '0x1111111111111111111111111111111111111111' }]));
  t('an added leg changes the digest', d !== planDigest([SWAP, { ...SWAP, amount: 1 }]));
  t('leg order matters', planDigest([SWAP, { ...SWAP, amount: 1 }]) !== planDigest([{ ...SWAP, amount: 1 }, SWAP]));
  t('binding: no approval is permissive (older servers)', verifyPlanBinding(null, [SWAP]).ok === true);
  const approval = issueApproval({ owner: 'o1', actions: [SWAP], intentId: 'int1' });
  t('binding: identical legs match', verifyPlanBinding(approval, [SWAP]).code === 'APPROVAL_MATCH');
  t('binding: a tampered leg is refused', verifyPlanBinding(approval, [{ ...SWAP, amount: 101 }]).code === 'APPROVAL_MISMATCH');
  t('binding: an expired approval is refused', verifyPlanBinding(approval, [SWAP], { now: approval.expiresAt + 1 }).code === 'APPROVAL_EXPIRED');
});

/* ─── 2. signed approvals ─────────────────────────────────────────────── */
await safely('approvals', () => {
  const a = issueApproval({ owner: 'owner-a', actions: [SWAP], intentId: 'int1' });
  t('approval never authorises execution by itself', a.authorizesExecution === false);
  t('approval TTL is between 1 and 30 minutes', a.expiresAt - a.issuedAt >= 60_000 && a.expiresAt - a.issuedAt <= 30 * 60_000);
  t('verify: match', verifyApproval({ owner: 'owner-a', approval: a, actions: [SWAP] }).code === 'APPROVAL_MATCH');
  t('verify: missing', verifyApproval({ owner: 'owner-a', approval: null, actions: [SWAP] }).code === 'APPROVAL_MISSING');
  t('verify: another owner cannot reuse it', verifyApproval({ owner: 'owner-b', approval: a, actions: [SWAP] }).code === 'APPROVAL_FORGED');
  t('verify: a re-dated approval is forged', verifyApproval({ owner: 'owner-a', approval: { ...a, expiresAt: a.expiresAt + 3600_000 }, actions: [SWAP] }).code === 'APPROVAL_FORGED');
  t('verify: a swapped digest is forged', verifyApproval({ owner: 'owner-a', approval: { ...a, digest: planDigest([{ ...SWAP, amount: 9999 }]) }, actions: [{ ...SWAP, amount: 9999 }] }).code === 'APPROVAL_FORGED');
  t('verify: changed legs mismatch', verifyApproval({ owner: 'owner-a', approval: a, actions: [{ ...SWAP, amount: 5 }] }).code === 'APPROVAL_MISMATCH');
  t('verify: expired', verifyApproval({ owner: 'owner-a', approval: a, actions: [SWAP], now: a.expiresAt + 1 }).code === 'APPROVAL_EXPIRED');
  t('no legs → no approval', issueApproval({ owner: 'x', actions: [] }) === null);
});

/* ─── 3. constitution ─────────────────────────────────────────────────── */
await safely('constitution', () => {
  t('constitution is frozen', Object.isFrozen(CONSTITUTION));
  try { CONSTITUTION.maxLeverage = 100; } catch { /* strict mode */ }
  t('a ceiling cannot be raised at runtime', CONSTITUTION.maxLeverage === 5);
  const art = (r) => r.violations.map((v) => v.article);
  t('a normal swap passes', checkConstitution({ actions: [SWAP] }).ok === true);
  t('leverage 10x is refused', art(checkConstitution({ actions: [{ type: 'PERP', leverage: 10, chainId: 42161 }] })).includes('LEVERAGE_CEILING'));
  t('leverage in parameters is seen too', art(checkConstitution({ actions: [{ type: 'PERP', parameters: { leverage: 20 } }] })).includes('LEVERAGE_CEILING'));
  t('slippage 5% is refused', art(checkConstitution({ actions: [{ ...SWAP, slippagePct: 5 }] })).includes('SLIPPAGE_CEILING'));
  t('slippage as bps (500) is refused', art(checkConstitution({ actions: [{ ...SWAP, slippagePct: undefined, slippageBps: 500 }] })).includes('SLIPPAGE_CEILING'));
  t('slippage as fraction (0.005) passes', checkConstitution({ actions: [{ ...SWAP, slippagePct: undefined, slippage: 0.005 }] }).ok);
  t('$1M leg is refused', art(checkConstitution({ actions: [{ ...SWAP, amountUsd: 1_000_000 }] })).includes('TRANSACTION_CEILING'));
  t('13 legs are refused', art(checkConstitution({ actions: Array.from({ length: 13 }, () => SWAP) })).includes('TOO_MANY_LEGS'));
  t('a zero amount is refused', art(checkConstitution({ actions: [{ ...SWAP, amount: 0 }] })).includes('NON_POSITIVE_AMOUNT'));
  t('a self-swap is refused', art(checkConstitution({ actions: [{ ...SWAP, to: 'usdc' }] })).includes('SELF_SWAP'));
  t('a cross-chain same-token bridge is NOT a self-swap', checkConstitution({ actions: [{ ...SWAP, to: 'USDC', toChainId: 1 }] }).ok);
  const balances = [{ symbol: 'USDC', chainId: 8453, amount: 50 }];
  t('overspend vs real balance is refused', art(checkConstitution({ actions: [SWAP], balances })).includes('OVERSPEND'));
  t('«all» with display rounding is allowed', checkConstitution({ actions: [{ ...SWAP, amount: 50.04 }], balances }).ok);
  t('an unknown balance never blocks', checkConstitution({ actions: [{ ...SWAP, from: 'DAI' }], balances }).ok);
  const unchained = { ...SWAP, chainId: undefined };
  t('an unchained leg is refused on the client', art(checkConstitution({ actions: [unchained] })).includes('CHAIN_REQUIRED'));
  t('…unless the wallet chain is the default', checkConstitution({ actions: [unchained], defaultChainId: 8453 }).ok);
  t('…or the leg names a non-EVM chain', checkConstitution({ actions: [{ ...unchained, chain: 'solana' }] }).ok);
  t('the server skips CHAIN_REQUIRED (it cannot know the wallet chain)', checkConstitution({ actions: [unchained], enforceChain: false }).ok);
  const fa = explainConstitution(checkConstitution({ actions: [{ ...SWAP, slippagePct: 9 }] }), 'fa');
  t('the Persian explanation is human, with no internal code', /[آ-ی]/.test(fa) && !/SLIPPAGE_CEILING/.test(fa));
  const en = explainConstitution(checkConstitution({ actions: [{ ...SWAP, slippagePct: 9 }] }), 'en');
  t('the English explanation is human', /slippage/i.test(en) && !/SLIPPAGE_CEILING/.test(en));
});

/* ─── 4. adversarial debate ───────────────────────────────────────────── */
const SEATS = { bull: { provider: 'p1', model: null }, bear: { provider: 'p2', model: null }, judge: { provider: 'p3', model: null } };
function fakeExecute(script) {
  const calls = [];
  const exec = async (provider, req) => {
    calls.push({ provider, req });
    const role = /JUDGE/.test(req.system) ? 'judge' : /BULL/.test(req.system) ? 'bull' : 'bear';
    const out = script[role];
    if (out instanceof Error) throw out;
    return { text: typeof out === 'function' ? out(req, calls) : JSON.stringify(out), model: `${provider}-m` };
  };
  exec.calls = calls;
  return exec;
}
const BULL = { thesis: 'ETF inflows are strong', arguments: ['a1', 'a2'], rebuttal: '', conviction: 80 };
const BEAR = { thesis: 'Funding is overheated', arguments: ['b1', 'b2'], rebuttal: '', conviction: 40 };
const JUDGE = { verdict: 'bull', stance: 'proceed', confidence: 99, riskLevel: 'medium', decisiveArgument: 'inflows', mainRisk: 'funding', summary: 's' };

await safely('debate', async () => {
  const exec = fakeExecute({ bull: BULL, bear: BEAR, judge: JUDGE });
  const d = await runAdversarialDebate({ message: 'should I buy BTC', locale: 'en', rounds: 2, deps: { execute: exec, seats: SEATS } });
  t('debate schema', d.schema === ADVERSARIAL_DEBATE_SCHEMA);
  t('debate ran 2 rounds', d.rounds === 2 && d.transcript.length === 2);
  t('5 model calls (2×bull, 2×bear, judge)', exec.calls.length === 5);
  t('the bear answers the bull (rebuttal context)', exec.calls[1].req.user.includes('OPPOSING ARGUMENT') && exec.calls[1].req.user.includes(BULL.thesis));
  t('round-2 bull rebuts the bear', exec.calls[2].req.user.includes(BEAR.thesis));
  t('the judge reads the transcript', exec.calls[4].req.user.includes('DEBATE TRANSCRIPT'));
  t('distinct providers per seat', new Set(exec.calls.map((c) => c.provider)).size === 3);
  t('verdict comes from the judge', d.verdict === 'bull' && d.degraded === false);
  t('confidence is capped at 85', d.confidence <= 85);
  t('a debate never authorises execution', d.executionAuthorized === false);

  const close = await runAdversarialDebate({ message: 'x', locale: 'en', rounds: 1,
    deps: { execute: fakeExecute({ bull: { ...BULL, conviction: 60 }, bear: { ...BEAR, conviction: 55 }, judge: JUDGE }), seats: SEATS } });
  t('a close debate caps confidence at 60', close.confidence <= 60);

  const reflected = await runAdversarialDebate({ message: 'x', locale: 'en', rounds: 1,
    reflection: { lines: ['2026-09-01 BTC: said bull, price moved -8% → LOSS'], lossCount: 3 },
    deps: { execute: fakeExecute({ bull: BULL, bear: BEAR, judge: { ...JUDGE, confidence: 80 } }), seats: SEATS } });
  t('past losses lower a bull verdict (80 → 65)', reflected.confidence === 65);
  t('reflection is flagged as used', reflected.reflectionUsed === true);

  const refExec = fakeExecute({ bull: BULL, bear: BEAR, judge: JUDGE });
  await runAdversarialDebate({ message: 'x', rounds: 1, reflection: { lines: ['LOSS-LINE-XYZ'], lossCount: 1 }, deps: { execute: refExec, seats: SEATS } });
  t('both sides see the past losses', refExec.calls[0].req.user.includes('LOSS-LINE-XYZ') && refExec.calls[1].req.user.includes('LOSS-LINE-XYZ'));

  const extreme = await runAdversarialDebate({ message: 'x', rounds: 1, deps: { execute: fakeExecute({ bull: BULL, bear: BEAR, judge: { ...JUDGE, riskLevel: 'extreme' } }), seats: SEATS } });
  t('EXTREME risk turns "proceed" into "reduce"', extreme.stance === 'reduce');

  const none = await runAdversarialDebate({ message: 'x', deps: { execute: fakeExecute({}), seats: null } });
  t('no provider → honest degraded "wait"', none.degraded === true && none.reason === 'NO_EXTERNAL_PROVIDER' && none.stance === 'wait');

  const oneSided = await runAdversarialDebate({ message: 'x', rounds: 2, deps: { execute: fakeExecute({ bull: BULL, bear: new Error('down'), judge: JUDGE }), seats: SEATS } });
  t('one side down → no verdict (ONE_SIDED)', oneSided.degraded && oneSided.reason === 'ONE_SIDED' && oneSided.verdict === 'balanced');

  const noJudge = await runAdversarialDebate({ message: 'x', rounds: 1, deps: { execute: fakeExecute({ bull: BULL, bear: BEAR, judge: new Error('down') }), seats: SEATS } });
  t('judge down → conviction fallback, flagged degraded', noJudge.degraded && noJudge.reason === 'JUDGE_UNAVAILABLE' && noJudge.confidence <= 55);
  t('judge-down bull verdict never says "proceed"', noJudge.stance !== 'proceed');

  const garbage = await runAdversarialDebate({ message: 'x', rounds: 1, deps: { execute: fakeExecute({ bull: () => 'not json', bear: BEAR, judge: JUDGE }), seats: SEATS } });
  t('an unparseable side counts as no answer', garbage.degraded === true);

  const pit = await runAdversarialDebate({ message: 'x', rounds: 1, context: { pointInTime: { historical: true, asOf: '2025-01-01T00:00:00.000Z' } },
    deps: { execute: refExec, seats: SEATS } });
  t('a historical debate tells the models the analysis date', refExec.calls.at(-1).req.user.includes('ANALYSIS DATE') && pit.ok);
});

/* ─── 5. decision log + reflection ────────────────────────────────────── */
await safely('decision log', async () => {
  _resetDecisionMemory();
  const owner = `probe-${Date.now()}`;
  const t0 = Date.UTC(2026, 8, 1);
  await recordDecision({ owner, asset: 'btc', verdict: 'bull', confidence: 70, thesis: 'ETF inflows', priceAtDecision: 100, horizonMs: 3600_000, now: t0 });
  await recordDecision({ owner, asset: 'BTC', verdict: 'bear', confidence: 60, thesis: 'overheated', priceAtDecision: 100, horizonMs: 3600_000, now: t0 + 1 });
  await recordDecision({ owner, asset: 'BTC', verdict: 'balanced', thesis: 'n/a', priceAtDecision: 100, horizonMs: 3600_000, now: t0 + 2 });
  await recordDecision({ owner, asset: 'BTC', verdict: 'bull', thesis: 'no price', priceAtDecision: null, horizonMs: 3600_000, now: t0 + 3 });
  const secret = await recordDecision({ owner, asset: 'ETH', verdict: 'bull', thesis: 'my seed phrase is abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', priceAtDecision: 10, now: t0 });
  t('a thesis carrying a secret is redacted', secret.decision.thesis === '[REDACTED_SECRET]');
  const early = await resolveDecisions({ owner, priceOf: async () => 90, now: t0 + 60_000 });
  t('nothing resolves before its horizon', early.resolved === 0);
  const r = await resolveDecisions({ owner, priceOf: async (s) => (s === 'BTC' ? 90 : null), now: t0 + 2 * 3600_000 });
  t('due decisions resolve (bull, bear, balanced; not the priceless one)', r.resolved === 3);
  const ref = await buildReflection({ owner, asset: 'BTC', now: t0 + 3 * 3600_000 });
  t('bull at 100 → 90 is a LOSS', ref.lossCount === 1);
  t('bear at 100 → 90 is a WIN', ref.winCount === 1);
  t('balanced is never scored', ref.sample === 2);
  t('losses are listed first', /LOSS/.test(ref.lines[0]));
  t('reflection is point-in-time (nothing resolved before t0)', (await buildReflection({ owner, asset: 'BTC', now: t0 })).sample === 0);
  const stats = await decisionStats({ owner });
  t('stats: hit rate 50%', stats.hitRate === 50 && stats.total === 5);
  t('stats: the priceless decision stays open', stats.open >= 1);
  t('owners are isolated', (await decisionStats({ owner: `${owner}-other` })).total === 0);
  const flat = `${owner}-flat`;
  await recordDecision({ owner: flat, asset: 'SOL', verdict: 'bull', priceAtDecision: 100, horizonMs: 3600_000, now: t0 });
  await resolveDecisions({ owner: flat, priceOf: async () => 100.2, now: t0 + 2 * 3600_000 });
  t('a 0.2% move is flat, not a win', (await decisionStats({ owner: flat })).recent[0].outcome.result === 'flat');
});

/* ─── 6. point-in-time ────────────────────────────────────────────────── */
await safely('point in time', () => {
  const asOf = '2025-06-01T00:00:00Z';
  const cutoff = Date.parse(asOf);
  const ctx = {
    market: { priceMap: { BTC: 100000 }, change24h: 3, series: [[cutoff - 86400_000, 60000], [cutoff, 61000], [cutoff + 86400_000, 70000]] },
    news: [{ title: 'old', publishedAt: '2025-05-30T00:00:00Z' }, { title: 'future', publishedAt: '2025-06-10T00:00:00Z' }]
  };
  const leaks = assertPointInTime(ctx, asOf);
  t('the leak detector finds the future bar and the future headline', leaks.length >= 2);
  const view = pointInTimeView(ctx, asOf);
  t('the view is historical', view.historical === true && view.asOf === new Date(cutoff).toISOString());
  t('future rows are dropped', view.context.market.series.length === 2 && view.context.news.length === 1 && view.context.news[0].title === 'old');
  t('live scalars are removed', view.context.market.change24h === undefined);
  t('the cleaned view has no leaks', assertPointInTime(view.context, asOf).length === 0);
  t('the input is not mutated', ctx.market.series.length === 3 && ctx.news.length === 2);
  t('no asOf → live, untouched', pointInTimeView(ctx).historical === false && pointInTimeView(ctx).context === ctx);
  t('toMs handles seconds, ms and ISO', toMs(1_700_000_000) === 1_700_000_000_000 && toMs(1_700_000_000_000) === 1_700_000_000_000 && toMs(asOf) === cutoff);

  const series = Array.from({ length: 30 }, (_, i) => [cutoff + (i - 20) * 86400_000, 100 + i]);
  const bt = runHonestBacktest({ series, source: 'probe', asOf });
  t('backtest drops bars after asOf', bt.ok && bt.pointInTime.historical && bt.pointInTime.droppedAfterAsOf === 9 && bt.window.points === 21);
  t('backtest window ends at asOf', bt.window.toAt <= cutoff);
  const live = runHonestBacktest({ series, source: 'probe' });
  t('backtest without asOf is unchanged', live.ok && live.window.points === 30 && live.pointInTime.historical === false);
});

/* ─── 7. retrieval ────────────────────────────────────────────────────── */
await safely('retrieval', () => {
  const stats = retrievalStats();
  t('index covers knowledge + FAQ', stats.documents >= 40 && faqCorpus().length >= 30);
  const top = (q, locale) => retrieve(q, { locale })[0]?.id || null;
  t('fa: slippage → faq.slippage', top('اسلیپیج چیه؟', 'fa') === 'faq.slippage');
  t('fa: bridge how-to → kb.bridge.howto', top('بریج چطوری کار میکنه', 'fa') === 'kb.bridge.howto');
  t('fa: seed request → seed / never-asks', ['faq.seed', 'kb.wallet.never-asks'].includes(top('عبارت بازیابی کیف پولم رو کسی خواست', 'fa')));
  t('fa: failed swap → faq.failed', top('چرا سواپم ناموفق شد', 'fa') === 'faq.failed');
  t('fa: wallet will not connect → connect', ['faq.connect', 'faq.wcReconnect'].includes(top('کیف پولم وصل نمیشه', 'fa')));
  t('en: why did my swap fail → faq.failed', top('why did my swap fail', 'en') === 'faq.failed');
  t('en: fee → a fee answer', /fee|bridge|gas/.test(top('how much is the fee', 'en') || ''));
  t('en: is my money safe → custody', top('is my money safe', 'en') === 'faq.custody');
  t('off-topic (weather) retrieves nothing', retrieve('هوا امروز چطوره', { locale: 'fa' }).length === 0);
  t('off-topic (politics) retrieves nothing', retrieve('who is the president of france', { locale: 'en' }).length === 0);
  t('off-topic (football) retrieves nothing', retrieve('فوتبال دیشب کی برد', { locale: 'fa' }).length === 0);
  t('empty query retrieves nothing', retrieve('', { locale: 'fa' }).length === 0);
  const hits = retrieve('اسلیپیج چیه؟', { locale: 'fa' });
  t('results carry citable ids + scores', hits.every((h) => h.id && h.title && h.body && Number.isFinite(h.score)));
  t('Persian results are in Persian', /[آ-ی]/.test(hits[0].body));
  const block = groundingBlock(hits);
  t('grounding block cites ids', block.includes('[faq.slippage]'));
  t('tokenize drops stopwords and normalises ي/ك', !tokenize('این چیه').length && tokenize('كيف').join() === tokenize('کیف').join());
});

/* ─── 8. loop detector ────────────────────────────────────────────────── */
await safely('loop detector', async () => {
  _resetToolLoopGuard();
  const trace = [];
  const call = { module: 'swap', operation: 'quote', input: { from: 'USDC', to: 'ETH', amount: 1 }, trace };
  t('call #1 passes', noteToolCall(call) === null);
  t('call #2 passes', noteToolCall(call) === null);
  t(`call #${LOOP_LIMITS.perTurn} of the identical call is a loop`, noteToolCall(call)?.scope === 'turn');
  t('a different input is not a loop', noteToolCall({ ...call, input: { from: 'USDC', to: 'ETH', amount: 2 } }) === null);
  t('input key order does not dodge the detector', noteToolCall({ ...call, input: { amount: 1, to: 'ETH', from: 'USDC' } })?.scope === 'turn');
  t('a new turn starts clean', noteToolCall({ ...call, trace: [] }) === null);
  const own = { module: 'swap', operation: 'execute', input: { a: 1 }, owner: 'o-loop' };
  const now = Date.now();
  noteToolCall({ ...own, now }); noteToolCall({ ...own, now: now + 1000 });
  t('3rd identical execute within 30 s (across turns) is a loop', noteToolCall({ ...own, now: now + 2000 })?.scope === 'owner');
  t('after the window it is allowed again', noteToolCall({ ...own, now: now + 120_000 }) === null);
  t('reads are never owner-limited', [1, 2, 3, 4].every(() => noteToolCall({ module: 'm', operation: 'read', input: {}, owner: 'o' }) === null));
  _resetToolLoopGuard();
  const tr = [];
  let last;
  for (let i = 0; i < 3; i += 1) last = await runTool({ module: 'no-such-module-probe', operation: 'read', input: { q: 1 }, trace: tr });
  t('runTool refuses the looping call with LOOP_DETECTED', last.status === 'LOOP_DETECTED' && last.ok === false);
});

/* ─── 9. HTTP surface + wiring ────────────────────────────────────────── */
await safely('http', async () => {
  const { default: app } = await import('../../server/app.js');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const DEVICE = 'fbtstrengthprobe0001';
  /* Inside test/run.mjs server/app.js is already loaded, so its AI budget
     (AI_RATE_LIMIT, read at import) is the production 10/window and earlier
     probes have spent it from 127.0.0.1. `trust proxy` is on: give every
     request its own documentation-range address so this probe measures the
     routes, not the limiter (which has its own probe). */
  let ipSeq = 0;
  const call = async (method, path, body) => {
    ipSeq += 1;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-fbt-device': DEVICE, 'x-forwarded-for': `198.51.100.${ipSeq % 250 + 1}` },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const walletContext = {
    wallet: { connected: true, canSign: true, evmAddresses: ['0xABC0000000000000000000000000000000000123'], solanaAddresses: [] },
    balances: [{ symbol: 'USDC', chainId: 8453, amount: 820, valueUsd: 820 }, { symbol: 'ETH', chainId: 8453, amount: 0.02, valueUsd: 60 }],
    portfolio: { dataStatus: 'live', totalValueUsd: 880, holdings: [] }
  };
  try {
    const c = await call('GET', '/api/v1/ai/constitution');
    t('GET /constitution lists the ceilings', c.status === 200 && c.json.constitution?.maxLeverage === 5);

    const chk = await call('POST', '/api/v1/ai/constitution/check', { actions: [{ ...SWAP, slippagePct: 9 }], locale: 'fa' });
    t('POST /constitution/check refuses 9% slippage in Persian', chk.json.ok === false && /[آ-ی]/.test(chk.json.message));

    const chat = await call('POST', '/api/v1/ai/chat', { message: '100 USDC دارم، ETH می‌خواهم', locale: 'fa', context: walletContext });
    const reply = chat.json?.reply || {};
    const confirm = await call('POST', '/api/v1/ai/confirm', { intentId: reply.intentId, intentType: reply.intent?.type, locale: 'fa', context: walletContext });
    const cj = confirm.json || {};
    t('confirm still returns PLAN_READY', cj.status === 'PLAN_READY');
    t('confirm carries a content-bound approval', Boolean(cj.approval?.digest && cj.approval?.mac));
    t('the approval binds the exact legs returned', verifyPlanBinding(cj.approval, cj.actions).code === 'APPROVAL_MATCH');
    const v = await call('POST', '/api/v1/ai/approval/verify', { approval: cj.approval, actions: cj.actions });
    t('server verifies its own approval', v.status === 200 && v.json.code === 'APPROVAL_MATCH' && v.json.authorizesExecution === false);
    const tampered = (cj.actions || []).map((a) => ({ ...a, amount: String(Number(a.amount || 1) * 10) }));
    const vt = await call('POST', '/api/v1/ai/approval/verify', { approval: cj.approval, actions: tampered });
    t('server refuses a tampered leg (409)', vt.status === 409 && vt.json.code === 'APPROVAL_MISMATCH');

    const exec = await call('POST', '/api/v1/ai/execute', { message: 'نصف USDC من را به ETH تبدیل کن', intentType: 'SWAP', locale: 'fa', context: walletContext });
    t('execute still resolves (200)', exec.status === 200 && exec.json?.ok === true);
    const execLegs = exec.json?.actionPlan?.actions?.length ? exec.json.actionPlan.actions : exec.json?.actions;
    t('execute carries an approval over the legs the client will walk', verifyPlanBinding(exec.json?.approval, execLegs).code === 'APPROVAL_MATCH');

    const bad = await call('POST', '/api/v1/ai/execute', {
      intentType: 'SWAP', locale: 'fa', context: walletContext,
      actions: [{ type: 'SWAP', from: 'USDC', to: 'ETH', amount: 100, chainId: 8453, slippagePct: 25 }]
    });
    t('execute refuses 25% slippage with 409 CONSTITUTION_VIOLATION', bad.status === 409 && bad.json?.execution?.error?.code === 'CONSTITUTION_VIOLATION');
    t('the refusal is explained in Persian, no internal code', /[آ-ی]/.test(bad.json?.message || '') && !/SLIPPAGE_CEILING/.test(bad.json?.message || ''));
    const over = await call('POST', '/api/v1/ai/execute', {
      intentType: 'SWAP', locale: 'fa', context: walletContext,
      actions: [{ type: 'SWAP', from: 'USDC', to: 'ETH', amount: 5000, chainId: 8453 }]
    });
    t('execute refuses spending more USDC than held (OVERSPEND)', over.status === 409 && over.json?.constitution?.violations?.some((x) => x.article === 'OVERSPEND'));

    const r = await call('POST', '/api/v1/ai/retrieve', { query: 'اسلیپیج چیه؟', locale: 'fa' });
    t('POST /retrieve returns passages', r.status === 200 && r.json.results?.[0]?.id === 'faq.slippage');
    const p = await call('POST', '/api/v1/ai/point-in-time', { asOf: '2025-06-01', context: { news: [{ title: 'f', publishedAt: '2025-07-01' }] } });
    t('POST /point-in-time strips the future', p.status === 200 && p.json.context.news.length === 0);
    const d = await call('POST', '/api/v1/ai/debate', { message: 'should I buy BTC?', asset: 'BTC', locale: 'en', rounds: 1 });
    t('POST /debate answers with the adversarial schema', d.status === 200 && d.json.schema === ADVERSARIAL_DEBATE_SCHEMA && d.json.executionAuthorized === false);
    const ds = await call('GET', '/api/v1/ai/decisions');
    t('GET /decisions answers', ds.status === 200 && ds.json.ok === true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

await safely('wiring', () => {
  const ui = readFileSync(new URL('../../src/components/IntentAIUnified.jsx', import.meta.url), 'utf8');
  t('client verifies the plan binding before signing', /verifyPlanBinding\(prepared\?\.approval, plannedActions\)/.test(ui));
  t('client re-checks the constitution with the wallet chain', /checkConstitution\(\{ actions: plannedActions[^)]*defaultChainId/.test(ui));
  t('the binding check sits before runExecutionPlan', ui.indexOf('verifyPlanBinding(prepared') < ui.indexOf('        result = await runExecutionPlan({'));
  const collab = readFileSync(new URL('../../server/aiCollaboration.js', import.meta.url), 'utf8');
  t('collaboration grounds on BM25 retrieval', /retrieveBm25\(message/.test(collab));
});

const standalone = process.argv[1] && process.argv[1].endsWith(import.meta.url.split('/').pop());
let failed = 0;
for (const [name, ok, err] of rows) {
  if (!ok) failed += 1;
  if (standalone) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${err ? `\n        ${err}` : ''}`);
}
if (standalone) {
  console.log(`\nai strengthening: ${rows.length - failed}/${rows.length} passed`);
  process.exit(failed ? 1 : 0);
}

export default rows.map(([name, ok]) => [name, ok]);

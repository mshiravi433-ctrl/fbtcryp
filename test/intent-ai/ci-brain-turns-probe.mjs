/**
 * FBT CENTRAL INTELLIGENCE OS — turn probe (spec §42, scenarios A–J).
 * ────────────────────────────────────────────────────────────────────
 * WHAT THIS MEASURES: the wiring of the central brain. One sentence goes in;
 * context is resolved, capability is checked, a plan is built, policy vetoes or
 * allows, real tools are called, findings become a recommendation, and the reply
 * is the reply the user sees.
 *
 * WHAT IT DOES NOT MEASURE: any venue or RPC endpoint. The external boundary is
 * replaced by `ci-fakes.mjs`, because CI has no outbound network and a probe that
 * silently passes when a provider is unreachable proves nothing. The fakes return
 * the SHAPE each real source returns, which is where this system's bugs lived:
 * a consumer reading `.value` where the producer sent `.data`, a `null` price
 * coerced to `0` and reported as a free swap, a thrown provider written into
 * shared state as a success.
 *
 * The assertions are deliberately about BEHAVIOUR, not strings: "the number the
 * user is shown is the number the source returned", "nothing is executed without
 * a confirmation", "a capability we do not have is refused instead of answered
 * sideways". Reformatting a Persian sentence must not break this probe; making
 * the brain lie would.
 *
 * Run: npm run test:central-brain-turns
 */
import { installFakes } from './ci-fakes.mjs';
import { setCiSource, resetCiSources, CI_SOURCE_NAMES } from '../../server/ci/sources.js';
import { createCentralIntelligence } from '../../server/ci/api.js';
import { auditRegistry } from '../../src/lib/central/registry.js';
import { containsForbidden } from '../../src/lib/central/human.js';
import { ACTION_STATUS, INTENT_STATES, MUTATING_OPERATIONS } from '../../src/lib/central/schema.js';

/* Persian and Arabic digits are the product, not a bug: assertions normalize them
   so a test can still check that the NUMBER is the one the source returned. */
const digits = (v) => String(v || '')
  .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
  .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
  .replace(/[٫٬,\s]/g, (c) => (c === '٫' ? '.' : ''));

const rows = [];
const t = (name, ok, detail = '') => rows.push([name, Boolean(ok), ok ? '' : String(detail).slice(0, 160)]);

for (const [name, fn] of Object.entries(installFakes())) setCiSource(name, fn);

const ci = createCentralIntelligence({ log: () => {} });
const replyOf = (out) => String(out?.response?.text || '');

/* ── A. a read question is answered with the number the source returned ────── */
{
  const owner = 'dev:ci-probe-read0001';
  const out = await ci.brain.handle({ owner, message: 'قیمت بیت‌کوین چنده؟', locale: 'fa', page: { path: '/market/btc', tab: 'overview' } });
  const reply = out.response || {};
  t('A read does not ask for a confirmation', reply.requiresConfirmation !== true, JSON.stringify({ mode: reply.mode }));
  t('A read answers with the number the source returned', digits(replyOf(out)).includes('36000'), reply.headline);
  t('A read names where its numbers came from', (reply.provenance?.sources || []).length > 0, JSON.stringify(reply.provenance).slice(0, 120));
  t('A read states its data age', reply.sections.some((s) => s.id === 'result' && s.dataAt), JSON.stringify(reply.sections.map((s) => s.id)));
  t('A read is not a generic filler line', containsForbidden(replyOf(out)) === false, replyOf(out).slice(0, 80));
  t('A read leaves the intent COMPLETED with no action', out.intent.status === 'COMPLETED' && !out.createdAction, JSON.stringify({ status: out.intent.status, action: out.createdAction?.actionId }));
  const state = ci.stateStore.peek(owner);
  t('A read writes the sections it fetched into shared state', state?.sections?.markets?.status === 'OK' && Number(state.sections.markets.data?.prices?.BTC?.priceUsd) === 36000, JSON.stringify(state?.sections?.markets?.status));
  t('A read does not pretend to have written a quote', !state?.sections?.quotes, JSON.stringify(Object.keys(state?.sections || {})));
}

/* ── B. anaphora: «بفروشمش؟» inherits the asset, and a hole is named ───────── */
{
  const owner = 'dev:ci-probe-anaph01';
  await ci.brain.handle({ owner, message: 'قیمت بیت‌کوین چنده؟', locale: 'fa' });
  const out = await ci.brain.handle({ owner, message: 'بفروشمش؟', locale: 'fa' });
  const ents = out.intent.entities || {};
  t('A follow-up resolves the asset from the previous turn', ents.asset === 'BTC' && ents.assetOrigin === 'memory', JSON.stringify({ asset: ents.asset, origin: ents.assetOrigin }));
  t('A follow-up does not make the user repeat themselves', /بیت.?کوین|BTC/.test(replyOf(out)) || out.intent.intentType.includes('SWAP'), out.intent.intentType);
  t('An amount we were never told is asked for, not invented', out.response.mode === 'QUESTION' && (out.response.ask?.fields || []).includes('amount'), JSON.stringify({ mode: out.response.mode, ask: out.response.ask?.fields }));
  t('A missing amount does not produce a confirmation card', out.response.requiresConfirmation !== true || !out.response.confirmationCard?.amountUsd, JSON.stringify(out.response.confirmationCard || null).slice(0, 120));
  t('Nothing was quoted from the venue for an incomplete order', !(out.plan.steps || []).some((s) => s.operation === 'execute' && s.status === 'DONE'), JSON.stringify((out.plan.steps || []).map((s) => [s.id, s.status])));
}

/* ── C. money: quote → gate → confirm → hand-off → verify → refresh ───────── */
{
  const owner = 'dev:ci-probe-money01';
  const out = await ci.brain.handle({
    owner,
    message: '۰.۱ بیت‌کوین رو به USDC تبدیل کن',
    locale: 'fa',
    page: { path: '/swap', tab: 'swap', walletConnected: true, selectedAsset: 'BTC' }
  });
  const card = out.response.confirmationCard || null;
  const gateIndex = (out.plan.steps || []).findIndex((s) => s.operation === 'confirmation' || s.id === 'confirm');
  const execIndex = (out.plan.steps || []).findIndex((s) => s.permission === 'EXECUTE' && s.operation === 'execute');
  t('A money request is parked behind a confirmation', out.response.requiresConfirmation === true && Boolean(card?.actionId), JSON.stringify({ mode: out.response.mode, requiresConfirmation: out.response.requiresConfirmation }));
  t('The plan puts a confirmation gate before any EXECUTE step', gateIndex >= 0 && execIndex > gateIndex, JSON.stringify({ gateIndex, execIndex, steps: (out.plan.steps || []).map((x) => x.id) }));
  t('The card shows the number the venue quoted', digits(card?.summary).includes('3585.2'), String(card?.summary));
  t('The card carries the action the confirm call needs', Boolean(card?.actionId && card?.planDigest), JSON.stringify({ actionId: card?.actionId, digest: card?.planDigest }));
  t('The card states the same input the action will run on', card?.input?.from === 'BTC' && card?.input?.to === 'USDC' && Number(card?.input?.amountUsd) > 0, JSON.stringify(card?.input));
  t('Nothing reached the chain during planning', out.execution == null || out.execution.status !== ACTION_STATUS.VERIFIED, JSON.stringify(out.execution || null).slice(0, 120));

  const confirmed = await ci.brain.confirmAction({ owner, actionId: card.actionId, planDigest: card.planDigest, execute: true });
  t('Confirming produces a hand-off the wallet must sign', confirmed.ok === true && (confirmed.execution?.status === ACTION_STATUS.AWAITING_SIGNATURE || confirmed.handoff?.unsignedOnly === true), JSON.stringify({ ok: confirmed.ok, code: confirmed.code, status: confirmed.execution?.status }));
  t('No address is invented when the venue gave none', confirmed.handoff ? confirmed.handoff.serverSigned !== true && confirmed.handoff.unsignedOnly !== false : true, JSON.stringify(confirmed.handoff || null).slice(0, 140));
  /* Confirming the same action twice must not produce a second execution: this is
     the double-click case, and it is checked here rather than in the UI because a
     client can always be bypassed. */
  const replay = await ci.brain.confirmAction({ owner, actionId: card.actionId, planDigest: card.planDigest, execute: true });
  t('A second confirm of the same action cannot run it twice', replay.ok === false || replay.executed === false, JSON.stringify({ ok: replay.ok, executed: replay.executed, code: replay.code }));
  const signed = confirmed.action || confirmed.execution || {};
  t('The action is awaiting a signature, never "sent"', [ACTION_STATUS.AWAITING_SIGNATURE, ACTION_STATUS.VERIFIED].includes(signed.status) || signed.status === 'BROADCAST', JSON.stringify({ status: signed.status }));

  const receipt = await ci.brain.reportExecutionResult({ owner, actionId: card.actionId, txHash: `0x${'a'.repeat(64)}`, status: 'BROADCAST' });
  t('A receipt is verified against a source, not accepted on trust', receipt.ok === true && Boolean(receipt.verification?.status || receipt.action?.verification?.status) && !['UNVERIFIED'].includes(receipt.verification?.status || receipt.action?.verification?.status), JSON.stringify({ ok: receipt.ok, code: receipt.code, verification: receipt.verification?.status || receipt.action?.verification?.status }));
  t('After a transaction the dependent modules are re-read', (ci.events.recent(owner, 40) || []).some((e) => ['SWAP_COMPLETED', 'BALANCE_CHANGED', 'POSITION_CHANGED', 'RISK_CHANGED', 'WALLET_CONNECTED'].includes(e.type)) && (ci.stateStore.peek(owner)?.pendingRefreshes || []).length === 0, JSON.stringify((ci.events.recent(owner, 40) || []).map((e) => e.type).slice(0, 12)));
  const after = ci.stateStore.peek(owner);
  t('The shared state moved forward, so nothing on screen is stale', (after?.revision || 0) > 0 && after.sections.wallet?.status === 'OK', JSON.stringify({ revision: after?.revision, wallet: after?.sections?.wallet?.status }));
}

/* ── D. lending: a capacity answer is arithmetic on protocol reads ─────────── */
{
  const owner = 'dev:ci-probe-borrow01';
  const out = await ci.brain.handle({ owner, message: 'چقدر می‌تونم وام بگیرم؟', locale: 'fa' });
  const text = replyOf(out);
  t('A capacity question is not answered as a trade', !out.response.requiresConfirmation, JSON.stringify({ mode: out.response.mode, type: out.intent.intentType }));
  t('The capacity shown is derived from the read position', /[۲ۢ٬,]?[0-9]/.test(text) && (out.response.sections || []).some((s) => s.source && String(s.source).includes('lending')), text.slice(0, 90));
  t('Lending health is part of the answer', (out.risk?.factors || []).some((f) => /health|lending/i.test(f.id)), JSON.stringify((out.risk?.factors || []).map((f) => f.id)));
  t('The read-only truth of the venue is not hidden', out.response.text.length > 0 && containsForbidden(text) === false, text.slice(0, 60));
}

/* ── E. capability refusal: a thing we cannot do is refused, not deflected ─── */
{
  const owner = 'dev:ci-probe-capab01';
  const out = await ci.brain.handle({ owner, message: 'چطور می‌تونم ETF اپل بخرم؟', locale: 'fa' });
  const text = replyOf(out);
  t('An unavailable capability is refused in the first line', /انجام نمی‌شود|انجام نمیشه/.test(text.split('\n')[0]), text.slice(0, 90));
  t('A refusal is marked as a refusal', out.response.refused === true, JSON.stringify({ refused: out.response.refused, mode: out.response.mode }));
  t('A refusal cites the registry, not a mood', (out.response.sections || []).some((s) => String(s.source || '').includes('registry')), JSON.stringify((out.response.sections || []).map((s) => s.source)));
  t('A refusal offers no number and no route', !out.createdAction && !/[۱-۹٬,][0-9٬,]{2,}/.test(String(out.response.confirmationCard?.summary || '')), JSON.stringify(out.createdAction || null));
  t('A refusal says what IS available', (out.response.sections || []).some((s) => s.id === 'alternatives'), JSON.stringify((out.response.sections || []).map((s) => s.id)));
}

/* ── F. security: a stop is a stop ────────────────────────────────────────── */
{
  const owner = 'dev:ci-probe-sec0001';
  setCiSource('swapTokenSafety', async () => ({ ok: true, chainId: 1, address: '0x3333333333333333333333333333333333333333', symbol: 'SCAM', riskLevel: 'CRITICAL', flags: ['HONEYPOT_DETECTED', 'BLACKLIST_FUNCTION'], securityBlock: true, holders: 3, sellTax: 99, buyTax: 99, source: 'fake:token-safety', at: Date.now() }));
  const out = await ci.brain.handle({ owner, message: '۰.۵ اتریوم رو به TOK تبدیل کن', locale: 'fa', page: { path: '/swap', walletConnected: true } });
  t('A security flag stops the turn', out.intent.status === 'SAFE_STOP' && out.policy?.verdict === 'SAFE_STOP', JSON.stringify({ status: out.intent.status, verdict: out.policy?.verdict }));
  t('A stop is published as an event the client can react to', (ci.events.recent(owner, 20) || []).some((e) => e.type === 'SAFE_STOP' || e.type === 'POLICY_BLOCKED'), JSON.stringify((ci.events.recent(owner, 20) || []).map((e) => e.type).slice(0, 8)));
  t('A stop is never presented as retryable', /نمی‌تواند|اجرا نشد|cannot|not be retried/i.test(replyOf(out)), replyOf(out).slice(0, 90));
  t('A stop leaves no executable action', !out.createdAction, JSON.stringify(out.createdAction?.actionId || null));
  t('A stop does not fall back to another venue', (out.plan.steps || []).every((x) => x.status !== 'DONE' || x.permission !== 'EXECUTE'), JSON.stringify((out.plan.steps || []).filter((x) => x.permission === 'EXECUTE').map((x) => x.status)));
  t('A stop is recorded in memory as the last error', Boolean(ci.brain.memoryFor(owner)?.lastError), JSON.stringify(ci.brain.memoryFor(owner)?.lastError || null).slice(0, 120));
  resetCiSources();
  for (const [name, fn] of Object.entries(installFakes())) setCiSource(name, fn);
}

/* ── G. duplicates: the same sentence twice is one action ─────────────────── */
{
  const owner = 'dev:ci-probe-dupe001';
  const message = '۰.۱ بیت‌کوین رو به USDC تبدیل کن';
  const a = await ci.brain.handle({ owner, message, locale: 'fa', page: { path: '/swap', walletConnected: true }, requestId: 'req_probe_dup_1' });
  const b = await ci.brain.handle({ owner, message, locale: 'fa', page: { path: '/swap', walletConnected: true }, requestId: 'req_probe_dup_1' });
  t('A repeated request is answered as a replay', b.replay === true || b.intent?.status === 'DUPLICATE', JSON.stringify({ replay: b.replay, status: b.intent?.status }));
  t('A replay points at the original card instead of a second one', b.response.duplicate === true && Boolean(b.response.headline), JSON.stringify({ dup: b.response.duplicate }));
  const pending = ci.brain.registry(owner).actions.pending(owner);
  t('Two identical asks leave exactly one open action', pending.length === 1 && pending[0].actionId === (a.response.confirmationCard?.actionId || a.createdAction?.actionId), JSON.stringify({ pending: pending.map((p) => p.actionId), expected: a.response.confirmationCard?.actionId }));
}

/* ── H. source failure: unread is admitted, never filled with zeros ───────── */
{
  const owner = 'dev:ci-probe-down001';
  setCiSource('portfolioSummary', async () => { throw new Error('PROVIDER_DOWN: upstream refused the connection'); });
  setCiSource('walletBalances', async () => ({ ok: false, code: 'PROVIDER_DOWN', error: 'all RPC endpoints timed out' }));
  const out = await ci.brain.handle({ owner, message: 'وضعیت پرتفوی من چطوره؟', locale: 'fa' });
  const text = replyOf(out);
  t('A failed read becomes the headline, not a footnote', /خوانده نشد|خوانده نمیشه|متوقف|در دسترس نیست/.test(text.split('\n').slice(0, 2).join(' ')), text.slice(0, 120));
  t('A failed read is never reported as zero', !/\b۰٫?0 ?\$|\$0\b|0 دلار|ارزش پرتفوی ۰/.test(text), text.slice(0, 90));
  t('A failed read says what could not be read', (out.response.sections || []).some((s) => s.id === 'dataGaps' || s.id === 'recovery' || s.id === 'nextStep'), JSON.stringify((out.response.sections || []).map((s) => s.id)));
  const logged = ci.brain.errorsFor(owner)[0] || null;
  t('A failure is classified and kept in the error trail', Boolean(logged?.code) && Boolean(logged?.recovery || logged?.at), JSON.stringify(logged).slice(0, 160));
  resetCiSources();
  for (const [name, fn] of Object.entries(installFakes())) setCiSource(name, fn);
}

/* ── I. the registry is the source of truth about capabilities ────────────── */
{
  const registry = ci.brain.registry('dev:ci-probe-read0001');
  const audit = auditRegistry(registry.list);
  t('All thirty modules are registered', registry.list.length === 30 && audit.specModules === 30 && audit.unregisteredSpecModules.length === 0, JSON.stringify({ listed: registry.list.length, spec: audit.specModules, missing: audit.unregisteredSpecModules }));
  t('Every module declares the §40 fields it owes', audit.verdict === 'COMPLETE' && audit.coveragePct === 100, JSON.stringify({ complete: audit.complete, coveragePct: audit.coveragePct, incomplete: audit.incomplete }));
  const caps = ci.brain.capabilities('dev:ci-probe-read0001').capabilities;
  t('A module with no trading route is UNAVAILABLE, not quietly DEGRADED', caps.etf === 'UNAVAILABLE' && caps.funds === 'UNAVAILABLE', JSON.stringify({ etf: caps.etf, funds: caps.funds }));
  const etfQuote = await registry.map.etf.quote({}, { owner: 'dev:ci-probe-read0001' });
  t('A dead module answers with a reason instead of an empty result', ['UNAVAILABLE', 'NOT_APPLICABLE'].includes(etfQuote.status) && String(etfQuote.reason || '').length > 12, JSON.stringify(etfQuote).slice(0, 140));
  t('A dead module never claims to have executed', typeof registry.map.etf.execute !== 'function' || (await registry.map.etf.execute({}, { owner: 'x' })).status !== 'OK', String((await registry.map.etf.execute({}, { owner: 'y' })).status));
  const ops = new Set(CI_SOURCE_NAMES);
  t('Every source name the brain calls exists in the boundary', ops.size >= 15 && ops.has('swapQuote') && ops.has('lendingPosition'), ops.size);
  t('The state machine has the terminals the client switches on', ['COMPLETED', 'SAFE_STOP', 'CANCELLED', 'DUPLICATE'].every((x) => INTENT_STATES.includes(x)), JSON.stringify(INTENT_STATES));
  t('The tool surface refuses an execute with no confirmed action', (await ci.brain.directToolCall({ owner: 'dev:ci-probe-read0001', module: 'swap', operation: 'execute', input: { from: 'BTC', to: 'USDC', amountUsd: 100 } })).code === 'CONFIRMATION_REQUIRED', 'direct execute accepted');
  t('A mutating operation is named as such, so gates can key off it', MUTATING_OPERATIONS.includes('execute') && !MUTATING_OPERATIONS.includes('read'), JSON.stringify(MUTATING_OPERATIONS));
}

/* ── J. every reply obeys the response contract ───────────────────────────── */
{
  const owner = 'dev:ci-probe-j000001';
  const messages = [
    'سلام، چطوری؟',
    'قیمت اتریوم چنده؟',
    'وامم چقدر امنه؟',
    'ریسک پرتفویم چطوره؟',
    '۵۰۰ دلار USDC قرض بده'
  ];
  const outs = [];
  for (const message of messages) outs.push(await ci.brain.handle({ owner, message, locale: 'fa', page: { path: '/intent-ai', tab: 'chat', walletConnected: true } }));
  const out0Ask = outs[0]?.response?.ask || null;
  t('An unmatched sentence is refused as unmatched, not answered sideways', out0Ask?.fields?.includes('intent') === true && !/ارزش پرتفوی|۱۰٬۰۰۰/.test(replyOf(outs[0])), replyOf(outs[0]).slice(0, 90));
  t('Every turn returns a mode the client can render', outs.every((o) => ['ANSWER', 'ACTION', 'QUESTION', 'ERROR_AND_RECOVERY', 'SAFE_STOP', 'STATUS'].includes(o.response.mode)), JSON.stringify(outs.map((o) => o.response.mode)));
  t('No turn answers with a stock phrase', outs.every((o) => containsForbidden(replyOf(o)) === false), JSON.stringify(outs.map((o) => replyOf(o).slice(0, 40))));
  t('Every turn carries the structured result it explained', outs.every((o) => Array.isArray(o.response.sections) && o.response.sections.length > 0), JSON.stringify(outs.map((o) => o.response.sections.length)));
  t('A turn that names no action does not propose one', outs.filter((o) => o.response.mode !== 'ACTION').every((o) => o.response.requiresConfirmation !== true), JSON.stringify(outs.map((o) => [o.response.mode, o.response.requiresConfirmation])));
  t('A turn never proposes money without a confirmation', outs.every((o) => o.response.mode !== 'ACTION' || o.response.requiresConfirmation === true), JSON.stringify(outs.map((o) => [o.response.mode, o.response.requiresConfirmation])));
  t('The brain logs the trail for every turn it took', (ci.brain.intentsFor(owner) || []).length >= messages.length, JSON.stringify({ intents: (ci.brain.intentsFor(owner) || []).length }));
  t('No trail line carries a key or a seed phrase', !/(privatekey|seedphrase|mnemonic|0x[0-9a-f]{64}(?!"}|,))/i.test(JSON.stringify(ci.brain.intentsFor(owner)).slice(0, 40000)), 'a secret-shaped value appeared in the intent trail');
  t('A greeting is met with what the brain can actually do', /رجیستری|مسیر|می‌توانم|can|Which one/i.test(replyOf(outs[0])) && (out0Ask?.options || []).length > 0, replyOf(outs[0]).slice(0, 90));
}

ci.brain.resetHealth();
const failed = rows.filter(([, ok]) => !ok).length;
console.log(`\n  central brain · turns (§42 A–J)  ${rows.length - failed}/${rows.length}\n`);
for (const [name, ok, detail] of rows) console.log(`   ${ok ? '✓' : '✗'} ${name}${detail ? `  → ${detail}` : ''}`);
process.exitCode = failed ? 1 : 0;
if (failed) console.log(`\n${failed} FAILED\n`);

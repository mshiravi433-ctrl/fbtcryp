/**
 * FBT INTENT OS — AGENT FACTORY PROBE.
 * ---------------------------------------------------------------------------
 * Proves «برام یک ایجنت بساز که …» parses into a WORKING agent draft:
 *
 *   A. detection      — creation sentences vs panel visits vs plain DCA orders
 *   B. parsing (fa)   — kind/asset/amount/frequency/threshold, Persian digits,
 *                       word numbers («ده درصد»), reversed order («از ۱۵۰۰۰۰ بالاتر»)
 *   C. parsing (en)   — the same in English, incl. $100-first amounts
 *   D. slot loop      — missing slots, free-text fill, chip apply, confirm edit
 *   E. payloads       — the exact monitor/automation payload the server gets
 *   F. templates      — every suggested agent + fleet prompt is creatable
 *
 * Pure: no network, no store. Run: node test/intent-ai/agent-factory-probe.mjs
 */

import {
  SUGGESTED_AGENTS,
  agentSlotQuestion,
  agentSummary,
  applyAgentChoice,
  buildAgentPayload,
  fillAgentSlot,
  fleetPrompt,
  isAgentCreateRequest,
  missingSlots,
  parseAgentRequest,
  primarySlot,
  suggestedDraft
} from '../../src/lib/intent-ai/os/agentFactory.js';

const rows = [];
const t = (name, ok, detail = '') => rows.push([`${name}${ok || !detail ? '' : ` — ${detail}`}`, Boolean(ok)]);

/* ── A. detection ─────────────────────────────────────────────────────── */
t('fa creation sentence detected', isAgentCreateRequest('برام یک ایجنت بساز که هر هفته ۱۰۰ دلار BTC بخره') === true);
t('fleet verbatim prompt detected', isAgentCreateRequest('برام یک ایجنت بساز که اگه ETH ده درصد ریخت خبر بده') === true);
t('en creation sentence detected', isAgentCreateRequest('Build me an agent that buys $100 of BTC every week') === true);
t('panel visit is not creation', isAgentCreateRequest('ایجنت‌ها را باز کن') === false);
t('plain DCA order is not creation', isAgentCreateRequest('هر هفته ۱۰۰ دلار BTC بخر') === false);
t('empty is not creation', isAgentCreateRequest('') === false);

/* ── B. parsing (fa) ──────────────────────────────────────────────────── */
{
  const d = parseAgentRequest('برام یک ایجنت بساز که هر هفته ۱۰۰ دلار BTC بخره');
  t('dca parses complete', d.ok === true && d.kind === 'dca' && d.asset === 'BTC' && d.amountUsd === 100 && d.frequency === 'WEEKLY');
}
{
  const d = parseAgentRequest('برام یک ایجنت بساز که قیمت BTC را بپاید و اگه ۱۰٪ ریخت خبر بده');
  t('drawdown guard parses complete', d.ok === true && d.kind === 'drawdown-watch' && d.asset === 'BTC' && d.threshold === 10 && d.operator === 'BELOW');
}
{
  const d = parseAgentRequest('برام یک ایجنت بساز که اگه ETH ده درصد ریخت خبر بده');
  t('word numbers parse («ده درصد» → 10)', d.ok === true && d.kind === 'drawdown-watch' && d.asset === 'ETH' && d.threshold === 10);
}
{
  const d = parseAgentRequest('برام یک ایجنت بساز که سودها را بپاید و اگه به ۱۲٪ رسید خبر بده');
  t('yield watch parses complete', d.ok === true && d.kind === 'yield-watch' && d.threshold === 12 && d.operator === 'ABOVE');
}
{
  const d = parseAgentRequest('برام یک ایجنت بساز که اگه BTC از ۱۵۰۰۰۰ بالاتر رفت خبر بده');
  t('reversed order parses («از ۱۵۰۰۰۰ بالاتر»)', d.ok === true && d.kind === 'price-watch' && d.asset === 'BTC' && d.threshold === 150000 && d.operator === 'ABOVE');
}
{
  const d = parseAgentRequest('برام یک ایجنت بساز که اگه BTC زیر 90000 رفت خبر بده');
  t('below parses', d.ok === true && d.threshold === 90000 && d.operator === 'BELOW');
}
{
  const d = parseAgentRequest('برام یک ایجنت بساز که هر ماه پرتفویم را متعادل کنه');
  t('rebalance parses complete', d.ok === true && d.kind === 'rebalance' && d.frequency === 'MONTHLY');
}
{
  const d = parseAgentRequest('برام یک ایجنت بساز');
  t('bare request asks for kind first', d.ok === false && d.missing[0] === 'kind');
}
{
  const d = parseAgentRequest('برام یک ایجنت بساز که هر هفته بخره');
  t('dca without asset/amount lists both', d.kind === 'dca' && d.missing.includes('asset') && d.missing.includes('amountUsd'));
}
{
  // «یک» inside «یک ایجنت» must never become a threshold.
  const d = parseAgentRequest('برام یک ایجنت بساز که قیمت BTC را بپاید');
  t('«یک ایجنت» is not a number', d.threshold == null && d.missing.includes('threshold'));
}

/* ── C. parsing (en) ──────────────────────────────────────────────────── */
{
  const d = parseAgentRequest('Build me an agent that buys $100 of BTC every week');
  t('en dca parses complete', d.ok === true && d.kind === 'dca' && d.asset === 'BTC' && d.amountUsd === 100 && d.frequency === 'WEEKLY');
}

/* ── D. slot loop ─────────────────────────────────────────────────────── */
{
  let d = parseAgentRequest('برام یک ایجنت بساز');
  t('missing kind only', JSON.stringify(missingSlots(d)) === JSON.stringify(['kind']));
  d = fillAgentSlot(d, 'kind', 'خرید دوره‌ای');
  t('free text fills kind', d?.kind === 'dca');
  d = fillAgentSlot(d, 'asset', 'btc');
  t('free text fills asset', d?.asset === 'BTC');
  d = fillAgentSlot(d, 'amountUsd', '۲۵۰');
  t('fa digits fill amount', d?.amountUsd === 250 && d.ok === true);
  t('off-topic text releases the draft', fillAgentSlot(parseAgentRequest('برام یک ایجنت بساز'), 'kind', 'قیمت BTC چنده؟') === null);
}
{
  let d = parseAgentRequest('برام یک ایجنت بساز');
  d = applyAgentChoice(d, 'kind', 'drawdown-watch');
  d = applyAgentChoice(d, 'asset', 'BTC');
  d = applyAgentChoice(d, 'threshold', 10);
  t('chips complete a guard', d?.ok === true && d.operator === 'BELOW' && d.percent === true);
  t('bad chip value rejected', applyAgentChoice(d, 'threshold', -5) === null);
}
{
  const q = agentSlotQuestion('threshold', { kind: 'drawdown-watch', asset: 'BTC' }, 'fa');
  t('slot question carries chips', q.text.includes('BTC') && q.choices?.length === 3);
  t('price threshold is free text', agentSlotQuestion('threshold', { kind: 'price-watch', asset: 'BTC' }, 'fa').choices === null);
  t('primary slot per kind', primarySlot('dca') === 'amountUsd' && primarySlot('rebalance') === 'frequency' && primarySlot('yield-watch') === 'threshold');
  t('summary names the numbers', agentSummary({ kind: 'dca', asset: 'BTC', amountUsd: 100, frequency: 'WEEKLY' }, 'fa').includes('۱۰۰') === false
    && agentSummary({ kind: 'dca', asset: 'BTC', amountUsd: 100, frequency: 'WEEKLY' }, 'fa').includes('100'));
}

/* ── E. payloads ──────────────────────────────────────────────────────── */
{
  const p = buildAgentPayload(parseAgentRequest('برام یک ایجنت بساز که هر هفته ۱۰۰ دلار BTC بخره'), { locale: 'fa' });
  t('dca payload targets automations', p.backend === 'automation' && p.input.type === 'DCA' && p.input.asset === 'BTC' && p.input.amount === '100' && p.input.frequency === 'WEEKLY');
}
{
  const p = buildAgentPayload(parseAgentRequest('برام یک ایجنت بساز که اگه BTC از ۱۵۰۰۰۰ بالاتر رفت خبر بده'), { locale: 'fa' });
  t('price payload targets monitors', p.backend === 'monitor' && p.draft.metric === 'PRICE' && p.draft.operator === 'ABOVE' && p.draft.threshold === 150000 && p.draft.asset.symbol === 'BTC');
}
{
  const p = buildAgentPayload(parseAgentRequest('برام یک ایجنت بساز که قیمت BTC را بپاید و اگه ۱۰٪ ریخت خبر بده'), { locale: 'fa' });
  t('guard payload is percent-below without baseline', p.backend === 'monitor' && p.draft.metric === 'PERCENT_CHANGE' && p.draft.operator === 'BELOW' && p.draft.threshold === 10 && p.draft.baseline === null);
}
{
  const p = buildAgentPayload(parseAgentRequest('برام یک ایجنت بساز که سودها را بپاید و اگه به ۱۲٪ رسید خبر بده'), { locale: 'fa' });
  t('yield payload is opportunity-above', p.backend === 'monitor' && p.draft.metric === 'OPPORTUNITY' && p.draft.operator === 'ABOVE' && p.draft.threshold === 12);
}
{
  t('incomplete draft never builds', buildAgentPayload(parseAgentRequest('برام یک ایجنت بساز')).error === 'DRAFT_INCOMPLETE');
}

/* ── F. templates ─────────────────────────────────────────────────────── */
{
  t('five suggested agents ship', SUGGESTED_AGENTS.length === 5);
  for (const s of SUGGESTED_AGENTS) {
    const d = suggestedDraft(s.id);
    t(`suggested ${s.id} is complete`, d?.ok === true && buildAgentPayload(d).error == null);
  }
  t('unknown template is null', suggestedDraft('nope') === null);
  const ids = ['market-agent', 'portfolio-agent', 'risk-agent', 'strategy-agent', 'guardian-agent', 'execution-agent', 'verification-agent'];
  for (const id of ids) {
    const d = parseAgentRequest(fleetPrompt(id, 'fa'));
    t(`fleet ${id} parses complete`, d?.ok === true && isAgentCreateRequest(fleetPrompt(id, 'fa')));
  }
  const open = parseAgentRequest(fleetPrompt('intent-agent', 'fa'));
  t('fleet intent-agent opens the kind question', open?.missing?.[0] === 'kind');
}

const agentFactoryFailed = rows.filter(([, ok]) => !ok);
console.log(`\nagent-factory probe: ${rows.length - agentFactoryFailed.length}/${rows.length} passed`);
if (agentFactoryFailed.length) {
  console.error(agentFactoryFailed.map(([name]) => `  ✗ ${name}`).join('\n'));
  process.exit(1);
}
console.log('OK: intent-ai/agent-factory-probe');
export default rows;

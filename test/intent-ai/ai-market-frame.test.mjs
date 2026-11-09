/**
 * «هوش مصنوعی برای تحلیل بازار و تحلیل را باهوش‌تر کن»
 * ---------------------------------------------------------------------------
 * A market answer fails in one specific, repeatable way: the turn holds a 24h
 * print and three prices, and the answer discusses a 200-day average, an RSI
 * divergence and a three-month target. Nothing there is checkable against the
 * turn's data — it comes from the model's memory, not from the market.
 *
 * The frame fixes the order of operations: compute what the data measures
 * (instruments, breadth, dispersion, regime, relative strength, the horizon it
 * can honestly support), state what it cannot measure, then hold the draft to
 * that line before and after review. These tests pin both halves — the frame's
 * arithmetic on thin and rich contexts, and the two violations that matter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKET_FRAME_SCHEMA,
  detectMarketAnalysis,
  buildMarketFrame,
  renderMarketFrame,
  renderMarketContract,
  checkMarketAnalysis,
  renderMarketViolations
} from '../../server/aiMarketFrame.js';
import { deriveResearchFindings } from '../../server/aiResearchAgenda.js';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

/* -------------------------------------------------------------------------- */
/*  A. THE FRAME                                                              */
/* -------------------------------------------------------------------------- */

const THIN_CONTEXT = {
  market: { dataStatus: 'live', change24hPct: -2.4, priceMap: { BTC: 68400, ETH: 3250, SOL: 150 } }
};

const RICH_CONTEXT = {
  market: {
    dataStatus: 'live',
    fetchedAt: 1762600000000,
    change24hPct: -1.2,
    assets: [
      { symbol: 'BTC', priceUsd: 68000, change24hPct: -1.2, change7dPct: 4.1, volume24hUsd: 3.2e10, marketCapUsd: 1.3e12, ath: 73500, low24h: 67200, high24h: 69100, sector: 'store-of-value' },
      { symbol: 'ETH', priceUsd: 3240, change24hPct: 2.8, change7dPct: 9.4, volume24hUsd: 1.5e10, marketCapUsd: 3.9e11, ath: 4870, low24h: 3130, high24h: 3280, sector: 'smart-contract' },
      { symbol: 'SOL', priceUsd: 152, change24hPct: 4.6, change7dPct: 12.2, volume24hUsd: 4.1e9, marketCapUsd: 7.1e10, ath: 260, low24h: 144, high24h: 155, sector: 'smart-contract' },
      { symbol: 'LINK', priceUsd: 11.4, change24hPct: 0, change7dPct: 1.1, volume24hUsd: 3.1e8, marketCapUsd: 7.2e9, ath: 52, low24h: 11.2, high24h: 11.6, sector: 'oracle' },
      { symbol: 'ARB', priceUsd: 0.42, change24hPct: -6.8, change7dPct: -11.5, volume24hUsd: 2.2e7, marketCapUsd: 1.6e9, ath: 2.4, low24h: 0.41, high24h: 0.45, sector: 'l2' }
    ]
  }
};

test('a thin context still yields an honest frame, not an invented one', () => {
  const frame = buildMarketFrame({ context: THIN_CONTEXT, message: 'تحلیل بازار BTC' });
  assert.equal(frame.schema, MARKET_FRAME_SCHEMA);
  assert.equal(frame.dataStatus, 'live');
  assert.equal(frame.stale, false);
  assert.equal(frame.instruments.length, 3);

  /* The top-level change is BTC's move and must reach the benchmark row. */
  assert.deepEqual(frame.benchmark, { symbol: 'BTC', change24hPct: -2.4 });
  assert.equal(frame.breadth.decliners, 1);
  assert.equal(frame.breadth.tracked, 3);

  /* One 24h print supports today, nothing longer. */
  assert.equal(frame.horizon.supportedDays, 1);
  assert.equal(frame.horizon.basis, '24h_only');

  /* The expensive claims are named as unsupported, not silently omitted. */
  assert.ok(frame.notSupported.includes('ohlc_history'));
  assert.ok(frame.notSupported.includes('rsi'));
  assert.ok(frame.notSupported.includes('orderbook_depth'));
  assert.ok(frame.notSupported.includes('funding_rate'));
  assert.ok(frame.gaps.includes('market_breadth'));
  assert.ok(frame.gaps.includes('volume'));
});

test('a rich context produces real breadth, dispersion, regime and leadership', () => {
  const frame = buildMarketFrame({ context: RICH_CONTEXT, message: 'وضعیت بازار چطور است؟' });
  assert.equal(frame.breadth.tracked, 5);
  assert.equal(frame.breadth.advancers, 2);
  assert.equal(frame.breadth.decliners, 2);
  assert.equal(frame.breadth.flat, 1);
  assert.equal(frame.breadth.ratio, 1);

  /* max-min of the five 24h changes: 4.6 − (−6.8). */
  assert.equal(frame.dispersionPct, 11.4);
  assert.equal(frame.regime, 'normal', 'a 1.2% benchmark move with 11.4pp dispersion is a normal tape');

  assert.equal(frame.leadership[0].sector, 'smart-contract');
  assert.equal(frame.leadership[1].sector, 'oracle');
  assert.equal(frame.leadership.at(-1).sector, 'l2');

  const btc = frame.instruments.find((i) => i.symbol === 'BTC');
  assert.equal(btc.liquidityTier, 'deep');
  assert.equal(btc.drawdownFromAthPct, 7.48);
  assert.equal(btc.rangePosition, 0.421);

  const arb = frame.instruments.find((i) => i.symbol === 'ARB');
  assert.equal(arb.liquidityTier, 'thin');
});

test('relative strength is measured against the benchmark, never assumed', () => {
  const frame = buildMarketFrame({ context: RICH_CONTEXT, message: 'تحلیل بازار' });
  const eth = frame.relative.find((r) => r.symbol === 'ETH');
  const arb = frame.relative.find((r) => r.symbol === 'ARB');
  assert.equal(eth.relativeStrength, 4);
  assert.equal(arb.relativeStrength, -5.6);
  assert.equal(frame.relative.some((r) => r.symbol === 'BTC'), false);

  /* With one instrument there is no relative read to make. */
  const single = buildMarketFrame({ context: { market: { priceMap: { BTC: 68000 } } }, message: 'تحلیل BTC' });
  assert.deepEqual(single.relative, []);
  assert.ok(single.notSupported.includes('relative_strength'));
});

test('the regime escalates with the tape, and stays unknown without data', () => {
  const turbulent = buildMarketFrame({
    context: { market: { dataStatus: 'live', change24hPct: -7.4, priceMap: { BTC: 64000, ETH: 3000 } } },
    message: 'تحلیل بازار'
  });
  assert.equal(turbulent.regime, 'turbulent');

  const calm = buildMarketFrame({
    context: { market: { dataStatus: 'live', change24hPct: 0.3, priceMap: { BTC: 68000, ETH: 3240 } } },
    message: 'تحلیل بازار'
  });
  assert.equal(calm.regime, 'calm');

  const empty = buildMarketFrame({ context: {}, message: 'تحلیل بازار' });
  assert.equal(empty.regime, 'unknown');
  assert.equal(empty.dataStatus, 'missing');
  assert.deepEqual(empty.instruments, []);
  assert.ok(empty.gaps.includes('live_prices'));
});

test('stale and offline data are marked, and the gap is named', () => {
  const stale = buildMarketFrame({
    context: { market: { dataStatus: 'offline', priceMap: { BTC: 68000 } } },
    message: 'تحلیل بازار'
  });
  assert.equal(stale.stale, true);
  assert.ok(stale.gaps.includes('fresh_market_data'));
});

test('the supported horizon follows the data, not the question', () => {
  const asked = buildMarketFrame({ context: THIN_CONTEXT, message: 'BTC تا سه ماه آینده چه می‌شود؟' });
  assert.equal(asked.horizon.requestedDays, 180);
  assert.equal(asked.horizon.supportedDays, 1);
  assert.equal(asked.horizon.exceeded, true);

  /* A 7d change buys a week — and still not three months. */
  const weekly = buildMarketFrame({ context: RICH_CONTEXT, message: 'تحلیل BTC تا سه ماه آینده' });
  assert.equal(weekly.horizon.supportedDays, 7);
  assert.equal(weekly.horizon.basis, '24h+7d_change');
  assert.equal(weekly.horizon.exceeded, true);

  /* An OHLC series is the one thing that would lift the ceiling. */
  const withHistory = buildMarketFrame({
    context: { market: { ...RICH_CONTEXT.market, ohlc: [{ t: 1, o: 1, h: 2, l: 1, c: 1.5 }] } },
    message: 'تحلیل BTC تا سه ماه آینده'
  });
  assert.equal(withHistory.horizon.basis, 'ohlc_history');
  assert.equal(withHistory.notSupported.includes('ohlc_history'), false);
  assert.equal(withHistory.notSupported.includes('rsi'), false);
});

test('the rendered frame carries the numbers, the limit and the gaps', () => {
  const frame = buildMarketFrame({ context: THIN_CONTEXT, message: 'تحلیل بازار BTC تا سه ماه آینده' });
  const text = renderMarketFrame(frame);
  assert.match(text, /MARKET FRAME/);
  assert.match(text, /status=زنده/);
  assert.match(text, /- BTC: \$68400, -2\.4% 24h/);
  assert.match(text, /horizon this data supports: today only/);
  assert.match(text, /the question asks for 180 days/);
  assert.match(text, /NOT SUPPORTED by this data/);
  assert.match(text, /gaps: /);

  const contract = renderMarketContract(frame);
  assert.match(contract, /MARKET ANALYSIS CONTRACT/);
  assert.match(contract, /invalidation level/);
  assert.match(contract, /three-month thesis unless you mark it as a scenario/);

  assert.equal(renderMarketFrame(null), '');
  assert.equal(renderMarketContract({ schema: 'other' }), '');
});

/* -------------------------------------------------------------------------- */
/*  B. COMPLIANCE                                                             */
/* -------------------------------------------------------------------------- */

const RSI_ANSWER = 'RSI در ناحیهٔ اشباع فروش است و واگرایی مثبت دیده می‌شود؛ میانگین متحرک ۵۰ روزه هم شکسته شده است.';

test('an indicator the data cannot compute is a HIGH violation', () => {
  const frame = buildMarketFrame({ context: THIN_CONTEXT, message: 'تحلیل بازار BTC' });
  const check = checkMarketAnalysis({ frame, answer: RSI_ANSWER });
  assert.equal(check.applicable, true);
  assert.equal(check.compliant, false);
  assert.deepEqual(check.issues.map((i) => i.id), ['INDICATOR_WITHOUT_HISTORY']);
  assert.equal(check.issues[0].severity, 'HIGH');
  assert.match(renderMarketViolations(check), /MARKET FRAME VIOLATIONS/);
  assert.match(renderMarketViolations(check), /INDICATOR_WITHOUT_HISTORY/);
});

test('with an OHLC series the same indicator is legitimate', () => {
  const frame = buildMarketFrame({
    context: { market: { ...THIN_CONTEXT.market, ohlc: [{ t: 1, o: 1, h: 2, l: 1, c: 1.5 }] } },
    message: 'تحلیل بازار BTC'
  });
  const check = checkMarketAnalysis({ frame, answer: RSI_ANSWER });
  assert.equal(check.compliant, true);
  assert.equal(renderMarketViolations(check), '');
});

test('a long-horizon target on a 24h print is flagged; a scenario is not', () => {
  const frame = buildMarketFrame({ context: THIN_CONTEXT, message: 'BTC تا سه ماه آینده چه می‌شود؟' });
  const bare = checkMarketAnalysis({
    frame,
    answer: 'BTC تا سه ماه آینده به ۹۵٬۰۰۰ دلار می‌رسد و هدف بعدی ۱۰۵ هزار است.'
  });
  assert.equal(bare.compliant, false);
  assert.ok(bare.issues.some((i) => i.id === 'HORIZON_EXCEEDS_DATA'));

  /* A conditional scenario is allowed to be long — that is what a scenario is. */
  const scenario = checkMarketAnalysis({
    frame,
    answer: 'سناریوی صعودی: اگر حجم معاملات بالای میانگین بماند، تا سه ماه آینده هدف ۹۵٬۰۰۰ دلار محتمل است و ابطال آن بازگشت زیر ۶۴ هزار است.'
  });
  assert.equal(scenario.compliant, true);

  /* No long horizon claimed: the horizon check stays silent. */
  const today = checkMarketAnalysis({ frame, answer: 'امروز BTC ۲٫۴٪ ریزش کرده و ETH نسبت به آن قوی‌تر است.' });
  assert.equal(today.compliant, true);
});

test('nothing to check means nothing to complain about', () => {
  const frame = buildMarketFrame({ context: THIN_CONTEXT, message: 'تحلیل بازار BTC' });
  assert.equal(checkMarketAnalysis({ frame, answer: '' }).applicable, false);
  assert.equal(checkMarketAnalysis({ answer: RSI_ANSWER }).compliant, true);
  assert.equal(renderMarketViolations(null), '');
});

test('only analysis turns are detected — a price quote and small talk are not', () => {
  assert.equal(detectMarketAnalysis('تحلیل بازار BTC را بگو'), true);
  assert.equal(detectMarketAnalysis('روند ETH چطور است؟'), true);
  assert.equal(detectMarketAnalysis('analyze the ETH market please'), true);
  /* A market task type still needs a market word: «بازار» alone is a topic,
     not an analysis, so the bare string stays false and the typed turn true. */
  assert.equal(detectMarketAnalysis('بازار'), false);
  assert.equal(detectMarketAnalysis('بازار امشب چطوره؟', ['market']), true);
  assert.equal(detectMarketAnalysis('سلام، وقت بخیر'), false);
  assert.equal(detectMarketAnalysis('قیمت BTC چنده؟'), false);
  assert.equal(detectMarketAnalysis(''), false);
});

/* -------------------------------------------------------------------------- */
/*  C. THE FRAME FEEDS THE RESEARCH AGENDA                                    */
/* -------------------------------------------------------------------------- */

test('a real market deficit opens an agenda item; a rich turn closes it', () => {
  const thinFrame = buildMarketFrame({ context: THIN_CONTEXT, message: 'تحلیل بازار BTC تا سه ماه آینده' });
  const thinCheck = checkMarketAnalysis({ frame: thinFrame, answer: 'تحلیل ساده' });
  const thinFindings = deriveResearchFindings({
    market: {
      horizon: thinFrame.horizon,
      breadth: thinFrame.breadth,
      violations: thinCheck.issues.map((i) => i.id)
    }
  });
  const open = thinFindings.map((f) => f.id);
  assert.ok(open.includes('market_history'), 'a 180-day question on a 24h print opens the history gap');
  assert.equal(open.includes('market_breadth'), false, 'BTC did move, so breadth was measured');
  const thinStatus = Object.fromEntries(thinFindings.map((f) => [f.id, f.status || 'open']));
  assert.equal(thinStatus.live_market, 'satisfied', 'live prices arrived, so that item is closed');

  /* Prices with no change at all: breadth is genuinely unmeasured. */
  const breadthOnly = deriveResearchFindings({
    market: {
      horizon: { supportedDays: 1, requestedDays: null, exceeded: false },
      breadth: { tracked: 3, advancers: 0, decliners: 0, flat: 0 },
      violations: []
    }
  });
  assert.ok(breadthOnly.some((f) => f.id === 'market_breadth'));

  const richFrame = buildMarketFrame({ context: RICH_CONTEXT, message: 'تحلیل بازار امروز' });
  const richFindings = deriveResearchFindings({
    market: {
      horizon: richFrame.horizon,
      breadth: richFrame.breadth,
      violations: []
    }
  });
  const byId = Object.fromEntries(richFindings.map((f) => [f.id, f.status || 'open']));
  assert.equal(byId.market_breadth, 'satisfied');
  assert.equal(byId.live_market, 'satisfied');

  /* No market block (every other mode) adds nothing. */
  assert.deepEqual(deriveResearchFindings({ market: null }), []);
});

/* -------------------------------------------------------------------------- */
/*  D. WIRING INTO THE TURN                                                   */
/* -------------------------------------------------------------------------- */

const MARKET_QUESTION = 'تحلیل بازار BTC تا سه ماه آینده چیست و چرا؟ روند و وضعیت بازار را بررسی کن.';

const GOOD_ANSWER = 'با دادهٔ امروز BTC ۲٫۴٪ ریزش کرده و نسبت به ETH ضعیف‌تر است؛ ETH ۱٫۲ واحد درصد بهتر عمل کرده. '
  + 'این داده فقط امروز را می‌پوشاند و سری زمانی OHLC ندارد، پس RSI یا میانگین متحرک قابل محاسبه نیست. '
  + 'سناریوی صعودی: اگر حجم بالای میانگین بماند، تا سه ماه آینده هدف ۹۵ هزار محتمل است و ابطال آن بازگشت زیر ۶۴ هزار است.';

function makeFleet({ finalAnswer = GOOD_ANSWER } = {}) {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    const system = String(opts.system || '');
    calls.push({ system, message: String(opts.user || '') });
    const reply = (text) => ({ provider: providerId, model: 'fake', durationMs: 2, text: JSON.stringify(text) });
    if (system.includes('adversarial self-reviewer')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    if (system.includes('Final Answer AI')) return reply({ answer: finalAnswer, claims: [], uncertainty: '' });
    return reply({ answer: 'تحلیل نقش: بازار در فاز تثبیت است و نقدینگی متوسط است.', claims: [], uncertainty: 'داده کم است' });
  };
  return {
    execute,
    selectProviders: () => ['fake-a', 'fake-b', 'fake-c'],
    calls,
    finalCalls: () => calls.filter((c) => c.system.includes('Final Answer AI')),
    critiqueCalls: () => calls.filter((c) => c.system.includes('adversarial self-reviewer')),
    marketCalls: () => calls.filter((c) => c.system.includes('MARKET FRAME'))
  };
}

test('max: a market turn carries the frame and the contract to every role', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: MARKET_QUESTION,
    locale: 'fa',
    context: THIN_CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  assert.ok(fleet.marketCalls().length >= 2, 'the frame must reach more than one role');
  assert.match(fleet.finalCalls()[0].system, /MARKET FRAME/);
  assert.match(fleet.finalCalls()[0].system, /MARKET ANALYSIS CONTRACT/);

  assert.equal(out.market.schema, MARKET_FRAME_SCHEMA);
  assert.equal(out.market.regime, 'normal');
  assert.equal(out.market.horizon.exceeded, true);
  assert.ok(out.market.notSupported.includes('ohlc_history'));
  assert.equal(out.market.compliant, true);
  assert.deepEqual(out.market.violations, []);
});

test('max: a draft with RSI and a bare target is sent back to the reviewer', async () => {
  const fleet = makeFleet({
    finalAnswer: 'RSI در ناحیهٔ اشباع فروش است و واگرایی مثبت دیده می‌شود. BTC تا سه ماه آینده به ۹۵ هزار دلار می‌رسد.'
  });
  const out = await runCollaborativeAnalysis({
    message: MARKET_QUESTION,
    locale: 'fa',
    context: THIN_CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });

  const critique = fleet.critiqueCalls()[0].message;
  assert.match(critique, /MARKET FRAME VIOLATIONS/);
  assert.match(critique, /INDICATOR_WITHOUT_HISTORY/);
  assert.match(critique, /HORIZON_EXCEEDS_DATA/);

  assert.equal(out.market.compliant, false);
  assert.ok(out.market.violations.includes('INDICATOR_WITHOUT_HISTORY'));
  assert.ok(out.market.violations.includes('HORIZON_EXCEEDS_DATA'));
});

test('max: a non-market turn carries no frame at all', async () => {
  const fleet = makeFleet({ finalAnswer: 'برای این سؤال، سازوکار فاندینگ را توضیح می‌دهم.' });
  const out = await runCollaborativeAnalysis({
    message: 'فاندینگ ریت چه معنایی دارد و چرا مهم است؟',
    locale: 'fa',
    context: THIN_CONTEXT,
    intelligence: 'max',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.market, null);
  for (const call of fleet.calls) {
    assert.equal(call.system.includes('MARKET FRAME'), false);
    assert.equal(call.system.includes('MARKET ANALYSIS CONTRACT'), false);
  }
});

test('balanced: the frame never reaches the models', async () => {
  const fleet = makeFleet();
  const out = await runCollaborativeAnalysis({
    message: MARKET_QUESTION,
    locale: 'fa',
    context: THIN_CONTEXT,
    intelligence: 'balanced',
    deps: fleet,
    deadlineMs: 15000
  });
  assert.equal(out.market, null);
  for (const call of fleet.calls) {
    assert.equal(call.system.includes('MARKET FRAME'), false);
  }
});

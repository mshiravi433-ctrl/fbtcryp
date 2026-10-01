/**
 * SMART MONEY → INTENT OS — THE CONNECTOR, PROVEN.
 * ---------------------------------------------------------------------------
 * A source grep cannot tell whether «اگر اسمارت مانی اتریوم را انباشت کرد خبر
 * بده» actually reaches a working automation, because the sentence has to
 * survive FOUR independent gates, each of which once dropped it:
 *
 *   1. the chat ROUTER — smart-money subject, a notify verb, an asset;
 *   2. the EVIDENCE GATE — `verifiedSignals` demands ≥3 independent qualified
 *      wallets, ≥3 paired swaps, confidence ≥75, and a non-stale index;
 *   3. the DRAFT — a concrete `smartTarget {chain, token}`;
 *   4. the SERVER — `normalizeMonitor` must accept it. This is the gate that
 *      makes the rest mean anything: a Smart Money monitor without a contract
 *      is refused with BAD_SM_TARGET, and without this step a regression that
 *      re-broke the wire would look perfectly fine in the client.
 *
 * The regression this locks is the reported one: the chat answered «type a
 * threshold» to a Smart Money request, and the function documented to handle
 * it (smartMoneyAlertFromText) was orphaned AND Persian-blind.
 *
 * Runs the REAL modules. No network; the evidence snapshot is the shape
 * `server/smartMoney/consensus.js` actually emits, and the acceptance step is
 * the real `normalizeMonitor`.
 */

const results = [];
const t = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${String(detail ?? '')}`}`);
};

const { parseSmartMoneyMonitorRequest, isSmartMoneyWatchText, resolveVerifiedTarget, MIN_INDEPENDENT_BUYERS } =
  await import('../src/lib/smartMoneyMonitorIntent.js');
const { verifiedSignals } = await import('../src/lib/smartMoneyEvidence.js');
const { parseMonitorRequest } = await import('../src/lib/intent-ai/os/monitorClient.js');
const { smartMoneyAlertFromText, buildSmartMoneyAlertIntent } = await import('../src/lib/smartMoneyAI.js');
const { normalizeMonitor } = await import('../server/intentMonitoring.js');

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

/* ── a REAL verified snapshot (fbt.smart-money-intelligence.v1) ──────────── */
/* Shaped exactly as server/smartMoney/consensus.js emits it: one qualified
   ETH row clearing every clause of the gate, plus a decoy on another chain. */
const verified = {
  schema: 'fbt.smart-money-intelligence.v1',
  dataStatus: 'observed',
  window: '24h',
  indexedAt: NOW - 90_000,
  consensus: [
    { chain: 1, token: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH',
      signal: 'ACCUMULATION', confidence: 88, independentBuyers: 5, independentSellers: 1,
      independentVotes: 6, swaps: 9, netFlowUsd: 4_200_000, lastAt: NOW - 300_000 },
    { chain: 8453, token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC',
      signal: 'DISTRIBUTION', confidence: 81, independentBuyers: 1, independentSellers: 4,
      independentVotes: 5, swaps: 7, netFlowUsd: -1_800_000, lastAt: NOW - 420_000 }
  ]
};

const parse = (text, opts = {}) =>
  parseSmartMoneyMonitorRequest(text, { verified, now: NOW, locale: 'fa', ...opts });

/* ═══ 1 · the sentence the user actually types ═══════════════════════════ */
console.log('\n▸ «اگر اسمارت مانی اتریوم را انباشت کرد خبر بده»');

{
  const text = 'اگر اسمارت مانی اتریوم را انباشت کرد خبر بده';

  /* The regression: this sentence used to be classified as a PRICE monitor
     with no condition, and the chat replied «type a threshold». */
  const old = parseMonitorRequest(text, { locale: 'fa' });
  t('the regression really happened: the price parser cannot read it',
    old?.error === 'NO_CONDITION', JSON.stringify(old));
  t('the old path demanded a threshold this sentence never contained',
    old?.asset === 'ETH' && old?.monitor?.threshold == null, JSON.stringify(old));

  t('the router recognises it as a Smart Money watch',
    isSmartMoneyWatchText(text) === true);
  const got = parse(text);
  t('it parses into a draft', !!got.monitor, JSON.stringify(got));
  t('the Persian asset name resolves to a real contract (اتریوم, not BAD_ASSET)',
    got.monitor?.smartTarget?.token === '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    && got.monitor?.smartTarget?.chain === 1, JSON.stringify(got.monitor?.smartTarget));
  t('accumulation maps to SMART_MONEY_BUYERS / ABOVE / ≥3 independent buyers',
    got.monitor?.metric === 'SMART_MONEY_BUYERS' && got.monitor?.operator === 'ABOVE'
    && got.monitor?.threshold === MIN_INDEPENDENT_BUYERS, JSON.stringify(got.monitor));

  /* THE ACCEPTANCE GATE — the real server validator. */
  const norm = normalizeMonitor(got.monitor, { now: NOW });
  t('the SERVER accepts the draft (no BAD_SM_TARGET)', !norm.error, JSON.stringify(norm.error));
  t('the stored monitor keeps the exact contract it was created with',
    norm.monitor?.smartTarget?.token === got.monitor.smartTarget.token
    && norm.monitor.smartTarget.chain === 1, JSON.stringify(norm.monitor?.smartTarget));
  t('the stored monitor is ACTIVE and can actually be evaluated',
    norm.monitor?.status === 'ACTIVE' && !!norm.monitor?.id, JSON.stringify(norm.monitor?.status));
  t('the stored label names the asset', /ETH|WETH/.test(norm.monitor?.label || ''), norm.monitor?.label);
}

/* ═══ 2 · English, and the distribution / reversal directions ═════════════ */
console.log('\n▸ directions');

{
  const en = parse('if smart money accumulates ETH tell me');
  t('English «if smart money accumulates ETH tell me» builds the same monitor',
    en.monitor?.metric === 'SMART_MONEY_BUYERS' && en.monitor?.smartTarget?.chain === 1,
    JSON.stringify(en.monitor));

  const sell = parse('وقتی اسمارت مانی USDC توزیع کرد خبر بده');
  t('«توزیع کرد» maps to SMART_MONEY_NET / BELOW with a NEGATIVE threshold',
    sell.monitor?.metric === 'SMART_MONEY_NET' && sell.monitor?.operator === 'BELOW'
    && sell.monitor?.threshold < 0, JSON.stringify(sell.monitor));

  const normSell = normalizeMonitor(sell.monitor, { now: NOW });
  t('the SERVER accepts a negative net-flow threshold',
    !normSell.error, JSON.stringify(normSell.error));

  const rev = parse('اگر جریان اسمارت مانی اتریوم برعکس شد خبر بده');
  t('«برعکس شد» maps to SMART_MONEY_REVERSAL with from>0 and to<0',
    rev.monitor?.metric === 'SMART_MONEY_REVERSAL'
    && rev.monitor.reversal.fromUsd > 0 && rev.monitor.reversal.toUsd < 0,
    JSON.stringify(rev.monitor));
  t('the SERVER accepts the reversal frame', !normalizeMonitor(rev.monitor, { now: NOW }).error,
    JSON.stringify(normalizeMonitor(rev.monitor, { now: NOW }).error));
}

/* ═══ 3 · fail CLOSED — the whole point of the evidence gate ═════════════ */
console.log('\n▸ fail-closed');

{
  t('an asset with no verified evidence is REFUSED, not guessed',
    parse('اگر اسمارت مانی DOGE انباشت کرد خبر بده').error === 'NO_VERIFIED_CONTRACT',
    JSON.stringify(parse('اگر اسمارت مانی DOGE انباشت کرد خبر بده')));

  t('the refusal names what IS being observed, so the answer is useful',
    parse('اگر اسمارت مانی DOGE انباشت کرد خبر بده').observed?.includes('WETH') === true,
    JSON.stringify(parse('اگر اسمارت مانی DOGE انباشت کرد خبر بده').observed));

  t('a missing index is unknown, not a $0 flow',
    parse('اگر اسمارت مانی اتریوم را انباشت کرد خبر بده', { verified: null }).error === 'NO_VERIFIED_CONTRACT');
  const stale = { ...verified, indexedAt: NOW - 48 * 3600_000 };
  t('a 48h-old index cannot arm a monitor',
    parse('اگر اسمارت مانی اتریوم را انباشت کرد خبر بده', { verified: stale }).error === 'NO_VERIFIED_CONTRACT');

  /* A snapshot that has the row but fails the evidence bar must not arm it. */
  const thin = { ...verified, consensus: [{ ...verified.consensus[0], independentBuyers: 1, independentVotes: 1, swaps: 1, confidence: 40 }] };
  t('a row that fails the ≥3-wallet / confidence bar is refused',
    parse('اگر اسمارت مانی اتریوم را انباشت کرد خبر بده', { verified: thin }).error === 'NO_VERIFIED_CONTRACT');

  t('a definition question is never turned into an automation',
    parse('اسمارت مانی چیست؟').error === 'DEFINITION_QUESTION');
  t('no notify verb → not an automation',
    parse('اسمارت مانی اتریوم چقدر است؟').error === 'NO_NOTIFY');
  t('not about smart money → not ours',
    parse('قیمت بیت کوین چنده؟').error === 'NOT_SMART_MONEY');
  t('an empty sentence is empty, not a crash', parse('').error === 'EMPTY');

  /* A base58 mint must never be coerced onto an EVM chain. The evidence gate
     already drops such a row (its chain is not finite), so the observable
     behaviour is a refusal — asserted here. The non-EVM guard is then
     exercised directly, because it is what stands between a future refactor
     and a Solana mint being analysed as an Ethereum contract. */
  t('a Solana-shaped row is refused, never coerced onto chain 1',
    parse('اگر اسمارت مانی اتریوم را انباشت کرد خبر بده', {
      verified: { ...verified, consensus: [{ ...verified.consensus[0], chain: 'solana', token: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' }] }
    }).error === 'NO_VERIFIED_CONTRACT');
  t('the non-EVM guard itself refuses (belt and braces)',
    resolveVerifiedTarget({
      symbol: 'WETH', now: NOW,
      verified: { ...verified, consensus: [{ ...verified.consensus[0], chain: 'solana', token: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' }] }
    }).error === 'NO_VERIFIED_CONTRACT');
}

/* ═══ 4 · two contracts, one name → ask, do not guess ═══════════════════ */
console.log('\n▸ ambiguity');

{
  const twin = { ...verified, consensus: [
    { ...verified.consensus[0], chain: 8453 },
    verified.consensus[0]
  ] };
  const got = resolveVerifiedTarget({ symbol: 'WETH', verified: twin, now: NOW });
  t('the same symbol on two chains is AMBIGUOUS_CONTRACT, never a coin flip',
    got.error === 'AMBIGUOUS_CONTRACT' && got.candidates?.length === 2, JSON.stringify(got));
}

/* ═══ 5 · the orphan is gone, and Persian works ══════════════════════════ */
console.log('\n▸ the orphaned intent builder');

{
  const sentence = 'اگر اسمارت مانی اتریوم را انباشت کرد خبر بده';

  /* smartMoneyAlertFromText used to be the documented answer to this exact
     sentence while nothing ever called it, and the object it returned was
     never stored by anyone. It must now agree with the real parser, and what
     it returns must be something the server accepts. */
  const legacy = smartMoneyAlertFromText(sentence, { verified, now: NOW });
  t('the old entry point now produces a real, server-accepted monitor draft',
    legacy?.ok === true && !!legacy.intent?.monitor
    && !normalizeMonitor(legacy.intent.monitor, { now: NOW }).error,
    JSON.stringify(legacy).slice(0, 200));
  t('and it lands on the SAME server record as the one parser the chat uses',
    (() => {
      const a = normalizeMonitor(legacy.intent.monitor, { now: NOW }).monitor;
      const b = normalizeMonitor(parse(sentence).monitor, { now: NOW }).monitor;
      return a.metric === b.metric && a.operator === b.operator && a.threshold === b.threshold
        && a.smartTarget?.token === b.smartTarget?.token && a.smartTarget?.chain === b.smartTarget?.chain;
    })(), 'two entry points, two different monitors');
  t('it stays notify-only', legacy.intent.executes === false && legacy.intent.action === 'NOTIFY');
  t('the Persian asset no longer dies as BAD_ASSET',
    smartMoneyAlertFromText(sentence, { verified, now: NOW })?.ok === true);

  /* And it refuses rather than describing a monitor wired to nothing. */
  t('without a verified index it says NEEDS_VERIFIED_CONTRACT, not a phantom intent',
    smartMoneyAlertFromText(sentence)?.code === 'NEEDS_VERIFIED_CONTRACT',
    JSON.stringify(smartMoneyAlertFromText(sentence)));
  t('buildSmartMoneyAlertIntent refuses a symbol with no observed evidence',
    buildSmartMoneyAlertIntent({ asset: 'ETH', verified, now: NOW }).ok === true
    && buildSmartMoneyAlertIntent({ asset: 'DOGE', verified, now: NOW }).ok === false,
    JSON.stringify(buildSmartMoneyAlertIntent({ asset: 'DOGE', verified, now: NOW })));
}

/* ═══ 6 · the tokens this feature exists for ═════════════════════════════ */
console.log('\n▸ naming the token the page is actually about');

{
  /* The live index on the day this was written held ONDO, AAVE, PEPE, PENDLE,
     ARB, LINK, UNI, LDO — the alt coins the Smart Money page exists to surface
     — and NONE of them is in the shared hint table, which only knows majors.
     A user naming one got NO_ASSET while that very contract sat under
     qualified-wallet observation. Resolution therefore falls back to the
     index, which is the better authority anyway: it is the list of contracts
     that can actually be alerted about. */
  const altIndex = { ...verified, consensus: [
    { ...verified.consensus[0], chain: 1, symbol: 'ONDO', token: '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3' },
    { ...verified.consensus[0], chain: 8453, symbol: 'AAVE', token: '0xb60e73ceac38ae8ff0a0cbb3bd63df3295820dd0' }
  ] };
  const got = parse('اگر اسمارت مانی AAVE را انباشت کرد خبر بده', { verified: altIndex });
  t('an alt coin the hint table has never heard of still resolves (AAVE)',
    got.monitor?.asset?.symbol === 'AAVE'
    && got.monitor.smartTarget.token === '0xb60e73ceac38ae8ff0a0cbb3bd63df3295820dd0',
    JSON.stringify(got.monitor?.asset));
  t('and the server accepts that draft too',
    !normalizeMonitor(got.monitor, { now: NOW }).error,
    JSON.stringify(normalizeMonitor(got.monitor, { now: NOW }).error));
  t('English ticker works the same way',
    parse('if smart money accumulates ONDO tell me', { verified: altIndex }).monitor?.asset?.symbol === 'ONDO');
  t('the instruction words are never mistaken for the asset',
    parse('if smart money accumulates ONDO tell me when whales buy', { verified: altIndex }).monitor
      ?.asset?.symbol === 'ONDO');
  t('a ticker the index does NOT carry is still refused',
    parse('if smart money accumulates DOGE tell me', { verified: altIndex }).error === 'NO_VERIFIED_CONTRACT');
  t('two index tickers in one sentence are ambiguous, not a guess',
    parse('smart money accumulates ONDO and AAVE tell me', { verified: altIndex }).error === 'AMBIGUOUS_CONTRACT',
    JSON.stringify(parse('smart money accumulates ONDO and AAVE tell me', { verified: altIndex })));
  t('the majors still resolve through the hint table (اتریوم → ETH → WETH row)',
    parse('اگر اسمارت مانی اتریوم را انباشت کرد خبر بده').monitor?.asset?.symbol === 'ETH');
  t('and the hint table still wins when both could match',
    parse('if smart money accumulates ETH tell me').monitor?.smartTarget?.token
      === '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
}

/* ═══ 7 · the notify-only contract ══════════════════════════════════════ */
console.log('\n▸ safety');

{
  const m = normalizeMonitor(parse('اگر اسمارت مانی اتریوم را انباشت کرد خبر بده').monitor, { now: NOW }).monitor;
  t('the monitor carries no execution, amount or signature — it is a watch',
    !('amount' in m) && !('executes' in m) && !('signature' in m) && m.metric.startsWith('SMART_MONEY_'),
    JSON.stringify(Object.keys(m)));
  t('it is scoped to one contract, not a whole symbol',
    m.smartTarget && /^0x[a-f0-9]{40}$/.test(m.smartTarget.token));
  t('the evidence it was built from is reported alongside it',
    parse('اگر اسمارت مانی اتریوم را انباشت کرد خبر بده').evidence?.independentBuyers === 5,
    JSON.stringify(parse('اگر اسمارت مانی اتریوم را انباشت کرد خبر بده').evidence));
  void USDC;
}

export default results;

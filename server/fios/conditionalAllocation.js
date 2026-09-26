/**
 * FBT FINANCIAL INTELLIGENCE OS — CROSS-ASSET CONDITIONAL ALLOCATION
 * (Phase 217): RWA / stocks / forex / commodities become AI-native.
 * ---------------------------------------------------------------------------
 * Phase 215 put the six traditional classes INTO the decision engine — they
 * could be discovered, scored and allocated. What they could still not do was
 * be the SUBJECT of an intent. «اگر طلا ۵٪ اصلاح کرد و BTC بالای X بود، ۱۰٪
 * سرمایه را به طلا اختصاص بده» is six understandings at once (asset, cross
 * asset, portfolio, risk, condition, allocation) and before this module the
 * AI managed one of them.
 *
 * THE CONTRACT
 *   understand   src/lib/intent-ai/conditionalIntent.js turns the sentence
 *                into a frame — pure, no network, no state
 *   read         server/crossAssetPrice.js prices every instrument the frame
 *                names, through the path its registry row declares
 *   decide       `evaluateConditions` compares each condition to its read.
 *                EVERY condition must be readable; one dead feed makes the
 *                whole evaluation UNREADABLE, because "gold is unreadable
 *                therefore let's assume it corrected" is not a decision
 *   allocate     `buildAllocationPlan` turns «۱۰٪ سرمایه» into dollars using
 *                the owner's REAL capital read. No capital read → NO_CAPITAL_READ,
 *                never a default portfolio size
 *   execute      gated by the SAME broker/off-ramp registry Phase 215 built.
 *                No configured provider → «این کلاس دارایی فقط تحلیل می‌شود،
 *                اجرا ندارد». A simulated fill does not exist in this module.
 *
 * WHAT IT NEVER DOES
 *   · never fires a condition it could not read;
 *   · never converts a percentage into dollars without a capital read;
 *   · never signs, submits, or claims a fill;
 *   · never invents a baseline — a PERCENT_CHANGE condition ARMS on its first
 *     read and compares from the second, exactly like the monitor engine.
 */

import { randomUUID } from 'node:crypto';
import { requireFlag } from './flags.js';
import { executionStatus, TRADITIONAL_CLASSES, ALL_CLASSES } from './traditionalAssets.js';
import { readCrossAssetPrices, canRead } from '../crossAssetPrice.js';
import {
  parseConditionalIntent,
  describeConditionalIntent,
  questionFor,
  CONDITIONAL_INTENT_SCHEMA
} from '../../src/lib/intent-ai/conditionalIntent.js';
import { instrumentFor, classOf } from '../../src/lib/intent-ai/crossAssetInstruments.js';

export const CONDITIONAL_ALLOCATION_SCHEMA = 'fbt.fi.conditional-allocation.v1';

/**
 * The rails. This is an ASSISTANT proposing an allocation, not a fiduciary,
 * so a single conditional instruction may not claim an unbounded share of the
 * portfolio. 40% is a guardrail, not a recommendation: hitting it does not
 * refuse the plan, it flags it and names the number, and the user decides.
 */
export const ALLOCATION_LIMITS = Object.freeze({
  MAX_SINGLE_ALLOCATION_PCT: 40,
  MIN_ALLOCATION_USD: 1,
  MAX_CONDITIONS: 6
});

const num = (v) => {
  /* null must stay null. `Number(null)` is 0, and an allocation whose
     `sizeUsd` is "not given" would then resolve to a zero-dollar plan
     instead of deriving the amount from the percentage — a silent wrong
     answer on real money rather than a loud one. */
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 2) => (v == null ? null : Number(Number(v).toFixed(d)));

/* ══════════════════ condition evaluation ═════════════════════════════════ */

/**
 * Apply one condition to one price read. Pure — the probe drives it directly.
 *
 * PRICE          value vs threshold, ABOVE/BELOW
 * PERCENT_CHANGE (value - baseline) / baseline × 100, compared to the
 *                threshold, which is NEGATIVE for a drawdown («۵٪ اصلاح» →
 *                -5). Needs a baseline: without one the condition ARMS on the
 *                current price and does not fire this pass.
 */
export function evaluateOneCondition(condition, read = null, { baseline = null } = {}) {
  const c = condition || {};
  const value = read?.ok ? num(read.value) : null;
  const out = {
    id: c.id || null,
    asset: c.asset,
    assetClass: c.assetClass,
    metric: c.metric,
    operator: c.operator,
    threshold: c.threshold,
    basis: c.basis,
    value,
    source: read?.ok ? read.source : null,
    at: read?.ok ? read.at : null,
    sample: null,
    hit: false,
    armed: false,
    ok: false,
    reason: null
  };
  if (!c.metric) { out.reason = 'CONDITION_UNSPECIFIED'; return out; }
  if (c.threshold == null) { out.reason = 'NO_THRESHOLD'; return out; }
  if (value == null || value <= 0) {
    out.reason = read?.code || 'NO_READ';
    return out;
  }
  if (c.metric === 'PERCENT_CHANGE') {
    const b = num(baseline);
    if (b == null || b <= 0) {
      /* ARM, never fire. A drawdown is measured from a baseline and we do not
         have one yet; inventing «yesterday's close» would be a fabricated
         trigger. The caller persists `value` as the baseline. */
      out.armed = true;
      out.sample = 0;
      return out;
    }
    out.sample = round(((value - b) / b) * 100, 4);
    out.hit = c.operator === 'ABOVE' ? out.sample >= c.threshold : out.sample <= c.threshold;
    out.ok = true;
    return out;
  }
  out.sample = round(value, 6);
  out.hit = c.operator === 'ABOVE' ? value >= c.threshold : value <= c.threshold;
  out.ok = true;
  return out;
}

/**
 * Combine the evaluations under the frame's logic.
 *
 * AND → every condition must hit. OR → any one is enough. Either way a single
 * UNREADABLE condition makes the whole thing UNREADABLE: a portfolio decision
 * built on a partial read is a guess wearing a number.
 */
export function combineEvaluations(evaluations = [], logic = 'AND') {
  const rows = Array.isArray(evaluations) ? evaluations : [];
  if (!rows.length) return { state: 'UNREADABLE', reason: 'NO_CONDITIONS', hit: false };
  const arming = rows.filter((r) => r.armed);
  if (arming.length) return { state: 'ARMING', reason: 'BASELINE_PENDING', hit: false, arming: arming.map((r) => r.id || r.asset) };
  const dead = rows.filter((r) => !r.ok);
  if (dead.length) {
    return {
      state: 'UNREADABLE',
      reason: dead[0].reason || 'NO_READ',
      hit: false,
      unreadable: dead.map((r) => ({ asset: r.asset, assetClass: r.assetClass, reason: r.reason, code: r.reason }))
    };
  }
  const hit = String(logic).toUpperCase() === 'OR'
    ? rows.some((r) => r.hit)
    : rows.every((r) => r.hit);
  return { state: hit ? 'TRIGGERED' : 'WAITING', reason: null, hit, metCount: rows.filter((r) => r.hit).length };
}

/* ══════════════════ the allocation ═══════════════════════════════════════ */

/**
 * «۱۰٪ سرمایه» → dollars, from the owner's real capital read.
 *
 * The one number this function will not produce is a capital figure. No read
 * → NO_CAPITAL_READ. A percentage of an unknown is not 10% of something, it
 * is an invitation to invent a portfolio.
 */
export function buildAllocationPlan(intent, { capitalUsd = null, reads = null, allowAboveRail = false, now = Date.now() } = {}) {
  const action = intent?.action || null;
  if (!action?.target?.symbol) {
    return { ok: false, code: 'NO_TARGET', detail: 'the instruction named no target asset to allocate into' };
  }
  const target = action.target;
  const inst = instrumentFor(target.symbol);
  if (!inst) return { ok: false, code: 'UNKNOWN_INSTRUMENT', detail: `${target.symbol} is not in the cross-asset registry` };

  const capital = num(capitalUsd);
  if (capital == null || capital <= 0) {
    return { ok: false, code: 'NO_CAPITAL_READ', detail: 'the allocation needs the owner\'s real capital from the portfolio read; nothing was modelled and nothing was guessed' };
  }

  let sizePct = num(action.sizePct);
  let sizeUsd = num(action.sizeUsd);
  let derivedFrom = null;
  if (sizeUsd != null && sizePct == null) {
    sizePct = round((sizeUsd / capital) * 100, 4);
    derivedFrom = 'AMOUNT';
  } else if (sizePct != null && sizeUsd == null) {
    sizeUsd = round((capital * sizePct) / 100, 2);
    derivedFrom = 'PORTFOLIO_PCT';
  } else if (sizePct != null && sizeUsd != null) {
    derivedFrom = 'BOTH_GIVEN';
  } else {
    return { ok: false, code: 'NO_SIZE', detail: 'the instruction named neither a percentage nor an amount' };
  }
  if (sizeUsd == null || sizeUsd <= 0) {
    return { ok: false, code: 'SIZE_NOT_POSITIVE', detail: 'the allocation resolved to zero or less' };
  }

  const execution = executionStatus(inst.assetClass);
  const warnings = [];
  const aboveRail = sizePct != null && sizePct > ALLOCATION_LIMITS.MAX_SINGLE_ALLOCATION_PCT;
  if (aboveRail) {
    warnings.push({
      code: 'ALLOCATION_ABOVE_RAIL',
      detail: `a single conditional instruction claiming ${sizePct}% of capital is above the ${ALLOCATION_LIMITS.MAX_SINGLE_ALLOCATION_PCT}% guardrail — staged for your explicit confirmation, not applied`,
      requiresExplicitConfirmation: true
    });
  }
  if (sizeUsd < ALLOCATION_LIMITS.MIN_ALLOCATION_USD) {
    return { ok: false, code: 'SIZE_BELOW_MINIMUM', detail: `the allocation resolved to $${sizeUsd}, below the $${ALLOCATION_LIMITS.MIN_ALLOCATION_USD} minimum` };
  }
  if (!execution.available) {
    warnings.push({
      code: execution.code || 'NO_EXECUTION_PROVIDER',
      detail: execution.note || execution.detail,
      requiresExplicitConfirmation: false
    });
  }
  if (intent?.portfolio?.assumed) {
    warnings.push({
      code: 'CAPITAL_SOURCE_ASSUMED',
      detail: 'the percentage was read against total capital because the instruction named no source — say «از پرتفوی» or «از استیبل‌ها» to pin it',
      requiresExplicitConfirmation: false
    });
  }

  const read = reads?.[target.symbol] || null;
  return {
    ok: true,
    schema: CONDITIONAL_ALLOCATION_SCHEMA,
    at: now,
    target: {
      symbol: inst.symbol,
      assetClass: inst.assetClass,
      name: inst.name || null,
      priceUsd: read?.ok ? read.value : null,
      priceSource: read?.ok ? read.source : null,
      priceAt: read?.ok ? read.at : null
    },
    action: action.kind,
    capitalUsd: round(capital, 2),
    sizePct: round(sizePct, 4),
    allocationUsd: round(sizeUsd, 2),
    derivedFrom,
    /* Units when a price could be read — a broker hands off in units far more
       often than in dollars, and `priceUsd` being null must not become 1. */
    units: read?.ok && read.value > 0 ? round(sizeUsd / read.value, 8) : null,
    execution,
    warnings,
    rail: {
      maxSingleAllocationPct: ALLOCATION_LIMITS.MAX_SINGLE_ALLOCATION_PCT,
      aboveRail,
      allowedAboveRail: allowAboveRail === true,
      /* The plan is proposed, never applied: the confirmation is the user's and
         the signature is the wallet's. Nothing here moves money. */
      requiresConfirmation: true,
      blockedByRail: aboveRail && allowAboveRail !== true
    },
    estimate: false,
    signs: false,
    submits: false,
    simulated: false
  };
}

/* ══════════════════ monitor bridge ═══════════════════════════════════════ */

/**
 * The frame → rows the monitor engine can store and watch.
 *
 * One row per condition is NOT enough: «اگر طلا اصلاح کرد و BTC بالای X بود»
 * that fired on either leg alone would allocate on a half-read instruction.
 * The primary row carries the first condition; the rest ride along on
 * `conditions[]` with a shared `conditionLogic`, so the monitor fires only
 * when the WHOLE instruction is true.
 */
export function monitorDraftFor(intent, { label = null, lang = 'fa' } = {}) {
  const conds = (intent?.conditions || []).slice(0, ALLOCATION_LIMITS.MAX_CONDITIONS);
  if (!conds.length) return { ok: false, code: 'NO_CONDITIONS', detail: 'nothing to watch' };
  const [first, ...rest] = conds;
  const action = intent?.action || null;
  const target = action?.target ? instrumentFor(action.target.symbol) : null;
  const labelText = label || describeConditionalIntent(intent, { lang });
  return {
    ok: true,
    monitor: {
      type: 'CROSS_ASSET_ALLOCATION',
      metric: first.metric === 'PERCENT_CHANGE' ? 'PERCENT_CHANGE' : 'PRICE',
      operator: first.operator === 'BELOW' ? 'BELOW' : 'ABOVE',
      threshold: first.metric === 'PERCENT_CHANGE' ? Math.abs(Number(first.threshold) || 0) : first.threshold,
      asset: { symbol: first.asset, assetClass: first.assetClass },
      conditions: rest.map((c) => ({
        id: c.id,
        metric: c.metric === 'PERCENT_CHANGE' ? 'PERCENT_CHANGE' : 'PRICE',
        operator: c.operator === 'BELOW' ? 'BELOW' : 'ABOVE',
        threshold: c.metric === 'PERCENT_CHANGE' ? Math.abs(Number(c.threshold) || 0) : c.threshold,
        asset: { symbol: c.asset, assetClass: c.assetClass },
        basis: c.basis
      })),
      conditionLogic: intent?.logic === 'OR' ? 'OR' : 'AND',
      label: String(labelText).slice(0, 120),
      goalText: String(intent?.text || '').slice(0, 240),
      intervalMinutes: 60,
      source: 'intent-os:cross-asset',
      allocation: target ? {
        symbol: target.symbol,
        assetClass: target.assetClass,
        sizePct: num(action?.sizePct),
        sizeUsd: num(action?.sizeUsd),
        kind: action?.kind || 'ALLOCATE',
        source: action?.source || null
      } : null
    }
  };
}

/* ══════════════════ the engine ═══════════════════════════════════════════ */

export function createConditionalAllocationEngine({ collections = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  /** Sentence → frame + the questions for whatever is missing. */
  function parse(owner, { text = '', lang = null } = {}) {
    const intent = parseConditionalIntent(text, { lang, now: now() });
    const refusal = requireFlag('CONDITIONAL_ALLOCATION_ENABLED');
    if (!refusal.ok) return { ok: false, code: refusal.code, flag: refusal.flag, intent: null };
    return {
      ok: true,
      schema: CONDITIONAL_INTENT_SCHEMA,
      intent,
      understood: intent.ok,
      summary: describeConditionalIntent(intent),
      questions: intent.missing.map((m) => ({ slot: m, question: questionFor(m, { lang: intent.lang }) })),
      classes: intent.classes,
      readable: intent.conditions.every((c) => canRead(c.asset)),
      unreadable: intent.conditions.filter((c) => !canRead(c.asset)).map((c) => c.asset)
    };
  }

  /**
   * Frame → decision. Reads every instrument the conditions name, evaluates,
   * and — when the whole instruction is true — builds the allocation plan.
   * Returns WAITING / ARMING / UNREADABLE / TRIGGERED; never a guess.
   */
  async function evaluate(owner, {
    intent = null,
    text = null,
    capitalUsd = null,
    financial = null,
    baselines = {},
    cryptoPrices = null,
    macroQuotes = null,
    globalSnapshot = null,
    allowAboveRail = false,
    correlationId = null
  } = {}) {
    const gate = requireFlag('CONDITIONAL_ALLOCATION_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };

    const frame = intent || (text ? parseConditionalIntent(text, { now: now() }) : null);
    if (!frame) return { ok: false, code: 'INTENT_REQUIRED', detail: 'pass intent (a parsed frame) or text' };
    if (!frame.conditions?.length) {
      return {
        ok: false, code: 'NO_CONDITIONS',
        detail: 'the instruction named no condition I can watch',
        questions: frame.missing.map((m) => ({ slot: m, question: questionFor(m, { lang: frame.lang }) })),
        intent: frame
      };
    }

    const symbols = [...new Set([
      ...frame.conditions.map((c) => c.asset),
      ...(frame.action?.target?.symbol ? [frame.action.target.symbol] : [])
    ])];
    const reads = await readCrossAssetPrices(symbols, {
      cryptoPrices, macroQuotes, globalSnapshot, now: now()
    });

    const evaluations = frame.conditions.map((c) => evaluateOneCondition(c, reads[c.asset] || null, { baseline: baselines?.[c.asset] ?? baselines?.[`${c.asset}:${c.metric}`] ?? null }));
    const combined = combineEvaluations(evaluations, frame.logic);

    /* New baselines to persist: an ARMED condition arms on the price we just
       read, so the next pass has something to measure against. */
    const newBaselines = {};
    for (const e of evaluations) if (e.armed && e.value != null) newBaselines[e.asset] = e.value;

    const record = {
      id: `cond_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      owner,
      at: now(),
      schema: CONDITIONAL_ALLOCATION_SCHEMA,
      correlationId: correlationId || null,
      intent: frame,
      reads: Object.fromEntries(Object.entries(reads).map(([k, v]) => [k, { ok: v.ok, value: v.value, source: v.source, at: v.at, code: v.code }])),
      evaluations,
      state: combined.state,
      reason: combined.reason || null,
      plan: null,
      simulated: false,
      signs: false,
      submits: false,
      executionPermission: false
    };

    if (combined.state === 'TRIGGERED' && frame.action?.target) {
      const capital = capitalUsd ?? num(financial?.net?.netWorthUsd) ?? num(financial?.computed?.netWorthUsd);
      const plan = buildAllocationPlan(frame, { capitalUsd: capital, reads, allowAboveRail, now: now() });
      record.plan = plan;
    }

    if (observability) {
      observability.emit({
        type: `conditional-allocation.${combined.state.toLowerCase()}`,
        owner,
        payload: { id: record.id, conditions: evaluations.length, reason: combined.reason }
      });
    }
    try { await collections?.put('conditional_allocations', owner, record, { idKey: 'id' }); } catch { /* the answer still stands */ }

    return {
      ok: true,
      schema: CONDITIONAL_ALLOCATION_SCHEMA,
      record,
      state: combined.state,
      reason: combined.reason,
      summary: describeConditionalIntent(frame),
      newBaselines,
      simulated: false,
      signs: false,
      executionPermission: false
    };
  }

  /** The allocation the instruction WOULD make, right now, regardless of the
   *  conditions — used by the chat to show «۱۰٪ سرمایه ≈ ۸۳۵ دلار» before the
   *  user commits to anything. */
  function planFor(owner, { intent = null, text = null, capitalUsd = null, financial = null, allowAboveRail = false } = {}) {
    const gate = requireFlag('CONDITIONAL_ALLOCATION_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const frame = intent || (text ? parseConditionalIntent(text, { now: now() }) : null);
    if (!frame) return { ok: false, code: 'INTENT_REQUIRED' };
    const capital = capitalUsd ?? num(financial?.net?.netWorthUsd) ?? num(financial?.computed?.netWorthUsd);
    return buildAllocationPlan(frame, { capitalUsd: capital, reads: null, allowAboveRail, now: now() });
  }

  /** The execution gate, verbatim from Phase 215: a configured broker hands
   *  off unsigned; anything else is «این کلاس دارایی فقط تحلیل می‌شود». */
  async function executeCheck(owner, { assetClass = null, instrument = null, amountUsd = null } = {}) {
    const gate = requireFlag('CONDITIONAL_ALLOCATION_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const key = String(assetClass || classOf(instrument) || '').toLowerCase();
    const status = executionStatus(key);
    return {
      ok: status.available,
      code: status.code || null,
      detail: status.note || status.detail,
      executionStatus: status,
      simulated: false,
      signs: false,
      executionPermission: false
    };
  }

  return {
    schema: CONDITIONAL_ALLOCATION_SCHEMA,
    parse,
    evaluate,
    planFor,
    executeCheck,
    monitorDraftFor,
    evaluateOneCondition,
    combineEvaluations,
    buildAllocationPlan,
    LIMITS: ALLOCATION_LIMITS,
    CLASSES: ALL_CLASSES,
    TRADITIONAL: TRADITIONAL_CLASSES
  };
}

/**
 * FBT INTENT AI — GUIDED STEP-BY-STEP CHAT FLOW
 * ---------------------------------------------------------------------------
 * Turns the "clarifications needed" dead-end into a friendly, one-question-
 * at-a-time conversation. The AI collects the missing pieces of an intent
 * (task, amount, goal, duration, network, tool permissions), confirms each
 * financial value with the user BEFORE moving on, enforces the product limits
 * from intentLimits.js at every answer, and finally assembles a deterministic
 * utterance that is re-parsed by the same auditable intentParser — so the
 * guided path and the direct path run through exactly one pipeline.
 *
 * The flow never grants permissions by itself: tool answers only decide which
 * capabilities are DECLINED for planning; financial execution still requires
 * the per-action authorization screen (Confirmation Gate).
 */

import { INTENT_LIMITS, MAX_GOAL_DURATION_HRS, usdValueOf, checkIntentLimits } from './intentLimits.js';

export const FLOW_SCHEMA = 'fbt.guided-flow.v1';

/** Flow steps (question codes). */
export const FLOW_STEPS = Object.freeze([
  'TASK', 'AMOUNT', 'CONFIRM_AMOUNT', 'GOAL', 'CONFIRM_GOAL', 'DURATION',
  'CONFIRM_DURATION', 'FROM', 'TO', 'NETWORK', 'TOOLS', 'EXECUTION_CONFIRMATION'
]);

/** Suggested chains for the network question — 12 major networks (≥ 10). */
export const FLOW_CHAIN_SUGGESTIONS = Object.freeze([
  { id: 42161, key: 'arbitrum' },
  { id: 1, key: 'ethereum' },
  { id: 8453, key: 'base' },
  { id: 56, key: 'bsc' },
  { id: 137, key: 'polygon' },
  { id: 10, key: 'optimism' },
  { id: 43114, key: 'avalanche' },
  { id: 59144, key: 'linea' },
  { id: 501, key: 'solana' },
  { id: 195, key: 'tron' },
  { id: 8757, key: 'ton' },
  { id: 146, key: 'sonic' }
].map(Object.freeze));

/** Suggested tasks when the requested action is unclear. */
export const FLOW_TASK_SUGGESTIONS = Object.freeze([
  { id: 'swap', key: 'swap' },
  { id: 'bridge', key: 'bridge' },
  { id: 'send', key: 'send' },
  { id: 'goal', key: 'goal' },
  { id: 'analyze', key: 'analyze' }
].map(Object.freeze));

/** Execution tools the user may permit or decline in the flow and on the
 *  interactive confirmation screen ("Which of these am I allowed to use?"). */
export const FLOW_TOOL_SUGGESTIONS = Object.freeze([
  { id: 'swap', key: 'swap' },
  { id: 'bridge', key: 'bridge' },
  { id: 'dca', key: 'dca' }
].map(Object.freeze));

/* ---------- answer interpretation ---------- */

const YES_WORDS = new Set([
  'بله', 'آره', 'آری', 'اوکی', 'اوکیه', 'حتما', 'صحیح', 'درسته', 'درست',
  'تایید', 'تأیید', 'میکنم', 'انجام', 'بزن', 'برو', 'اجازه', 'قابل', 'همه',
  'نعم', 'أوافق', 'موافق', 'حسنا',
  'yes', 'y', 'ok', 'okay', 'confirm', 'confirmed', 'approve', 'approved', 'sure', 'go', 'yeah', 'all'
]);
const NO_WORDS = new Set([
  'نه', 'خیر', 'نمیکنم', 'لغو', 'کنسل', 'رد', 'اشتباه', 'نپذیر', 'نخیر', 'هیچ',
  'لا', 'كلا', 'رفض', 'إلغاء', 'شيء',
  'no', 'n', 'cancel', 'stop', 'reject', 'declined', 'never', 'wrong', 'none'
]);

/** Persian/Arabic digit + punctuation normalisation shared by all parsers. */
export function normalizeAnswerText(raw) {
  let text = String(raw ?? '');
  const persian = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arabic = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  for (let i = 0; i < 10; i++) {
    text = text.split(persian[i]).join(String(i)).split(arabic[i]).join(String(i));
  }
  return text
    .replace(/[\u200c\u200f\u200e]/g, ' ')
    .replace(/[.,!?؛،:()[\]{}"'«»\-_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Detect an explicit yes / no answer. Returns true / false / null (unclear). */
export function detectYesNo(raw) {
  const tokens = normalizeAnswerText(raw).toLowerCase().split(' ').filter(Boolean);
  if (!tokens.length) return null;
  const yes = tokens.some((w) => YES_WORDS.has(w));
  const no = tokens.some((w) => NO_WORDS.has(w));
  if (yes && no) return null;
  if (yes) return true;
  if (no) return false;
  return null;
}

/** Parse a money answer: $2,000 · 2000 دلار · ۲۰۰۰ دلار · 2k · 2 هزار · 1.5 میلیون. */
export function parseAmountAnswer(raw) {
  // Merge thousand separators first ("2,000" / "2 000") so the main pattern
  // sees one number.
  const text = normalizeAnswerText(raw).replace(/(\d)[ ,](\d{3})/g, '$1$2');
  const m = text.match(/(\d+(?:\.\d+)?)\s*(k|هزار|میلیون|میلیارد|million|billion|m|bn|دلار|دولار|dollars?|usd)?/i);
  if (!m) return null;
  let value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const suffix = String(m[2] || '').toLowerCase();
  if (suffix === 'k' || suffix === 'هزار') value *= 1_000;
  else if (suffix === 'میلیون' || suffix === 'million' || suffix === 'm') value *= 1_000_000;
  else if (suffix === 'میلیارد' || suffix === 'billion' || suffix === 'bn') value *= 1_000_000_000;
  return Math.round(value * 100) / 100;
}

/** Parse a goal/target answer: 50% · ۵۰ درصد · 50 percent · plain 50. */
export function parseGoalAnswer(raw) {
  const text = normalizeAnswerText(raw);
  const m = text.match(/(\d+(?:\.\d+)?)\s*(%|درصد|percent|pct)?/i);
  if (!m) return null;
  const pct = Number(m[1]);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return Math.round(pct * 10) / 10;
}

/** Parse a duration answer: 30 روز · 4 ساعت · 2 هفته · 45 دقیقه · 30 days · plain = days. */
export function parseDurationAnswer(raw) {
  const text = normalizeAnswerText(raw).toLowerCase();
  // Persian/Arabic units first — no \b after them (these letters are not \w).
  let m = text.match(/(\d+(?:\.\d+)?)\s*(روز|روزه|هفته|ساعت|دقیقه|ماه|يوم|أيام|يومات|اسبوع|أسبوع|ساعة|دقيقة|شهر)/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    if (unit === 'روز' || unit === 'روزه' || unit === 'يوم' || unit === 'أيام' || unit === 'يومات') return n * 24;
    if (unit === 'هفته' || unit === 'اسبوع' || unit === 'أسبوع') return n * 24 * 7;
    if (unit === 'ساعت' || unit === 'ساعة') return n;
    if (unit === 'دقیقه' || unit === 'دقيقة') return Math.round((n / 60) * 100) / 100;
    return n * 24 * 30; // ماه / شهر
  }
  m = text.match(/(\d+(?:\.\d+)?)\s*(days?|weeks?|hours?|hrs?|minutes?|mins?|months?)(?![a-z])/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    if (unit.startsWith('day')) return n * 24;
    if (unit.startsWith('week')) return n * 24 * 7;
    if (unit.startsWith('hour') || unit.startsWith('hr')) return n;
    if (unit.startsWith('min')) return Math.round((n / 60) * 100) / 100;
    return n * 24 * 30; // month(s)
  }
  m = text.match(/(\d+(?:\.\d+)?)\s*(d|w|h)(?![a-z0-9])/);
  if (m) {
    const n = Number(m[1]);
    if (m[2] === 'd') return n * 24;
    if (m[2] === 'w') return n * 24 * 7;
    return n;
  }
  // Bare number in the duration question means days.
  m = text.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]) * 24;
  return null;
}

const TASK_KEYWORDS = [
  { task: 'swap', words: ['swap', 'exchange', 'convert', 'trade', 'تبدیل', 'مبادله', 'تعویض', 'مبادلة', 'تبديل'] },
  { task: 'bridge', words: ['bridge', 'پل', 'انتقال', 'جسر'] },
  { task: 'send', words: ['send', 'transfer', 'pay', 'ارسال', 'پرداخت', 'إرسال'] },
  { task: 'goal', words: ['goal', 'target', 'profit', 'هدف', 'هدفگذاری', 'سود', 'درآمد', 'ربح'] },
  { task: 'analyze', words: ['analyze', 'analysis', 'research', 'تحلیل', 'آنالیز', 'بررسی', 'تحليل'] }
];

/** Which task does the answer describe? Returns a task id or null. */
export function detectTaskAnswer(raw) {
  const text = normalizeAnswerText(raw).toLowerCase();
  for (const row of TASK_KEYWORDS) {
    if (row.words.some((w) => text.includes(w))) return row.task;
  }
  return null;
}

/** Which execution tools did the user permit? Answers like "بله", "فقط swap", "swap و bridge". */
export function detectToolsAnswer(raw) {
  const decision = detectYesNo(raw);
  if (decision === true) {
    const all = {};
    for (const tool of FLOW_TOOL_SUGGESTIONS) all[tool.id] = true;
    return all;
  }
  if (decision === false) {
    const none = {};
    for (const tool of FLOW_TOOL_SUGGESTIONS) none[tool.id] = false;
    return none;
  }
  const text = normalizeAnswerText(raw).toLowerCase();
  const tools = {};
  let any = false;
  if (/(swap|تبدیل|مبادله|تعویض|مبادلة)/.test(text)) { tools.swap = true; any = true; }
  if (/(bridge|پل|جسر)/.test(text)) { tools.bridge = true; any = true; }
  if (/(dca|پله|دستگاه|خرید پله ای|شراء متدرج)/.test(text)) { tools.dca = true; any = true; }
  if (!any) return null;
  for (const tool of FLOW_TOOL_SUGGESTIONS) if (!(tool.id in tools)) tools[tool.id] = false;
  return tools;
}

/* ---------- flow state machine ---------- */

const needsFrom = (task) => ['swap', 'bridge', 'send', 'goal'].includes(task);
const needsTo = (task) => ['swap', 'bridge', 'goal'].includes(task);

function nextStep(flow) {
  const c = flow.collected;
  if (flow.pendingConfirm) return flow.pendingConfirm;
  if (!c.task) return 'TASK';
  if (c.task === 'analyze') return c.tools ? null : 'TOOLS';
  if (c.amountUsd == null) return 'AMOUNT';
  if (c.task === 'goal') {
    if (c.goalPct == null) return 'GOAL';
    if (c.durationHrs == null) return 'DURATION';
  }
  if (needsFrom(c.task) && !c.fromSymbol) return 'FROM';
  if (needsTo(c.task) && !c.toSymbol) return 'TO';
  if (c.chainId == null) return 'NETWORK';
  if (!c.tools) return 'TOOLS';
  return null;
}

/**
 * Build a guided flow from a parsed (incomplete) intent. Everything already
 * present in the intent is kept — only the missing pieces are asked about.
 * `explicitChain` marks a chain the user named themselves: a chain that only
 * came from the session default is still asked about, because the network is
 * one of the flow's confirmation questions.
 */
export function createFlowFromParsed(parsed, { chainDetector, tokenNormalizer, explicitChain = false } = {}) {
  const intent = parsed?.intent || {};
  const flow = {
    schema: FLOW_SCHEMA,
    active: true,
    step: null,
    pendingConfirm: null,
    kind: intent.action && intent.action !== 'analyze' ? intent.kind : null,
    collected: {
      task: intent.action && intent.action !== 'analyze' ? normalizeTask(intent.action, intent.kind) : null,
      amountUsd: usdValueOf(intent),
      goalPct: Number.isFinite(Number(intent.goalPct)) && Number(intent.goalPct) > 0 ? Number(intent.goalPct) : null,
      durationHrs: Number.isFinite(Number(intent.durationHrs)) && Number(intent.durationHrs) > 0 ? Number(intent.durationHrs) : null,
      fromSymbol: intent.fromSymbol || null,
      toSymbol: intent.toSymbol || null,
      chainId: explicitChain ? (intent.chainId ?? null) : null,
      tools: null
    },
    asked: [],
    startedAt: Date.now(),
    chainDetector,
    tokenNormalizer
  };
  // A goal flavour without a percentage still asks for the goal first.
  if (flow.collected.task === 'swap' && /سود|هدف|profit|target/i.test(String(parsed?.raw || ''))) {
    flow.collected.task = 'goal';
  }
  flow.step = nextStep(flow);
  return flow;
}

function normalizeTask(action, kind) {
  if (kind === 'goal') return 'goal';
  if (action === 'buy' || action === 'sell' || action === 'swap') return 'swap';
  if (action === 'bridge') return 'bridge';
  if (action === 'send') return 'send';
  if (action === 'analyze') return 'analyze';
  return kind || 'swap';
}

/** Everything the UI needs to render the current question. */
export function flowQuestionPayload(flow) {
  if (!flow || !flow.active) return null;
  return {
    step: flow.step,
    pendingConfirm: flow.pendingConfirm || null,
    collected: { ...flow.collected },
    suggestions: suggestionsForStep(flow.step),
    schema: FLOW_SCHEMA
  };
}

function suggestionsForStep(step) {
  switch (step) {
    case 'TASK': return FLOW_TASK_SUGGESTIONS;
    case 'NETWORK': return FLOW_CHAIN_SUGGESTIONS;
    case 'TOOLS': return FLOW_TOOL_SUGGESTIONS;
    case 'AMOUNT': return [100, 500, 1000, 5000].map((v) => ({ value: v }));
    case 'GOAL': return [10, 20, 30, 60].map((v) => ({ value: v }));
    case 'DURATION': return [{ value: 24 }, { value: 168 }, { value: 720 }];
    case 'FROM': return [{ id: 'USDT' }, { id: 'USDC' }];
    case 'TO': return [{ id: 'ETH' }, { id: 'BTC' }];
    default: return [];
  }
}

/**
 * Apply one user answer to the flow.
 *
 * @returns {{
 *   ok: boolean,
 *   flow: object,
 *   done?: boolean,
 *   utterance?: string,
 *   violations?: Array,
 *   error?: 'NOT_UNDERSTOOD'|'NOT_YES_NO'|'BAD_VALUE'
 * }}
 */
export function applyFlowAnswer(flow, rawText, ctx = {}) {
  const next = {
    ...flow,
    collected: { ...flow.collected },
    asked: [...(flow.asked || [])]
  };
  const text = String(rawText ?? '');

  const overLimit = (value, field) => checkIntentLimits({ ...next.collected, [field]: value, kind: next.collected.task }).length > 0;

  const advance = () => {
    next.step = nextStep(next);
    if (next.step) next.asked.push(next.step);
    return { ok: true, flow: next, done: next.step === null, utterance: next.step === null ? assembleUtterance(next) : undefined };
  };

  switch (flow.step) {
    case 'TASK': {
      const task = detectTaskAnswer(text);
      if (!task) return { ok: false, flow: next, error: 'NOT_UNDERSTOOD' };
      next.collected.task = task;
      return advance();
    }
    case 'AMOUNT': {
      const value = parseAmountAnswer(text);
      if (value == null) return { ok: false, flow: next, error: 'NOT_UNDERSTOOD' };
      if (overLimit(value, 'amountUsd')) {
        return {
          ok: false,
          flow: next,
          error: 'OVER_LIMIT',
          violations: checkIntentLimits({ ...next.collected, amountUsd: value, kind: next.collected.task })
        };
      }
      next.collected.amountUsd = value;
      next.pendingConfirm = 'CONFIRM_AMOUNT';
      next.step = 'CONFIRM_AMOUNT';
      return { ok: true, flow: next };
    }
    case 'CONFIRM_AMOUNT': {
      const decision = detectYesNo(text);
      const replacement = parseAmountAnswer(text);
      if (decision === null && replacement != null && replacement !== next.collected.amountUsd) {
        if (overLimit(replacement, 'amountUsd')) {
          return { ok: false, flow: next, error: 'OVER_LIMIT', violations: checkIntentLimits({ ...next.collected, amountUsd: replacement, kind: next.collected.task }) };
        }
        next.collected.amountUsd = replacement;
        return { ok: true, flow: next }; // re-confirm the new value
      }
      if (decision === null) return { ok: false, flow: next, error: 'NOT_YES_NO' };
      if (decision) {
        next.pendingConfirm = null;
        return advance();
      }
      next.collected.amountUsd = null;
      next.pendingConfirm = null;
      next.step = 'AMOUNT';
      return { ok: true, flow: next };
    }
    case 'GOAL': {
      const pct = parseGoalAnswer(text);
      if (pct == null) return { ok: false, flow: next, error: 'NOT_UNDERSTOOD' };
      if (overLimit(pct, 'goalPct')) {
        return { ok: false, flow: next, error: 'OVER_LIMIT', violations: checkIntentLimits({ ...next.collected, goalPct: pct, kind: next.collected.task }) };
      }
      next.collected.goalPct = pct;
      next.pendingConfirm = 'CONFIRM_GOAL';
      next.step = 'CONFIRM_GOAL';
      return { ok: true, flow: next };
    }
    case 'CONFIRM_GOAL': {
      const decision = detectYesNo(text);
      const replacement = parseGoalAnswer(text);
      if (decision === null && replacement != null && replacement !== next.collected.goalPct) {
        if (overLimit(replacement, 'goalPct')) {
          return { ok: false, flow: next, error: 'OVER_LIMIT', violations: checkIntentLimits({ ...next.collected, goalPct: replacement, kind: next.collected.task }) };
        }
        next.collected.goalPct = replacement;
        return { ok: true, flow: next };
      }
      if (decision === null) return { ok: false, flow: next, error: 'NOT_YES_NO' };
      if (decision) {
        next.pendingConfirm = null;
        return advance();
      }
      next.collected.goalPct = null;
      next.pendingConfirm = null;
      next.step = 'GOAL';
      return { ok: true, flow: next };
    }
    case 'DURATION': {
      const hrs = parseDurationAnswer(text);
      if (hrs == null) return { ok: false, flow: next, error: 'NOT_UNDERSTOOD' };
      if (overLimit(hrs, 'durationHrs')) {
        return { ok: false, flow: next, error: 'OVER_LIMIT', violations: checkIntentLimits({ ...next.collected, durationHrs: hrs, kind: next.collected.task }) };
      }
      next.collected.durationHrs = hrs;
      next.pendingConfirm = 'CONFIRM_DURATION';
      next.step = 'CONFIRM_DURATION';
      return { ok: true, flow: next };
    }
    case 'CONFIRM_DURATION': {
      const decision = detectYesNo(text);
      const replacement = parseDurationAnswer(text);
      if (decision === null && replacement != null && replacement !== next.collected.durationHrs) {
        if (overLimit(replacement, 'durationHrs')) {
          return { ok: false, flow: next, error: 'OVER_LIMIT', violations: checkIntentLimits({ ...next.collected, durationHrs: replacement, kind: next.collected.task }) };
        }
        next.collected.durationHrs = replacement;
        return { ok: true, flow: next };
      }
      if (decision === null) return { ok: false, flow: next, error: 'NOT_YES_NO' };
      if (decision) {
        next.pendingConfirm = null;
        return advance();
      }
      next.collected.durationHrs = null;
      next.pendingConfirm = null;
      next.step = 'DURATION';
      return { ok: true, flow: next };
    }
    case 'FROM':
    case 'TO': {
      const token = ctx.tokenNormalizer ? ctx.tokenNormalizer(text) : fallbackToken(text);
      if (!token) return { ok: false, flow: next, error: 'NOT_UNDERSTOOD' };
      if (flow.step === 'FROM') next.collected.fromSymbol = token;
      else next.collected.toSymbol = token;
      return advance();
    }
    case 'NETWORK': {
      const chainId = ctx.chainDetector ? ctx.chainDetector(text) : null;
      const numeric = Number(normalizeAnswerText(text));
      const id = chainId ?? (FLOW_CHAIN_SUGGESTIONS.some((c) => c.id === numeric) ? numeric : null);
      if (id == null) return { ok: false, flow: next, error: 'NOT_UNDERSTOOD' };
      next.collected.chainId = id;
      return advance();
    }
    case 'TOOLS': {
      const tools = detectToolsAnswer(text);
      if (!tools) return { ok: false, flow: next, error: 'NOT_UNDERSTOOD' };
      next.collected.tools = tools;
      return advance();
    }
    default:
      return { ok: false, flow: next, error: 'NOT_UNDERSTOOD' };
  }
}

function fallbackToken(text) {
  const m = normalizeAnswerText(text).toUpperCase().match(/\b([A-Z0-9]{2,12})\b/);
  return m ? m[1] : null;
}

/** Map chain id → an English alias the deterministic parser understands. */
const CHAIN_UTTERANCE = new Map([
  [42161, 'arbitrum'], [1, 'ethereum'], [8453, 'base'], [56, 'bsc'], [137, 'polygon'],
  [10, 'optimism'], [43114, 'avalanche'], [59144, 'linea'], [501, 'solana'],
  [195, 'tron'], [8757, 'ton'], [146, 'sonic']
]);

/**
 * Assemble the deterministic utterance the pipeline re-parses. Both the
 * guided path and the direct path therefore share one auditable parser.
 */
export function assembleUtterance(flow) {
  const c = flow.collected || {};
  const chain = CHAIN_UTTERANCE.get(c.chainId);
  const amount = c.amountUsd ?? 0;
  const from = c.fromSymbol || 'USDT';
  const onChain = chain ? ` on ${chain}` : '';
  switch (c.task) {
    case 'goal': {
      const parts = [`goal ${c.goalPct ?? 10}% profit on ${amount} ${from}`];
      if (c.toSymbol) parts.push(`to ${c.toSymbol}`);
      if (chain) parts.push(`on ${chain}`);
      if (c.durationHrs) parts.push(`in ${c.durationHrs} hours`);
      return parts.join(' ');
    }
    case 'swap':
      return `swap ${amount} ${from} to ${c.toSymbol || 'ETH'}${onChain}`;
    case 'bridge':
      return `bridge ${amount} ${from} to ${c.toSymbol || 'ETH'}${onChain}`;
    case 'send':
      return `send ${amount} ${from}${onChain}`;
    case 'analyze':
      return `analyze ${from}`;
    default:
      return String(c.task || '');
  }
}

/** Tools the user did NOT permit → declinedCapabilities for planning. */
export function declinedFromTools(tools) {
  if (!tools || typeof tools !== 'object') return [];
  return Object.entries(tools).filter(([, allowed]) => allowed !== true).map(([id]) => id);
}

export { INTENT_LIMITS, MAX_GOAL_DURATION_HRS };

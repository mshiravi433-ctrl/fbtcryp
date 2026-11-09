/**
 * SITUATION READ — the person's money and the person's mood, read together.
 * ---------------------------------------------------------------------------
 * The emotion layer (§۵٫۲۲) reads the message; the market frame (§۵٫۲۰) reads
 * the tape. Neither knows the one fact that changes the answer most: the
 * user's own portfolio is down 18% and they are panicking, or up 30% and
 * euphoric. Those are opposite conversations:
 *
 *   down 18%, acute      → acknowledge, no plan, no averaging down, no
 *                          «جبران میشه», one small non-trading step
 *   up 30%, euphoric     → confirm the number once, say it is unrealized, and
 *                          ask how much they are willing to give back
 *   up 30%, anxious      → the fear is legitimate: giving-back risk vs upside
 *   down 6%, calm        → facts and options with tradeoffs, no lecture
 *   no P&L in the turn   → UNKNOWN: never say they are up or down, never
 *                          congratulate or console about money
 *
 * So this module joins `context.portfolio` (aggregate only) with the emotion
 * and social reads into one deterministic situation: direction, magnitude,
 * basis (realized/unrealized/day-move), concentration, and the stance the
 * answer owes. `checkSituationResponse` then catches the answer that
 * celebrates a loss, pushes risk into panic, feeds euphoria, promises a
 * recovery, invents a P&L figure, or ignores the portfolio entirely.
 *
 * Smartest mode, level 2+. balanced/swift keep the prompt they always had.
 */

export const SITUATION_SCHEMA = 'fbt.ai-situation.v1';
export const SITUATION_VERSION = '1.0.0';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/* ── emotional vocabulary, mirrored from the emotion layer so this module can
      stand alone (tests and other callers may pass a bare emotion object) ──── */

const ACUTE_PRIMARY = ['fear', 'grief', 'shame', 'anger', 'loneliness', 'burnout'];

const CELEBRATE = [
  'تبریک', 'مبارک', 'عالیه', 'عالی بود', 'چه سودی', 'سود خوبی', 'خوش به حالت', 'دستت درد نکنه',
  'congratulations', 'congrats', 'great job', 'nice profit', 'well done', 'you nailed'
];

const RISK_ADD = [
  'میانگین کم', 'میانگین‌گیری', 'میانگین گیری', 'اضافه کن', 'بیشتر بخر', 'دو برابر', 'اهرم', 'لوریج',
  'همه رو بزن', 'همه را بزن', 'همه‌چیو بزن', 'پوزیشن سنگین', 'قرض بگیر', 'وام بگیر',
  'average down', 'double down', 'add more', 'leverage', 'all in', 'borrow', 'go bigger'
];

const RECOVERY_PROMISE = [
  'جبران میشه', 'جبران بشه', 'جبران می‌شود', 'جبران خواهد شد', 'حتماً برمی‌گرده', 'حتما برمیگردد', 'برمی‌گرده', 'قیمت برمی‌گردد',
  'از دست نمی‌ره', 'از دست نمی‌رود', 'بیخودی نگرانی', 'it will recover', 'it will come back', 'guaranteed'
];

const GUARANTEE = [
  'تضمینی', 'تضمین', 'قطعاً سود', 'حتماً میره بالا', 'صد در صد', 'بدون ریسک',
  'guaranteed', 'sure thing', 'risk free', 'risk-free', 'can only go up'
];

const NO_DATA_MARKERS = [
  'سبد', 'پورتفوی', 'پورتفولیو', 'موجودی', 'داده‌ای از سبد', 'داده‌ای از موجودی',
  'portfolio', 'holdings', 'no data', 'cannot see your'
];

const PNL_CLAIM_RE = /(?:(?:سود|ضرر|افت|رشد)\s*(?:حدود\s*)?(\d+(?:\.\d+)?)\s*(?:درصد|٪|%)?|(\d+(?:\.\d+)?)\s*(?:درصد|٪|%)\s*(?:سود|ضرر|بالا|پایین))/iu;
const IS_UP_WORDS = ['در سود هستی', 'در سود هستید', 'تو سودی', 'در سودی', 'سود کردی', 'سود کرده‌ای', 'سود خوبی کردی', 'سود خوبی کرده‌ای', 'بالا رفتی', 'پرسودی', 'سودکاری'];
const IS_DOWN_WORDS = ['در ضرر هستی', 'در ضرر هستید', 'تو ضرری', 'در ضرری', 'ضرر کردی', 'ضرر کرده‌ای', 'ضرر خوبی کردی', 'پایین آمدی', 'در زیان هستی', 'زیان کردی'];
const IS_UP_EN = /you(?:'re|\s+are)\s+(?:in\s+)?(?:profit|up)|you\s+made\s+money|you\s+are\s+up/iu;
const IS_DOWN_EN = /you(?:'re|\s+are)\s+(?:in\s+)?(?:loss|down)|you\s+lost\s+money/iu;

/** Persian/Arabic digits → ASCII so «۲۰٪» can be read as a number. */
function toAscii(value = '') {
  return String(value)
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/*
 * Persian attaches grammar as a suffix («سبدت», «تبریکت»), so a strict trailing
 * boundary misses the very word we are looking for. Terms of 4+ Persian letters
 * match as a prefix; shorter ones stay strict so «سود» does not fire inside a
 * longer word by accident.
 */
function has(text, term) {
  const t = String(term);
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s\u200c]*');
  const persianLetters = t.replace(/[^\u0600-\u06FF]/g, '').length;
  const tail = persianLetters >= 4 ? '' : '(?![\\p{L}])';
  return new RegExp(`(?<![\\p{L}])${escaped}${tail}`, 'iu').test(String(text || ''));
}

function anyHas(text, list) {
  return list.some((term) => has(text, term));
}

/* ── the read ─────────────────────────────────────────────────────────────── */

function readPortfolio(context = {}) {
  const p = context?.portfolio || {};
  const totalUsd = num(p.totalValueUsd);
  const pnlUsd = num(p.pnlUsd ?? p.unrealizedPnlUsd);
  const costBasisUsd = num(p.costBasisUsd);
  let pnlPct = num(p.pnlPct ?? p.unrealizedPnlPct);
  if (pnlPct == null && pnlUsd != null && costBasisUsd > 0) pnlPct = (pnlUsd / costBasisUsd) * 100;
  const dayPct = num(p.change24hPct);
  const realizedPnlUsd = num(p.realizedPnlUsd);

  const holdings = Array.isArray(p.holdings) ? p.holdings.filter((h) => h && num(h.valueUsd) != null) : [];
  const weights = totalUsd > 0
    ? holdings.map((h) => ({ symbol: String(h.symbol || '?').toUpperCase(), weightPct: (num(h.valueUsd) / totalUsd) * 100 }))
    : [];
  const top = weights.slice().sort((a, b) => b.weightPct - a.weightPct)[0] || null;
  const hhi = weights.reduce((s, w) => s + (w.weightPct / 100) ** 2, 0);

  const basis = pnlPct != null ? 'pnl' : dayPct != null ? 'day_change' : 'none';
  const pct = pnlPct != null ? pnlPct : dayPct != null ? dayPct : null;

  return {
    dataStatus: String(p.dataStatus || (totalUsd != null ? 'client' : 'unavailable')),
    hasRead: totalUsd != null,
    totalUsd,
    pnlUsd,
    pnlPct: round(pnlPct, 2),
    realizedPnlUsd,
    dayPct: round(dayPct, 2),
    basis,
    pct: round(pct, 2),
    concentration: top
      ? { symbol: top.symbol, weightPct: round(top.weightPct, 1), hhi: round(hhi, 3), holdings: weights.length }
      : null,
    cashPct: totalUsd > 0 && num(p.cashUsd) != null ? round((num(p.cashUsd) / totalUsd) * 100, 1) : null
  };
}

/**
 * Join the portfolio with the mood and produce the stance for this answer.
 *
 * `emotion` is a read from `aiEmotionRead` (or a compatible object). Without
 * it, the situation is still computed — a loss is a loss even from a calm
 * message — but the state stays on the calm branch.
 */
export function readSituation({ context = {}, emotion = null, social = null, message = '', locale = 'fa' } = {}) {
  const p = readPortfolio(context);
  const primary = emotion?.primary || 'neutral';
  const intensity = Number(emotion?.intensity) || 0;
  const acute = emotion?.acute === true || (ACUTE_PRIMARY.includes(primary) && intensity >= 0.55);
  const pct = p.pct;
  const magnitude = pct == null ? null : Math.abs(pct);

  let direction = 'unknown';
  if (pct != null) direction = pct > 0.5 ? 'gain' : pct < -0.5 ? 'loss' : 'flat';

  /* The user says they lost money and the turn carries no P&L: their statement
     is the only fact, and it must be treated as one — not measured, not
     contradicted. */
  const claimsLoss = anyHas(message, ['ضرر کردم', 'پول از دست دادم', 'همه پولمو از دست دادم', 'از دست دادم', 'i lost money', 'i am down']);
  const claimsGain = anyHas(message, ['سود کردم', 'سود خوبی', 'i made money', 'i am up']);
  if (pct == null) direction = claimsLoss ? 'loss_unverified' : claimsGain ? 'gain_unverified' : 'unknown';

  const excited = ['joy', 'hope'].includes(primary) && intensity >= 0.45;
  const worried = ACUTE_PRIMARY.includes(primary) && ['fear', 'grief', 'burnout'].includes(primary) && intensity >= 0.35;

  let state = 'unknown';
  if (direction === 'loss_unverified') {
    state = 'loss_unverified';
  } else if (direction === 'gain_unverified') {
    state = 'gain_unverified';
  } else if (direction === 'loss') {
    state = (acute && (magnitude >= 10 || p.basis === 'day_change')) ? 'loss_panic'
      : intensity >= 0.35 ? 'loss_upset'
        : 'loss_calm';
  } else if (direction === 'gain') {
    state = excited ? 'gain_euphoric' : worried ? 'gain_worried' : 'gain_calm';
  } else if (direction === 'flat') {
    state = 'flat';
  }

  const numbers = [];
  if (p.totalUsd != null) numbers.push(`total $${Math.round(p.totalUsd)}`);
  const money = (v) => (v < 0 ? `-$${Math.abs(Math.round(v))}` : `$${Math.round(v)}`);
  if (p.pnlPct != null) numbers.push(`unrealized ${p.pnlPct > 0 ? '+' : ''}${p.pnlPct}%${p.pnlUsd != null ? ` (${money(p.pnlUsd)})` : ''}`);
  if (p.pnlPct == null && p.dayPct != null) numbers.push(`today ${p.dayPct > 0 ? '+' : ''}${p.dayPct}%`);
  if (p.realizedPnlUsd != null) numbers.push(`realized ${money(p.realizedPnlUsd)}`);
  if (p.concentration) numbers.push(`top ${p.concentration.symbol} ${p.concentration.weightPct}% of ${p.concentration.holdings} holding(s)`);

  return {
    schema: SITUATION_SCHEMA,
    version: SITUATION_VERSION,
    locale,
    dataStatus: p.dataStatus,
    hasRead: p.hasRead,
    basis: p.basis,
    direction: p.basis === 'none' && (claimsLoss || claimsGain) ? (claimsLoss ? 'loss_unverified' : 'gain_unverified') : direction,
    pct,
    magnitudePct: magnitude,
    pnlUsd: p.pnlUsd,
    realizedPnlUsd: p.realizedPnlUsd,
    concentration: p.concentration,
    cashPct: p.cashPct,
    state,
    emotion: { primary, intensity, acute },
    claims: { loss: claimsLoss, gain: claimsGain },
    numbers,
    /* Only numbers the answer is allowed to state as the user's P&L. */
    allowedPcts: [...new Set([p.pnlPct, p.dayPct, magnitude].filter((v) => v != null).map((v) => String(Number(v))))]
  };
}

/* ── obligations ──────────────────────────────────────────────────────────── */

const STANCE = {
  loss_panic: [
    'they are down and in an acute emotional state. Acknowledge it in ONE short sentence, then stop and let the answer breathe.',
    'do NOT propose a plan, do NOT suggest averaging down, adding, leveraging or borrowing. Decisions taken in panic are the ones people regret.',
    'state the loss number ONCE, plainly, with the basis (today\'s move vs unrealized); do not soften it and do not dramatise it.',
    'name the one thing in their control right now, and it must not be a trade.'
  ],
  loss_upset: [
    'they are down and upset. Acknowledge once, then give the facts and at most two options, each with its tradeoff.',
    'no advice to add risk; no «جبران میشه»; no lecture about what they should have done.'
  ],
  loss_calm: [
    'they are down but calm. Give the numbers, then options with tradeoffs — this is a decision conversation, not a consolation.',
    'no false recovery promise and no moralising; they did not ask to be scolded.'
  ],
  gain_euphoric: [
    'they are up and excited. Confirm the gain ONCE with the number, then say clearly what is unrealized and what is not.',
    'do not encourage leverage, all-in, doubling down or borrowing. Ask one concrete question: how much of this are they willing to give back?',
    'do not pour cold water on it either — one caveat, said plainly, is enough.'
  ],
  gain_worried: [
    'they are up but anxious about giving it back. Treat that fear as legitimate: it is a real tradeoff, not a mood to be fixed.',
    'talk about giving-back risk versus staying exposed, with numbers; never say «چیزی برای نگرانی نیست».'
  ],
  gain_calm: [
    'they are up and calm. Confirm with the number, mention that it is unrealized, and give one de-risking consideration.',
    'no champagne, no disclaimers wall.'
  ],
  flat: [
    'the portfolio is roughly flat on this basis. Do not invent a trend in either direction.'
  ],
  loss_unverified: [
    'they told you they lost money and this turn has no portfolio read. That statement is the fact to respect, not a number to compute.',
    'acknowledge it once, do not console with money claims, and do not advise adding risk. If a measured answer is needed, ask for the portfolio read.'
  ],
  gain_unverified: [
    'they told you they are in profit and this turn has no portfolio read. Do not confirm a figure you do not have; ask for the read or answer the question asked.'
  ],
  unknown: []
};

/**
 * The situation as a prompt block. '' when there is no portfolio read and no
 * emotional situation to respect — an ordinary question keeps its prompt.
 */
export function renderSituationContract(situation) {
  if (!situation || situation.schema !== SITUATION_SCHEMA) return '';
  const meaningful = situation.hasRead
    || ['loss_panic', 'loss_upset', 'gain_euphoric', 'gain_worried', 'loss_unverified', 'gain_unverified'].includes(situation.state);
  if (!meaningful) return '';

  const lines = ['SITUATION (their money and their mood, read together):'];
  if (situation.numbers.length) lines.push(`- measured this turn: ${situation.numbers.join('; ')}.`);

  if (situation.basis === 'day_change') {
    lines.push('- the figure above is TODAY\'S move of the portfolio, not their profit or loss since buying. Do not call it profit or loss.');
  } else if (situation.basis === 'pnl') {
    lines.push('- the figure above is unrealized profit/loss against cost basis unless stated otherwise. Unrealized is not money in hand.');
  }

  if (situation.concentration && situation.concentration.weightPct >= 50) {
    lines.push(`- concentration: ${situation.concentration.symbol} is ${situation.concentration.weightPct}% of the portfolio. If it changes the answer, say so with the number.`);
  }
  if (situation.cashPct != null) {
    lines.push(`- cash is ${situation.cashPct}% of the portfolio.`);
  }

  for (const rule of STANCE[situation.state] || []) lines.push(`- ${rule}`);

  if (situation.basis === 'none') {
    lines.push('- there is NO portfolio P&L in this turn. Never say the user is up or down, never congratulate or console about money, and never state a profit/loss figure. If they say they lost, that is their statement — answer it as a statement.');
  }

  lines.push('- use only the numbers in this block for their money; do not compute or remember a different figure.');
  return lines.join('\n');
}

/* ── compliance ───────────────────────────────────────────────────────────── */

/**
 * Did the answer respect the money situation?
 *
 * Every check fires on its own trigger only; a calm, data-backed answer that
 * simply discusses the market is never flagged.
 */
export function checkSituationResponse({ situation = null, answer = '' } = {}) {
  const text = String(answer || '');
  const issues = [];
  if (!situation || situation.schema !== SITUATION_SCHEMA || !text.trim()) {
    return { schema: SITUATION_SCHEMA, applicable: false, issues, compliant: true };
  }
  const isLoss = situation.direction === 'loss' || situation.direction === 'loss_unverified' || situation.state.startsWith('loss');
  const isGain = situation.direction === 'gain' || situation.direction === 'gain_unverified' || situation.state.startsWith('gain');


  /* 1. Congratulating a loss. */
  if (isLoss && anyHas(text, CELEBRATE)) {
    issues.push({
      id: 'CELEBRATING_A_LOSS',
      severity: 'HIGH',
      detail: 'the answer congratulates a user whose portfolio is down. Remove the celebration; acknowledge the loss and answer the question.'
    });
  }

  /* 2. Feeding risk into a loss. */
  if (isLoss && anyHas(text, RISK_ADD)) {
    issues.push({
      id: 'PUSHING_RISK_AFTER_LOSS',
      severity: 'HIGH',
      detail: 'the answer pushes the user to add risk (averaging down, leverage, borrowing, doubling) after a loss. Do not; that is the decision people regret most in this state.'
    });
  }

  /* 3. Feeding euphoria. */
  if (situation.state === 'gain_euphoric' && (anyHas(text, RISK_ADD) || anyHas(text, GUARANTEE))) {
    issues.push({
      id: 'FEEDING_EUPHORIA',
      severity: 'HIGH',
      detail: 'the user is up and excited and the answer encourages more risk or promises it continues. Confirm the gain, say what is unrealized, and ask one question about giving it back.'
    });
  }

  /* 4. A recovery promise after a loss. */
  if (isLoss && anyHas(text, RECOVERY_PROMISE)) {
    issues.push({
      id: 'FALSE_RECOVERY_PROMISE',
      severity: 'MEDIUM',
      detail: 'the answer promises the loss will be recovered. Nobody knows that; say what would have to be true instead.'
    });
  }

  /* 5. A P&L figure the turn does not contain. */
  if (situation.hasRead && situation.allowedPcts.length) {
    const allowed = new Set(situation.allowedPcts);
    for (const hit of toAscii(text).matchAll(new RegExp(PNL_CLAIM_RE.source, 'giu'))) {
      const value = hit[1] || hit[2];
      if (value != null && !allowed.has(String(Number(value)))) {
        issues.push({
          id: 'INVENTED_PNL',
          severity: 'HIGH',
          detail: `the answer states ${value}% as the user's profit/loss, which is not in this turn's numbers (${situation.allowedPcts.join(', ')}%). Use the measured figure or none.`
        });
        break;
      }
    }
  }

  /* 6. Telling someone they are up or down with no P&L in the turn. */
  if (situation.basis === 'none') {
    if (anyHas(text, IS_UP_WORDS) || anyHas(text, IS_DOWN_WORDS) || IS_UP_EN.test(text) || IS_DOWN_EN.test(text)) {
      issues.push({
        id: 'PROFIT_CLAIM_WITHOUT_DATA',
        severity: 'HIGH',
        detail: 'the answer tells the user they are in profit or in loss, and this turn has no portfolio P&L. Do not assert it; ask or answer the question itself.'
      });
    }
  }

  /* Nothing to respect: no direction read, nothing claimed. */
  if (!isLoss && !isGain) {
    return { schema: SITUATION_SCHEMA, applicable: false, issues, compliant: true };
  }

  /* 7. A loss/gain answer that never touches the portfolio at all. */
  if (situation.hasRead && (isLoss || isGain) && (situation.magnitudePct || 0) >= 5) {
    const mentionsNumber = /\d/.test(toAscii(text));
    const mentionsPortfolio = anyHas(text, NO_DATA_MARKERS) || anyHas(text, ['btc', 'eth', 'sol', 'بیت', 'اتریوم', 'سولانا']);
    if (!mentionsNumber && !mentionsPortfolio) {
      issues.push({
        id: 'IGNORING_PORTFOLIO',
        severity: 'MEDIUM',
        detail: 'this turn measured their portfolio and the answer speaks only in generalities. Use the numbers and name the position that decides the answer.'
      });
    }
  }

  return {
    schema: SITUATION_SCHEMA,
    applicable: true,
    state: situation.state,
    issues,
    compliant: issues.length === 0
  };
}

/** The reviewer's MUST-FIX block ('' when the draft respects the situation). */
export function renderSituationDeficit(check) {
  if (!check || check.compliant !== false || !check.issues?.length) return '';
  return `SITUATION VIOLATIONS (the answer misreads the user's position; fix each one):\n${check.issues
    .map((i) => `- [${i.id}] ${i.detail}`)
    .join('\n')}`;
}

export default readSituation;

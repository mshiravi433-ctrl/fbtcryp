/**
 * FBT INTENT OS — AGENT FACTORY (pure half).
 * ---------------------------------------------------------------------------
 * «برام یک ایجنت بساز که …» has to END in a working agent, not in a panel.
 * This module is the pure, testable half of that flow:
 *
 *   isAgentCreateRequest(text)  — does this sentence ask for a NEW agent?
 *   parseAgentRequest(text)     — kind + slots + what is still missing.
 *   fillAgentSlot(draft, slot, text) — a free-text answer fills one slot.
 *   applyAgentChoice(draft, slot, value) — a tapped chip fills one slot.
 *   agentSlotQuestion(slot, draft, locale) — what to ask, with which chips.
 *   agentSummary(draft, locale) — the one-paragraph «این را بسازم؟».
 *   buildAgentPayload(draft)    — the exact monitor/automation payload.
 *   SUGGESTED_AGENTS            — one-tap templates, fully specified.
 *
 * The chat (IntentAIUnified) owns the loop; the server owns the registry.
 * Nothing here touches the network, so a probe can pin every sentence.
 */

import { resolveMonitorAsset } from './monitorClient.js';

export const AGENT_KINDS = Object.freeze(['price-watch', 'drawdown-watch', 'yield-watch', 'dca', 'rebalance']);

export const KIND_FA = Object.freeze({
  'price-watch': 'دیده‌بان قیمت',
  'drawdown-watch': 'نگهبان افت',
  'yield-watch': 'دیده‌بان سود',
  dca: 'خرید دوره‌ای',
  rebalance: 'تعادل پرتفوی'
});

export const KIND_EN = Object.freeze({
  'price-watch': 'Price watch',
  'drawdown-watch': 'Drawdown guard',
  'yield-watch': 'Yield watch',
  dca: 'Recurring buy',
  rebalance: 'Portfolio rebalance'
});

const FREQUENCY_FA = Object.freeze({ DAILY: 'روزانه', WEEKLY: 'هفتگی', MONTHLY: 'ماهانه' });

const faDigits = (s) => String(s || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

function numFrom(raw) {
  if (raw == null) return null;
  const s = faDigits(String(raw)).replace(/[,،\s_]/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2]) n *= (m[2].toLowerCase() === 'm' ? 1_000_000 : 1000);
  return n;
}

const AGENT_WORD = /(ایجنت|عامل\s*هوشمند|agent)/i;
const CREATE_WORD = /(بساز|بسازید|بسازی|ایجاد|درست\s*کن|بزن|می‌خوام|میخوام|می‌خواهم|میخواهم|لازم\s*دارم|create|build|make|new|spawn|set\s*up)/i;

/**
 * A sentence asks for a NEW agent when it names an agent + a creation verb
 * («برام یک ایجنت بساز که…»), or when it is one of the factory's own prompts
 * (fleet «بساز» buttons send these verbatim).
 */
export function isAgentCreateRequest(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  if (FLEET_PROMPTS.some((p) => s.includes(p.fa) || s.includes(p.en))) return true;
  return AGENT_WORD.test(s) && CREATE_WORD.test(s);
}

function detectKind(s) {
  if (/(ریبالانس|متعادل|rebalance)/i.test(s)) return 'rebalance';
  if (/(دی\s*سی\s*ای|خرید\s*پلکانی|خرید\s*دوره|dca|recurring\s*buy)/i.test(s)) return 'dca';
  if (/(هر|روزانه|هفتگی|ماهانه|خودکار|مکرر|دوره‌ای|daily|weekly|monthly|every|auto)/i.test(s)
    && /(بخر|خرید|buy)/i.test(s)) return 'dca';
  const watch = /(بپا|پایش|نظارت|هشدار|خبر\s*بده|خبرم\s*کن|رصد|زیر\s*نظر|watch|monitor|alert|notify|tells?\s*me)/i.test(s);
  const profit = /(سود|بازده|فرصت|yield|apy|ای‌پی‌وای|اپی‌وای)/i.test(s);
  const drop = /(افت|ریزش|ضرر|سقوط|ریخت|بیفته|بیوفته|drawdown|drops?|dips?|falls?|crash)/i.test(s);
  /* A drop always wins over profit talk («سودم نریزه» is a guard, not a
     yield search); bare profit talk inside an agent sentence is a yield
     watch; anything else watched with an asset is a price watch. */
  if (drop && (watch || profit || /(درصد|٪|%|percent)/i.test(s))) return 'drawdown-watch';
  if (profit) return 'yield-watch';
  if (watch && resolveMonitorAsset(s)) return 'price-watch';
  if (watch || drop) return 'price-watch';
  return null;
}

function detectFrequency(s) {
  if (/(روزانه|هر\s*روز|روزی|daily|every\s*day)/i.test(s)) return 'DAILY';
  if (/(ماهانه|هر\s*ماه|ماهی|monthly|every\s*month)/i.test(s)) return 'MONTHLY';
  if (/(هفتگی|هر\s*هفته|weekly|every\s*week)/i.test(s)) return 'WEEKLY';
  return null;
}

function detectAmount(s) {
  // «۱۰۰ دلار» (number first) and «$100» (currency first).
  const m = s.match(/([0-9۰-۹٠-٩.,kKmM]+)\s*(دلار|تتر|usdt|usd|\$)/i)
    || s.match(/\$\s*([0-9.,kKmM]+)/i);
  if (m) {
    const n = numFrom(m[1]);
    if (n != null && n > 0) return n;
  }
  return null;
}

const FA_WORD_NUMBERS = Object.freeze({
  'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10,
  'یازده': 11, 'دوازده': 12, 'سیزده': 13, 'چهارده': 14, 'پانزده': 15, 'پونزده': 15, 'شانزده': 16, 'هفده': 17, 'هجده': 18, 'نوزده': 19, 'بیست': 20,
  'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60, 'هفتاد': 70, 'هشتاد': 80, 'نود': 90, 'صد': 100
});

function detectThreshold(s) {
  // NOTE: Persian percent is «٪» (U+066A), not «%» — both must match.
  const pct = /%|٪|درصد|percent/i.test(s);
  const above = s.match(/(?:بالاتر|بالای|بیشتر|فوق|بیش\s*از|above|over|≥|>)\s*([0-9۰-۹٠-٩.,kKmM]+)/i)
    || s.match(/([0-9۰-۹٠-٩.,kKmM]+)\s*(?:بالاتر|بالای|بیشتر)(?:\s*(?:رفت|بره|بشه|بشود|رسید))?/i);
  const below = s.match(/(?:کمتر\s*از|کمتر|پایین‌تر\s*از|پایین‌تر|زیر|below|under|≤|<)\s*([0-9۰-۹٠-٩.,kKmM]+)/i)
    || s.match(/([0-9۰-۹٠-٩.,kKmM]+)\s*(?:کمتر|پایین‌تر)(?:\s*(?:رفت|بره|بشه|بشود|رسید|شد))?/i);
  const at = s.match(/(?:به)\s*([0-9۰-۹٠-٩.,kKmM]+)\s*(?:٪|%|درصد|percent)?\s*(?:رسید(?:ه)?|برسه|برسد)|(?:رسید(?:ه)?(?:\s*به)?)\s*([0-9۰-۹٠-٩.,kKmM]+)|(?:hits?|reaches?|at)\s*([0-9۰-۹٠-٩.,kKmM]+)/i);
  let raw = above?.[1] || below?.[1] || at?.[1] || at?.[2] || at?.[3] || null;
  let threshold = raw ? numFrom(raw) : null;
  if ((threshold == null || threshold <= 0) && pct) {
    // Direction-less percent («اگه ۱۰٪ ریخت») — the number still counts.
    const bare = s.match(/([0-9۰-۹٠-٩.,]+)\s*(?:٪|%|درصد|percent)/i);
    if (bare) threshold = numFrom(bare[1]);
    if ((threshold == null || threshold <= 0)) {
      // Word numbers («اگه ده درصد ریخت») — the word must sit next to a
      // percent marker, otherwise «یک» in «یک ایجنت» would win.
      for (const [word, n] of Object.entries(FA_WORD_NUMBERS)) {
        if (new RegExp(`${word}\\s*(?:٪|%|درصد|percent)`, 'u').test(s)) { threshold = n; break; }
      }
    }
  }
  if (threshold == null || threshold <= 0) return { threshold: null, operator: null, percent: pct };
  return {
    threshold,
    operator: above ? 'ABOVE' : (below ? 'BELOW' : 'ABOVE'),
    percent: pct,
    explicitDirection: Boolean(above || below)
  };
}

function detectInterval(s) {
  const m = s.match(/(?:هر|every|each)\s*(\d+)?\s*(دقیقه|ساعت|روز|min(?:ute)?s?|hour?s?|day?s?)/i);
  if (!m) return null;
  const n = Number(m[1] || 1);
  let minutes = n;
  if (/ساعت|hour/i.test(m[0])) minutes = n * 60;
  else if (/روز|day/i.test(m[0])) minutes = n * 1440;
  const allowed = [5, 15, 30, 60, 180, 360, 720, 1440];
  if (allowed.includes(minutes)) return minutes;
  return minutes <= 15 ? 15 : minutes <= 60 ? 60 : minutes <= 360 ? 360 : 720;
}

/**
 * Parse «برام یک ایجنت بساز که …» into a draft. Never throws, never guesses
 * a number: anything unreadable lands in `missing` and the chat asks for it.
 */
export function parseAgentRequest(text, { locale = 'fa' } = {}) {
  void locale;
  const s = String(text || '');
  const kind = detectKind(s);
  const asset = resolveMonitorAsset(s);
  const frequency = detectFrequency(s);
  const amountUsd = detectAmount(s);
  const { threshold, operator, percent, explicitDirection } = detectThreshold(s);
  const intervalMinutes = detectInterval(s);

  const draft = {
    kind,
    asset: asset || null,
    amountUsd: amountUsd ?? null,
    frequency: frequency || (kind === 'rebalance' ? 'MONTHLY' : kind === 'dca' ? 'WEEKLY' : null),
    threshold: threshold ?? null,
    operator: kind === 'drawdown-watch' ? 'BELOW' : (operator || null),
    percent: kind === 'drawdown-watch' ? true : Boolean(percent),
    explicitDirection: Boolean(explicitDirection),
    intervalMinutes: intervalMinutes || (kind === 'yield-watch' ? 360 : 60),
    source: 'agent-factory'
  };
  draft.missing = missingSlots(draft);
  draft.ok = draft.missing.length === 0 && Boolean(kind);
  return draft;
}

export function missingSlots(draft) {
  const out = [];
  if (!draft?.kind) return ['kind'];
  if (draft.kind === 'dca') {
    if (!draft.asset) out.push('asset');
    if (!(draft.amountUsd > 0)) out.push('amountUsd');
    if (!draft.frequency) out.push('frequency');
  } else if (draft.kind === 'rebalance') {
    if (!draft.frequency) out.push('frequency');
  } else if (draft.kind === 'price-watch') {
    if (!draft.asset) out.push('asset');
    if (!(draft.threshold > 0)) out.push('threshold');
  } else if (draft.kind === 'drawdown-watch') {
    if (!draft.asset) out.push('asset');
    if (!(draft.threshold > 0)) out.push('threshold');
  } else if (draft.kind === 'yield-watch') {
    if (!(draft.threshold > 0)) out.push('threshold');
  }
  return out;
}

/** The slot «✎ تغییرش بده» re-asks per kind. */
export function primarySlot(kind) {
  if (kind === 'dca') return 'amountUsd';
  if (kind === 'rebalance') return 'frequency';
  return 'threshold';
}

function kindFromText(s) {
  if (/(ریبالانس|متعادل|rebalance)/i.test(s)) return 'rebalance';
  if (/(دی\s*سی\s*ای|dca|خرید\s*(پلکانی|دوره)|recurring)/i.test(s)) return 'dca';
  if (/(سود|بازده|فرصت|yield|apy)/i.test(s)) return 'yield-watch';
  if (/(افت|ریزش|drawdown|drop|dip|نگهبان)/i.test(s)) return 'drawdown-watch';
  if (/(قیمت|price|بپا|پایش|هشدار|خبر|watch|monitor)/i.test(s)) return 'price-watch';
  return null;
}

/**
 * A free-text follow-up («BTC»، «۱۰۰»، «95000»، «هفتگی») fills the pending
 * slot. Returns the updated draft, or null when the text is not an answer —
 * in which case the caller releases the draft and treats it as a new topic.
 */
export function fillAgentSlot(draft, slot, text) {
  const s = String(text || '').trim();
  if (!draft || !slot || !s) return null;
  // A question is never a slot answer («قیمت BTC چنده؟» while the kind is
  // pending must release the draft, not fill «price-watch»).
  if (/[؟?]|\b(چنده|چیه|چیست|چطور|چگونه|چرا|کدوم|کدام|چقدر|how|what|why|which)\b/i.test(s)) return null;
  const next = { ...draft };
  if (slot === 'kind') {
    const k = kindFromText(s);
    if (!k) return null;
    next.kind = k;
    if (k === 'dca' && !next.frequency) next.frequency = 'WEEKLY';
    if (k === 'rebalance' && !next.frequency) next.frequency = 'MONTHLY';
  } else if (slot === 'asset') {
    const a = resolveMonitorAsset(s);
    if (!a) return null;
    next.asset = a;
  } else if (slot === 'amountUsd') {
    const explicit = detectAmount(s);
    const bare = explicit ?? (/^[0-9۰-۹٠-٩.,kKmM]+$/.test(s.trim()) ? numFrom(s.trim()) : null);
    if (!(bare > 0)) return null;
    next.amountUsd = bare;
  } else if (slot === 'frequency') {
    const f = detectFrequency(s);
    if (!f) return null;
    next.frequency = f;
  } else if (slot === 'threshold') {
    const t = detectThreshold(s);
    let value = t.threshold;
    if (value == null) {
      const bare = /^[0-9۰-۹٠-٩.,kKmM]+$/.test(s.trim()) ? numFrom(s.trim()) : null;
      if (bare != null && bare > 0) value = bare;
    }
    if (!(value > 0)) return null;
    next.threshold = value;
    if (t.percent) next.percent = true;
    if (next.kind === 'drawdown-watch') {
      next.operator = 'BELOW';
      next.percent = true;
    } else if (t.operator) {
      next.operator = t.operator;
      next.explicitDirection = Boolean(t.explicitDirection);
    } else if (!next.operator) {
      next.operator = next.kind === 'yield-watch' ? 'ABOVE' : 'ABOVE';
    }
  } else {
    return null;
  }
  next.missing = missingSlots(next);
  next.ok = next.missing.length === 0 && Boolean(next.kind);
  return next;
}

/** A tapped chip fills the pending slot. Values are pre-validated. */
export function applyAgentChoice(draft, slot, value) {
  if (!draft || !slot || value == null || value === '') return null;
  const next = { ...draft };
  if (slot === 'kind') {
    if (!AGENT_KINDS.includes(value)) return null;
    next.kind = value;
    if (value === 'dca' && !next.frequency) next.frequency = 'WEEKLY';
    if (value === 'rebalance' && !next.frequency) next.frequency = 'MONTHLY';
  } else if (slot === 'asset') {
    next.asset = String(value).toUpperCase();
  } else if (slot === 'amountUsd') {
    const n = Number(value);
    if (!(n > 0)) return null;
    next.amountUsd = n;
  } else if (slot === 'frequency') {
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(value)) return null;
    next.frequency = value;
  } else if (slot === 'threshold') {
    const n = Number(value);
    if (!(n > 0)) return null;
    next.threshold = n;
    if (next.kind === 'drawdown-watch') { next.operator = 'BELOW'; next.percent = true; }
    else if (!next.operator) next.operator = 'ABOVE';
  } else {
    return null;
  }
  next.missing = missingSlots(next);
  next.ok = next.missing.length === 0 && Boolean(next.kind);
  return next;
}

export function agentSlotQuestion(slot, draft = {}, locale = 'fa') {
  const fa = String(locale).startsWith('fa');
  const kindName = fa ? (KIND_FA[draft?.kind] || 'ایجنت') : (KIND_EN[draft?.kind] || 'agent');
  if (slot === 'kind') {
    return {
      text: fa
        ? 'چه نوع ایجنتی بسازم؟'
        : 'What kind of agent should I build?',
      choices: AGENT_KINDS.map((k) => ({ id: `agent-kind-${k}`, value: k, label: fa ? KIND_FA[k] : KIND_EN[k] }))
    };
  }
  if (slot === 'asset') {
    return {
      text: fa ? `برای ${kindName} کدام دارایی؟` : `Which asset for the ${kindName}?`,
      choices: ['BTC', 'ETH', 'SOL'].map((a) => ({ id: `agent-asset-${a}`, value: a, label: a }))
    };
  }
  if (slot === 'amountUsd') {
    return {
      text: fa
        ? `هر ${FREQUENCY_FA[draft?.frequency] || 'دوره'} چقدر ${draft?.asset || ''} بخرم؟ (عدد خودت را هم می‌توانی بنویسی)`
        : `How much ${draft?.asset || ''} per ${String(draft?.frequency || 'period').toLowerCase()}? (or type your own number)`,
      choices: [50, 100, 500].map((n) => ({ id: `agent-amount-${n}`, value: n, label: `$${n}` }))
    };
  }
  if (slot === 'frequency') {
    return {
      text: fa ? 'هر چند وقت یک‌بار؟' : 'How often?',
      choices: ['DAILY', 'WEEKLY', 'MONTHLY'].map((f) => ({
        id: `agent-freq-${f}`,
        value: f,
        label: fa ? FREQUENCY_FA[f] : f.charAt(0) + f.slice(1).toLowerCase()
      }))
    };
  }
  if (slot === 'threshold') {
    if (draft?.kind === 'drawdown-watch') {
      return {
        text: fa
          ? `${draft?.asset || 'دارایی'} چند درصد از قیمت الانش بریزد خبرت کنم؟`
          : `How many percent below the current price should ${draft?.asset || 'the asset'} fall before I alert you?`,
        choices: [5, 10, 20].map((n) => ({ id: `agent-drop-${n}`, value: n, label: `${n}٪` }))
      };
    }
    if (draft?.kind === 'yield-watch') {
      return {
        text: fa
          ? 'سود واقعی به چند درصد سالانه برسد خبرت کنم؟'
          : 'At what real APY should I alert you?',
        choices: [8, 12, 20].map((n) => ({ id: `agent-yield-${n}`, value: n, label: `${n}٪` }))
      };
    }
    return {
      text: fa
        ? `${draft?.asset || 'دارایی'} به چه قیمتی (دلار) برسه خبرت کنم؟ مثلاً «بالای 100000» یا «زیر 90000».`
        : `At what USD price should I alert you for ${draft?.asset || 'the asset'}? E.g. "above 100000" or "below 90000".`,
      choices: null
    };
  }
  return { text: fa ? '؟' : '?', choices: null };
}

function fmtNum(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** The «این را بسازم؟» paragraph. Built only from parsed slots — no guesses. */
export function agentSummary(draft, locale = 'fa') {
  const fa = String(locale).startsWith('fa');
  if (!draft?.kind) return fa ? 'ایجنت' : 'agent';
  if (draft.kind === 'dca') {
    return fa
      ? `ایجنت خرید دوره‌ای: هر ${FREQUENCY_FA[draft.frequency] || draft.frequency} ${fmtNum(draft.amountUsd)} دلار ${draft.asset} — هر اجرا با تأیید تو، بدون امضا پولی جابه‌جا نمی‌شود.`
      : `Recurring-buy agent: $${fmtNum(draft.amountUsd)} of ${draft.asset} ${String(draft.frequency || '').toLowerCase()} — every run needs your confirmation, nothing moves without a signature.`;
  }
  if (draft.kind === 'rebalance') {
    return fa
      ? `ایجنت تعادل پرتفوی: هر ${FREQUENCY_FA[draft.frequency] || draft.frequency} پرتفوی را بررسی و پیشنهاد تعادل می‌دهد — اجرا فقط با تأیید تو.`
      : `Rebalance agent: checks the portfolio ${String(draft.frequency || '').toLowerCase()} and proposes a rebalance — execution only with your confirmation.`;
  }
  if (draft.kind === 'yield-watch') {
    return fa
      ? `دیده‌بان سود: اگر بهترین سود واقعی به ${fmtNum(draft.threshold)}٪ سالانه رسید خبرت می‌کنم (بررسی هر ${draft.intervalMinutes} دقیقه).`
      : `Yield watch: alerts you when the best real APY reaches ${fmtNum(draft.threshold)}% (checked every ${draft.intervalMinutes}m).`;
  }
  if (draft.kind === 'drawdown-watch') {
    return fa
      ? `نگهبان افت ${draft.asset}: اگر از قیمت الانش ${fmtNum(draft.threshold)}٪ یا بیشتر ریخت خبرت می‌کنم (بررسی هر ${draft.intervalMinutes} دقیقه). مبنا همان قیمتی است که از لحظه ساخت می‌بینم.`
      : `${draft.asset} drawdown guard: alerts you on a ${fmtNum(draft.threshold)}%+ drop from the price at creation (checked every ${draft.intervalMinutes}m).`;
  }
  const dir = draft.operator === 'BELOW' ? (fa ? 'زیر' : 'below') : (fa ? 'بالای' : 'above');
  return fa
    ? `دیده‌بان قیمت ${draft.asset}: اگر ${dir} ${fmtNum(draft.threshold)} دلار رفت خبرت می‌کنم (بررسی هر ${draft.intervalMinutes} دقیقه).`
    : `${draft.asset} price watch: alerts you ${dir} $${fmtNum(draft.threshold)} (checked every ${draft.intervalMinutes}m).`;
}

/**
 * The exact creation payload. Monitor kinds return the monitor draft the
 * server validates; automation kinds return the automation input.
 */
export function buildAgentPayload(draft, { locale = 'fa' } = {}) {
  if (!draft?.ok) return { error: 'DRAFT_INCOMPLETE' };
  const lang = String(locale).startsWith('en') ? 'en' : 'fa';
  if (draft.kind === 'dca') {
    return {
      backend: 'automation',
      input: {
        type: 'DCA',
        asset: draft.asset,
        amount: String(draft.amountUsd),
        frequency: draft.frequency,
        chainId: null,
        note: `agent:${draft.asset}-dca`
      }
    };
  }
  if (draft.kind === 'rebalance') {
    return {
      backend: 'automation',
      input: {
        type: 'REBALANCE',
        asset: draft.asset || 'BTC',
        frequency: draft.frequency,
        chainId: null,
        note: 'agent:rebalance'
      }
    };
  }
  if (draft.kind === 'yield-watch') {
    return {
      backend: 'monitor',
      draft: {
        type: 'GOAL',
        metric: 'OPPORTUNITY',
        operator: 'ABOVE',
        threshold: draft.threshold,
        asset: { symbol: 'YIELD' },
        goalText: lang === 'fa' ? `خبرم کن اگر سود واقعی به ${draft.threshold}٪ رسید` : `Alert me when real yield reaches ${draft.threshold}%`,
        label: `سود ≥ ${draft.threshold}٪`,
        intervalMinutes: draft.intervalMinutes,
        locale: lang
      }
    };
  }
  if (draft.kind === 'drawdown-watch') {
    /* PERCENT_CHANGE + BELOW + a positive threshold means "a drop of t% or
       more" (server semantics); the baseline auto-arms from the first live
       read, so no price has to be known at creation time. */
    return {
      backend: 'monitor',
      draft: {
        type: 'ASSET',
        metric: 'PERCENT_CHANGE',
        operator: 'BELOW',
        threshold: draft.threshold,
        baseline: null,
        asset: { symbol: draft.asset },
        label: lang === 'fa' ? `${draft.asset} افت ${draft.threshold}٪` : `${draft.asset} -${draft.threshold}%`,
        intervalMinutes: draft.intervalMinutes,
        locale: lang
      }
    };
  }
  return {
    backend: 'monitor',
    draft: {
      type: 'ASSET',
      metric: 'PRICE',
      operator: draft.operator || 'ABOVE',
      threshold: draft.threshold,
      asset: { symbol: draft.asset },
      label: `${draft.asset} ${(draft.operator || 'ABOVE') === 'ABOVE' ? '≥' : '≤'} ${draft.threshold}`,
      intervalMinutes: draft.intervalMinutes,
      locale: lang
    }
  };
}

/** One-tap templates for the Agents tab — fully specified, zero questions. */
export const SUGGESTED_AGENTS = Object.freeze([
  {
    id: 'sug-btc-dca',
    kind: 'dca', asset: 'BTC', amountUsd: 100, frequency: 'WEEKLY',
    titleFa: 'خرید هفتگی بیت‌کوین', titleEn: 'Weekly BTC buys',
    descFa: 'هر هفته ۱۰۰ دلار BTC — هر اجرا با تأیید تو', descEn: '$100 of BTC every week — each run needs your OK'
  },
  {
    id: 'sug-eth-dca',
    kind: 'dca', asset: 'ETH', amountUsd: 50, frequency: 'WEEKLY',
    titleFa: 'خرید هفتگی اتریوم', titleEn: 'Weekly ETH buys',
    descFa: 'هر هفته ۵۰ دلار ETH — هر اجرا با تأیید تو', descEn: '$50 of ETH every week — each run needs your OK'
  },
  {
    id: 'sug-btc-guard',
    kind: 'drawdown-watch', asset: 'BTC', threshold: 10, operator: 'BELOW', percent: true, intervalMinutes: 60,
    titleFa: 'نگهبان افت BTC', titleEn: 'BTC drawdown guard',
    descFa: 'اگر BTC از الان ۱۰٪ ریخت خبرت می‌کنم', descEn: 'Alerts you on a 10% BTC drop from now'
  },
  {
    id: 'sug-yield',
    kind: 'yield-watch', threshold: 10, operator: 'ABOVE', intervalMinutes: 360,
    titleFa: 'دیده‌بان سود', titleEn: 'Yield watch',
    descFa: 'اگر سود واقعی جایی به ۱۰٪ سالانه رسید خبرت می‌کنم', descEn: 'Alerts you when real yield hits 10% APY'
  },
  {
    id: 'sug-rebalance',
    kind: 'rebalance', asset: 'BTC', frequency: 'MONTHLY',
    titleFa: 'تعادل ماهانه پرتفوی', titleEn: 'Monthly rebalance',
    descFa: 'هر ماه پرتفوی را بررسی و پیشنهاد تعادل می‌دهد', descEn: 'Reviews the portfolio monthly and proposes a rebalance'
  }
]);

export function suggestedDraft(templateId) {
  const t = SUGGESTED_AGENTS.find((x) => x.id === templateId);
  if (!t) return null;
  const draft = {
    kind: t.kind,
    asset: t.asset || null,
    amountUsd: t.amountUsd ?? null,
    frequency: t.frequency || null,
    threshold: t.threshold ?? null,
    operator: t.operator || null,
    percent: Boolean(t.percent),
    intervalMinutes: t.intervalMinutes || 60,
    source: 'suggested'
  };
  draft.missing = missingSlots(draft);
  draft.ok = draft.missing.length === 0 && Boolean(draft.kind);
  return draft;
}

/*
 * The «بساز» prompts behind the ناوگان ایجنت‌ها (Intelligence) cards. Each one
 * is a verbatim AGENT_CREATE sentence, so the fleet links into the SAME
 * parse → confirm → create pipeline as typed text — never a parallel fake.
 */
export const FLEET_PROMPTS = Object.freeze([
  { id: 'market-agent', fa: 'برام یک ایجنت بساز که قیمت BTC را بپاید و اگه ۱۰٪ ریخت خبر بده', en: 'Build me an agent that watches BTC and alerts me on a 10% drop' },
  { id: 'portfolio-agent', fa: 'برام یک ایجنت بساز که هر ماه پرتفویم را متعادل کنه', en: 'Build me an agent that rebalances my portfolio monthly' },
  { id: 'risk-agent', fa: 'برام یک ایجنت بساز که اگه ETH ده درصد ریخت خبر بده', en: 'Build me an agent that alerts me if ETH drops ten percent' },
  { id: 'strategy-agent', fa: 'برام یک ایجنت بساز که سودها را بپاید و اگه به ۱۲٪ رسید خبر بده', en: 'Build me an agent that watches yields and alerts me at 12%' },
  { id: 'guardian-agent', fa: 'برام یک ایجنت بساز که اگه BTC از ۱۵۰۰۰۰ بالاتر رفت خبر بده', en: 'Build me an agent that alerts me if BTC goes above 150000' },
  { id: 'execution-agent', fa: 'برام یک ایجنت بساز که هر هفته ۱۰۰ دلار BTC بخره', en: 'Build me an agent that buys $100 of BTC every week' },
  { id: 'intent-agent', fa: 'برام یک ایجنت بساز', en: 'Build me an agent' },
  { id: 'verification-agent', fa: 'برام یک ایجنت بساز که اگه SOL از ۲۰۰ بالاتر رفت خبر بده', en: 'Build me an agent that alerts me if SOL goes above 200' }
]);

export function fleetPrompt(agentId, locale = 'fa') {
  const row = FLEET_PROMPTS.find((p) => p.id === agentId);
  if (!row) return null;
  return String(locale).startsWith('en') ? row.en : row.fa;
}

/**
 * THE RESEARCH AGENDA — what this assistant still does not know, kept.
 * ---------------------------------------------------------------------------
 * Every deep turn already computes, deterministically, exactly what it could
 * not establish: the strategy frame's gaps, the decision gate's missing
 * evidence, the numbers no source could back, the parts of a multi-part
 * question the answer left untouched, the dialogue contract the answer failed.
 *
 * All of that was thrown away at the end of the turn. So the next turn started
 * from zero: it could not say «I still owe you the live price», could not notice
 * that the same gap has now appeared for the third time, and could not show the
 * operator that the assistant is IMPROVING rather than merely answering.
 *
 * This module keeps those unknowns as a small, per-owner AGENDA:
 *
 *   · derive — turn today's findings into items (fixed vocabulary, no message
 *     text, so the agenda never becomes a transcript);
 *   · merge  — open / refresh / resolve items, capped and deterministic;
 *   · brief  — the most relevant open questions, rendered for the next turn's
 *     prompt («if this turn can close one, close it and say so»);
 *   · record — persist and report opened / closed / total.
 *
 * An item is RESOLVED only by a turn that actually established the thing (live
 * prices present, claims verified, numbers sourced, parts covered, the dialogue
 * contract satisfied) — never by time passing or by silence.
 */

export const RESEARCH_AGENDA_SCHEMA = 'fbt.ai-research-agenda.v1';
export const RESEARCH_ITEM_SCHEMA = 'fbt.ai-research-item.v1';
export const RESEARCH_AGENDA_MAX = 32;
export const RESEARCH_RESOLVED_KEEP = 8;

/**
 * The fixed vocabulary. `needs` says what would close the item, in the words of
 * the product, and is what the next prompt sees.
 */
export const RESEARCH_FACETS = Object.freeze({
  live_market: Object.freeze({ facet: 'live_market', needs: { fa: 'خوانش زندهٔ قیمت از ابزار بازار', en: 'a live price read from the market tool' }, keywords: ['قیمت', 'بازار', 'price', 'market', 'btc', 'eth'] }),
  verified_claims: Object.freeze({ facet: 'verified_claims', needs: { fa: 'تأیید حداقل یک ادعا با دادهٔ ابزار یا منبع', en: 'at least one claim verified by tool data or a source' }, keywords: ['شاهد', 'منبع', 'source', 'evidence', 'ادعا', 'claim'] }),
  portfolio: Object.freeze({ facet: 'portfolio', needs: { fa: 'سبد و موجودی واقعی کاربر', en: 'the user’s real portfolio and balances' }, keywords: ['سبد', 'پورتفوی', 'portfolio', 'موجودی', 'balance'] }),
  capital: Object.freeze({ facet: 'capital', needs: { fa: 'سرمایهٔ واقعی قابل تخصیص', en: 'the real capital available to allocate' }, keywords: ['سرمایه', 'capital', 'بودجه', 'budget'] }),
  weights: Object.freeze({ facet: 'weights', needs: { fa: 'وزن‌های فعلی دارایی‌ها در سبد', en: 'the current asset weights in the portfolio' }, keywords: ['وزن', 'تخصیص', 'weight', 'allocation', 'درصد'] }),
  risk_band: Object.freeze({ facet: 'risk_band', needs: { fa: 'حد تحمل ریسک کاربر', en: 'the user’s stated risk tolerance' }, keywords: ['ریسک', 'risk', 'دراودان', 'drawdown'] }),
  horizon: Object.freeze({ facet: 'horizon', needs: { fa: 'افق زمانی سرمایه‌گذاری', en: 'the investment horizon' }, keywords: ['افق', 'مدت', 'horizon', 'ماه', 'سال'] }),
  goal: Object.freeze({ facet: 'goal', needs: { fa: 'هدف بازدهی و مهلت آن', en: 'the return target and its deadline' }, keywords: ['هدف', 'بازده', 'goal', 'return', 'سود'] }),
  sourced_numbers: Object.freeze({ facet: 'sourced_numbers', needs: { fa: 'منبع برای هر عدد پاسخ', en: 'a source for every number in the answer' }, keywords: ['عدد', 'number', 'figure', 'درصد'] }),
  question_coverage: Object.freeze({ facet: 'question_coverage', needs: { fa: 'پاسخ به همهٔ بخش‌های پرسش', en: 'an answer to every part of the question' }, keywords: [] }),
  answer_shape: Object.freeze({ facet: 'answer_shape', needs: { fa: 'پاسخ در شکلِ خواسته‌شده (سازوکار/عدد/مقایسه)', en: 'an answer in the shape that was asked (mechanism/number/comparison)' }, keywords: [] }),
  falsifier: Object.freeze({ facet: 'falsifier', needs: { fa: 'شرط ابطال برای پیش‌بینی', en: 'a falsifier for the forecast' }, keywords: ['پیش‌بینی', 'forecast', 'هدف', 'target'] }),
  rubric_section: Object.freeze({ facet: 'rubric_section', needs: { fa: 'بخشِ غایبِ برنامهٔ سرمایه‌گذاری', en: 'the missing section of the investment plan' }, keywords: ['استراتژی', 'strategy', 'برنامه', 'plan'] })
});

const GAP_TO_FACET = Object.freeze({
  capital: 'capital',
  weights: 'weights',
  live_prices: 'live_market',
  stale_market_data: 'live_market',
  risk_band: 'risk_band',
  horizon: 'horizon',
  goal: 'goal'
});

function facetOf(id) {
  return RESEARCH_FACETS[id] || null;
}

function needsText(facetId, locale = 'fa') {
  const f = facetOf(facetId);
  if (!f) return null;
  return String(locale || 'fa').startsWith('fa') ? f.needs.fa : f.needs.en;
}

/**
 * Turn one finished turn's deterministic findings into agenda entries.
 *
 * Every entry is either `open` (the gap exists) or `satisfied` (the thing was
 * established this turn, so a matching older item can be resolved). Only facet
 * ids and counts travel — never the user's message.
 */
export function deriveResearchFindings({
  strategy = null,
  decision = null,
  subQuestions = null,
  numericAudit = null,
  dialogue = null,
  falsifier = null,
  context = null
} = {}) {
  const findings = [];
  const push = (facet, extra = {}) => {
    if (!facetOf(facet)) return;
    findings.push({ id: `${facet}${extra.suffix ? `:${extra.suffix}` : ''}`, facet, ...extra });
  };

  /* ── strategy frame: what the plan could not stand on ── */
  if (strategy?.frame) {
    const gaps = Array.isArray(strategy.frame.gaps) ? strategy.frame.gaps : [];
    for (const gap of gaps) {
      const facet = GAP_TO_FACET[gap];
      if (facet) push(facet);
    }
    if (!gaps.includes('live_prices') && strategy.frame.hasLivePrices) push('live_market', { status: 'satisfied' });
    const missingSections = Array.isArray(strategy.rubric?.missing) ? strategy.rubric.missing : [];
    for (const section of missingSections) push('rubric_section', { suffix: section, detail: section });
  }

  /* ── decision gate: which evidence was missing ── */
  if (decision?.applicable && decision.evidence) {
    for (const miss of decision.evidence.missing || []) {
      const facet = miss === 'live_market' ? 'live_market' : miss === 'verified_claims' ? 'verified_claims' : null;
      if (facet) push(facet);
    }
    if ((decision.evidence.missing || []).length === 0) {
      push('live_market', { status: 'satisfied' });
      push('verified_claims', { status: 'satisfied' });
    }
  }

  /* ── numbers the evidence could not source ── */
  if (numericAudit) {
    if (Array.isArray(numericAudit.unsourced) && numericAudit.unsourced.length) push('sourced_numbers');
    else if (numericAudit.clean === true) push('sourced_numbers', { status: 'satisfied' });
  }

  /* ── parts of the question the answer left untouched ── */
  if (subQuestions && Array.isArray(subQuestions.uncovered)) {
    if (subQuestions.uncovered.length) push('question_coverage');
    else push('question_coverage', { status: 'satisfied' });
  }

  /* ── the shape of the answer ── */
  if (dialogue?.applicable) {
    if (dialogue.compliant === false) push('answer_shape');
    else push('answer_shape', { status: 'satisfied' });
  }

  /* ── a forecast that never said what would prove it wrong ── */
  if (falsifier?.applicable) {
    if (falsifier.compliant === false) push('falsifier');
    else push('falsifier', { status: 'satisfied' });
  }

  /* ── what the market read offered: live data satisfies the oldest gap ── */
  const liveNow = Boolean(context?.market?.priceMap && Object.keys(context.market.priceMap).length)
    && String(context?.market?.dataStatus || '').toLowerCase() !== 'stale';
  if (liveNow) push('live_market', { status: 'satisfied' });
  const portfolioNow = Boolean(context?.portfolio) && (context.portfolio.totalValueUsd != null || context.portfolio.holdings);
  if (portfolioNow) {
    push('portfolio', { status: 'satisfied' });
  }

  /* One entry per id: an `open` finding outranks `satisfied`. */
  const byId = new Map();
  for (const f of findings) {
    const current = byId.get(f.id);
    if (!current || (current.status === 'satisfied' && f.status !== 'satisfied')) byId.set(f.id, f);
  }
  return [...byId.values()];
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  if (!item.id || !facetOf(item.facet)) return null;
  return {
    schema: RESEARCH_ITEM_SCHEMA,
    id: String(item.id),
    facet: item.facet,
    detail: item.detail || null,
    status: item.status === 'resolved' ? 'resolved' : 'open',
    severity: item.severity || 'MEDIUM',
    seenCount: Number.isFinite(item.seenCount) ? item.seenCount : 1,
    firstSeenAt: Number.isFinite(item.firstSeenAt) ? item.firstSeenAt : 0,
    lastSeenAt: Number.isFinite(item.lastSeenAt) ? item.lastSeenAt : 0,
    resolvedAt: Number.isFinite(item.resolvedAt) ? item.resolvedAt : null
  };
}

export function normalizeResearchAgenda(raw) {
  const items = Array.isArray(raw) ? raw.map(normalizeItem).filter(Boolean) : [];
  return items.slice(-RESEARCH_AGENDA_MAX);
}

/**
 * Merge this turn's findings into the agenda.
 *
 * `satisfied` resolves a matching item (it is never deleted: the operator can
 * see that it WAS open and when it closed). `open` either creates an item or
 * refreshes it — `seenCount` is how a repeated blind spot becomes visible.
 */
export function mergeResearchAgenda(previous = [], findings = [], { at = Date.now() } = {}) {
  const items = normalizeResearchAgenda(previous).map((i) => ({ ...i }));
  const index = new Map(items.map((i) => [i.id, i]));
  const opened = [];
  const closed = [];
  const repeated = [];

  for (const finding of Array.isArray(findings) ? findings : []) {
    if (!finding?.id || !facetOf(finding.facet)) continue;
    const existing = index.get(finding.id);
    if (finding.status === 'satisfied') {
      if (existing && existing.status === 'open') {
        existing.status = 'resolved';
        existing.resolvedAt = at;
        closed.push(existing.id);
      }
      continue;
    }
    if (existing) {
      if (existing.status === 'resolved') {
        /* It came back: reopen rather than pretend it never closed. */
        existing.status = 'open';
        existing.resolvedAt = null;
        existing.seenCount += 1;
        existing.lastSeenAt = at;
        repeated.push(existing.id);
      } else {
        existing.seenCount += 1;
        existing.lastSeenAt = at;
        repeated.push(existing.id);
      }
      continue;
    }
    const item = {
      schema: RESEARCH_ITEM_SCHEMA,
      id: finding.id,
      facet: finding.facet,
      detail: finding.detail || null,
      status: 'open',
      severity: finding.severity || 'MEDIUM',
      seenCount: 1,
      firstSeenAt: at,
      lastSeenAt: at,
      resolvedAt: null
    };
    items.push(item);
    index.set(item.id, item);
    opened.push(item.id);
  }

  /* Cap: every open item survives; only the oldest resolved ones fall off. */
  const open = items.filter((i) => i.status === 'open');
  const resolved = items.filter((i) => i.status === 'resolved').slice(-RESEARCH_RESOLVED_KEEP);
  const kept = [...resolved, ...open].slice(-RESEARCH_AGENDA_MAX);
  const openTotal = kept.filter((i) => i.status === 'open').length;

  return {
    schema: RESEARCH_AGENDA_SCHEMA,
    items: kept,
    opened,
    closed,
    repeated,
    openTotal,
    at
  };
}

/* ── relevance + rendering ────────────────────────────────────────────────── */

const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'بازار', 'است', 'هست', 'برای', 'که', 'این', 'را', 'از', 'به', 'در'
]);

function wordsOf(text = '') {
  return String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * The open items worth putting in front of the next model: those that share a
 * keyword with the question first, then the most-repeated blind spots.
 */
export function selectAgendaItems(agenda = [], message = '', { limit = 3 } = {}) {
  const items = Array.isArray(agenda) ? agenda : (agenda?.items || []);
  const words = wordsOf(message);
  const open = normalizeResearchAgenda(items).filter((i) => i.status === 'open');
  const scored = open.map((item) => {
    const facet = facetOf(item.facet);
    const keywordHit = (facet?.keywords || []).filter((k) => words.some((w) => w.includes(k) || k.includes(w))).length;
    return { item, score: keywordHit * 3 + Math.min(item.seenCount, 5) + (item.severity === 'HIGH' ? 1 : 0) };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map((s) => ({ ...s.item, facetKeywords: facetOf(s.item.facet)?.keywords || [] }));
}

/** The block the specialists see; '' when the agenda has nothing relevant. */
export function renderResearchBrief(items = [], locale = 'fa') {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!list.length) return '';
  const fa = String(locale || 'fa').startsWith('fa');
  const lines = list.slice(0, 3).map((item) => {
    const needs = needsText(item.facet, locale) || item.facet;
    const times = item.seenCount > 1 ? (fa ? ` (${item.seenCount} بار باز مانده)` : ` (open ${item.seenCount} times)`) : '';
    return `- [${item.facet}] ${needs}${times}`;
  });
  return [
    fa
      ? 'دستور کار پژوهشی (از نوبت‌های قبلی خودت باز مانده است): اگر همین نوبت می‌تواند یکی را ببندد، همان را صریح ببند و بگو با چه شاهدی؛ اگر نمی‌تواند، ادعا نکن که بسته شد.'
      : 'OPEN RESEARCH AGENDA (left by your own earlier turns): if this turn can close one, close it explicitly and say which evidence did it; if not, do not pretend it closed.',
    ...lines
  ].join('\n');
}

/**
 * A tiny session wrapper: load → brief → record, with a store that may be a
 * real KV, a stub in a test, or nothing at all (then the agenda is inert).
 */
export function createResearchAgenda({ load = null, save = null, now = () => Date.now() } = {}) {
  const live = typeof load === 'function' && typeof save === 'function';
  return {
    enabled: live,
    async read(owner = null) {
      if (!live) return [];
      try {
        return normalizeResearchAgenda(await load(owner));
      } catch {
        return [];
      }
    },
    brief(agenda, message, { limit = 3, locale = 'fa' } = {}) {
      return renderResearchBrief(selectAgendaItems(agenda, message, { limit }), locale);
    },
    async record(owner, { agenda = null, findings = [], locale = 'fa' } = {}) {
      if (!live) return null;
      try {
        /* A caller that does not hold the loaded agenda still gets a correct
           merge: read it here rather than merging into an empty list and
           silently losing every earlier open question. */
        const base = Array.isArray(agenda) ? agenda : await this.read(owner);
        const merged = mergeResearchAgenda(base, findings, { at: now() });
        await save(owner, merged.items);
        return {
          schema: RESEARCH_AGENDA_SCHEMA,
          opened: merged.opened,
          closed: merged.closed,
          repeated: merged.repeated,
          openTotal: merged.openTotal
        };
      } catch {
        return null;
      }
    }
  };
}

export default deriveResearchFindings;

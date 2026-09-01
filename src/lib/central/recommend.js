/**
 * FBT CENTRAL INTELLIGENCE OS — Recommendation Engine (spec §26, §27, §28, §30).
 * ---------------------------------------------------------------------------
 * §26 is a shape AND a veto: a recommendation must carry a reason list, a data
 * list, a risk block, a confidence number, alternatives and actions. This module
 * makes the veto real — `buildRecommendation` returns `{ ok: false, missing: [] }`
 * instead of emitting a sentence with no evidence under it.
 *
 * WHY ALTERNATIVES ARE MANDATORY
 * A single recommendation is a decision made for the user; two or three with
 * their trade-offs is the same analysis made visible. Filling `alternatives` with
 * "do nothing" is not allowed either — the do-nothing baseline is generated
 * separately as `baseline`, so it is always present, always free, and never
 * counted as if it were an option someone researched.
 */
import { CI_SCHEMA, PERMISSION, round, usableNumber } from './schema.js';

export const RECOMMENDATION_SCHEMA = 'fbt.central-recommendation.v1';

/** §26 required fields. Missing one is a defect in the CALLER, and says so. */
export const REQUIRED_FIELDS = Object.freeze(['recommendation', 'reason', 'data', 'risk', 'confidence', 'alternatives', 'actions']);

export function assertRecommendable(candidate = {}) {
  const missing = [];
  if (!nonEmptySentence(candidate.recommendation)) missing.push('recommendation');
  if (!Array.isArray(candidate.reason) || !candidate.reason.length) missing.push('reason');
  if (!Array.isArray(candidate.data) || !candidate.data.length) missing.push('data');
  if (!candidate.risk || typeof candidate.risk !== 'object' || !candidate.risk.level) missing.push('risk');
  if (usableNumber(candidate.confidence) === null) missing.push('confidence');
  if (!Array.isArray(candidate.alternatives)) missing.push('alternatives');
  if (!Array.isArray(candidate.actions)) missing.push('actions');
  /* Evidence must be attributable: an entry without a source is a vibe. */
  const unattributed = (candidate.data || []).filter((d) => !d || !d.source);
  if (unattributed.length) missing.push('data[].source');
  const unreasonedActions = (candidate.actions || []).filter((a) => a && !a.actionType);
  if (unreasonedActions.length) missing.push('actions[].actionType');
  return { ok: missing.length === 0, missing, candidate };
}

const nonEmptySentence = (s) => typeof s === 'string' && s.trim().length > 12;

/**
 * Build a recommendation from the pipeline's own artefacts.
 *
 * `confidence` is DERIVED (evidence count, risk confidence, freshness), never
 * chosen — a model picking a number between 0 and 1 is the exact behaviour §3
 * forbids. It is also capped by the risk engine's confidence, so weak inputs
 * cannot yield a confident recommendation no matter how the sentence reads.
 */
export function buildRecommendation({ kind = 'ACTIONABLE', intent = null, risk = null, findings = [], capabilities = {}, policy = null, plan = null, locale = 'en', alternatives = [], actions = [], now = Date.now() } = {}) {
  const fa = locale === 'fa';
  const evidence = findings
    .filter((f) => f && (f.status === 'OK' || f.status === 'PARTIAL'))
    .map((f) => ({
      id: f.id || f.source || `evidence-${findings.indexOf(f)}`,
      source: f.source || f.id || 'unknown-source',
      /* The reply language comes from the locale, not from whatever the engine
         happened to write: the Persian user must not receive an English reason
         line, and the English user must not receive Persian. `detailFa` is the
         same fact in the other language, produced where the fact was computed. */
      detail: String((fa && f.detailFa) ? f.detailFa : (f.detail || f.summary || '')).slice(0, 220),
      dataAt: f.dataAt || f.at || null,
      status: f.status || 'OK',
      ...(f.partial ? { partial: true, missing: f.missing } : {})
    }));
  const reasons = findings
    .filter((f) => f && (f.status === 'OK' || f.status === 'PARTIAL') && (f.reasonFa || f.reason))
    .map((f) => String((fa && f.reasonFa) ? f.reasonFa : f.reason).slice(0, 220));
  if (!evidence.length) {
    return {
      schema: RECOMMENDATION_SCHEMA, brain: CI_SCHEMA, ok: false,
      /* `reason` stays an ARRAY even in a refusal: §43's composer reads the same
         field on both paths, and a string here would crash the reply that is
         supposed to explain the refusal. */
      missing: ['data'], reason: ['no finding survived validation, so there is nothing to recommend from'],
      refusal: locale === 'fa'
        ? 'پیشنهادی تولید نمی‌شود: دادهٔ معتبری برای تکیه‌کردن روی آن خوانده نشد.'
        : 'No recommendation is produced: no trustworthy data was readable to support one.'
    };
  }
  const headline = makeHeadline({ kind, findings, intent, locale, risk });
  const derivedConfidence = round(Math.min(
    0.9,
    0.34 + Math.min(0.3, evidence.length * 0.07) + (risk?.confidence ? Math.min(0.22, risk.confidence * 0.24) : 0) - (policy && policy.staleSections?.length ? 0.08 * policy.staleSections.length : 0)
  ), 3);
  const confidence = derivedConfidence < (risk?.confidence ?? 1) ? derivedConfidence : Math.min(derivedConfidence, risk?.confidence ?? derivedConfidence);
  const candidate = {
    recommendation: headline,
    reason: Array.from(new Set(reasons.length ? reasons : evidence.map((e) => e.detail).filter(Boolean))),
    data: evidence,
    risk: { level: risk?.level || 'UNKNOWN', factors: (risk?.factors || []).slice(0, 6).map((f) => ({ id: f.id, level: f.level, detail: f.detail, detailFa: f.detailFa || null })), confidence: risk?.confidence ?? null },
    confidence,
    alternatives: dedupe(alternatives).slice(0, 4),
    baseline: { id: 'do-nothing', label: locale === 'fa' ? 'هیچ کاری نکنید و فقط نظر را بخوانید' : 'Take no action and read the analysis only', costUsd: 0, risk: 'LOW', note: locale === 'fa' ? 'همیشه گزینهٔ رایگان است و همیشه روی میز می‌ماند' : 'always available, always free, never counted as a recommendation' },
    actions: actions.map(normalizeAction).filter(Boolean),
    kind,
    intentId: intent?.intentId || null,
    executable: actions.some((a) => a.permission === PERMISSION.EXECUTE),
    at: now
  };
  const check = assertRecommendable(candidate);
  if (!check.ok) return { schema: RECOMMENDATION_SCHEMA, brain: CI_SCHEMA, ok: false, missing: check.missing, partial: candidate };
  return { schema: RECOMMENDATION_SCHEMA, brain: CI_SCHEMA, ok: true, ...candidate };
}

const normalizeAction = (a) => {
  if (!a) return null;
  const type = a.actionType || a.type || null;
  if (!type) return null;
  const labelFor = (value) => String(value).slice(0, 120);
  return {
    actionType: String(type).toUpperCase().slice(0, 24),
    module: a.module || null,
    label: labelFor(a.label || type),
    /* The Persian label has to survive normalisation or the client renders English
       in a Persian thread — dropping a field here is how a bilingual product
       quietly becomes an English one with translated labels. */
    labelFa: a.labelFa ? labelFor(a.labelFa) : null,
    permission: a.permission || (a.executable === true ? PERMISSION.EXECUTE : PERMISSION.READ),
    requiresConfirmation: a.requiresConfirmation !== false,
    input: a.input || {},
    why: a.why ? String(a.why).slice(0, 180) : null,
    whyFa: a.whyFa ? String(a.whyFa).slice(0, 180) : null
  };
};

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    if (!item) continue;
    const key = String(item.id || item.label || item).slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(typeof item === 'string' ? { label: item.slice(0, 120) } : { ...item, label: String(item.label || item.id || '').slice(0, 120) });
  }
  return out;
}

/*
 * The headline is composed from the findings' own numbers. No sentence here may
 * contain a figure that was not present in `findings`, which is why the template
 * interpolates `f.value` fields rather than describing them in prose.
 */
function makeHeadline({ kind, findings, intent, locale, risk }) {
  const fa = locale === 'fa';
  /* A finding that says "I could not read this" is evidence of a gap, never a
     fact to quote. Every branch below therefore looks only at usable findings, so a
     dead price source can only produce a refusal, never «undefined دلار». */
  const by = (id) => findings.find((f) => f.id === id && f.status !== 'UNAVAILABLE') || null;
  const text = (f, field) => (fa && f[`${field}Fa`] ? f[`${field}Fa`] : f[field]);
  const concentration = by('concentration');
  const health = by('health-factor') || by('lending-safety');
  const capacity = by('borrow-capacity');
  const goal = by('goal-feasibility');
  const shock = by('whatif');
  const quote = by('quote');
  const exposure = by('exposure');
  const intentType = intent?.intentType || '';
  if (shock && Number.isFinite(Number(shock.value))) {
    return fa
      ? `با افت ${fmtNum(Math.abs(Number(shock.shockPct ?? 30)), fa)}٪، ارزش پرتفوی شما از ${fmtUsd(shock.beforeUsd, fa)} به ${fmtUsd(shock.afterUsd, fa)} می‌رسد${shock.liquidations ? ` و ${fmtNum(shock.liquidations, fa)} موقعیت در محدودهٔ لیکوئیداسیون قرار می‌گیرد` : ''}.`
      : `A ${Math.abs(Number(shock.shockPct ?? 30))}% move takes your portfolio from ${fmtUsd(shock.beforeUsd, fa)} to ${fmtUsd(shock.afterUsd, fa)}${shock.liquidations ? `, with ${shock.liquidations} position(s) inside the liquidation band` : ''}.`;
  }
  if (health && intentType.includes('LOAN')) {
    return fa
      ? `وام شما فعال است: سلامت بدهی ${health.healthFactor ?? '—'}، ${health.distancePct != null ? `فاصله تا لیکوئیداسیون ${health.distancePct}٪` : 'فاصله تا لیکوئیداسیون خوانده نشد'}، سطح ریسک ${health.level || '—'}.`
      : `Your loan is live: health factor ${health.healthFactor ?? '—'}, ${health.distancePct != null ? `${health.distancePct}% from liquidation` : 'liquidation distance unreadable'}, risk level ${health.level || '—'}.`;
  }
  if (capacity) {
    const raw = capacity.capacityUsdByLtv ?? capacity.capacityUsd;
    const safe = capacity.capacityUsdRespectingFloor ?? capacity.safeUsd;
    return fa
      ? `با وثیقهٔ فعلی، سقف نظری وام‌گیری ${fmtUsd(raw, fa)} است؛ اما چون کفِ سلامتِ سیاست ما حفظ فاکتور سلامت است، مبلغ قابل‌اتکا ${fmtUsd(safe, fa)} است${capacity.bindingConstraint ? ` (عامل محدودکننده: ${capacity.bindingConstraint})` : ''}.`
      : `Your theoretical headroom is ${fmtUsd(raw, fa)}, but the health-factor floor makes ${fmtUsd(safe, fa)} the amount we will act on${capacity.bindingConstraint ? ` (binding constraint: ${capacity.bindingConstraint})` : ''}.`;
  }
  const asset = by('asset-intelligence');
  if (asset && ['ASSET_ANALYSIS', 'SIGNAL_READING', 'CONCENTRATION_CHECK', 'QUOTE_SWAP'].includes(intentType)) {
    const sig = asset.signal ? `، سیگنال فنی ${dirLabel(asset.signal.direction, fa)}${asset.signal.strength != null ? ` با قدرت ${round(Number(asset.signal.strength) * 100, 0)}٪` : ''}` : '';
    const news = asset.newsCount ? `، ${asset.newsCount} خبر مرتبط` : '';
    return fa
      ? `${asset.asset} اکنون ${fmtPrice(asset.price, fa)} دلار است؛ تغییر ۲۴ ساعت ${pctStr(asset.change24hPct)}${asset.volatilityPct != null ? `، نوسان روزانه ${pctStr(asset.volatilityPct)}` : ''}${asset.fundingAprPct != null ? `، funding سالانه ${pctStr(asset.fundingAprPct)}` : ''}${sig}${news}.`
      : `${asset.asset} is ${fmtPrice(asset.price, fa)} USD now; 24h ${pctStr(asset.change24hPct)}${asset.volatilityPct != null ? `, daily volatility ${pctStr(asset.volatilityPct)}` : ''}${asset.fundingAprPct != null ? `, ${pctStr(asset.fundingAprPct)}% annualised funding` : ''}${sig ? `, technical signal ${dirLabel(asset.signal.direction, fa)}` : ''}${news}.`;
  }
  const overview = by('market-overview');
  if (overview && intentType === 'MARKET_OVERVIEW') {
    const b = overview.breadth || {};
    const movers = (list) => (list || []).map((r) => `${r.symbol} ${pctStr(r.change24hPct ?? r.change24h)}`).filter((x) => x !== ' ').join('، ');
    return fa
      ? `بازار: ارزش کل ${fmtUsd(b.totalMarketCapUsd, fa)}، تغییر ۲۴ ساعته ${pctStr(b.marketCapChange24hPct)}، دامنهٔ بیت‌کوین ${pctStr(b.btcDominancePct)}${movers(overview.gainers) ? `؛ صعودی‌ها ${movers(overview.gainers)}` : ''}${movers(overview.losers) ? `، نزولی‌ها ${movers(overview.losers)}` : ''}.`
      : `Market: total cap ${fmtUsd(b.totalMarketCapUsd, fa)}, 24h change ${b.marketCapChange24hPct ?? '—'}%, BTC dominance ${b.btcDominancePct ?? '—'}%${movers(overview.gainers) ? `; leading ${movers(overview.gainers)}` : ''}${movers(overview.losers) ? `, lagging ${movers(overview.losers)}` : ''}.`;
  }
  const digest = by('news-digest');
  if (digest && intentType === 'NEWS_SUMMARY') {
    const lines = (digest.items || []).slice(0, 3).map((n) => `«${n.title}»`).join(' و ');
    return fa
      ? `${digest.count} خبر خوانده شد${lines ? `؛ تازه‌ترین‌ها: ${lines}` : ''}. فقط تیتر و زمان انتشار نقل می‌شود، تفسیری افزوده نشده.`
      : `Read ${digest.count} headline(s)${lines ? `: ${lines}` : ''}. Titles and timestamps only — no interpretation was added.`;
  }
  if (concentration && intentType === 'CONCENTRATION_CHECK') {
    return fa
      ? `${concentration.asset} حدود ${concentration.sharePct}٪ از سرمایهٔ پرریسک شماست — سطح ${levelLabel(concentration.level, fa)}.`
      : `${concentration.asset} is about ${concentration.sharePct}% of your risk capital — ${concentration.level || 'WATCH'} level.`;
  }
  if (goal) {
    return fa
      ? `برای هدف ${fmtUsd(goal.targetUsd, fa)} در ${fmtNum(goal.years, fa)} سال: شانس برآوردی ${fmtNum(goal.probabilityPct, fa)}٪ با سپردهٔ ماهانهٔ ${fmtUsd(goal.contribution, fa)}.${goal.requiredContribution ? ` برای رسیدن به ۶۰٪ باید ماهی ${fmtUsd(goal.requiredContribution, fa)} بگذارید.` : ''}`
      : `For the ${fmtUsd(goal.targetUsd, fa)} goal in ${goal.years}y: ~${goal.probabilityPct}% odds at ${fmtUsd(goal.contribution, fa)}/month.${goal.requiredContribution ? ` Reaching 60% needs ${fmtUsd(goal.requiredContribution, fa)}/month.` : ''}`;
  }
  if (quote) {
    const gave = quote.amountIn != null ? `${fmtNum(quote.amountIn, fa)} ${quote.fromAsset || ''}`.trim() : `${fmtUsd(quote.amountUsd, fa)} ${quote.fromAsset || ''}`.trim();
    const min = quote.minOut != null ? (fa ? `، حداقل دریافت ${fmtNum(quote.minOut, fa)} ${quote.toAsset || ''}`.trim() : `, at least ${fmtNum(quote.minOut, fa)} ${quote.toAsset || ''}`.trim()) : '';
    const exp = Number.isFinite(Number(quote.expiresAt)) ? Math.max(0, Math.round((Number(quote.expiresAt) - Date.now()) / 1000)) : null;
  const next = by('quote-next');
  const nextLeg = next
    ? (fa ? ` ${next.detailFa || next.detail}.` : ` Second leg after that: ${next.detail}.`)
    : '';
  return fa
      ? `${gave} → ${fmtNum(quote.received, fa)} ${quote.toAsset || ''}${min}؛ اثر قیمتی ${quote.priceImpactPct != null ? `${fmtNum(quote.priceImpactPct, fa)}٪` : 'ناخواند'}، هزینهٔ تقریبی ${quote.feeUsd != null ? `${fmtNum(quote.feeUsd, fa)} دلار` : 'ناخواند'}${quote.provider ? `، از ${quote.provider}` : ''}${exp !== null ? ` — این نرخ تا ${fmtNum(exp, fa)} ثانیه دیگر معتبر است و پس از آن اجرا نمی‌شود` : ''}.${nextLeg}${intent?.compound?.length ? ' یک تأییدیه برای هر دو مرحله کافی است؛ اگر مرحلهٔ دوم ناممکن شود، پیش از اجرا متوقف می‌شوم.' : ''}`
      : `${gave} → ${fmtNum(quote.received, fa)} ${quote.toAsset || ''}${min}; ${quote.priceImpactPct != null ? `${fmtNum(quote.priceImpactPct, fa)}% price impact` : 'impact unreadable'}, ${quote.feeUsd != null ? `~${fmtNum(quote.feeUsd, fa)} USD fee` : 'fee unreadable'}${quote.provider ? `, via ${quote.provider}` : ''}${exp !== null ? ` — this quote expires in ${exp}s and will not be executed after that` : ''}.${nextLeg}${intent?.compound?.length ? ' One confirmation covers both legs; if the second becomes impossible, this stops before executing.' : ''}`;
  }
  if (exposure && concentration) {
    return fa
      ? `ارزش پرتفوی ${fmtUsd(exposure.equityUsd, fa)}، تمرکز اصلی روی ${concentration.asset} (${fmtNum(concentration.sharePct, fa)}٪)، اهرم ترکیبی ${exposure.leverage != null ? `${fmtNum(exposure.leverage, fa)}×` : 'ناخواند'}.`
      : `Portfolio ${fmtUsd(exposure.equityUsd, fa)}, main concentration in ${concentration.asset} (${concentration.sharePct}%), combined leverage ${exposure.leverage ?? '—'}×.`;
  }
  /* The generic tail is the LAST branch, and it names the value it read: a reply
     that starts «نتیجهٔ خواندن وضعیت:» with no number in it is the forbidden
     generic phrasing, so the composer's caller gets an explicit refusal instead of
     a sentence that only looks like an answer. */
  const first = findings.find((f) => f.status === 'OK' || f.status === 'PARTIAL') || null;
  if (!first) {
    return fa
      ? 'پاسخی نیست: هیچ عدد معتبری از ابزارها خوانده نشد، و عددی هم ساخته نمی‌شود.'
      : 'No answer: no trustworthy number was read from the tools, and none will be invented.';
  }
  const value = first?.value ?? first?.detail;
  return `${fa ? 'نتیجهٔ خواندن وضعیت:' : 'From the state read:'} ${String(value ?? (fa ? 'دادهٔ کافی نبود' : 'not enough readable data'))}`;
}

const dirLabel = (d, fa) => ({ bullish: fa ? 'صعودی' : 'bullish', bearish: fa ? 'نزولی' : 'bearish', neutral: fa ? 'خنثی' : 'neutral' }[String(d || '').toLowerCase()] || String(d || '—'));

function fmtNum(v, fa = false) {
  const n = usableNumber(v);
  if (n === null) return '—';
  try {
    return new Intl.NumberFormat(fa ? 'fa-IR' : 'en-US', { maximumFractionDigits: Math.abs(n) < 1 ? 8 : 2 }).format(n);
  } catch {
    return String(round(n, 6));
  }
}

function fmtPrice(v, fa = false) {
  const n = usableNumber(v);
  if (n === null) return '—';
  try {
    return new Intl.NumberFormat(fa ? 'fa-IR' : 'en-US', { maximumFractionDigits: n < 1 ? 6 : 2 }).format(n);
  } catch {
    return String(n);
  }
}

const pctStr = (v) => {
  const n = usableNumber(v);
  if (n === null) return '—';
  return `${n > 0 ? '+' : ''}${round(n, 2)}٪`;
};

const levelLabel = (level, fa) => ({ HIGH: fa ? 'بالا' : 'high', ELEVATED: fa ? 'افزایش‌یافته' : 'elevated', MODERATE: fa ? 'متوسط' : 'moderate', LOW: fa ? 'پایین' : 'low' }[String(level || '').toUpperCase()] || String(level || '—'));

function fmtUsd(v, fa = false) {
  const n = usableNumber(v);
  if (n === null) return '—';
  /* Abbreviations are English-shaped (`10k USD`); in a Persian sentence they read as
     a broken unit. Full grouped digits plus the currency word, always the same
     number the engine computed. */
  if (fa) return `${fmtNum(n, true)} دلار`;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${round(n / 1_000_000, 2)}M USD`;
  if (abs >= 1_000) return `${round(n / 1_000, 1)}k USD`;
  return `${round(n, 2)} USD`;
}

/**
 * §14's "concentration → risk → news → signals → market → action" chain, made
 * into a function: given the findings, decide WHICH engine actions are actually
 * possible right now (capability-gated), in the order that reduces risk first.
 */
export function possibleActionsFrom({ findings = [], capabilities = {}, risk = null, policy = null, walletConnected = false } = {}) {
  const available = (m) => capabilities?.[m] === 'AVAILABLE' || capabilities?.[m] === 'DEGRADED';
  const actions = [];
  const concentration = findings.find((f) => f.id === 'concentration');
  const yieldOpportunity = findings.find((f) => f.id === 'opportunities');
  const borrowable = findings.find((f) => f.id === 'borrow-capacity');
  if (concentration && usableNumber(concentration.sharePct) >= 45) {
    if (available('swap') && walletConnected) {
      actions.push({ actionType: 'SWAP', module: 'swap', label: `Trim ${concentration.asset} into stables`, labelFa: `${concentration.asset} را به اندازهٔ لازم به استیبل‌کوین تبدیل کن`, why: `concentration ${concentration.sharePct}% of risk capital`, whyFa: `تمرکز ${fmtNum(concentration.sharePct, true)}٪ از سرمایهٔ پرریسک`, permission: PERMISSION.EXECUTE, input: { from: concentration.asset, to: 'USDC', reason: 'reduce-concentration' } });
    }
    if (available('lending') && walletConnected) actions.push({ actionType: 'LEND', module: 'lending', label: `Put ${concentration.asset} to work as collateral instead of selling`, labelFa: `به‌جای فروش، ${concentration.asset} را وثیقه بگذار`, permission: PERMISSION.EXECUTE, why: 'keeps upside while reducing naked exposure', whyFa: 'سود نگه‌داشتنِ موقعیت، بدون قرار گرفتن در معرضِ خالی', input: { asset: concentration.asset } });
    if (available('alerts')) actions.push({ actionType: 'SET_ALERT', module: 'alerts', label: `Alert if ${concentration.asset} share passes 55%`, labelFa: `اگر سهم ${concentration.asset} از ۵۵٪ گذشت به من هشدار بده`, permission: PERMISSION.PREPARE, why: 'monitors without moving funds', whyFa: 'پایش بدون جابه‌جایی وجه', input: { condition: 'sharePct>55' } });
  }
  if (borrowable && usableNumber(borrowable.safeUsd) > 0 && risk?.level !== 'HIGH' && risk?.level !== 'CRITICAL') {
    actions.push({ actionType: 'BORROW', module: 'borrowing', label: `Borrow up to ${fmtUsd(borrowable.safeUsd)} within the health-factor floor`, labelFa: `تا ${fmtUsd(borrowable.safeUsd, true)} و با حفظ کف فاکتور سلامت وام بگیر`, permission: PERMISSION.EXECUTE, why: 'headroom exists at the current collateral value', whyFa: 'با ارزش وثیقهٔ فعلی، ظرفیت خالی وجود دارد', input: { maxUsd: usableNumber(borrowable.safeUsd) } });
  }
  if (yieldOpportunity?.candidates?.length && available('farming')) {
    actions.push({ actionType: 'FARM', module: 'farming', label: `Deploy idle stables at ${yieldOpportunity.candidates[0].aprPct}% APR`, labelFa: `نقدینهٔ بی‌کار را در استخر ${fmtNum(yieldOpportunity.candidates[0].aprPct, true)}٪ APR بگذار`, permission: PERMISSION.EXECUTE, why: yieldOpportunity.candidates[0].reason || 'best eligible pool', whyFa: yieldOpportunity.candidates[0].reasonFa || null, input: { pool: yieldOpportunity.candidates[0].id } });
  }
  if (policy?.requiresConfirmation) actions.forEach((a) => { a.requiresConfirmation = true; });
  return actions.slice(0, 4);
}

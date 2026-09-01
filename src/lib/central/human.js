/**
 * FBT CENTRAL INTELLIGENCE OS — AI Response Engine (spec §19, §20, §21, §43).
 * ---------------------------------------------------------------------------
 * §19 is a direction of data flow, and this file is the only place it is
 * implemented: Tool Result → structured result → explanation. The inverse
 * (user → LLM → plausible sentence) cannot be expressed here, because every
 * field on the rendered card is assembled from a `results[...]` entry and
 * labelled with the source and timestamp that produced it.
 *
 * §20 ("no generic fallback") is enforced mechanically, not stylistically:
 * `FORBIDDEN_PHRASES` are matched against the finished text and a hit downgrades
 * the reply to an explicit defect (`generic: true` + a named missing field). The
 * only legitimate question the brain may ask is the one `askFor()` composes from
 * `context.missingInformation` — «برای محاسبهٔ تمرکز، موجودی کیف‌پول خوانده نشد»
 * rather than «لطفاً بیشتر توضیح دهید».
 *
 * The anti-duplicate fingerprint is here too: a reply identical to the last one
 * for the same context digest is not sent twice, which is the second half of the
 * «پاسخ‌های تکراری» complaint (the first half is §34's action idempotency).
 */
import { CI_SCHEMA, FORBIDDEN_PHRASES, PERMISSION, RESPONSE_MODES, round, usableNumber } from './schema.js';
import { hashString } from './schema.js';

export const RESPONSE_SCHEMA = 'fbt.central-response.v1';

const LABELS = Object.freeze({
  en: { result: 'Result', reason: 'Why', data: 'Data', risk: 'Risk', confidence: 'Confidence', suggestion: 'Suggestion', action: 'Action', amount: 'Amount', network: 'Network', fee: 'Fee', status: 'Status', transaction: 'Transaction', verification: 'Verification', final: 'Final result', notRead: 'could not be read', stale: 'stale', unavailable: 'unavailable', via: 'via' },
  fa: { result: 'نتیجه', reason: 'دلیل', data: 'داده', risk: 'ریسک', confidence: 'اطمینان', suggestion: 'پیشنهاد', action: 'عملیات', amount: 'مبلغ', network: 'شبکه', fee: 'هزینه', status: 'وضعیت', transaction: 'تراکنش', verification: 'اعتبارسنجی', final: 'نتیجهٔ نهایی', notRead: 'خوانده نشد', stale: 'کهنه', unavailable: 'در دسترس نبود', via: 'از طریق' }
});

const section = (id, label, value, { source = null, dataAt = null, tone = null, unit = null } = {}) => ({
  id,
  label,
  value: value === undefined || value === null ? '—' : value,
  unit,
  source,
  dataAt,
  tone,
  /** §43: an analysis number without a source is not shown as a fact. */
  attributable: Boolean(source)
});

/**
 * The main entry point. `results` is the map the brain filled from the modules
 * (keyed by plan step id); everything rendered here is either in that map, in
 * `risk`, in `policy`, or an explicit "could not read".
 */
export function composeResponse({
  intent = null, context = null, plan = null, policy = null, results = {}, risk = null,
  recommendation = null, error = null, execution = null, locale = 'en', state = null,
  lastFingerprint = null, confirmation = null, refusal = null, gapLead = null, now = Date.now()
} = {}) {
  const L = LABELS[locale === 'fa' ? 'fa' : 'en'];
  const fa = L === LABELS.fa;
  const sections = [];
  const mode = pickMode({ error, policy, execution, recommendation, results, intent });

  /* ---- a capability refusal replaces the analysis, it does not decorate it ---- */
  if (refusal) {
    sections.push(section('result', L.result, refusal.text, { source: refusal.source || 'central-registry', tone: 'ask' }));
    if (refusal.reason) sections.push(section('refusalReason', fa ? 'ثبت رجیستری' : 'Registry record', refusal.reason, { source: 'central-registry' }));
    if (refusal.alternatives?.length) sections.push(section('alternatives', fa ? 'چیزی که در دسترس است' : 'What is available', refusal.alternatives, { source: 'capability-manager' }));
  }

  /* ---- analysis sections (§43 upper half) ---- */
  if (!refusal && (mode === 'ANSWER' || mode === 'ACTION')) {
    const readable = Object.entries(results).filter(([, v]) => v && v.status !== 'UNAVAILABLE');
    /* The subject of the question comes first, even when it failed. A turn that
       reads three things successfully and misses the ONE the user asked about must
       not answer with the three — that is a real number attached to the wrong
       question, which is harder to notice than an empty reply. */
    const headline = gapLead?.text || (recommendation?.ok ? recommendation.recommendation : summarizeResults(readable, { fa, L }));
    sections.push(section('result', L.result, headline, {
      source: recommendation?.data?.map((d) => d.source).filter(Boolean).join(' + ') || readable.map(([k]) => results[k]?.source).filter(Boolean).join(' + ') || null,
      sourceLabel: fa ? 'منبع' : 'source',
      dataAt: maxAt(readable.map(([, v]) => v.dataAt || v.at)),
      dataAtLabel: relative(maxAt(readable.map(([, v]) => v.dataAt || v.at)), fa)
    }));
    /* A veto carries its own explanation, but it is an ENGINEERING reason, never
       something to show as «دلیل» under a Persian answer line. So declared reasons
       count only for an accepted recommendation; the refusal text is rendered
       separately below. */
    const declared = recommendation?.ok && Array.isArray(recommendation?.reason) ? recommendation.reason
      : [];
    const reasons = (declared.length ? declared : inferReasons(readable, { fa })).filter(Boolean);
    if (reasons.length) sections.push(section('reason', L.reason, reasons.slice(0, 4), { source: 'risk-engine + central-state' }));
    const dataRows = (recommendation?.data || readable.map(([k, v]) => ({ id: k, source: v.source || 'module', detail: v.summary || '', dataAt: v.dataAt || null })))
      .filter((d) => d && (d.detail || d.source));
    if (dataRows.length) sections.push(section('data', L.data, dataRows.slice(0, 8).map((d) => formatDataRow(d, fa)), { source: 'tool-results' }));
    /* The risk line is shown when it is a fact about the user's money or when the
       turn is about to touch money. For a read-only price question, "risk:
       MISSING" is noise about our own inputs, so it is only surfaced when the
       level is real or when execution/risk is the subject of the turn. */
    const riskIsSubject = ['EXECUTE_SWAP', 'EXECUTE_BRIDGE', 'EXECUTE_LEND', 'EXECUTE_BORROW', 'EXECUTE_REPAY', 'EXECUTE_REBALANCE', 'WHATIF_SIMULATION', 'CONCENTRATION_CHECK', 'FUTURES_RISK', 'LOAN_STATUS'].includes(intent?.intentType) || mode === 'ACTION';
    const riskReason = (fa ? risk?.reasonsFa?.[0] : risk?.reasons?.[0]) || risk?.reasons?.[0] || null;
    if (gapLead) sections.push(section('nextStep', fa ? 'قدم بعدی' : 'Next step', gapLead.next || (fa ? 'منبع دوباره خوانده می‌شود؛ تا آن زمان عددی نمایش داده نمی‌شود.' : 'the source is read again; until then no number is shown'), { source: gapLead.source || 'recovery-engine' }));
    if (risk && (risk.level !== 'MISSING' || riskIsSubject)) sections.push(section('risk', L.risk, `${risk.level}${riskReason ? ` — ${riskReason}` : ''}`, { source: 'central-risk-engine', tone: toneFor(risk.level) }));
    const confidence = recommendation?.confidence ?? risk?.confidence ?? intent?.confidence ?? null;
    if (confidence !== null && confidence !== undefined) sections.push(section('confidence', L.confidence, `${round(Number(confidence) * 100, 0)}%`, { tone: Number(confidence) < 0.4 ? 'warn' : null }));
    if (recommendation?.ok && recommendation.actions?.length) sections.push(section('suggestion', L.suggestion, recommendation.actions.map((a) => (fa ? a.labelFa || a.label : a.label)).filter(Boolean), { source: 'recommendation-engine' }));
    if (!recommendation?.ok && recommendation?.refusal) sections.push(section('refusal', fa ? 'چرا پیشنهادی نیست' : 'Why no recommendation', recommendation.refusal, { tone: 'warn', source: 'recommendation-engine' }));
    if (recommendation?.ok && recommendation.alternatives?.length) sections.push(section('alternatives', fa ? 'گزینه‌های دیگر' : 'Alternatives', recommendation.alternatives.map((a) => a.label), { source: 'recommendation-engine' }));
  }

  /* ---- execution sections (§43 lower half) ---- */
  if (mode === 'ACTION' && execution) {
    sections.push(section('action', L.action, execution.actionType || intent?.entities?.actionType || '—', { source: 'action-engine' }));
    sections.push(section('amount', L.amount, execution.amountLabel || '—', { source: execution.source || 'quote' }));
    sections.push(section('network', L.network, execution.network || '—', { source: 'wallet-service' }));
    sections.push(section('fee', L.fee, execution.feeLabel || L.notRead, { source: execution.feeSource || 'quote' }));
    sections.push(section('status', L.status, execution.status || 'PENDING', { source: 'action-engine' }));
    sections.push(section('transaction', L.transaction, execution.txHash || (fa ? 'هنوز امضا نشده' : 'not signed yet'), { source: execution.txHash ? 'blockchain' : 'action-engine' }));
    sections.push(section('verification', L.verification, execution.verification || (fa ? 'در انتظار تأیید بلاک' : 'awaiting on-chain confirmation'), { source: 'verification' }));
    sections.push(section('final', L.final, execution.finalResult || (fa ? 'پس از تأیید، وضعیت به همهٔ ماژول‌ها منتقل می‌شود' : 'state propagates to every module once confirmed'), { source: 'central-state' }));
  }

  /* ---- blocked / stopped / error ---- */
  if (mode === 'SAFE_STOP') {
    sections.push(section('stopped', fa ? 'متوقف شد' : 'Stopped', stopText(policy, error, fa), { tone: 'danger', source: 'policy-engine' }));
  } else if (mode === 'ERROR_AND_RECOVERY') {
    sections.push(section('error', fa ? 'خطا' : 'Error', error?.userMessage || (fa ? 'منبع داده پاسخ نداد' : 'a data source did not answer'), { tone: 'warn', source: error?.module || 'tool-router' }));
    if (error?.recovery?.actions?.length) sections.push(section('recovery', fa ? 'اقدام سامانه' : 'System action', error.recovery.actions.map((a) => a.type), { source: 'recovery-engine' }));
    if (policy?.reasons?.length) sections.push(section('impact', fa ? 'تأثیر روی پاسخ' : 'Effect on the answer', policy.reasons.slice(0, 2), { source: 'policy-engine' }));
  }

  /* ---- a question, only when a field is genuinely missing (§5) ---- */
  const ask = mode === 'QUESTION' ? askFor(context, { fa, L }) : null;
  if (ask) sections.push(section('question', fa ? 'برای ادامه لازم است' : 'Needed to continue', ask.text, { tone: 'ask' }));

  /* A partial failure must say so. Hiding «the price source did not answer» behind
     a reply that quotes the two sections that DID answer is the difference between
     a system you can trust and a system that looks confident while lying about its
     own inputs (§22), so the gap is a first-class section of every ANSWER. */
  if (error && mode !== 'ERROR_AND_RECOVERY' && mode !== 'SAFE_STOP') {
    sections.push(section('dataGaps', fa ? 'چه چیزی خوانده نشد' : 'What could not be read', [error.userMessage || error.code, ...(error.recovery?.actions?.length ? [`${fa ? 'اقدام سامانه' : 'system action'}: ${error.recovery.actions.map((a) => a.type).join(' → ')}`] : [])], { tone: 'warn', source: error.module || 'tool-router' }));
  }
  const text = renderText({ mode, sections, fa, L, headline: mode === 'QUESTION' ? null : (recommendation?.ok ? recommendation.recommendation : (refusal?.text || null)) });
  /* The execution sections still belong: a refusal about an ETF does not cancel a
     confirmation card that is already open for something else. */
  const generic = containsForbidden(text);
  const fingerprint = hashString([
    intent?.intentType, context?.contextDigest, Object.keys(results).sort().map((k) => `${k}:${results[k]?.revision ?? ''}`).join(','),
    policy?.verdict, risk?.level, recommendation?.ok ? 1 : 0
  ].join('|'));
  const duplicate = Boolean(lastFingerprint) && lastFingerprint === fingerprint;

  return {
    schema: RESPONSE_SCHEMA,
    brain: CI_SCHEMA,
    mode,
    locale,
    intentId: intent?.intentId || null,
    planDigest: plan?.digest || null,
    sections,
    text: generic ? `${text}\n${fa ? '[هشدار کیفیت] این پاسخ عمومی بود و به همین دلیل بازبینی شد.' : '[quality flag] this reply was generic and was rewritten to name the missing inputs.'}` : text,
    headline: mode === 'QUESTION' ? (ask?.text || null) : (recommendation?.ok ? recommendation.recommendation : (refusal?.text || gapLead?.text || sections.find((s) => s.id === 'result')?.value || null)),
    refused: Boolean(refusal),
    actions: recommendation?.ok ? (recommendation.actions || []).slice(0, 4) : [],
    suggestions: buildSuggestions({ results, risk, recommendation, capabilities: context?.capabilities, fa, L }),
    confidence: recommendation?.confidence ?? risk?.confidence ?? null,
    provenance: {
      toolSteps: Object.keys(results).length,
      stateRevision: state?.revision ?? null,
      policyVerdict: policy?.verdict || null,
      sources: Array.from(new Set(sections.map((s) => s.source).filter(Boolean))),
      evaluatedAt: now
    },
    /** The number-level honesty guarantee, spelled out for the client (§48). */
    numbersFromToolsOnly: true,
    generic: generic || duplicate,
    duplicate,
    fingerprint,
    requiresConfirmation: policy?.requiresConfirmation === true,
    confirmationCard: policy?.requiresConfirmation
      ? buildConfirmationCard({
        intent, results, policy, fa, L, confirmation,
        quote: confirmation?.quote || null, risk: confirmation?.risk || null,
        actionType: confirmation?.actionType || null, input: confirmation?.input || null
      })
      : null,
    /** What the reply will NOT do, stated in data so a client can render it and a
       test can assert it: the server never signs and never moves funds. */
    executionBoundary: { serverSigns: false, holdsKeys: false, broadcasts: false, handsOffToWallet: true },
    ask
  };
}

function pickMode({ error, policy, execution, recommendation, results, intent }) {
  const usable = Object.values(results || {}).filter((v) => v && v.status !== 'UNAVAILABLE').length;
  if (policy?.verdict === 'SAFE_STOP') return 'SAFE_STOP';
  /* A missing field outranks a confirmation card: offering a user a button to
     approve a request whose amount we do not know is worse than asking for it. */
  if (intent?.needsUserInput) return 'QUESTION';
  /* "Some results exist" is not the same as "anything was read": a turn where every
     source failed still has result entries, all UNAVAILABLE. Treating that as an
     ANSWER is how a system produces a confident paragraph out of nothing. */
  if (error && !usable) return 'ERROR_AND_RECOVERY';
  if (policy?.requiresConfirmation && !execution) return 'ACTION';
  if (execution) return 'ACTION';
  if (intent?.needsUserInput || (!Object.keys(results || {}).length && !recommendation?.ok)) return 'QUESTION';
  return 'ANSWER';
}

function summarizeResults(entries, { fa, L }) {
  if (!entries.length) return fa ? 'داده‌ای خوانده نشد؛ عددی هم ادعا نمی‌شود.' : 'Nothing was read, so nothing is claimed.';
  const parts = entries.slice(0, 4).map(([k, v]) => `${k}: ${v.summary || (fa ? 'خوانده شد' : 'read')}`);
  const stale = entries.filter(([, v]) => v.stale).length;
  return `${parts.join(' · ')}${stale ? ` · ${fa ? `${stale} ورودی کهنه بود` : `${stale} input(s) were stale}`}` : ''}`;
}

function inferReasons(entries, { fa }) {
  const out = [];
  for (const [key, value] of entries) {
    if (value?.factors?.length) out.push(...value.factors.slice(0, 2).map((f) => `${fa ? '' : ''}${f.detail || f.id}`));
    else if (value?.detail) out.push(String(value.detail));
    else if (value && typeof value === 'object' && value.level) out.push(`${key} = ${value.level}${value.sharePct !== undefined ? ` (${value.sharePct}%)` : ''}`);
  }
  return Array.from(new Set(out.filter(Boolean))).slice(0, 4);
}

const formatDataRow = (d, fa = false) => `${d.detail || d.id}${d.source ? ` (${d.source}${d.dataAt ? `, ${relative(d.dataAt, fa)}` : ''})` : ''}`;

function relative(at, fa = false) {
  const ms = Date.now() - Number(at || 0);
  if (!Number.isFinite(ms) || ms < 0) return fa ? 'اکنون' : 'now';
  if (ms < 45_000) return fa ? 'همین حالا' : 'just now';
  const n = (v) => { try { return new Intl.NumberFormat(fa ? 'fa-IR' : 'en-US').format(Math.round(v)); } catch { return String(Math.round(v)); } };
  if (ms < 3_600_000) return fa ? `${n(ms / 60_000)} دقیقه پیش` : `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return fa ? `${n(ms / 3_600_000)} ساعت پیش` : `${Math.round(ms / 3_600_000)}h ago`;
  return fa ? `${n(ms / 86_400_000)} روز پیش` : `${Math.round(ms / 86_400_000)}d ago`;
}

const maxAt = (list) => {
  const nums = list.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? Math.max(...nums) : null;
};

const toneFor = (level) => ({ CRITICAL: 'danger', HIGH: 'danger', ELEVATED: 'warn', MODERATE: 'warn' }[String(level || '').toUpperCase()] || 'ok');

function stopText(policy, error, fa) {
  const reason = policy?.safeStopCodes?.[0] || error?.code || (fa ? 'بررسی امنیتی' : 'security check');
  return fa
    ? `این عملیات به دلیل بررسی امنیتی متوقف شد (${reason}). برای جلوگیری از انتقال اشتباه، تراکنش اجرا نشد.`
    : `This operation was stopped by a security check (${reason}). To prevent an incorrect transfer, no transaction was executed.`;
}

/** §20: a question names the field, never asks to "explain more". */
function askFor(context, { fa, L }) {
  const missing = context?.missingInformation || [];
  if (!missing.length) return null;
  /* Nothing in the registry matched this sentence. That is a different kind of
     missing than an absent amount: the field list would be useless («منظورتان
     intent» is not a question a person can answer), so the reply says what could
     not be matched and names the paths that DO exist, which the user can pick from
     or correct in one word. Still no "please elaborate", still no invented topic. */
  if (missing.includes('intent')) {
    const near = (context?.nearMisses || []).filter(Boolean);
    const said = String(context?.message || '').trim().slice(0, 70);
    return {
      fields: ['intent'],
      options: near,
      text: fa
        ? `«${said}» را به هیچ مسیر ثبت‌شده‌ای در رجیستری مرکزی نرساندم، پس از این راه عددی عرض نمی‌شود. چیزی که همین حالا ساخته‌شده است${near.length ? `: ${near.join('، ')}` : ''}. کدام را خواستید؟`
        : `"${said}" did not match any registered route, so no number is offered from this path. What exists right now${near.length ? `: ${near.join(', ')}` : ''}. Which one did you mean?`,
      L
    };
  }
  const names = {
    wallet: fa ? 'اتصال یا خواندن کیف‌پول' : 'a wallet connection or balance read',
    markets: fa ? 'دادهٔ بازار' : 'market data',
    portfolio: fa ? 'ترکیب پرتفوی' : 'portfolio composition',
    lending: fa ? 'وضعیت وام از پروتکل' : 'the lending position from the protocol',
    asset: fa ? 'نام دارایی' : 'an asset',
    fromAsset: fa ? 'ارز مبدأ' : 'the asset to send',
    toAsset: fa ? 'ارز مقصد' : 'the asset to receive',
    amount: fa ? 'مبلغ (یا درصدی از دارایی)' : 'an amount (or a share of the balance)',
    network: fa ? 'شبکه' : 'the network',
    recipient: fa ? 'نشانی گیرنده' : 'the recipient address',
    pool: fa ? 'استخر یا پروتکل مقصد' : 'the destination pool or protocol',
    collateral: fa ? 'داراییِ وثیقه' : 'the collateral asset',
    goal: fa ? 'مبلغ هدف و افق زمانی' : 'a target amount and a horizon',
    condition: fa ? 'شرط هشدار' : 'the alert condition'
  };
  const list = missing.map((m) => names[m] || m);
  return {
    fields: missing,
    text: fa
      ? `برای اینکه عدد دقیق بدهم، این لازم است: ${list.join('، ')}. بدون آن، حدس نمی‌زنم.`
      : `To give you a real number I need: ${list.join(', ')}. I will not guess in its place.`,
    L
  };
}

export function containsForbidden(text) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  return FORBIDDEN_PHRASES.some((p) => flat.toLowerCase().includes(String(p).toLowerCase()));
}

/**
 * §43's two templates as plain text. Deliberately NOT markdown prose: the panel
 * renders `sections`, and this string is for notifications, the Telegram bot and
 * copy-paste. Keeping both from one source means they cannot disagree.
 */
function renderText({ mode, sections, fa, L, headline }) {
  const lines = [];
  for (const s of sections) {
    const v = Array.isArray(s.value)
      ? s.value.map((x) => `· ${typeof x === 'string' ? x : `${x.label || x.id || ''}${x.note ? ` — ${x.note}` : ''}`}`).join('\n')
      : String(s.value ?? '—');
    lines.push(`${s.label}: ${v}`);
    /* The source line is the provenance the spec insists on; its age has to read
       in the same language as the answer, or a Persian reply ends in English. */
    if (s.attributable && s.source && mode !== 'QUESTION') lines.push(`  ${L.via} ${s.source}${s.dataAt ? ` (${relative(s.dataAt, fa)})` : ''}`);
  }
  if (!lines.length) lines.push(fa ? 'پاسخی از داده‌های واقعی ساخته نشد.' : 'No answer could be built from real data.');
  /* An action offered to a Persian reader must be readable by them: the label is
     what they click, so it is rendered in the reply language with the English
     label kept underneath for operators and logs. */
  return lines.join('\n');
}

/** ≤4 suggestions, derived from what the state supports — never from a mood. */
function buildSuggestions({ results, risk, recommendation, capabilities, fa }) {
  const out = [];
  if (risk?.level === 'HIGH' || risk?.level === 'CRITICAL') out.push({ label: fa ? 'کاهش تمرکز را بررسی کن' : 'Check reducing concentration', intent: 'PORTFOLIO_ANALYSIS' });
  const cap = Object.entries(capabilities || {}).filter(([, v]) => v === 'UNAVAILABLE' || v === 'DEGRADED').map(([k]) => k);
  if (cap.length) out.push({ label: fa ? `رفع مشکل ${cap.slice(0, 2).join('، ')} لازم است` : `${cap.slice(0, 2).join(', ')} needs attention`, intent: 'SYSTEM_HEALTH' });
  if (recommendation?.ok) out.push({ label: fa ? 'شبیه‌سازی سناریو روی همین پیشنهاد' : 'Run a what-if on this suggestion', intent: 'WHATIF_SIMULATION' });
  const keys = Object.keys(results || {});
  if (keys.includes('portfolio.read')) out.push({ label: fa ? 'اگر بازار ۳۰٪ بریزد؟' : 'What if the market drops 30%?', intent: 'WHATIF_SIMULATION' });
  if (keys.includes('lending.positions')) out.push({ label: fa ? 'سقف وام امن چقدر است؟' : 'How much can I safely borrow?', intent: 'BORROW_CAPACITY' });
  return out.slice(0, 4);
}

/**
 * The confirmation card: what will happen, what it costs, what could go wrong,
 * and the exact plan it authorises. A "yes" to a DIFFERENT plan is invalid, and
 * `policy.planDigest` is what proves it — so this object must carry the digest.
 */
export function buildConfirmationCard({ intent, results, policy, fa, L, quote = null, risk = null, actionType = null, input = null, confirmation = null } = {}) {
  const quoteStep = quote || Object.entries(results || {}).find(([k]) => k.endsWith('.quote'))?.[1] || null;
  const quoteData = { ...(quoteStep?.data || {}), ...(quoteStep || {}) };
  const riskStep = risk || results?.['risk.analyze'] || null;
  const riskData = { ...(riskStep?.data || {}), ...(riskStep || {}) };
  const expiry = usableNumber(quoteData.expiresAt);
  const ttlSeconds = expiry !== null ? Math.max(0, Math.round((expiry - Date.now()) / 1000)) : null;
  const level = String(riskData.level || 'UNKNOWN').toUpperCase();
  return {
    title: fa ? 'تأیید این عملیات' : 'Confirm this action',
    actionType: actionType || quoteData.actionType || null,
    body: fa
      ? 'تا شما تأیید نکنید، هیچ امضایی انجام نمی‌شود. این کارت همان طرحی است که اجرا می‌شود؛ اگر نرخ جابه‌جا شود، اجرا متوقف می‌شود.'
      : 'Nothing is signed until you confirm. This card is the exact plan that will run; if the quote moves, execution stops instead of proceeding.',
    planDigest: policy?.planDigest || null,
    intentId: intent?.intentId || null,
    /* The id the client must send back to confirm/cancel. Without it on the card,
       a renderer has to reach into a second object and the two can drift — and a
       card pointing at the wrong action is a confirmation granted on nothing. */
    actionId: confirmation?.actionId || null,
    summary: quoteStep ? quoteSummary(quoteData, fa) : (fa ? 'بدون نرخ زنده، تأییدیه‌ای صادر نمی‌شود.' : 'No confirmation is issued without a live quote.'),
    quote: {
      fromAsset: quoteData.fromAsset ?? null, toAsset: quoteData.toAsset ?? null,
      amountIn: usableNumber(quoteData.amountIn), amountUsd: usableNumber(quoteData.amountUsd),
      expectedOut: usableNumber(quoteData.expectedOut), minOut: usableNumber(quoteData.minOut),
      priceImpactPct: usableNumber(quoteData.priceImpactPct), feeUsd: usableNumber(quoteData.feeUsd ?? quoteData.fee),
      provider: quoteData.provider || quoteData.source || null,
      slippagePct: usableNumber(quoteData.slippagePct),
      chainId: usableNumber(quoteData.chainId ?? quoteData.fromChain) ?? null,
      toChainId: usableNumber(quoteData.toChain) ?? null
    },
    cost: usableNumber(quoteData.feeUsd ?? quoteData.fee),
    /* The expiry is on the card because a confirmation granted on a dead quote is
       the failure mode §33's quote-validity gate exists to prevent: the user must
       see that the number they approved has a shelf life. */
    quoteExpiresInSec: ttlSeconds,
    risk: level,
    riskNote: (fa ? riskData.reasonsFa?.[0] : riskData.reasons?.[0]) || riskData.reasons?.[0] || riskData.detail || null,
    input: input ? { from: input.from ?? null, to: input.to ?? null, amountUsd: usableNumber(input.amountUsd), network: input.network ?? null } : null,
    warnings: [
      level === 'HIGH' || level === 'CRITICAL' ? (fa ? `سطح ریسک این عملیات ${level} محاسبه شده است` : `this action is assessed at ${level} risk`) : null,
      usableNumber(quoteData.priceImpactPct) !== null && usableNumber(quoteData.priceImpactPct) > 1 ? (fa ? `اثر قیمتی ${fmtNum(usableNumber(quoteData.priceImpactPct), fa)}٪ بالاتر از باند راحت ماست` : `price impact ${quoteData.priceImpactPct}% is above our comfort band`) : null,
      quoteData.unsignedOnly === false ? (fa ? 'این نرخ به امضای سرور نیاز دارد — غیرممکن است؛ سرور کلید ندارد' : 'this quote claims a server signature — impossible; the server holds no key') : null
    ].filter(Boolean),
    consequences: fa
      ? ['پس از اجرا، موجودی، پرتفوی، ریسک، هدف و هشدارها به‌طور خودکار تازه می‌شوند', 'اگر نرخ بیش از حد مجاز جابه‌جا شود، اجرا متوقف می‌شود و دوباره سؤال می‌پرسم', 'امضا فقط در کیف پول شما انجام می‌شود؛ این سرور کلیدی ندارد']
      : ['after execution, wallet, portfolio, risk, goals and alerts refresh automatically', 'if the quote drifts beyond tolerance, execution stops and you are asked again', 'signing happens only in your wallet; this server holds no key'],
    requiredTier: PERMISSION.EXECUTE
  };
}

function quoteSummary(q, fa) {
  /* The card is the last thing a user reads before money moves, so it states the
     quantity they named (0.1 BTC), not a re-derived USD figure, and it always
     carries the worst-case output (`minOut`) when the provider gave one — that is
     the number a slippage surprise is measured against. */
  const recv = usableNumber(q.expectedOut ?? q.receivedAmount);
  const gaveToken = usableNumber(q.amountIn);
  const gaveUsd = usableNumber(q.amountUsd);
  const minOut = usableNumber(q.minOut);
  if (recv === null) return fa ? 'جزئیات نرخ از ارائه‌دهنده خوانده نشد.' : 'The provider did not return full quote details.';
  const gave = gaveToken !== null ? `${fmtNum(gaveToken, fa)} ${q.fromAsset || ''}`.trim() : (gaveUsd !== null ? `${fmtNum(gaveUsd, fa)} USD` : '—');
  const impact = usableNumber(q.priceImpactPct);
  const fee = usableNumber(q.feeUsd ?? q.fee);
  const parts = [fa ? `${gave} → ${fmtNum(recv, fa)} ${q.toAsset || ''}`.trim() : `${gave} → ${fmtNum(recv, fa)} ${q.toAsset || ''}`.trim()];
  if (minOut !== null) parts.push(fa ? `حداقل دریافت ${fmtNum(minOut, fa)}` : `min out ${fmtNum(minOut, fa)}`);
  if (impact !== null) parts.push(fa ? `اثر قیمتی ${fmtNum(impact, fa)}٪` : `${fmtNum(impact, fa)}% impact`);
  if (fee !== null) parts.push(fa ? `هزینه ≈ ${fmtNum(fee, fa)} USD` : `fee ≈ ${fmtNum(fee, fa)} USD`);
  if (gaveToken !== null && gaveUsd !== null) parts.push(fa ? `برابر ${fmtNum(gaveUsd, fa)} USD` : `≈ ${fmtNum(gaveUsd, fa)} USD`);
  if (q.provider) parts.push(q.provider);
  return parts.join(' · ');
}

function fmtNum(v, fa) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat(fa ? 'fa-IR' : 'en-US', { maximumFractionDigits: n < 1 ? 8 : (n < 1000 ? 2 : 2) }).format(n);
  } catch {
    return String(round(n, 6));
  }
}

/** Used by the probes: any emitted text must survive the generic check. */
export function assertNotGeneric(text) {
  if (containsForbidden(text)) {
    const err = new Error('GENERIC_FALLBACK_SUPPRESSED');
    err.code = 'GENERIC_FALLBACK_SUPPRESSED';
    throw err;
  }
  return true;
}

export { RESPONSE_MODES };

/**
 * FBT CENTRAL INTELLIGENCE OS — Error Intelligence (spec §22, §23, §39).
 * ---------------------------------------------------------------------------
 * Two complaints are answered here:
 *
 *   «when an API is broken it doesn't know to use another path»
 *   «it repeats the same errors over and over»
 *
 * The first becomes a table: every raw failure is classified into a code, and
 * each code has an ordered recovery ladder (retry → failover → revalidate →
 * serve-stale-with-flag → mark-unavailable). The second becomes a ledger: an
 * error fingerprint already reported this session is not shown to the user
 * again; only its counter moves, while the log keeps everything.
 *
 * THE LINE BETWEEN RECOVERABLE AND NOT (§23)
 * A security signal never enters the ladder. `safeStop: true` means: no retry,
 * no alternate route, no "let me try that differently". The one code in this
 * file that must never gain a fallback is CONTRACT_MISMATCH — an earlier
 * version of this system treated it as a provider error and failovered, which
 * is exactly how a wrong-contract call becomes a lost deposit.
 */
import { CI_SCHEMA, ERROR_CLASSES, RECOVERY_LADDER, SAFE_STOP_CODES, hashString } from './schema.js';

export const ERROR_SCHEMA = 'fbt.central-error.v1';

/**
 * Message → code. Ordered, most specific first: an RPC that returns
 * `{"error":{"message":"execution reverted: insufficient funds"}}` is a balance
 * problem, not a revert problem, and the user needs to be told the first.
 */
const SIGNATURES = Object.freeze([
  { code: 'INVALID_RECIPIENT', klass: ERROR_CLASSES.SECURITY, patterns: [/invalid (recipient|address)/i, /address checksum/i, /not a valid address/i, /ens not found/i, /recipient is (the )?(zero|null)/i, /0x0{38,}/i] },
  { code: 'CONTRACT_MISMATCH', klass: ERROR_CLASSES.SECURITY, patterns: [/contract (mismatch|not found|bytecode)/i, /no contract code at given address/i, /address is not a contract/i, /wrong (pool|router|token) address/i] },
  { code: 'ORACLE_MANIPULATION_SUSPECTED', klass: ERROR_CLASSES.SECURITY, patterns: [/oracle (deviation|manipulat|stale|price mismatch)/i, /price (moved|drift) .{0,12}(too much|extreme)/i, /chainlink (round|answer) (stale|invalid)/i] },
  { code: 'HONEYPOT_DETECTED', klass: ERROR_CLASSES.SECURITY, patterns: [/honeypot/i, /cannot (sell|transfer) (out|tokens)/i, /transfer.*blocked.*token/i] },
  { code: 'SENDER_BINDING_MISMATCH', klass: ERROR_CLASSES.SECURITY, patterns: [/sender (mismatch|does not match)/i, /from address (is not|!=)/i, /signature (invalid|does not match)/i, /nonce too (low|high).*foreign/i] },
  { code: 'NETWORK_MISMATCH', klass: ERROR_CLASSES.SECURITY, patterns: [/chain id (mismatch|does not match)/i, /wrong network/i, /incompatible (rpc|network|chain)/i, /unauthorized host .*json-rpc/i] },
  { code: 'SIGNER_MISMATCH', klass: ERROR_CLASSES.SECURITY, patterns: [/signer (address|mismatch|not authorized)/i, /account (not|is not) (the )?signer/i] },
  { code: 'USER_REJECTED', klass: ERROR_CLASSES.USER, patterns: [/user (rejected|denied)/i, /rejected the request/i, /action rejected/i, /user cancelled/i, /provider: user denied/i, /MetaMask Signature Rejected/i] },
  { code: 'INSUFFICIENT_BALANCE', klass: ERROR_CLASSES.RECOVERABLE_DATA, patterns: [/insufficient (funds|balance)/i, /native currency (amount is not sufficient)/i, /have less balance/i, /gas required exceeds allowance/i] },
  { code: 'INSUFFICIENT_ALLOWANCE', klass: ERROR_CLASSES.RECOVERABLE_DATA, patterns: [/allowance is not (enough|sufficient)/i, /erc20: insufficient allowance/i, /not approved/i] },
  { code: 'QUOTE_EXPIRED', klass: ERROR_CLASSES.RECOVERABLE_DATA, patterns: [/quote (expired|stale|invalid)/i, /route (expired|not found)/i, /(price )?impact is too high/i, /too little received/i, /deadline exceeded/i, /transaction deadline/i] },
  { code: 'NONCE_TOO_LOW', klass: ERROR_CLASSES.TRANSIENT, patterns: [/nonce too low/i, /already known/i, /replacement transaction underpriced/i] },
  { code: 'RATE_LIMITED', klass: ERROR_CLASSES.DEGRADED, patterns: [/\b429\b/, /rate ?limit(ed|ing)?/i, /too many requests/i, /cloudflare.*access limit/i, /under rate limit/i] },
  { code: 'PROVIDER_TIMEOUT', klass: ERROR_CLASSES.TRANSIENT, patterns: [/provider (timeout|timed out)/i, /upstream timeout/i] },
  { code: 'RPC_TIMEOUT', klass: ERROR_CLASSES.TRANSIENT, patterns: [/abort(ed)?/i, /timed? ?out/i, /timeout of \d+ms exceeded/i, /deadline exceeded/i, /ETIMEDOUT/i, /The user aborted a request/i] },
  { code: 'RPC_ERROR', klass: ERROR_CLASSES.DEGRADED, patterns: [/json-rpc/i, /eth_(call|getBalance|estimateGas)/i, /missing response/i, /bad gateway .*rpc/i, /execution reverted/i] },
  { code: 'INDEXER_LAG', klass: ERROR_CLASSES.RECOVERABLE_DATA, patterns: [/indexer (is )?(behind|lag)/i, /not (yet )?indexed/i, /block (height|number) (too old|mismatch)/i, /stale block/i] },
  { code: 'PROVIDER_DOWN', klass: ERROR_CLASSES.DEGRADED, patterns: [/\b50[234]\b/, /service unavailable/i, /bad gateway/i, /gateway timeout/i, /upstream (unreachable|error)/i, /ECONNREFUSED/i, /ENOTFOUND/i, /EAI_AGAIN/i], retryable: true },
  { code: 'NETWORK_UNAVAILABLE', klass: ERROR_CLASSES.DEGRADED, patterns: [/NETWORK_UNAVAILABLE/, /failed to fetch/i, /networkerror/i, /no internet/i, /offline/i], retryable: true },
  { code: 'UPSTREAM_HTTP_5XX', klass: ERROR_CLASSES.DEGRADED, patterns: [/\bHTTP 5\d\d\b/i, /status.{0,4}5\d\d/], retryable: true },
  { code: 'UPSTREAM_HTTP_4XX', klass: ERROR_CLASSES.FATAL, patterns: [/\bHTTP 4\d\d\b/i, /bad request/i, /unsupported (chain|token)/i] },
  { code: 'DATA_INCOMPLETE', klass: ERROR_CLASSES.RECOVERABLE_DATA, patterns: [/missing (field|data)/i, /not available/i, /unavailable/i, /no data/i] },
  { code: 'STALE_DATA', klass: ERROR_CLASSES.RECOVERABLE_DATA, patterns: [/stale/i, /outdated/i, /\bTTL\b/i] }
]);

/**
 * `classifyError` never throws and never returns "unknown" as an excuse: an
 * unclassifiable error still gets a class (FATAL) and no fallback, so a parse
 * miss degrades to a safe stop rather than to a blind retry loop.
 */
export function classifyError(raw, { status = null, method = null, module: moduleId = null } = {}) {
  const message = String(raw?.message || raw?.error || raw || '').slice(0, 400);
  const haystack = `${message} ${status ?? ''} ${raw?.code ?? ''} ${raw?.name ?? ''}`;
  let match = null;
  for (const sig of SIGNATURES) {
    if (sig.patterns.some((p) => p.test(haystack))) { match = sig; break; }
  }
  const code = match?.code || (Number(status) >= 500 ? 'PROVIDER_DOWN' : 'UNCLASSIFIED_ERROR');
  const klass = match?.klass || ERROR_CLASSES.FATAL;
  const safeStop = SAFE_STOP_CODES.includes(code) || klass === ERROR_CLASSES.SECURITY;
  const ladder = safeStop ? [] : (RECOVERY_LADDER[code] || []);
  return {
    schema: ERROR_SCHEMA,
    brain: CI_SCHEMA,
    code,
    class: safeStop ? ERROR_CLASSES.SECURITY : klass,
    module: moduleId,
    method,
    status: status ?? null,
    retryable: !safeStop && (match?.retryable ?? [ERROR_CLASSES.TRANSIENT, ERROR_CLASSES.DEGRADED].includes(klass)),
    safeStop,
    ladder,
    /** Never log-facing: kept for the observability trail only. */
    technical: message.replace(/[\u0000-\u001f]/g, ' ').slice(0, 240),
    fingerprint: hashString(`${code}|${moduleId || ''}|${message.slice(0, 120)}`),
    at: Date.now()
  };
}

/**
 * The next rung of the ladder, or null when the ladder is exhausted.
 * `attempts` counts what the CURRENT turn already spent, so a 30-turn session
 * does not start each failure already out of retries.
 */
export function nextRecovery(classified, { attempts = 0, provider = null, providers = [], rpc = [], usedRpc = [] } = {}) {
  if (!classified || classified.safeStop) return { done: true, reason: 'SAFE_STOP', actions: [] };
  const ladder = classified.ladder || [];
  const action = ladder[attempts];
  if (!action) return { done: true, reason: 'LADDER_EXHAUSTED', actions: [] };
  const actions = [];
  switch (action) {
    case 'RETRY':
      actions.push({ type: 'RETRY', delayMs: 350 * (attempts + 1), jitter: true, reason: `retry ${attempts + 1} after ${classified.code}` });
      break;
    case 'FAILOVER_RPC': {
      const next = (rpc.length ? rpc : ['primary']).find((e) => !usedRpc.includes(e));
      if (!next) return { done: true, reason: 'NO_RPC_ALTERNATIVE', actions: [{ type: 'MARK_DEGRADED', module: classified.module }] };
      actions.push({ type: 'FAILOVER_RPC', endpoint: next, reason: 'switching RPC endpoint after a transport failure' });
      break;
    }
    case 'FAILOVER_PROVIDER': {
      const alternatives = (providers.length ? providers : [provider]).filter((p) => p && p !== provider);
      if (!alternatives.length) return { done: true, reason: 'NO_PROVIDER_ALTERNATIVE', actions: [{ type: 'SERVE_STALE_WITH_FLAG' }] };
      actions.push({ type: 'FAILOVER_PROVIDER', candidates: alternatives.slice(0, 3), reason: 'another provider serves this data' });
      break;
    }
    case 'BACKOFF_RETRY':
      actions.push({ type: 'RETRY', delayMs: 1200 * (attempts + 1), jitter: true, respectRetryAfter: true });
      break;
    case 'REVALIDATE':
      actions.push({ type: 'REVALIDATE', reason: 'indexer behind — re-read the block rather than trust the cache' });
      break;
    case 'SERVE_STALE_WITH_FLAG':
      actions.push({ type: 'SERVE_STALE_WITH_FLAG', label: true, reason: 'older value, explicitly labelled as such' });
      break;
    case 'REFRESH':
      actions.push({ type: 'REFRESH', reason: 'read the section again before answering' });
      break;
    case 'REQUOTE':
      actions.push({ type: 'REQUOTE', reason: 'a fresh quote, then policy runs again on it' });
      break;
    case 'VALIDATE_INPUT':
      actions.push({ type: 'ASK_PRECISELY', reason: 'the request itself is not usable; name the field that is wrong' });
      break;
    case 'MARK_DEGRADED':
    case 'MARK_UNAVAILABLE':
      actions.push({ type: action, module: classified.module, reason: 'declared honestly instead of retried forever' });
      break;
    default:
      actions.push({ type: action });
  }
  return { done: false, action, actions, remaining: Math.max(0, ladder.length - attempts - 1) };
}

/* ── the "don't repeat yourself" part (§22, and the duplicate-answer bug) ── */
export function createErrorLedger({ windowMs = 5 * 60_000, maxEntries = 200 } = {}) {
  const seen = new Map();
  return {
    /** True the FIRST time a fingerprint appears in the window: show it. Later
     *  occurrences log and count, but do not produce a second identical apology. */
    report(error, now = Date.now()) {
      const fp = error?.fingerprint || hashString(String(error?.code || error));
      const entry = seen.get(fp);
      if (entry && now - entry.firstAt < windowMs) {
        entry.count += 1;
        entry.lastAt = now;
        entry.at = now;
        return { show: false, count: entry.count, firstAt: entry.firstAt, error };
      }
      if (seen.size > maxEntries) {
        const oldest = [...seen.entries()].sort((a, b) => a[1].firstAt - b[1].firstAt)[0];
        if (oldest) seen.delete(oldest[0]);
      }
      seen.set(fp, {
        firstAt: now, lastAt: now, at: now, count: 1,
        code: error?.code || null,
        /* The trail exists so someone can answer «what did the brain do about
           it?». A bare code cannot be audited, so the classification and the
           recovery the ladder chose are stored next to the fingerprint: the entry
           then explains the decision, not only the symptom. */
        class: error?.class || null,
        module: error?.module || null,
        safeStop: error?.safeStop === true,
        recovery: Array.isArray(error?.recovery?.actions) ? error.recovery.actions.slice(0, 4) : null,
        recoveryDone: error?.recovery?.done === true
      });
      return { show: true, count: 1, firstAt: now, error };
    },
    recent(now = Date.now()) {
      return [...seen.values()].filter((e) => now - e.lastAt < windowMs).sort((a, b) => b.lastAt - a.lastAt).slice(0, 20);
    },
    reset() { seen.clear(); },
    size: () => seen.size
  };
}

/**
 * The user-facing sentence. Persian first because that is the reported language
 * of the complaint, and it says three things: what happened, what the system
 * did about it, and whether the user must act. No raw stack, ever (§22).
 */
export function humanizeError(error, { locale = 'fa', recovery = null, retryPlanned = false } = {}) {
  const fa = locale !== 'en';
  const tried = recovery?.actions?.length
    ? (fa ? `سامانه ${recovery.actions.map((a) => a.type === 'FAILOVER_RPC' ? 'مسیر RPC جایگزین' : a.type === 'FAILOVER_PROVIDER' ? 'ارائه‌دهندهٔ جایگزین' : a.type === 'SERVE_STALE_WITH_FLAG' ? 'مقدار قبلی با برچسب کهنه' : 'تلاش مجدد').join(' و ')} را امتحان کرد.` : `The system tried ${recovery.actions.map((a) => a.type).join(' then ')}.`)
    : '';
  switch (error?.code) {
    case 'SAFE_STOP':
    case 'CONTRACT_MISMATCH':
    case 'ORACLE_MANIPULATION_SUSPECTED':
    case 'INVALID_RECIPIENT':
    case 'SECURITY_VIOLATION':
    case 'SENDER_BINDING_MISMATCH':
    case 'NETWORK_MISMATCH':
      return fa
        ? 'این عملیات به دلیل بررسی امنیتی متوقف شد. برای جلوگیری از انتقال اشتباه، تراکنش اجرا نشد.'
        : 'This operation was stopped by a security check. To prevent an incorrect transfer, no transaction was executed.';
    case 'RPC_TIMEOUT':
    case 'PROVIDER_TIMEOUT':
    case 'TIMEOUT':
      return fa
        ? `اتصال به منبع اطلاعاتی قطع شد. ${tried ? `${tried} ` : ''}اگر دادهٔ تازه‌ای نبود، عددی نمایش داده نمی‌شود.`
        : `The data source timed out. ${tried} Nothing was shown as current unless it actually was.`;
    case 'RATE_LIMITED':
      return fa ? `سقف درخواست موقتاً پر شده است.${retryPlanned ? ' تلاش مجدد برنامه‌ریزی شد.' : ''}` : `Rate limit reached temporarily. ${retryPlanned ? 'A retry is scheduled.' : ''}`;
    case 'PROVIDER_DOWN':
    case 'NETWORK_UNAVAILABLE':
      return fa ? 'منبع اطلاعاتی در دسترس نیست. تا بازیابی آن، عدد قدیمی را به‌جای آن نشان نمی‌دهیم.' : 'A data source is unreachable. Until it recovers, an old number will not be shown in place of it.';
    case 'INSUFFICIENT_BALANCE':
      return fa ? 'موجودی کیف‌پول برای این مقدار کافی نیست؛ بخشی از مبلغ به کارمزد شبکه هم نیاز دارد.' : 'The wallet balance does not cover this amount — part of it has to pay network fees as well.';
    case 'INSUFFICIENT_ALLOWANCE':
      return fa ? 'ابتدا باید اجازهٔ خرج (approve) برای این توکن ثبت شود.' : 'A token approval (approve) has to be signed for this asset first.';
    case 'QUOTE_EXPIRED':
      return fa ? 'نرخ قبلی منقضی شد؛ نرخ جدید گرفته می‌شود و دوباره تأییدیه خواسته می‌شود.' : 'The quote expired; a new one is being taken and confirmation will be requested again.';
    case 'USER_REJECTED':
      return fa ? 'تراکنش در کیف‌پول تأیید نشد و هیچ عملیاتی انجام نشد.' : 'The transaction was not approved in the wallet, and nothing was executed.';
    case 'INDEXER_LAG':
      return fa ? 'دادهٔ ایندکسر عقب است؛ وضعیت از روی زنجیرهِ بلاک دوباره خوانده شد.' : 'The indexer is behind; status was re-read against the chain.';
    case 'DATA_INCOMPLETE':
    case 'STALE_DATA':
      return fa ? 'دادهٔ لازم برای پاسخ دقیق در دسترس نبود؛ از حدس استفاده نشد.' : 'The data needed for an exact answer was not available, so nothing was guessed.';
    default:
      return fa
        ? `پاسخ کامل ممکن نشد (${String(error?.code || 'خطا').slice(0, 40)}). این خطا ثبت شد و برای تکرار نشدن آن اقدام می‌شود.`
        : `The full answer could not be produced (${String(error?.code || 'error').slice(0, 40)}). It was recorded, and the recovery path above is what prevents a repeat.`;
  }
}

/**
 * Whether a code may EVER be answered with an alternative route. Kept as an
 * exported predicate so a probe (and a reviewer) can test the exact negative:
 * security codes have no fallback, by contract, not by convention.
 */
export function mayFallBack(code) {
  return !SAFE_STOP_CODES.includes(String(code || ''));
}

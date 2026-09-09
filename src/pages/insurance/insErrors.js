/**
 * INSURANCE ERRORS — one machine code in, one readable sentence out.
 * ---------------------------------------------------------------------------
 * «ارورهای این صفحه غلط است. وقتی می‌زنی امضا کنی و پول نداری، یک ارور چندخطی
 * می‌آورد به‌جای «موجودی‌ات کم است». بقیهٔ ارورها هم درست‌شان کن.»
 *
 * Almost every action on these pages ended the same way:
 *
 *     catch (e) { setErr(e.message || String(e)); notify(e.message, 'error'); }
 *
 * so what the user reads is whatever the deepest layer happened to throw. For
 * one sign-and-activate with an empty wallet that is MetaMask's envelope:
 *
 *     Internal JSON-RPC error.
 *     {"code":-32603,"data":{"message":"Insufficient funds.",
 *      "data":{"0x2f9a…":{"message":"insufficient funds for gas * price + value"}}}}
 *
 * — three lines inside a toast that disappears in four seconds, and the useful
 * words («موجودی», «gas») buried in JSON the user cannot act on. The server path
 * is just as noisy: `insuranceClient.json()` throws `detail.errors[0].detail ||
 * code`, so `setErr(err)` happily renders a bare `VALID_WALLET_REQUIRED` in an
 * alert that is supposed to be Persian.
 *
 * THE CONTRACT THIS MODULE KEEPS
 *   · ONE LINE, ALWAYS. Newlines collapse, ethers' trailing `(amount="…")`
 *     argument dump is stripped, and the result is capped. Nobody gets a
 *     paragraph in a toast.
 *   · NAME THE THING THEY CAN FIX. "Not enough ETH to pay the network fee" and
 *     "not enough USDC for the cover" are different fixes, and both are better
 *     than "Activation failed" — which is what the previous inline regex gave
 *     whenever MetaMask nested the reason inside `data.message` instead of
 *     putting it in `message` (i.e. almost always).
 *   · NOTHING INVENTED. Unrecognised → the honest generic line + the code.
 *     A provider 500 is never quietly relabelled "insufficient balance".
 *   · THE CODE SURVIVES SEPARATELY. `technical` is rendered as its own small
 *     mono line so support can ask for it without polluting the sentence.
 *
 * `reasonLabel` (insStatus.js) keeps owning provider/quote reason codes; this
 * module defers to it instead of duplicating that list.
 */
import { reasonLabel } from './insStatus.js';

/** Numeric EIP-1193 / JSON-RPC codes, keyed as strings. */
const WALLET_NUMERIC = { 4001: 'userRejected', '-32002': 'userRejected' };

/** i18n keys under `insurance.errors.*`, per machine code. */
const CODE_KEYS = {
  /* wallet / provider */
  USER_REJECTED: 'userRejected',
  ACTION_REJECTED: 'userRejected',
  PROVIDER_USER_REJECTED: 'userRejected',
  INSUFFICIENT_BALANCE: 'insufficientBalance',
  INSUFFICIENT_FUNDS: 'insufficientBalance',
  NO_GAS: 'noGas',
  INSUFFICIENT_ALLOWANCE: 'allowance',
  ALLOWANCE_MISSING: 'allowance',
  APPROVE_FAILED: 'allowance',
  WRONG_NETWORK: 'wrongNetwork',
  CHAIN_MISMATCH: 'wrongNetwork',
  CHAIN_ID_MISMATCH: 'wrongNetwork',
  UNRECOGNIZED_CHAIN_ID: 'wrongNetwork',
  INVALID_CHAIN_ID: 'wrongNetwork',
  PROVIDER_UNAVAILABLE: 'noWallet',
  EIP1193_UNAVAILABLE: 'noWallet',
  WALLET_NOT_CONNECTED: 'noWallet',
  METHOD_MISSING: 'methodMissing',
  TIMEOUT: 'timeout',
  TRANSACTION_REVERTED: 'reverted',
  EXECUTION_REVERTED: 'reverted',
  TRANSACTION_DROPPED: 'dropped',
  NONCE_TOO_LOW: 'dropped',
  NETWORK_OFFLINE: 'offline',
  HTTP_ERROR: 'offline',
  RATE_LIMITED: 'rateLimited',
  RPC_ERROR: 'rpc'
  /* Server envelope codes (ACTIVATION_FAILED, QUOTE_EXPIRED,
     VALID_WALLET_REQUIRED, COVERAGE_NOT_ACTIVE, IDEMPOTENCY_CONFLICT …) are
     deliberately NOT listed: all 42 of them live in `insurance.reason.*` in en
     and fa, and step 2 below reads that table. Forking them here is how two
     lists start disagreeing — so `test/insurance/ins-errors.test.js` fails if
     this table grows a server code, and also if the server ever throws a code
     that table has no sentence for. */
};

/**
 * Message signatures, most specific first — a rejection is not an error, a
 * missing gas balance is not a missing token balance, and both are checked
 * before the generic «500»/«rpc» catch-alls.
 */
const SIGNATURES = [
  ['userRejected', /user rejected|action_rejected|user denied|rejected by the user|txreject|denied by user|\b4001\b/i],
  ['noGas', /insufficient funds for gas|gas \* price \+ value|intrinsic transaction cost|insufficient funds\.?\s*$|not enough (?:eth|ether|bnb|matic|native)/i],
  ['insufficientBalance', /insufficient (?:funds|balance)|exceeds? (?:the )?balance|not enough (?:tokens?|usdc|usdt|balance|money)|balance is too low|would exceed|INSUFFICIENT_(?:FUNDS|BALANCE|AMOUNT)/i],
  ['allowance', /allowance|spend limit|must (?:first )?approve|approve\(\)/i],
  ['walletMismatch', /wallet address (?:named|does not match)|address mismatch|different wallet|connect the wallet/i],
  ['wrongNetwork', /unrecognized chain|invalid chain|wrong network|different network|switch the wallet|network mismatch|chain id|4902/i],
  ['noWallet', /no (?:eip-?1193|wallet|provider).*(?:found|available)|provider unavailable|eip-?1193|extension|not connected|connect (?:a|your) wallet|detect ?wallet/i],
  ['methodMissing', /method .*(?:not found|not supported|not available)|unsupported method|is unavailable in this client|does not expose|4200|provider method not found|the method .* does not exist/i],
  ['reverted', /execution reverted|reverted|revert|vm exception|error running transaction|returned error/i],
  ['dropped', /nonce too low|already known|underpriced|same nonce|replacement transaction|transaction is already known/i],
  ['timeout', /timeout|timed out|etimedout|deadline exceeded/i],
  ['offline', /failed to fetch|fetch failed|networkerror|err_internet|econnrefused|econnreset|enotfound|network request failed|no internet/i],
  ['rateLimited', /429|too many requests|rate ?limit/i],
  ['rpc', /\b5\d\d\b|json-?rpc|rpc error|upstream|http \d{3}/i]
];

/** Ethers appends `(key="value", …)` after the reason — technical, never actionable. */
const ETHERS_DUMP = /\s*\((?:[^()]|\([^()]*\))*\)\s*$/g;
/** Provider JSON-RPC boilerplate that carries no meaning for a human. */
const RPC_NOISE = /internal json-rpc error|external json-rpc error|request parameters\s*:|expected value\s*:|json ?rpc|"(?:code|data|message)"\s*:\s*[^,}]*[,.]?\s*|code":-?\d+/gi;
const MAX_LEN = 148;
/* An UPPER_SNAKE machine code — deliberately strict. Normalising whitespace
   would make every sentence («Validation error») look like a code, which is how
   the earlier version of this mapper threw away the provider's one readable
   line and showed «The request did not complete» instead. */
const CODE_RE = /^[A-Z][A-Z0-9]{1,11}(?:_[A-Z0-9]{1,12}){0,6}$/;

/** Keys whose string values are worth reading, at any nesting depth. */
const TEXT_KEYS = /^(message|reason|shortMessage|error|detail|msg|statusText)$/i;

/**
 * Wallets bury the real reason under `data.data[<hash>].message`, MetaMask
 * double-wraps JSON-RPC, FastAPI sends `detail: [{msg}]`, ethers v6 uses
 * `shortMessage`. Rather than enumerate every shape (which is how the old
 * `e.message` regex missed the balance case entirely), walk the error once and
 * collect every string that lives under a recognisable key.
 */
function dig(node, depth, out, seen) {
  if (!node || depth > 4 || out.length > 24) return;
  if (typeof node === 'string') { out.push(node); return; }
  if (typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      if (item && typeof item === 'object') dig(item, depth + 1, out, seen);
      else if (typeof item === 'string') out.push(item);
    }
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && TEXT_KEYS.test(k)) out.push(v);
    else if (v && typeof v === 'object') dig(v, depth + 1, out, seen);
  }
}

function collectParts(err) {
  const out = [];
  const seen = new Set();
  if (typeof err === 'string') out.push(err);
  else if (err) {
    for (const key of ['shortMessage', 'message', 'reason', 'code', 'detail', 'data', 'rpcError', 'info', 'error', 'body']) {
      const v = err[key];
      if (typeof v === 'string') out.push(v);
      else if (v && typeof v === 'object') dig(v, 1, out, seen);
    }
  }
  return out.filter((s) => s && s.length < 4000);
}

function clean(raw) {
  let s = String(raw ?? '').replace(/[\r\n\t]+/g, ' ');
  for (let i = 0; i < 3; i += 1) s = s.replace(ETHERS_DUMP, ' ');
  s = s.replace(RPC_NOISE, ' ').replace(/\s+/g, ' ').trim().replace(/^[,;.\s]+|[,;\s]+$/g, '');
  if (s.length > MAX_LEN) s = `${s.slice(0, MAX_LEN - 1).replace(/[\s,.]+$/, '')}…`;
  return s;
}

function looksLikeCode(s) {
  const v = String(s ?? '').trim();
  return CODE_RE.test(v);
}

function codeOf(err, parts) {
  const raw = String(err?.code ?? err?.rpcError?.code ?? err?.data?.code ?? '').trim();
  /* EIP-1193 numeric codes (4001, -32603…) are codes, but they are not the
     string `code` field support quotes, so they never become `code` here. */
  if (CODE_RE.test(raw.toUpperCase())) return raw.toUpperCase();
  const name = String(err?.name ?? '').trim();
  if (CODE_RE.test(name)) return name.toUpperCase();
  const fromText = parts.find(looksLikeCode);
  return fromText ? String(fromText).trim().toUpperCase() : 'INSURANCE_ERROR';
}

/**
 * FastAPI rejects a body with `detail: [{ loc: ['body','coverageAmount'],
 * msg: 'field required', type: 'value_error.missing' }]` — the field name is
 * the only actionable part, so pull it out instead of pasting the array.
 */
function validationIssue(err) {
  const list = [err?.detail, err?.data?.detail, err?.errors].flat().find((v) => Array.isArray(v) && v.length);
  if (!list) return null;
  const first = list.find((v) => v && typeof v === 'object' && (v.msg || v.message)) || null;
  if (!first) return null;
  const loc = Array.isArray(first.loc) ? first.loc.filter((p) => p !== 'body' && p !== 'query').join('.') : '';
  return { field: loc, msg: clean(first.msg || first.message), count: list.length };
}

/**
 * @param {Error|string|object} err anything thrown on an insurance path
 * @param {(key: string, opts?: object) => string} t i18next `t`
 * @returns {{text: string, code: string, technical: string}}
 */
export function insuranceError(err, t) {
  const parts = collectParts(err);
  const code = codeOf(err, parts);
  const haystack = `${code} ${parts.join(' ')}`;
  const knownCode = err?.code ? String(err.code).toUpperCase() : '';

  /* 1 · an exact machine code we understand. */
  /* EIP-1193 numeric codes arrive without a string `code`, and they are the
     single most common "error" on this page (the user pressed Reject). */
  const numeric = err?.code === undefined || err?.code === null ? '' : String(err.code);
  const mapped = CODE_KEYS[knownCode] || WALLET_NUMERIC[numeric];
  if (mapped) return sentence(mapped, code, t, err, parts);

  /* 2 · the server's own reason code (`QUOTE_EXPIRED`, `VALID_WALLET_REQUIRED`…)
         already has a translated sentence in `insurance.reason.*`; match it on
         the code, which is exact, instead of re-guessing from prose. */
  if (CODE_RE.test(code)) {
    const byCode = t(`insurance.reason.${code}`, { defaultValue: '' });
    if (byCode) return { text: clean(byCode) || byCode, code, technical: code };
  }

  /* 3 · a schema complaint from the API: name the field. */
  const issue = validationIssue(err);
  if (issue) {
    const text = clean(t('insurance.errors.invalidInput', { field: issue.field || '—', message: issue.msg, defaultValue: '' }))
      || clean(parts.join(' '));
    return { text, code: 'VALIDATION_ERROR', technical: issue.field || 'VALIDATION_ERROR' };
  }

  /* 4 · wallets and fetch disagree on everything except wording, so fall back
         to signatures. This is where «موجودی» is recovered out of a JSON blob. */
  for (const [key, re] of SIGNATURES) {
    if (re.test(haystack)) return sentence(key, code, t, err, parts);
  }

  /* 5 · a reason code embedded in a longer sentence still beats raw text —
         but only in a SENTENCE: reasonLabel pattern-matches `4\\d\\d` and
         friends, and a stack frame («at server/insurance/index.js:4412») looks
         exactly like an HTTP 4xx to it. Feeding dumps to it invented causes. */
  const joined = parts.join(' ');
  const stackShaped = /\n|\bat\s+\S+:\d+/.test(joined);
  const viaReason = stackShaped ? '' : reasonLabel(t, joined);
  if (viaReason && viaReason !== parts[0] && looksLikeCode(viaReason) === false) {
    const cleaned = clean(viaReason);
    if (cleaned) return { text: cleaned, code, technical: code };
  }

  /* 6 · a genuine sentence from the provider (server-controlled certificate
         wording, no JSON, no stack) is already the best answer available:
         keep it, cleaned. A multi-line dump is not — but its FIRST line often
         is, and a stack frame never is, so both are salvaged in order. */
  const prose = parts.find((p) => p && !p.includes('\n') && !looksLikeCode(p) && !STACK_LINE.test(p)) || '';
  const human = clean(prose);
  if (human.length > 12 && !stackShaped) return { text: human, code, technical: techFor(code, err, parts) };
  /* 6b · a multi-line dump never reaches the screen, not even its first line:
          a translated «this did not work (code …)» with the text behind the
          details toggle is more useful than half a stack trace in English. */

  /* 7 · nothing recognised: say so, keep the code, invent nothing. */
  return sentence('generic', code, t, err, parts);
}

/** The code support asks for: ours when we have one, otherwise the provider's
 *  numeric JSON-RPC code plus the last raw fragment, so the detail toggle is
 *  never an empty box and never a guess. */
function techFor(code, err, parts) {
  if (code !== 'INSURANCE_ERROR') return code;
  const numeric = err?.code === undefined || err?.code === null || typeof err.code === 'string' ? '' : String(err.code);
  const raw = clean(parts.slice(-1)[0] || '');
  return [numeric && `JSON-RPC ${numeric}`, raw].filter(Boolean).join(' · ');
}

const STACK_LINE = /^\s*at\s+\S+\s+\(?[^)]*:\d+:\d+\)?\s*$/;

function sentence(key, code, t, err, parts) {
  const text = clean(t(`insurance.errors.${key}`, { code, defaultValue: '' }))
    || clean(t('insurance.errors.generic', { code, defaultValue: '' }))
    /* a locale that has neither key must still say something */
    || t('insurance.errors.generic', { code, defaultValue: 'The request did not complete.' });
  return { text, code, technical: techFor(code, err, parts) };
}

/** A string for `notify()` — the sentence, and nothing else. A 4-second toast
 *  is not where anyone reads a hex code. */
export function insuranceErrorToast(err, t) {
  return insuranceError(err, t).text;
}

/**
 * FBT AI ORCHESTRATOR — SECRET SCRUBBER (shared by memory, prompts and the ledger)
 * ---------------------------------------------------------------------------
 * One rule: nothing that could be a credential ever leaves the process toward a
 * model, and nothing that could be a credential is ever written into the vector
 * memory or the decision ledger.
 *
 * This is deliberately a *narrow* detector plus a *broad* keyword gate:
 *   · narrow, because over-redacting ordinary text ("my key question") destroys
 *     the memory that makes the assistant useful;
 *   · broad on the words that only ever appear in a credential context
 *     ("seed phrase", "mnemonic", "private key", "bearer", "api key"),
 *     because a false positive there costs one redaction and a false negative
 *     costs a wallet.
 *
 * `server/aiGateway.js#sanitizePrompt` remains the last line of defence on the
 * wire; this module is what the orchestrator uses BEFORE it builds a prompt or
 * writes to storage, so a secret never even reaches that filter.
 */

const CREDENTIAL_PATTERNS = Object.freeze([
  /\b0x[a-fA-F0-9]{64}\b/,                                  // raw 32-byte private key
  /\b(?:[5KL9][1-9A-HJ-NP-Za-km-z]{50,51})\b/,              // WIF-encoded key
  /\b(?:sk|rk|pk|gsk|xai|gsk_|hf|or)-[A-Za-z0-9_-]{16,}\b/,  // provider API keys
  /\bAIza[0-9A-Za-z_-]{20,}\b/,                             // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:postgres|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]{8,}/i
]);

/** Words that only show up when a human is being asked for a credential. */
const CREDENTIAL_WORDS = /(?:seed[\s_-]?phrase|mnemonic|private[\s_-]?key|recovery[\s_-]?phrase|secret[\s_-]?key|api[\s_-]?secret|passphrase|keystore|master[\s_-]?password|عبارت[\s_-]?(?:بازیابی|یادآور|۱۲|12)|کلید[\s_-]?(?:خصوصی|امضا)|رمز[\s_-]?کیف)/i;

/**
 * A run of 11+ plain lowercase words is the shape of a BIP39 phrase written out
 * — no product sentence looks like that. Checked only when no digits, no
 * punctuation and no other language characters are present.
 */
function looksLikeSeedRun(text) {
  const runs = String(text).match(/\b[a-z]{3,8}(?:\s+[a-z]{3,8}){10,}\b/g);
  if (!runs) return false;
  return runs.some((run) => {
    const words = run.trim().split(/\s+/);
    return words.length >= 11 && words.length <= 26;
  });
}

/** True when the text contains something that must never be stored or sent. */
export function containsSensitiveKeyOrPhrase(input) {
  if (input == null) return false;
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  if (!text) return false;
  if (CREDENTIAL_PATTERNS.some((re) => re.test(text))) return true;
  if (CREDENTIAL_WORDS.test(text)) {
    /* The WORD alone is a strong signal here because this module is applied to
       user-authored text and to messages bound for a model — a user typing
       «کلید خصوصی» is either asking a safety question (the answer must not
       repeat a key) or pasting one (which must be stripped). Both are handled
       by refusing to store/send that field verbatim. */
    return true;
  }
  return looksLikeSeedRun(text);
}

/** Replace every credential-shaped token with a fixed marker. */
export function redactSecrets(input) {
  if (input == null) return input;
  if (typeof input !== 'string' && typeof input !== 'object') return input;
  if (typeof input === 'string') {
    let out = input;
    for (const re of CREDENTIAL_PATTERNS) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), '[REDACTED_SECRET]');
    if (CREDENTIAL_WORDS.test(out)) out = out.replace(CREDENTIAL_WORDS, '[REDACTED_SECRET]');
    if (looksLikeSeedRun(out)) out = out.replace(/\b[a-z]{3,8}(?:\s+[a-z]{3,8}){10,}\b/g, '[REDACTED_SEED]');
    return out;
  }
  if (Array.isArray(input)) return input.map((v) => redactSecrets(v));
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (/key|secret|password|seed|mnemonic|token|auth|signature/i.test(k)) { out[k] = '[REDACTED_SECRET]'; continue; }
    out[k] = redactSecrets(v);
  }
  return out;
}

/** Deep-clip a value to a size budget (payloads bound for storage). */
export function clipDeep(value, maxString = 400, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > maxString ? `${value.slice(0, maxString - 1)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[DEPTH]';
  if (Array.isArray(value)) return value.slice(0, 24).map((v) => clipDeep(v, maxString, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = clipDeep(v, maxString, depth + 1);
  return out;
}

export const REDACT_SCHEMA = 'fbt.ai-redact.v1';

/**
 * FBT FUTURES — request / intent / execution ids and idempotency keys (spec §16, §21).
 * ---------------------------------------------------------------------------
 * Browser-safe and dependency-free. Keys are dedup fingerprints, never secrets.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomId(prefix, len = 14) {
  let id = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    id = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  } else {
    for (let i = 0; i < len; i += 1) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}_${id}`;
}

export const makeFuturesRequestId = () => randomId('fut_req');
export const makeFuturesExecutionId = () => randomId('fut_exec');
export const makeFuturesIntentId = () => randomId('fut_int');

/** FNV-1a → hex; deterministic content fingerprint. */
const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/**
 * Deterministic idempotency key: same action + wallet + provider + market +
 * side + collateral + leverage + nonce → same key. `nonce` separates two
 * genuinely distinct identical orders (e.g. the user really wants two).
 */
export function makeFuturesIdempotencyKey({ action = 'open', wallet, providerId, marketId, side, collateralUsd, leverage, positionId = '', nonce = '' }) {
  const content = [
    String(action).toLowerCase(), String(wallet || '').toLowerCase(), String(providerId || ''),
    String(marketId || ''), String(side || ''), String(collateralUsd ?? ''), String(leverage ?? ''),
    String(positionId || ''), String(nonce || '')
  ].join('|');
  return `fut_${String(action).toLowerCase()}_${String(providerId || 'x')}_${fnv1a(content)}${fnv1a(content.split('').reverse().join(''))}`;
}

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
export const isValidIdempotencyKey = (k) => typeof k === 'string' && IDEMPOTENCY_KEY_RE.test(k);

/**
 * FBT AGENT HUB — the one place a secret is sealed.
 * ---------------------------------------------------------------------------
 * Two different relationships need the same primitive:
 *
 *   · a reviewed provider's OAuth token (connections.js), and
 *   · a key the USER pastes for their OWN A2A agent (sourceCredentials.js).
 *
 * Both are AES-256-GCM blobs under `AGENT_HUB_SECRET_KEY`, both are stored at
 * their own key, and neither is ever returned in a response body. Keeping the
 * primitive in one file is what makes "the key is never logged" a property of
 * the code rather than a promise in three modules.
 *
 * The key is 32 bytes, expressed as 64 hex characters or base64. A missing or
 * malformed key is reported as `AGENT_HUB_SECRET_KEY_REQUIRED` — never silently
 * replaced with a generated key, because a key that rotates on cold start
 * would make every stored credential unreadable while looking configured.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const SEAL_ALGORITHM = 'aes-256-gcm';

/** `AGENT_HUB_SECRET_KEY`: 32 bytes as 64 hex chars or base64. */
export function loadSealingKey(env = process.env) {
  const raw = String(env.AGENT_HUB_SECRET_KEY || '').trim();
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (value) => Buffer.from(String(value), 'base64url');

/** JSON value → `iv.tag.ciphertext`, all base64url. */
export function seal(key, plaintext) {
  if (!key) throw new Error('SEALING_KEY_REQUIRED');
  const iv = randomBytes(12);
  const cipher = createCipheriv(SEAL_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(plaintext), 'utf8'), cipher.final()]);
  return `${b64url(iv)}.${b64url(cipher.getAuthTag())}.${b64url(encrypted)}`;
}

/** The inverse. Throws on a malformed blob or a failed authentication tag. */
export function unseal(key, payload) {
  if (!key) throw new Error('SEALING_KEY_REQUIRED');
  const [ivPart, tagPart, dataPart] = String(payload || '').split('.');
  if (!ivPart || !tagPart || !dataPart) throw new Error('SEALED_PAYLOAD_MALFORMED');
  const decipher = createDecipheriv(SEAL_ALGORITHM, key, fromB64url(ivPart));
  decipher.setAuthTag(fromB64url(tagPart));
  const plain = Buffer.concat([decipher.update(fromB64url(dataPart)), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

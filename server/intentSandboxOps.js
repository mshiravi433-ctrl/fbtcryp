/**
 * FBT INTENT AI — SANDBOX OPERATIONAL PROVISIONING (dev/preview only).
 * ---------------------------------------------------------------------------
 * The signed auction-closing ceremony needs two operator secrets that a fresh
 * deployment does not have: the coordinator Ed25519 private key and the close
 * token. Without them the network status board reports "close unavailable"
 * even though the whole protocol is implemented.
 *
 * In sandbox mode (the same gate as the sandbox operator evidence — see
 * intentSandboxEvidence.js) this module provisions LOCAL secrets so every
 * part of the signed-close flow actually runs in dev and preview: coordinator
 * identity + keyring, close token, activatedAt. The coordinator key is
 * persisted under `.sandbox/` (gitignored) so the identity is stable across
 * restarts; the close token is derived from that key, so the same operator
 * can re-derive it.
 *
 * Real operator-supplied env values ALWAYS win (they are only set when
 * absent), so a production deployment with real secrets is never touched,
 * and sandbox mode is off in production by default.
 */

import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sandboxEvidenceEnabled } from './intentSandboxEvidence.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SANDBOX_DIR = resolve(REPOSITORY_ROOT, '.sandbox');
const COORDINATOR_KEY_FILE = resolve(SANDBOX_DIR, 'coordinator-key.b64url');

let provisioned = false;

/** Load a persisted sandbox coordinator key, or create + persist one. */
function sandboxCoordinatorKey() {
  if (existsSync(COORDINATOR_KEY_FILE)) {
    const existing = readFileSync(COORDINATOR_KEY_FILE, 'utf8').trim();
    if (/^[A-Za-z0-9_-]{40,128}$/.test(existing)) return existing;
  }
  const { privateKey } = generateKeyPairSync('ed25519');
  const encoded = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url');
  try {
    mkdirSync(SANDBOX_DIR, { recursive: true });
    writeFileSync(COORDINATOR_KEY_FILE, encoded, { mode: 0o600 });
  } catch {
    /* Non-fatal: the in-process key still works for this boot. */
  }
  return encoded;
}

/** Provision once, at import time. No-op when sandbox mode is off. */
export function provisionSandboxOps(env = process.env) {
  if (provisioned) return;
  provisioned = true;
  if (!sandboxEvidenceEnabled(env)) return;

  /* Coordinator identity — only when the operator did not supply one. The
     key format is the app's canonical Ed25519 encoding: base64url PKCS8 DER
     (see intentSignatures.privateKeyObject). */
  if (!String(env.INTENT_COORDINATOR_PRIVATE_KEY || '').trim()) {
    const key = sandboxCoordinatorKey();
    env.INTENT_COORDINATOR_ID = String(env.INTENT_COORDINATOR_ID || 'fbt-sandbox-coordinator').toLowerCase();
    env.INTENT_COORDINATOR_PRIVATE_KEY = key;
    env.INTENT_COORDINATOR_KEY_ACTIVATED_AT = String(Date.now());
  }

  /* Signed-close auth token — only when the operator did not supply one.
     Derived deterministically from the sandbox coordinator key so the close
     flow is reproducible across restarts and the operator can re-derive it. */
  if (String(env.INTENT_AUCTION_CLOSE_TOKEN || '').length < 32) {
    const seed = String(env.INTENT_COORDINATOR_PRIVATE_KEY || '');
    env.INTENT_AUCTION_CLOSE_TOKEN = seed
      ? createHash('sha256').update(`fbt.sandbox-close-token.v1\n${seed}`).digest('hex')
      : randomBytes(48).toString('hex');
  }
}

provisionSandboxOps();

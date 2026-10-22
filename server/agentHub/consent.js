/**
 * FBT EXTERNAL AGENT HUB — consent, server half (§12, §14).
 * ---------------------------------------------------------------------------
 * The message itself is composed by `src/lib/intent-ai/agentHub/consent.js`,
 * which the browser uses for the preview. Same function, same bytes: what the
 * user approved is what the provider receives, and there is no second
 * implementation that could drift.
 *
 * This half adds the two things only the server may do:
 *   · hash the exact message (one SHA-256, truncated) — the task row stores the
 *     hash, so FBT can prove what was approved without keeping a copy of the
 *     portfolio it just handed to a third party;
 *   · write the consent RECORD: provider, categories, hash, policy versions.
 *
 * Nothing here is execution. A shared portfolio total is read-only context; it
 * can never authorize a trade, a transfer or a wider risk limit.
 */
import { createHash } from 'node:crypto';
import {
  CONSENT_CATEGORIES,
  CONSENT_LABELS,
  MAX_MESSAGE,
  MAX_TASK,
  composeConsentMessage
} from '../../src/lib/intent-ai/agentHub/consent.js';

export const CONSENT_SCHEMA = 'fbt.agent-hub.consent.v1';
export const CONTEXT_CATEGORIES = CONSENT_CATEGORIES;
export const CONTEXT_LABELS = CONSENT_LABELS;

/** Server-side wrapper: compose + hash, one call. */
export function buildConsentPayload({ taskText, categories, context = {} } = {}) {
  const composed = composeConsentMessage({ taskText, categories, context });
  if (!composed.ok) return composed;
  return {
    ok: true,
    text: composed.text,
    hash: createHash('sha256').update(composed.text).digest('hex').slice(0, 32),
    categories: composed.categories,
    sections: composed.sections,
    bytes: composed.bytes
  };
}

export function consentRecord({ provider, categories, hash, termsVersion = null, privacyVersion = null, scope = 'per_task', at = Date.now() }) {
  return {
    providerId: provider.id,
    contextCategories: [...categories],
    approvedContextHash: hash,
    termsVersion: termsVersion ? String(termsVersion).slice(0, 40) : null,
    privacyVersion: privacyVersion ? String(privacyVersion).slice(0, 40) : null,
    scope: scope === 'persistent' ? 'persistent' : 'per_task',
    at
  };
}

export { MAX_MESSAGE, MAX_TASK };

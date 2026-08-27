/**
 * FBT INTENT AI — PHASE 77: HUMAN-READABLE TERMS DIFF
 * ---------------------------------------------------------------------------
 * "termsHash changed" is technically true and practically useless. When the
 * terms a user approved stop matching the terms about to execute, the user
 * needs to read the sentence "amount changed from 100 to 500" and decide.
 *
 *   · every change becomes a row: field, before, after, direction, severity
 *   · severity is MATERIAL for anything that moves money, risk or destination;
 *     material changes ALWAYS force re-confirmation, never a silent re-hash
 *   · a field we cannot read is a material change, not "unchanged"
 *   · the rows are i18n keys + params; this module writes no prose
 */

import { classifyFailure } from './failureModes.js';

export const TERMS_DIFF_SCHEMA = 'fbt.terms-diff.v1';

/** Fields that move money, risk, or destination. */
export const MATERIAL_FIELDS = Object.freeze([
  'amount', 'amountIn', 'amountOut', 'minReceived', 'token', 'tokenIn', 'tokenOut',
  'recipient', 'to', 'chainId', 'slippageBps', 'deadline', 'venue', 'route',
  'price', 'limitPrice', 'feeBps', 'spender', 'allowance'
]);

export const COSMETIC_FIELDS = Object.freeze(['label', 'note', 'displayName', 'icon', 'sortIndex']);

export const SEVERITIES = Object.freeze(['none', 'informational', 'material']);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const isMaterial = (field) => MATERIAL_FIELDS.includes(field);

function severityFor(field) {
  if (isMaterial(field)) return 'material';
  if (COSMETIC_FIELDS.includes(field)) return 'informational';
  // Unknown field: treat as material. Fail closed.
  return 'material';
}

function directionFor(before, after) {
  const b = num(before); const a = num(after);
  if (b === null || a === null) return null;
  if (a > b) return 'increased';
  if (a < b) return 'decreased';
  return 'unchanged';
}

function pctChange(before, after) {
  const b = num(before); const a = num(after);
  if (b === null || a === null || b === 0) return null;
  return Math.round(((a - b) / Math.abs(b)) * 10000) / 100;
}

function flatten(obj, prefix = '', out = {}, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out, depth + 1);
    else out[key] = Array.isArray(v) ? v.join(',') : v;
  }
  return out;
}

const leafName = (path) => String(path).split('.').pop();

/** Build the readable diff between the approved terms and the current terms. */
export function diffTerms({ approved = null, current = null } = {}) {
  if (!approved || typeof approved !== 'object' || !current || typeof current !== 'object') {
    return {
      ok: false, schema: TERMS_DIFF_SCHEMA, changes: [], hasMaterialChange: true,
      requiresReconfirmation: true,
      i18nKey: 'intentAI.termsDiff.unreadable',
      error: classifyFailure('MISSING_DATA', { detail: 'TERMS_UNREADABLE' })
    };
  }
  const a = flatten(approved);
  const b = flatten(current);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const changes = [];
  for (const key of keys) {
    const before = a[key];
    const after = b[key];
    if (before === after) continue;
    if (before === undefined && after === undefined) continue;
    const field = leafName(key);
    const kind = before === undefined ? 'added' : (after === undefined ? 'removed' : 'changed');
    changes.push({
      path: key,
      field,
      kind,
      before: before === undefined ? null : before,
      after: after === undefined ? null : after,
      direction: kind === 'changed' ? directionFor(before, after) : null,
      percentChange: kind === 'changed' ? pctChange(before, after) : null,
      severity: severityFor(field),
      // "amount changed from 100 to 500" — assembled by the translator, not here.
      i18nKey: `intentAI.termsDiff.row.${kind}`,
      i18nParams: {
        field,
        fieldLabelKey: `intentAI.termsDiff.field.${field}`,
        before: before === undefined ? null : String(before),
        after: after === undefined ? null : String(after)
      }
    });
  }
  const material = changes.filter((c) => c.severity === 'material');
  return {
    ok: true,
    schema: TERMS_DIFF_SCHEMA,
    changes,
    materialChanges: material,
    hasMaterialChange: material.length > 0,
    // A material change can never be waved through by re-hashing.
    requiresReconfirmation: material.length > 0,
    unchanged: changes.length === 0,
    i18nKey: changes.length === 0
      ? 'intentAI.termsDiff.identical'
      : (material.length ? 'intentAI.termsDiff.material' : 'intentAI.termsDiff.cosmetic'),
    i18nParams: { count: changes.length, material: material.length }
  };
}

/** The one-line summary shown next to the confirm button. */
export function summarizeDiff(diff) {
  if (!diff?.ok) return { ok: false, i18nKey: 'intentAI.termsDiff.unreadable', i18nParams: {}, requiresReconfirmation: true };
  if (diff.unchanged) return { ok: true, i18nKey: 'intentAI.termsDiff.identical', i18nParams: {}, requiresReconfirmation: false };
  const first = diff.materialChanges[0] || diff.changes[0];
  return {
    ok: true,
    i18nKey: 'intentAI.termsDiff.summary',
    i18nParams: {
      field: first.field,
      fieldLabelKey: first.i18nParams.fieldLabelKey,
      before: first.i18nParams.before,
      after: first.i18nParams.after,
      more: Math.max(0, diff.changes.length - 1)
    },
    requiresReconfirmation: diff.requiresReconfirmation
  };
}

/**
 * The gate. If the terms moved materially since approval, the previous
 * confirmation is void — the user confirms again or nothing executes.
 */
export function assertTermsUnchanged({ approved = null, current = null, approvedHash = null, currentHash = null } = {}) {
  const diff = diffTerms({ approved, current });
  if (!diff.ok) {
    return { ok: false, mayProceed: false, executionAuthorized: false, diff, i18nKey: diff.i18nKey, error: diff.error };
  }
  const hashesDiffer = Boolean(approvedHash && currentHash && approvedHash !== currentHash);
  if (diff.hasMaterialChange) {
    return {
      ok: false, mayProceed: false, executionAuthorized: false, requiresReconfirmation: true,
      diff, summary: summarizeDiff(diff), i18nKey: 'intentAI.termsDiff.material',
      error: classifyFailure('TERMS_CHANGED', { detail: diff.materialChanges[0].field })
    };
  }
  if (hashesDiffer) {
    // The hash moved but nothing readable did: we cannot explain it, so we stop.
    return {
      ok: false, mayProceed: false, executionAuthorized: false, requiresReconfirmation: true,
      diff, i18nKey: 'intentAI.termsDiff.unexplained',
      error: classifyFailure('TERMS_CHANGED', { detail: 'HASH_CHANGED_WITHOUT_VISIBLE_DIFF' })
    };
  }
  return {
    ok: true, mayProceed: true,
    // Passing this gate is not authorization; the confirmation gate still runs.
    executionAuthorized: false,
    requiresReconfirmation: false,
    diff, summary: summarizeDiff(diff),
    i18nKey: diff.unchanged ? 'intentAI.termsDiff.identical' : 'intentAI.termsDiff.cosmetic'
  };
}

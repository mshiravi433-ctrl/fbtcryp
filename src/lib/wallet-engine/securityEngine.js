/**
 * FBT WALLET ENGINE — SECURITY / RISK ENGINE
 * ---------------------------------------------------------------------------
 * One place that composes every local risk signal into a verdict before value
 * moves: a suspicious address, a suspicious contract, a dangerous token, a
 * dangerous approval, or unusual wallet behavior.
 *
 * The per-domain math is split across focused modules —
 *   · address facts  → recipientRisk()        in src/lib/walletRisk.js
 *   · token facts    → contractRisk()/GoPlus  in src/lib/tokenRisk.js
 *   · approval facts → scanApprovals()        in approvalManager.js (this dir)
 * — and this engine only JOINS them into a single `fbt.security-verdict.v1`.
 * It does not call scanners; the facts are injected by the caller, so the
 * engine stays pure, synchronous and testable.
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · `level:'unknown'` is a verdict. A recipient with no on-chain history is
 *   not "safe" — it is unverifiable, and the UI must say so.
 * · Flags are translation keys + facts, never sentences, and never a single
 *   reassuring "safe" badge built from the absence of data.
 */

import { recipientRisk } from '../walletRisk.js';

export const SECURITY_SCHEMA = 'fbt.security-verdict.v1';

const LEVEL_ORDER = { none: 0, low: 1, medium: 2, high: 3, unknown: 0 };
const maxLevel = (a, b) => (LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b);

/**
 * Assess a transfer destination from real on-chain facts.
 * Facts: txCount, code, checksummed, known, blocklisted.
 */
export function assessRecipient({ address = null, txCount = null, code = null, checksummed = null, known = null, blocklisted = null } = {}) {
  const flags = recipientRisk({ txCount, code, checksummed, known });
  if (blocklisted === true) flags.push('blocklisted');

  /* `known` is a POSITIVE signal, not a risk flag — filter it out of the
     negatives so a known, active EOA reads as clean instead of unknown. */
  const negatives = flags.filter((f) => f !== 'known');
  let level = 'unknown';
  if (flags.includes('blocklisted')) level = 'high';
  else if (negatives.includes('contract')) level = 'medium';
  else if (negatives.includes('fresh') || negatives.includes('unchecksummed')) level = 'low';
  else if (flags.includes('known') && txCount != null && txCount > 0) level = 'none';

  return { schema: SECURITY_SCHEMA, kind: 'recipient', address, level, flags };
}

/** Assess a token from injected scanner facts (mirrors tokenRisk.js signals). */
export function assessToken({ symbol = null, address = null, honeypot = null, verified = null, score = null } = {}) {
  const flags = [];
  let level = 'unknown';
  if (honeypot === true) { flags.push('honeypot'); level = 'high'; }
  else if (verified === false) { flags.push('unverified'); level = 'medium'; }
  else if (verified === true) level = 'low';
  if (score != null && Number(score) >= 60) { level = 'high'; flags.push('high-risk-score'); }
  return { schema: SECURITY_SCHEMA, kind: 'token', symbol, address, level, flags };
}

/**
 * Join recipient + token + approval risk into one transfer verdict.
 * The highest sub-level wins; `reasons` carry every flag so the UI can list
 * them, not just show a color.
 */
export function assessTransfer({ recipient = {}, token = {}, approval = {} } = {}) {
  const r = assessRecipient(recipient);
  const t = assessToken(token);
  const aLevel = approval?.risk && APPROVAL_LEVELS.includes(approval.risk) ? approval.risk : 'none';
  const level = maxLevel(maxLevel(r.level, t.level), aLevel === 'high' ? 'high' : aLevel === 'medium' ? 'medium' : 'none');
  return {
    schema: 'fbt.security-transfer.v1',
    level,
    recipient: r,
    token: t,
    approvalRisk: aLevel,
    flags: [...r.flags, ...t.flags],
    blocked: level === 'high'
  };
}

const APPROVAL_LEVELS = ['none', 'low', 'medium', 'high'];

/**
 * Unusual wallet-behavior heuristics over a list of events. Events are plain
 * `{ kind, ts, valueUsd, to }` rows; the engine flags patterns a human would
 * stop at, and the caller decides whether to block or just warn.
 */
export function detectUnusualBehavior(events = [], { now = Date.now() } = {}) {
  const rows = Array.isArray(events) ? events : [];
  const flags = [];
  const recent = rows.filter((e) => now - (e.ts || 0) < 5 * 60 * 1000);
  if (recent.length >= 5) flags.push('rapid-fire');

  const large = rows.filter((e) => Number(e.valueUsd) >= 10000);
  if (large.length) flags.push('large-transfer');

  const firstLarge = rows
    .filter((e) => Number(e.valueUsd) >= 10000)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))[0];
  if (firstLarge && rows.filter((e) => (e.ts || 0) < (firstLarge.ts || 0)).length === 0) {
    flags.push('first-action-large');
  }

  const distinctTo = new Set(rows.map((e) => e.to).filter(Boolean));
  if (distinctTo.size >= 10) flags.push('fan-out');

  return {
    schema: 'fbt.behavior-verdict.v1',
    flags,
    level: flags.length ? (flags.includes('first-action-large') ? 'medium' : 'low') : 'none'
  };
}

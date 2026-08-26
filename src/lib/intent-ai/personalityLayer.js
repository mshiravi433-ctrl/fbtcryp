/**
 * FBT INTENT AI — Spec 65 items 46–47: Personality Layer and Agent Avatar.
 *
 * Personality is tone only: Professional / Friendly / Analytical / Minimal /
 * Technical. It rewrites presentation strings. It can never change risk
 * labels, policy decisions, Guardian outcomes, limits or STOP — a probe
 * helper is exported so tests can prove that invariance. Avatars are visual
 * identity only and grant nothing.
 */

import { containsRawSecret, fail, noExecutionPermission, safeString } from './phaseBoundary.js';

export const PERSONALITY_SCHEMA = 'fbt.intent-personality.v1';
export const AGENT_AVATAR_SCHEMA = 'fbt.intent-agent-avatar.v1';

export const PERSONALITY_TONES = Object.freeze(['professional', 'friendly', 'analytical', 'minimal', 'technical']);

const GLYPHS = Object.freeze({
  research: '🔍', guardian: '🛡', execution: '⚙', risk: '⚖', external: '🌐',
  strategy: '🧭', market: '📊', liquidity: '💧', learning: '📚', auditor: '🧾'
});
const PALETTE = Object.freeze(['blue', 'green', 'amber', 'violet', 'cyan']);

function toneWrapper(tone) {
  switch (tone) {
    case 'friendly': return (text) => `👋 ${text}`;
    case 'analytical': return (text) => `📈 ${text}`;
    case 'minimal': return (text) => text.split(/(?<=\.)\s+/)[0] || text;
    case 'technical': return (text) => `[tech] ${text}`;
    default: return (text) => text;
  }
}

/**
 * Apply tone to display text. The function receives the text and returns
 * display text — nothing else. Risk/policy payloads pass through untouched.
 */
export function applyPersonality({ tone = 'professional', text = null, now = Date.now() } = {}) {
  if (containsRawSecret({ tone, text })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const selected = PERSONALITY_TONES.includes(tone) ? tone : null;
  if (!selected) return fail('UNKNOWN_TONE', String(tone || ''));
  const body = safeString(text, 1000);
  if (!body) return fail('TEXT_REQUIRED');
  const wrap = toneWrapper(selected);
  return noExecutionPermission({
    ok: true,
    schema: PERSONALITY_SCHEMA,
    tone: selected,
    displayText: wrap(body),
    scope: 'display-only',
    riskEffect: 'none',
    policyEffect: 'none',
    guardianEffect: 'none',
    stopEffect: 'none',
    limitEffect: 'none',
    appliedAt: now
  });
}

/**
 * Proof helper: given the same safety payload, two different tones must
 * produce identical safety fields. Used by tests/UI to keep the promise
 * checkable.
 */
export function personalityCannotChangeRisk(applyA, applyB, safetyPayload) {
  const keys = ['riskEffect', 'policyEffect', 'guardianEffect', 'stopEffect', 'limitEffect', 'riskLevel', 'decision', 'maxLossPct', 'riskCapPct'];
  const a = typeof applyA === 'object' && applyA !== null ? applyA : {};
  const b = typeof applyB === 'object' && applyB !== null ? applyB : {};
  const pick = (source) => Object.fromEntries(keys.filter((key) => key in safetyPayload || key in source).map((key) => [key, source[key] ?? safetyPayload[key]]));
  return JSON.stringify(pick(a)) === JSON.stringify(pick(b));
}

/**
 * Spec 65 item 47 — visual identity for internal and external agents.
 * Deterministic, decorative, permission-free.
 */
export function agentAvatar({ agentId = null, role = null, now = Date.now() } = {}) {
  if (containsRawSecret({ agentId, role })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const id = safeString(String(agentId || ''), 80);
  if (!id) return fail('AGENT_ID_REQUIRED');
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const glyph = GLYPHS[role] || '🤖';
  const color = PALETTE[hash % PALETTE.length];
  return noExecutionPermission({
    ok: true,
    schema: AGENT_AVATAR_SCHEMA,
    agentId: id,
    role: safeString(String(role || ''), 40) || 'agent',
    glyph,
    color,
    decorative: true,
    grantsPermission: false,
    grantsTrust: false,
    affectsGuardian: false,
    generatedAt: now
  });
}

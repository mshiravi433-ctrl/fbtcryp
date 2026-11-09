/**
 * FBT AI — CLAIM LEDGER (what the specialists actually asserted)
 * ---------------------------------------------------------------------------
 * The collaboration engine verifies the FINAL answer's claims (`verifyClaims`)
 * and flags numbers the evidence cannot source (`aiEvidenceAudit`), but until
 * now the SYNTHESISER wrote blind: it saw a digest of prose, not the verdicts.
 * A claim supported by live tool data and a claim that three models merely
 * repeated looked identical in that digest, and two analysts quoting different
 * prices for the same asset were averaged into one confident paragraph.
 *
 * This module builds a deterministic ledger BEFORE synthesis:
 *
 *   1. which factual claims tool data / web evidence actually supports;
 *   2. which claim only models agree on (analysis, not fact);
 *   3. where two analysts give DIFFERENT numbers for the SAME subject.
 *
 * No model call, no invention: the classification comes from `verifyClaims`,
 * the conflicts from comparing extracted numbers per subject. The ledger is
 * given to the synthesiser and to the adversarial reviewer, and published in
 * the reply. It never edits an answer.
 */

import { extractNumbers, normalizeDigits } from './aiEvidenceAudit.js';

export const CLAIM_LEDGER_SCHEMA = 'fbt.ai-claim-ledger.v1';

/* Asset names as people and models write them. The subject is always reported
   with the ticker from the price map, never with the alias. */
const ASSET_ALIASES = {
  BTC: ['بیت‌کوین', 'بیت کوین', 'bitcoin'],
  ETH: ['اتریوم', 'اتریوم‌', 'ethereum'],
  SOL: ['سولانا', 'solana'],
  BNB: ['بایننس کوین', 'binance coin'],
  XRP: ['ریپل', 'ripple'],
  DOGE: ['دوج', 'dogecoin'],
  ADA: ['کاردانو', 'cardano'],
  TON: ['تون کوین', 'toncoin']
};

function fold(text) {
  return normalizeDigits(text)
    .replace(/\u200c/g, '')
    .replace(/[\u064a\u0649]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .toLowerCase();
}

function aliasPattern(alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* Latin tickers must be whole words («method» is not ETH); Persian aliases
     are matched as substrings, which is how they are actually written. */
  return /^[a-z0-9]+$/.test(alias)
    ? new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`)
    : null;
}

function mentions(folded, alias) {
  const re = aliasPattern(alias);
  if (re) return re.test(folded);
  return alias.length > 1 && folded.includes(alias);
}

/**
 * Build the ledger.
 * @param {object} params
 * @param {Array} params.verified         output of verifyClaims().verified
 * @param {Array} params.consensusOnly    output of verifyClaims().aiConsensusOnly
 * @param {Array} params.factualClaims    every factual claim (with role)
 * @param {object} params.context         safe context (market.priceMap used as reference)
 */
export function buildClaimLedger({ verified = [], consensusOnly = [], factualClaims = [], context = {} } = {}) {
  const symbols = Object.keys(context?.market?.priceMap || {})
    .filter((s) => /^[A-Za-z0-9]{2,10}$/.test(s));
  const priceOf = (symbol) => {
    const raw = context?.market?.priceMap?.[symbol];
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const entries = [];
  for (const c of factualClaims) {
    const text = String(c?.claim || '').trim();
    if (!text) continue;
    const folded = fold(text);
    const subjects = symbols.filter((s) => {
      const aliases = [s, ...(ASSET_ALIASES[s.toUpperCase()] || [])].map(fold);
      return aliases.some((a) => a && mentions(folded, a));
    });
    const values = extractNumbers(text).map((n) => n.value).filter((v) => Number.isFinite(v) && Math.abs(v) >= 100);
    if (!subjects.length || !values.length) continue;
    entries.push({ role: c.role || null, text, subjects, values: [...new Set(values)] });
  }

  const conflicts = [];
  for (const subject of new Set(entries.flatMap((e) => e.subjects))) {
    const group = entries.filter((e) => e.subjects.includes(subject));
    if (group.length < 2) continue;
    const disjoint = group.some((a, i) => group.some((b, j) => i < j
      && a.values.length && b.values.length
      && !a.values.some((v) => b.values.includes(v))));
    if (!disjoint) continue;
    const values = [...new Set(group.flatMap((e) => e.values))].sort((a, b) => a - b);
    conflicts.push({
      subject,
      values,
      roles: [...new Set(group.map((e) => e.role).filter(Boolean))],
      claims: group.slice(0, 3).map((e) => ({ role: e.role, claim: e.text.slice(0, 160), values: e.values })),
      toolValue: priceOf(subject),
      note: priceOf(subject) != null
        ? 'the tool price is the reference; a figure that contradicts it must be corrected or dropped'
        : 'no tool price for this subject; state the disagreement and what would settle it'
    });
  }

  return {
    schema: CLAIM_LEDGER_SCHEMA,
    verifiedCount: verified.length,
    consensusOnlyCount: consensusOnly.length,
    conflictCount: conflicts.length,
    verified: verified.slice(0, 6).map((c) => ({ role: c.role || null, claim: String(c.claim || '').slice(0, 160), basis: c.basis || null })),
    consensusOnly: consensusOnly.slice(0, 6).map((c) => ({ role: c.role || null, claim: String(c.claim || '').slice(0, 160) })),
    conflicts: conflicts.slice(0, 4),
    clean: conflicts.length === 0
  };
}

/**
 * The synthesiser/reviewer block. Empty string when there is nothing to say,
 * so a turn without factual claims sends the exact prompt it always did.
 */
export function renderClaimLedger(ledger) {
  if (!ledger || ledger.schema !== CLAIM_LEDGER_SCHEMA) return '';
  const lines = [];
  if (ledger.verified?.length) {
    lines.push('VERIFIED BY TOOL/WEB (may be stated as fact):');
    for (const c of ledger.verified) lines.push(`- [${c.role || 'analyst'}] ${c.claim} (${c.basis || 'evidence'})`);
  }
  if (ledger.consensusOnly?.length) {
    lines.push('AI-CONSENSUS ONLY (models agree but no trusted source confirms it — present as analysis, never as fact):');
    for (const c of ledger.consensusOnly) lines.push(`- [${c.role || 'analyst'}] ${c.claim}`);
  }
  if (ledger.conflicts?.length) {
    if (lines.length) lines.push('');
    lines.push('CONFLICTING FIGURES BETWEEN ANALYSTS (do not average them; resolve with the tool data or say plainly that it cannot be resolved):');
    for (const c of ledger.conflicts) {
      const parts = c.claims.map((x) => `${x.values.join('/')} [${x.role || 'analyst'}]`).join(' vs ');
      lines.push(`- ${c.subject}: ${parts}${c.toolValue != null ? ` — tool data says ${c.subject}=${c.toolValue}` : ' — no tool price available'}`);
    }
  }
  if (!lines.length) return '';
  return `ANALYST CLAIM LEDGER (what the specialists actually asserted — use it, do not average it away):\n${lines.join('\n')}`;
}

export default buildClaimLedger;

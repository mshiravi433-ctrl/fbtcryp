/**
 * FBT AI — NUMERIC EVIDENCE AUDIT (the "unsourced number" check)
 * ---------------------------------------------------------------------------
 * A model can be fluent, well-grounded in prose, and still invent the one
 * number that decides the answer: a support level, a yield, a fee, a price.
 * The collaboration engine already verifies STRUCTURED claims (`verifyClaims`),
 * but a number that never made it into the `claims` array was invisible.
 *
 * This module closes that gap deterministically — no model call, no guessing:
 *
 *   1. read every meaningful number in the draft answer (Persian/Arabic digits,
 *      thousands separators, decimals, percentages);
 *   2. build the corpus of numbers the draft was ALLOWED to use (tool context,
 *      verified knowledge, cited web snippets, and the analyses it synthesized);
 *   3. report the ones that appear nowhere.
 *
 * The report is fed to the adversarial reviewer as a MUST-FIX list and is
 * published in the reply metadata. It does NOT rewrite the text: an automatic
 * mask would delete legitimate computed ratios (fees, P&L, differences), and a
 * wrong deletion is worse than a flagged number.
 *
 * Thresholds are deliberate: 1–2 digit integers are excluded because they are
 * almost always list indices, counts or prose ("2 scenarios"), and flagging
 * them would train the reviewer to ignore the report. From 100 upward, and for
 * any decimal/percentage, a number is expected to have a source.
 */

export const EVIDENCE_AUDIT_SCHEMA = 'fbt.ai-evidence-audit.v1';

const PERSIAN_DIGITS = /[\u06F0-\u06F9]/g;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;

/** Convert Persian/Arabic-Indic digits to ASCII, leaving everything else. */
export function normalizeDigits(text) {
  return String(text ?? '')
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Meaningful numeric tokens in a piece of text.
 * Returns canonical numeric strings (no separators, no trailing `.0`).
 */
export function extractNumbers(text) {
  const normalized = normalizeDigits(text);
  /* A number may carry `,` `٬` `,` `'` or a normal space as a thousands
     separator, and may end in `%`. Capture the whole run, then clean it. */
  const re = /(?<![\p{L}\d])(\d[\d.,\u066C\u060C\u066B'\u00A0 ]*\d|\d)(?:\s*%)?/gu;
  const out = [];
  const seen = new Set();
  let match;
  while ((match = re.exec(normalized)) !== null) {
    const raw = match[1];
    /* A trailing separator is punctuation, not part of the number. */
    const cleaned = raw.replace(/[.,\u066C\u060C\u066B'\u00A0 ]+$/g, '').replace(/[,\u066C\u060C\u066B'\u00A0 ]/g, '');
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) continue;
    const value = Number(cleaned);
    if (!Number.isFinite(value)) continue;
    /* 1–2 digit integers are counts/indices in prose; not audited. */
    const meaningful = Math.abs(value) >= 100 || cleaned.includes('.');
    if (!meaningful) continue;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ token: match[0].trim(), value });
  }
  return out;
}

/** The corpus of numbers a draft was allowed to use. */
export function buildEvidenceCorpus({ context = null, knowledge = [], sources = [], analyses = [] } = {}) {
  const parts = [];
  try {
    if (context) parts.push(JSON.stringify(context));
  } catch { /* a cyclic context simply contributes nothing */ }
  for (const k of knowledge || []) {
    parts.push(String(k?.title || ''), String(k?.body || ''), String(k?.bodyEn || ''));
  }
  for (const s of sources || []) {
    parts.push(String(s?.title || ''), String(s?.snippet || ''));
  }
  for (const a of analyses || []) {
    if (a?.ok === false) continue;
    parts.push(String(a?.answer || ''));
    for (const c of a?.claims || []) parts.push(String(c?.claim || ''));
  }
  return normalizeDigits(parts.join('\n'));
}

/**
 * Audit one answer against a corpus.
 * @returns {{schema:string, checked:number, unsourced:Array<{token:string,value:number}>, sourced:number, clean:boolean}}
 */
export function auditNumbers(answer, corpus) {
  const numbers = extractNumbers(answer);
  const corpusNumbers = new Set(extractNumbers(corpus).map((n) => String(n.value)));
  const unsourced = numbers.filter((n) => !corpusNumbers.has(String(n.value)));
  return {
    schema: EVIDENCE_AUDIT_SCHEMA,
    checked: numbers.length,
    sourced: numbers.length - unsourced.length,
    unsourced,
    clean: unsourced.length === 0
  };
}

/**
 * A reviewer-facing block. Empty string when there is nothing to fix, so the
 * review prompt is byte-identical to before on a clean draft.
 */
export function renderUnsourcedBlock(audit) {
  if (!audit || !Array.isArray(audit.unsourced) || !audit.unsourced.length) return '';
  const list = audit.unsourced.slice(0, 8).map((n) => n.token).join(' · ');
  return `UNSOURCED NUMBERS — these do not appear anywhere in the evidence. Remove them, recompute them from the evidence, or write that the figure is not readable. Do not keep a number you cannot source:\n${list}`;
}

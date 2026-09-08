/**
 * FBT FINANCIAL INTELLIGENCE OS — Preference Model (§8).
 * ---------------------------------------------------------------------------
 *   riskTolerance · feeSensitivity · leverageTolerance · preferredChains
 *   preferredAssets · investmentHorizon · tradingFrequency
 *   preferredExecutionStyle · slippageTolerancePct
 *
 * THE TWO RULES THIS FILE EXISTS TO ENFORCE
 * 1. An explicit user preference always beats an inferred one. That is not a
 *    tie-break in a formula — every key is resolved through Memory 2.0, whose
 *    precedence is USER_SAID > USER_PREFERRED > USER_BEHAVIOR > AI_INFERRED, so
 *    an inference structurally cannot win.
 * 2. Learning never grants execution permission. The resolved model carries
 *    `executionPermission: false` and `grantsScope: []`; authority comes only
 *    from a policy object (§22/§23) or an explicit confirmation.
 *
 * Inference is deliberately slow: `MIN_INFERRED_EVENTS` verified observations
 * are required before a preference is written at all, and the write is tagged
 * AI_INFERRED so a later explicit statement overwrites it silently.
 */
import { MEMORY_PROVENANCE } from './memory.js';

export const PREFERENCES_SCHEMA = 'fbt.fi.preferences.v1';

export const PREFERENCE_KEYS = Object.freeze([
  'riskTolerance', 'feeSensitivity', 'leverageTolerance', 'preferredChains',
  'preferredAssets', 'investmentHorizon', 'tradingFrequency',
  'preferredExecutionStyle', 'slippageTolerancePct'
]);

export const RISK_TOLERANCES = Object.freeze(['CONSERVATIVE', 'MODERATE', 'GROWTH', 'AGGRESSIVE']);
export const FEE_SENSITIVITY = Object.freeze(['LOW', 'NORMAL', 'HIGH']);
export const LEVERAGE_TOLERANCE = Object.freeze(['NONE', 'LOW', 'MODERATE', 'HIGH']);
export const HORIZONS = Object.freeze(['SHORT', 'MEDIUM', 'LONG']);
export const TRADING_FREQUENCY = Object.freeze(['RARE', 'OCCASIONAL', 'ACTIVE']);
export const EXECUTION_STYLES = Object.freeze(['MANUAL', 'CONFIRM_EACH', 'DCA', 'AUTONOMOUS_WITHIN_POLICY']);

/** Below this many verified observations, nothing is inferred (§9: "do not
 *  make dangerous assumptions from a small number of events"). */
export const MIN_INFERRED_EVENTS = 3;

const ENUMS = Object.freeze({
  riskTolerance: RISK_TOLERANCES,
  feeSensitivity: FEE_SENSITIVITY,
  leverageTolerance: LEVERAGE_TOLERANCE,
  investmentHorizon: HORIZONS,
  tradingFrequency: TRADING_FREQUENCY,
  preferredExecutionStyle: EXECUTION_STYLES
});

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/* ── deterministic statement parsing ─────────────────────────────────────── */
/* Small, boring and auditable on purpose: these are the sentences a user
   actually types, and a wrong parse becomes a wrong trade. Anything it does
   not recognise is left alone rather than guessed. */
const STATEMENT_RULES = Object.freeze([
  { key: 'leverageTolerance', value: 'NONE', re: /\b(no|never|without|zero|hate|avoid)\b[^\n]{0,30}\b(leverage|leveraged|margin|perp)\b|\b(leverage|margin)\b[^\n]{0,20}\b(never|no|not)\b/i },
  { key: 'leverageTolerance', value: 'HIGH', re: /\b(high|aggressive|max)\b[^\n]{0,20}\b(leverage|margin)\b/i },
  { key: 'feeSensitivity', value: 'HIGH', re: /\b(low|lowest|minimal|cheap)\b[^\n]{0,20}\b(fee|fees|gas|cost)s?\b|\b(fee|fees|gas|cost)s?\b[^\n]{0,20}\b(low|lowest|minimal|cheap)\b|\b(fee|fees|gas)\b[^\n]{0,20}\b(matter|important|sensitive)\b|\b(minimi[sz]e|watch|avoid)\b[^\n]{0,20}\b(fee|fees|gas|cost)s?\b/i },
  { key: 'feeSensitivity', value: 'LOW', re: /\b(don'?t|do not|never)\b[^\n]{0,20}\b(care|mind)\b[^\n]{0,20}\b(fee|fees|gas)\b/i },
  { key: 'riskTolerance', value: 'CONSERVATIVE', re: /\b(safe|safety|conservative|low[ -]risk|capital preservation|don'?t lose)\b/i },
  { key: 'riskTolerance', value: 'AGGRESSIVE', re: /\b(aggressive|high[ -]risk|max(imum)? return|degen|yolo)\b/i },
  { key: 'riskTolerance', value: 'MODERATE', re: /\b(moderate|balanced|medium[ -]risk)\b/i },
  { key: 'preferredExecutionStyle', value: 'DCA', re: /\b(dca|dollar[ -]cost|every (week|month|day)|recurring|定期)\b/i },
  { key: 'investmentHorizon', value: 'LONG', re: /\b(long[ -]term|\d+\s*years?|hold for years|هولد)\b/i },
  { key: 'investmentHorizon', value: 'SHORT', re: /\b(short[ -]term|this week|next week|few days|scalp)\b/i },
  { key: 'tradingFrequency', value: 'RARE', re: /\b(rarely|seldom|not often|once in a while)\b/i },
  { key: 'tradingFrequency', value: 'ACTIVE', re: /\b(daily|every day|often|frequently|active trader)\b/i }
]);

export function parsePreferenceStatement(text = '') {
  const s = String(text || '');
  const found = [];
  for (const rule of STATEMENT_RULES) {
    if (rule.re.test(s)) found.push({ key: rule.key, value: rule.value, matched: rule.re.source.slice(0, 40) });
  }
  /* Chains and assets are extracted as tokens, not guessed. */
  const chains = [...s.matchAll(/\b(ethereum|base|arbitrum|optimism|polygon|solana|bsc|avalanche|bitcoin)\b/gi)].map((m) => m[1].toLowerCase());
  if (chains.length) found.push({ key: 'preferredChains', value: [...new Set(chains)], matched: 'chain-token' });
  const assets = [...s.matchAll(/\b(btc|eth|sol|usdc|usdt|dai)\b/gi)].map((m) => m[1].toUpperCase());
  if (assets.length) found.push({ key: 'preferredAssets', value: [...new Set(assets)], matched: 'asset-token' });
  const slip = s.match(/\b(?:slippage|اسلیپج)\D{0,12}(\d+(?:\.\d+)?)\s*%?/i);
  if (slip && num(slip[1]) !== null && num(slip[1]) >= 0 && num(slip[1]) <= 20) {
    found.push({ key: 'slippageTolerancePct', value: num(slip[1]), matched: 'slippage-number' });
  }
  return found;
}

export function createPreferenceModel({ memory, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  /** Resolve every key through memory precedence. */
  async function resolve(owner) {
    const values = {};
    const origins = {};
    const confidence = {};
    for (const key of PREFERENCE_KEYS) {
      const r = await memory.resolve(owner, key);
      values[key] = r.ok ? r.value : null;
      origins[key] = r.ok ? r.provenance : null;
      confidence[key] = r.ok ? ({ USER_SAID: 0.95, USER_PREFERRED: 0.9, USER_BEHAVIOR: 0.7, AI_INFERRED: 0.5 }[r.provenance] ?? 0.5) : 0;
    }
    const known = PREFERENCE_KEYS.filter((k) => values[k] !== null);
    return {
      schema: PREFERENCES_SCHEMA,
      owner,
      ...values,
      origins,
      confidence,
      coverage: Number((known.length / PREFERENCE_KEYS.length).toFixed(3)),
      known,
      unknown: PREFERENCE_KEYS.filter((k) => values[k] === null),
      updatedAt: now(),
      /* §8: learning is not authority. */
      executionPermission: false,
      grantsScope: []
    };
  }

  /** Explicit user settings (a form, or "remember: slippage 0.5%"). */
  async function setExplicit(owner, patch = {}, { correlationId = null } = {}) {
    const written = [];
    const rejected = [];
    for (const [key, value] of Object.entries(patch || {})) {
      if (!PREFERENCE_KEYS.includes(key)) { rejected.push({ key, code: 'UNKNOWN_PREFERENCE' }); continue; }
      const allowed = ENUMS[key];
      const clean = allowed ? (allowed.includes(String(value).toUpperCase()) ? String(value).toUpperCase() : null)
        : Array.isArray(value) ? value.slice(0, 12).map((v) => String(v).slice(0, 24))
          : num(value);
      if (clean === null || clean === undefined) { rejected.push({ key, code: 'BAD_VALUE', allowed: allowed || 'number|array' }); continue; }
      const res = await memory.remember(owner, { key, value: clean, provenance: 'USER_PREFERRED', note: 'explicit setting', correlationId });
      if (res.ok) written.push(key); else rejected.push({ key, code: res.code });
    }
    return { ok: written.length > 0, written, rejected, preferences: await resolve(owner) };
  }

  /** "REMEMBER THIS" from a sentence (§37/§38). */
  async function learnFromStatement(owner, text, { correlationId = null } = {}) {
    const found = parsePreferenceStatement(text);
    if (!found.length) return { ok: false, code: 'NO_PREFERENCE_DETECTED', detail: 'nothing in that sentence maps to a known preference' };
    const written = [];
    for (const f of found) {
      const res = await memory.remember(owner, { key: f.key, value: f.value, provenance: 'USER_SAID', note: `from: ${String(text).slice(0, 60)}`, correlationId });
      if (res.ok) written.push(f.key);
    }
    if (observability) observability.emit({ type: 'learning.completed', owner, correlationId, payload: { engine: 'preferences', via: 'statement', keys: written } });
    return { ok: written.length > 0, written, detected: found, preferences: await resolve(owner) };
  }

  /**
   * Learn from a VERIFIED outcome (§31). Bounded, and always written as
   * AI_INFERRED — so a single bad fill can never rewrite a stated preference.
   */
  async function learnFromOutcome(owner, outcome = {}, { correlationId = null } = {}) {
    if (outcome?.verified !== true) return { ok: false, code: 'OUTCOME_NOT_VERIFIED' };
    const { rows } = await memory.outcomes(owner, { limit: 30 });
    const sample = [outcome, ...rows].slice(0, 30);
    if (sample.length < MIN_INFERRED_EVENTS) {
      return { ok: false, code: 'NOT_ENOUGH_EVIDENCE', samples: sample.length, required: MIN_INFERRED_EVENTS };
    }
    const inferred = [];

    /* Fee sensitivity: did the user's fills keep landing on the cheap route? */
    const feeRows = sample.filter((r) => num(r.feesUsd) !== null && num(r.expected?.feeUsd ?? r.expected?.feesUsd) !== null);
    if (feeRows.length >= MIN_INFERRED_EVENTS) {
      const cheaper = feeRows.filter((r) => num(r.feesUsd) <= num(r.expected?.feeUsd ?? r.expected?.feesUsd) * 1.02).length;
      const ratio = cheaper / feeRows.length;
      if (ratio >= 0.8) inferred.push({ key: 'feeSensitivity', value: 'HIGH', basis: `${cheaper}/${feeRows.length} fills at or below the quoted fee` });
    }

    /* Slippage: real slippage consistently above tolerance means the tolerance
       we hold is not the tolerance the user lives with. */
    const slipRows = sample.filter((r) => num(r.slippagePct) !== null);
    if (slipRows.length >= MIN_INFERRED_EVENTS) {
      const mean = slipRows.reduce((a, r) => a + num(r.slippagePct), 0) / slipRows.length;
      const current = await memory.resolve(owner, 'slippageTolerancePct');
      if (current.ok && num(current.value) !== null && mean > num(current.value) * 1.25 && current.provenance !== 'USER_SAID') {
        inferred.push({ key: 'slippageTolerancePct', value: Number(mean.toFixed(2)), basis: `mean realized slippage ${mean.toFixed(2)}% over ${slipRows.length} fills` });
      }
    }

    /* Execution style: repeated scheduled/recurring fills → DCA. */
    const dca = sample.filter((r) => String(r.kind || '').toLowerCase().includes('dca') || String(r.kind || '').toLowerCase().includes('recurring')).length;
    if (dca >= MIN_INFERRED_EVENTS) inferred.push({ key: 'preferredExecutionStyle', value: 'DCA', basis: `${dca} recurring fills` });

    const written = [];
    for (const inf of inferred) {
      const res = await memory.remember(owner, { key: inf.key, value: inf.value, provenance: 'AI_INFERRED', note: inf.basis, correlationId });
      if (res.ok) written.push({ ...inf, replaced: res.replaced });
      else if (res.code === 'WOULD_DOWNGRADE_MEMORY') written.push({ ...inf, skipped: 'explicit preference kept' });
    }
    if (observability) observability.emit({ type: 'learning.completed', owner, correlationId, payload: { engine: 'preferences', via: 'outcome', samples: sample.length, inferred: written.map((w) => w.key) } });
    return { ok: true, samples: sample.length, inferred: written, preferences: await resolve(owner) };
  }

  async function digest(owner) {
    const p = await resolve(owner);
    return {
      riskTolerance: p.riskTolerance, riskToleranceOrigin: p.origins.riskTolerance,
      feeSensitivity: p.feeSensitivity, feeSensitivityOrigin: p.origins.feeSensitivity,
      leverageTolerance: p.leverageTolerance, leverageToleranceOrigin: p.origins.leverageTolerance,
      preferredChains: p.preferredChains, preferredAssets: p.preferredAssets,
      investmentHorizon: p.investmentHorizon, tradingFrequency: p.tradingFrequency,
      preferredExecutionStyle: p.preferredExecutionStyle,
      slippageTolerancePct: p.slippageTolerancePct,
      coverage: p.coverage, unknown: p.unknown,
      executionPermission: false,
      updatedAt: p.updatedAt
    };
  }

  return {
    schema: PREFERENCES_SCHEMA,
    keys: PREFERENCE_KEYS,
    resolve, setExplicit, learnFromStatement, learnFromOutcome, digest,
    provenanceClasses: MEMORY_PROVENANCE
  };
}

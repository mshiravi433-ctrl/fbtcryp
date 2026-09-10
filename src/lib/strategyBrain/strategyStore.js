/**
 * FBT STRATEGY BRAIN — STRATEGY STORE (persistence).
 * ---------------------------------------------------------------------------
 * The brain builds a Portfolio Strategy for a horizon measured in months. A
 * plan that evaporates the moment the tab closes is not a strategy, it is a
 * one-screen answer — and worse, the staged execution and revision halves
 * become unreachable, because the stage progress they act on is gone.
 *
 * This module keeps a plan and its runtime truth alive across reloads so:
 *
 *   · a user who returns tomorrow continues the SAME plan, on the stage they
 *     actually reached, with the same confirmed receipts;
 *   · monitoring can compare realised PnL against the plan curve it was
 *     built with, instead of re-deriving a fresh curve that has forgotten
 *     when capital was deployed;
 *   · a revision keeps its link to the strategy it replaced.
 *
 * ─── HOST BUDGET ────────────────────────────────────────────────────────────
 * Deliberately free. One localStorage key, no server, no database, no timers,
 * no background sync. Plans are capped at STRATEGY_MAX_PLANS and each is
 * written whole, so the footprint is bounded by design and nothing here can
 * grow with usage.
 *
 * ─── WHAT IT NEVER STORES ───────────────────────────────────────────────────
 * No key, no mnemonic, no signature payload. Credential-shaped field names are
 * stripped defensively before anything reaches storage — the same rule
 * historyStore enforces.
 */

import { defaultStorage as historyDefaultStorage } from '../intent-ai/os/historyStore.js';

export const STRATEGY_STORE_KEY = 'fbt.strategy-brain.plans.v1';
export const STRATEGY_STORE_SCHEMA = 'fbt.strategy-brain-plans.v1';

/** Enough to keep the live plan plus a few recent ones; bounded, not tuned. */
export const STRATEGY_MAX_PLANS = 6;

const FORBIDDEN = /privatekey|mnemonic|seedphrase|seed|signature|signedpayload|apikey|password|secret/i;

function stripSecretsDeep(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripSecretsDeep(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN.test(k)) continue;
    out[k] = stripSecretsDeep(v, depth + 1);
  }
  return out;
}

/** Injectable exactly like historyStore's, so a probe can use a memory store. */
export function defaultStorage() {
  return historyDefaultStorage();
}

function emptyDoc() {
  return { schema: STRATEGY_STORE_SCHEMA, plans: [] };
}

function readDoc(store) {
  try {
    const raw = store?.getItem(STRATEGY_STORE_KEY) || '';
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.plans)) return emptyDoc();
    return { schema: STRATEGY_STORE_SCHEMA, plans: parsed.plans };
  } catch {
    return emptyDoc();
  }
}

function writeDoc(store, doc) {
  try {
    store?.setItem(STRATEGY_STORE_KEY, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

/**
 * The part of the runtime worth keeping. Stage progress is the only truth that
 * cannot be rebuilt from the strategy object itself — it records what was
 * actually signed, when, and with which receipt.
 */
function pickRuntime(runtimeState) {
  if (!runtimeState || typeof runtimeState !== 'object') return null;
  return {
    stageProgress: runtimeState.stageProgress || {},
    observations: Array.isArray(runtimeState.observations) ? runtimeState.observations.slice(-20) : [],
    revisions: Array.isArray(runtimeState.revisions) ? runtimeState.revisions.slice(-5) : [],
    halted: runtimeState.halted || null
  };
}

/**
 * Upsert a plan by its strategyId. Saving the same plan again (after a stage
 * is confirmed, or a revision lands) replaces the previous row rather than
 * adding a second one.
 *
 * @returns the stored record, or null when there is nothing valid to store.
 */
export function saveStrategyPlan({ strategy, goal = null, runtime = null, store = defaultStorage(), now = Date.now() } = {}) {
  if (!strategy?.ok || !strategy.strategyId) return null;
  const doc = readDoc(store);
  const plans = doc.plans.filter((p) => p && p.strategyId);

  const previous = plans.find((p) => p.strategyId === strategy.strategyId) || null;
  const record = stripSecretsDeep({
    strategyId: strategy.strategyId,
    schema: STRATEGY_STORE_SCHEMA,
    createdAt: previous?.createdAt || now,
    savedAt: now,
    goal: goal || strategy.goal || null,
    strategy,
    runtime: pickRuntime(runtime),
    /* A revision chain is followed to its head: the newest strategyId in the
       chain is the one a returning user should resume. */
    supersedes: previous?.supersedes || null,
    headline: {
      expectedReturnPct: strategy.verdict?.expectedReturnPct ?? null,
      targetPct: strategy.goal?.targetPct ?? null,
      horizonDays: strategy.goal?.horizonDays ?? null,
      capitalUsd: strategy.goal?.capitalUsd ?? null,
      riskLevel: strategy.goal?.riskLevel || null,
      chosen: strategy.chosen || null,
      stageCount: (strategy.stages || []).length,
      sleeveCount: (strategy.sleeves || []).length
    }
  });

  const idx = plans.findIndex((p) => p.strategyId === record.strategyId);
  if (idx >= 0) plans[idx] = record;
  else plans.push(record);

  /* Newest first, then bounded. A dropped plan is simply the oldest one. */
  plans.sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0));
  doc.plans = plans.slice(0, STRATEGY_MAX_PLANS);
  const persisted = writeDoc(store, doc);
  return persisted ? record : null;
}

/** Link a revision so the chain can be followed from head back to origin. */
export function linkRevision({ fromStrategyId, toStrategyId, store = defaultStorage() } = {}) {
  if (!fromStrategyId || !toStrategyId) return null;
  const doc = readDoc(store);
  const from = doc.plans.find((p) => p.strategyId === fromStrategyId);
  const to = doc.plans.find((p) => p.strategyId === toStrategyId);
  if (!to) return null;
  to.supersedes = fromStrategyId;
  /* The origin of the chain is whatever `from` superseded, if anything. */
  if (from?.supersedes) to.supersedes = from.supersedes;
  writeDoc(store, doc);
  return { ok: true, fromStrategyId, toStrategyId, originStrategyId: to.supersedes };
}

export function readStrategyPlans({ store = defaultStorage() } = {}) {
  return readDoc(store).plans;
}

/** The most recently saved plan — the one a returning user resumes. */
export function latestStrategyPlan({ store = defaultStorage() } = {}) {
  const plans = readDoc(store).plans;
  return plans.length ? plans[0] : null;
}

export function loadStrategyPlan(strategyId, { store = defaultStorage() } = {}) {
  if (!strategyId) return null;
  return readDoc(store).plans.find((p) => p.strategyId === strategyId) || null;
}

/** Drop one plan, or everything when no id is given. */
export function deleteStrategyPlan(strategyId = null, { store = defaultStorage() } = {}) {
  const doc = readDoc(store);
  if (!strategyId) {
    writeDoc(store, emptyDoc());
    return { ok: true, deleted: null, remaining: 0 };
  }
  const before = doc.plans.length;
  doc.plans = doc.plans.filter((p) => p.strategyId !== strategyId);
  writeDoc(store, doc);
  return { ok: true, deleted: strategyId, remaining: doc.plans.length, removed: before - doc.plans.length };
}

/**
 * Turn a stored record back into constructor arguments for
 * `createStrategyRuntime`, so a resumed runtime picks up exactly where the
 * saved one left off instead of restarting every stage.
 *
 * @returns null when the record cannot produce a usable strategy.
 */
export function hydrateRuntimeArgs(record) {
  const strategy = record?.strategy;
  if (!strategy?.ok || !strategy.strategyId) return null;
  const runtime = pickRuntime(record.runtime);
  return {
    strategy,
    goal: record.goal || strategy.goal || null,
    hydrate: runtime
  };
}

/** A short, human label for a saved plan — used by the resume list. */
export function planLabel(record, { locale = 'fa' } = {}) {
  const h = record?.headline || {};
  const days = Number(h.horizonDays) || 0;
  const target = Number(h.targetPct) || 0;
  if (locale === 'en') {
    const horizon = days ? `${Math.round(days / 30)} mo` : 'no horizon';
    return `${target}% target · ${horizon}`;
  }
  const horizon = days ? `${Math.max(1, Math.round(days / 30))} ماه` : 'بدون افق';
  return `هدف ${target}٪ · ${horizon}`;
}

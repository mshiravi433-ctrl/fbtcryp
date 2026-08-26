/**
 * FBT INTENT AI — Spec 65 item 29: Event Risk Agent adapter.
 *
 * News, token unlocks, CPI, FOMC, ETF flows and protocol upgrades are event
 * risk inputs. Rules:
 *   - An event without a credible source class can RAISE caution but can
 *     never LOWER event risk.
 *   - High event risk reduces confidence and forces review; it never triggers
 *     hidden execution and never bypasses Guardian or policy.
 */

import { containsRawSecret, fail, finite, noExecutionPermission, safeString } from './phaseBoundary.js';

export const EVENT_RISK_SCHEMA = 'fbt.intent-event-risk.v1';

export const EVENT_TYPES = Object.freeze(['news', 'unlock', 'cpi', 'fomc', 'etf', 'upgrade', 'other']);
export const SOURCE_CLASSES = Object.freeze(['official-calendar', 'onchain-schedule', 'attested-news', 'unverified']);

const TYPE_WEIGHT = Object.freeze({ unlock: 25, cpi: 20, fomc: 25, etf: 15, upgrade: 15, news: 10, other: 5 });
const CREDIBLE_SOURCES = new Set(['official-calendar', 'onchain-schedule', 'attested-news']);

function eventRow(input, now, maxAgeHrs) {
  if (!input || typeof input !== 'object' || containsRawSecret(input)) return null;
  const type = EVENT_TYPES.includes(input.type) ? input.type : 'other';
  const source = safeString(String(input.source || ''), 80);
  const sourceClass = SOURCE_CLASSES.includes(input.sourceClass) ? input.sourceClass : 'unverified';
  const observedAt = finite(input.observedAt ?? input.at);
  const severity = ['low', 'medium', 'high'].includes(input.severity) ? input.severity : null;
  // An event older than the max age is stale for risk-raising purposes.
  const stale = observedAt === null ? true : now - observedAt > maxAgeHrs * 3_600_000;
  return { type, source, sourceClass, observedAt, severity, stale };
}

/**
 * Assess event risk from supplied events. Unknown/unverifiable events keep
 * `unverifiedCount` high and can only increase caution; a `high` event risk
 * result reduces strategy confidence and requires review.
 */
export function assessEventRisk({ events = [], maxAgeHrs = 48, now = Date.now() } = {}) {
  if (containsRawSecret(events)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const rows = (Array.isArray(events) ? events : []).slice(0, 32).map((row) => eventRow(row, now, maxAgeHrs)).filter(Boolean);
  const credible = rows.filter((row) => CREDIBLE_SOURCES.has(row.sourceClass) && row.stale === false && row.severity !== null);
  const unverified = rows.filter((row) => !credible.includes(row));

  let score = 0;
  for (const row of credible) {
    const severityWeight = row.severity === 'high' ? 1 : row.severity === 'medium' ? 0.6 : 0.3;
    score += (TYPE_WEIGHT[row.type] || 5) * severityWeight;
  }
  // Unverified events may only add caution, never subtract.
  const unverifiedCaution = Math.min(10, unverified.length * 2);
  const eventRisk = Math.min(100, Math.round(score + unverifiedCaution));
  const level = eventRisk >= 45 ? 'high' : eventRisk >= 20 ? 'medium' : rows.length ? 'low' : 'unavailable';

  return noExecutionPermission({
    ok: true,
    schema: EVENT_RISK_SCHEMA,
    eventRisk,
    level,
    status: rows.length ? 'observed' : 'insufficient-evidence',
    credibleCount: credible.length,
    unverifiedCount: unverified.length,
    unverifiedCanOnlyRaiseRisk: true,
    effect: level === 'high'
      ? { confidenceReduction: true, reviewRequired: true, hiddenExecution: false, strategyChangeByItself: false }
      : { confidenceReduction: false, reviewRequired: false, hiddenExecution: false, strategyChangeByItself: false },
    confidenceAdjustment: level === 'high' ? { direction: 'down', note: 'High event risk lowers planning confidence; it does not authorize anything.' } : null,
    events: rows.map((row) => ({ type: row.type, sourceClass: row.sourceClass, observedAt: row.observedAt, severity: row.severity, stale: row.stale })),
    assessedAt: now
  });
}

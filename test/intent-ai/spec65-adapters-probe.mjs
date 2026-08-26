/* Spec 65 — Priority 4: honest adapters. Market regime (27), event risk (29),
 * smart money from the existing whale panel (28). No evidence → unavailable;
 * no fabricated numbers; adapters never change strategy or execute. */
import {
  detectMarketRegime,
  assessEventRisk,
  smartMoneyEvidence,
  decayConfidence
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
const hr = 3_600_000;

try {
  // ── 27: Market Regime ───────────────────────────────────────────────────
  const noRegime = detectMarketRegime({ evidence: [], now });
  check('no regime evidence → regime=unavailable, never guessed', noRegime.regime === 'unavailable' && noRegime.status === 'insufficient-evidence');
  const bull = detectMarketRegime({ evidence: [{ source: 'verdict-engine', observedAt: now - hr, quality: 0.8, metrics: { trendPct: 14, volatilityPct: 4, liquidityUsd: 900000 } }], now });
  check('bull regime detected from fresh sourced evidence', Array.isArray(bull.regime) && bull.regime.includes('bull') && bull.status === 'observed');
  const mixed = detectMarketRegime({ evidence: [{ source: 'signals', observedAt: now - 3 * hr, quality: 0.8, metrics: { trendPct: 2, volatilityPct: 12, liquidityUsd: 100000 } }], now });
  check('high-volatility + low-liquidity come from thresholds, not vibes', mixed.detectable.includes('high-volatility') && mixed.detectable.includes('low-liquidity') && mixed.requiresStrategyReview === true);
  const stale = detectMarketRegime({ evidence: [{ source: 'old-feed', observedAt: now - 72 * hr, quality: 0.8, metrics: { trendPct: 30 } }], now });
  check('stale regime data decays below threshold and is excluded/blocked', stale.status !== 'observed' || stale.staleRowsExcluded > 0);
  const unscored = detectMarketRegime({ evidence: [{ source: 'no-quality-feed', observedAt: now - hr, metrics: { trendPct: 30 } }], now });
  check('regime evidence without a quality score cannot drive a label', unscored.regime === 'unavailable');
  check('a regime label never switches strategy by itself', bull.strategyChangesAutomatically === false && bull.executionAuthorized === false);

  // ── 37: Confidence Decay (feeds regime + everything evidence-based) ─────
  const fresh = decayConfidence({ baseConfidence: 80, observedAt: now - hr, now });
  const old = decayConfidence({ baseConfidence: 80, observedAt: now - 48 * hr, now });
  check('fresh data keeps most confidence; old data decays deterministically', fresh.status === 'fresh-enough' && fresh.confidence > 70 && old.confidence < fresh.confidence);
  check('below-threshold confidence blocks execution and demands review', old.status === 'stale-review-required' && old.executionBlocked === true && old.reviewRequired === true);
  const unknownAge = decayConfidence({ baseConfidence: 80, observedAt: null, now });
  check('unknown observation age is never silently trusted', unknownAge.status === 'unknown-age' && unknownAge.executionBlocked === true);
  const futureAge = decayConfidence({ baseConfidence: 80, observedAt: now + 3600_000, now });
  check('a future observation timestamp is rejected evidence', futureAge.status === 'future-observation' && futureAge.executionBlocked === true);

  // ── 29: Event Risk ──────────────────────────────────────────────────────
  const noEvents = assessEventRisk({ events: [], now });
  check('no events → event risk unavailable, not zero-risk', noEvents.level === 'unavailable' && noEvents.status === 'insufficient-evidence');
  const risky = assessEventRisk({ events: [
    { type: 'fomc', source: 'fed-calendar', sourceClass: 'official-calendar', observedAt: now - hr, severity: 'high' },
    { type: 'unlock', source: 'token-unlock-schedule', sourceClass: 'onchain-schedule', observedAt: now - 2 * hr, severity: 'high' }
  ], now });
  check('credible high-severity events raise event risk and cut confidence only', risky.level === 'high' && risky.effect.confidenceReduction === true && risky.effect.hiddenExecution === false && risky.effect.strategyChangeByItself === false);
  const unverifiedLower = assessEventRisk({ events: [
    { type: 'news', source: 'random-forum', sourceClass: 'unverified', observedAt: now - hr, severity: 'low' }
  ], now });
  check('unverified sources cannot lower event risk below credible baseline', unverifiedLower.unverifiedCount === 1 && unverifiedLower.unverifiedCanOnlyRaiseRisk === true);
  const calm = assessEventRisk({ events: [
    { type: 'upgrade', source: 'protocol-gov', sourceClass: 'official-calendar', observedAt: now - 5 * hr, severity: 'low' }
  ], now });
  check('credible low-severity events keep risk low without promising safety', calm.level === 'low' && calm.effect.hiddenExecution === false);

  // ── 28: Smart Money from the whale panel ────────────────────────────────
  const emptyWhales = smartMoneyEvidence({ whaleEvents: [], now });
  check('no whale data → signals unavailable, nothing fabricated', emptyWhales.status === 'unavailable' && emptyWhales.signals === null && emptyWhales.strategyEvidence.length === 0);
  const whales = smartMoneyEvidence({ whaleEvents: [
    { kind: 'inflow', valueUsd: 5_000_000, token: { symbol: 'ETH' }, chainId: 1, timestamp: now - hr, from: { label: 'whale-1' }, to: { label: 'Binance' } },
    { kind: 'outflow', valueUsd: 2_000_000, token: { symbol: 'ETH' }, chainId: 1, timestamp: now - 2 * hr, from: { label: 'Coinbase' }, to: { label: 'whale-2' } },
    { kind: 'transfer', valueUsd: 800_000, token: { symbol: 'USDC' }, chainId: 42161, timestamp: now - 3 * hr, from: { label: 'whale-3' }, to: { label: 'whale-4' } }
  ], now });
  check('whale panel events become strategy evidence with sample sizes', whales.status === 'observed' && whales.signals.eventCount === 3 && whales.strategyEvidence.every((row) => row.sampleSize >= 1));
  check('exchange inflow/outflow derived from observed events only', whales.signals.exchangeInflowUsd === 5000000 && whales.signals.exchangeOutflowUsd === 2000000 && whales.signals.netExchangeFlowUsd === -3000000);
  check('smart money adapter is advice-only and never executes', whales.executes === false && whales.adviceOnly === true && whales.executionAuthorized === false);
  const staleWhales = smartMoneyEvidence({ whaleEvents: [
    { kind: 'transfer', valueUsd: 900_000, token: { symbol: 'ETH' }, timestamp: now - 72 * hr }
  ], now });
  check('stale whale events stay unavailable for strategy use', staleWhales.status === 'unavailable');

  console.log(JSON.stringify({ probe: 'spec65-adapters', passed: results.filter((r) => r.ok).length, total: results.length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'spec65-adapters', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}
export default results;

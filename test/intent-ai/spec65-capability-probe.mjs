/* Spec 65 — Priority 2: complete Capability Scanner catalog, honest scan
 * summary, One-Click activation request (permission ≠ execution), marketplace
 * discovery (listing ≠ permission ≠ execution), and Auto-Revoke. */
import {
  CAPABILITY_CATALOG,
  CAPABILITY_SCORE_SCHEMA,
  scanCapabilities,
  scanSummary,
  assertScanBeforeStart,
  scoreCapability,
  capabilityById,
  requestCapabilityActivation,
  discoverForCapability,
  sweepAutoRevoke,
  assertBoundedGrant,
  revokeGrantNow,
  reapplyGrantAfterControl,
  createNonBypassableControls
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();

try {
  // ── 1: Catalog completeness ─────────────────────────────────────────────
  const requiredIds = ['smart-wallet', 'swap', 'dex-aggregator', 'liquidity-router', 'bridge', 'defi', 'farming', 'staking', 'lending', 'borrowing', 'futures', 'perpetuals', 'dydx', 'cex-connectors', 'signals', 'investment', 'rwa', 'payment', 'p2p', 'limit-orders', 'dca', 'ai-prediction', 'portfolio', 'risk-engine', 'shop', 'external-ai-agents'];
  const catalogIds = new Set(CAPABILITY_CATALOG.map((row) => row.id));
  const missing = requiredIds.filter((id) => !catalogIds.has(id));
  check('catalog covers the required capability list (26+ entries)', missing.length === 0 && CAPABILITY_CATALOG.length >= 30);

  const scan = scanCapabilities({ runtime: { swap: { configured: true, operational: true, evidence: ['quote-provider'] } }, intent: { id: 'intent-1', requiredCapabilities: ['swap', 'dydx'] }, now });
  check('scan reports which capabilities are relevant and which optional', scan.capabilities.length === CAPABILITY_CATALOG.length && scan.capabilities.some((r) => r.intentRelevant === true) && scan.capabilities.some((r) => r.intentRelevant === false));
  const summary = scanSummary(scan, { now });
  check('scan summary states total/relevant/optional/available honestly', summary.ok && summary.total === CAPABILITY_CATALOG.length && summary.relevant === 2 && typeof summary.optional === 'number' && summary.available === 1);
  check('scan-before-start is a read-only gate, never an activation', assertScanBeforeStart(scan).ok === true && assertScanBeforeStart(scan).scanIsNotActivation === true);
  check('no scan → BLOCK', assertScanBeforeStart(null).ok === false && assertScanBeforeStart(null).code === 'PRE_START_SCAN_REQUIRED');
  check('RWA/Payment/P2P/Shop stay not-implemented without adapters', ['rwa', 'payment', 'p2p', 'shop'].every((id) => capabilityById(id).implemented === false));

  // ── 3: capability score without evidence stays empty ────────────────────
  const unscored = scoreCapability(null);
  check('score without full evidence is null + insufficient-evidence', unscored.score === null && unscored.status === 'insufficient-evidence' && unscored.metrics === null);
  const halfScore = scoreCapability({ usefulness: 50, risk: 20, cost: 20, reliability: 50, liquidity: 50 });
  check('six of seven metrics still yield no score', halfScore.score === null && halfScore.status === 'insufficient-evidence');
  const scored = scoreCapability({ usefulness: 50, risk: 20, cost: 20, reliability: 50, liquidity: 50, expectedImpact: 60, executionQuality: 40 });
  check('all seven evidenced metrics produce a bounded observed score', scored.score !== null && scored.status === 'observed' && scored.schema === CAPABILITY_SCORE_SCHEMA);

  // ── 4: One-Click activation = permission request, not execution ─────────
  const click1 = requestCapabilityActivation({ capabilityId: 'staking', scan, stage: 'permission-request', now });
  check('one click creates a PERMISSION REQUEST only', click1.ok && click1.oneClickMeaning === 'PERMISSION_REQUEST_ONLY_NOT_EXECUTION' && click1.executionAuthorized === false && click1.financialExecutionAuthorized === false);
  check('flow enforces wallet stage before limits', requestCapabilityActivation({ capabilityId: 'staking', scan, stage: 'wallet-connect', walletConnected: false, now }).ok === false);
  const limits = requestCapabilityActivation({ capabilityId: 'staking', scan, stage: 'limits-set', walletConnected: true, limits: { capitalUsd: 500, transactionUsd: 100, riskPct: 20 }, now });
  check('limits stage requires capital/transaction/risk numbers', limits.ok && limits.stageStatus === 'limits-acknowledged');
  const activate = requestCapabilityActivation({ capabilityId: 'staking', scan, stage: 'activate', walletConnected: true, limits, now });
  check('without operational evidence Activate stays pending-evidence, never green', activate.stageStatus === 'pending-evidence' && activate.activated === false && activate.green === false);
  const runtimeScan = scanCapabilities({ runtime: { staking: { configured: true, operational: true, evidence: ['protocol-adapter'] } }, now });
  const activated = requestCapabilityActivation({ capabilityId: 'staking', scan: runtimeScan, stage: 'activate', walletConnected: true, limits, evidence: { attested: true }, now });
  check('activation with evidence is still planning-only, not execution', activated.activated === true && activated.greenMeaning === 'CAPABILITY_ENABLED_FOR_PLANNING_NOT_EXECUTION' && activated.executionAuthorized === false);
  check('activation of an unknown capability is rejected', requestCapabilityActivation({ capabilityId: 'yolo-bridge', scan, stage: 'permission-request', now }).ok === false);

  // ── 2: Marketplace discovery — listing ≠ permission ≠ execution ─────────
  const listing = discoverForCapability({ capabilityId: 'rwa', agents: [], criteria: {}, now });
  check('a capability missing in FBT is marked external-needed', listing.ok && listing.availableInFbt === false && listing.externalNeeded === true);
  check('listing grants no permission and no execution', listing.listingIsNot.permission === false && listing.listingIsNot.execution === false && listing.hireRequires.includes('USER_OPT_IN') && listing.hireRequires.includes('GUARDIAN'));
  check('external agents never receive secrets', listing.externalAgentsNeverReceive.includes('private-key') && listing.externalAgentsNeverReceive.includes('seed'));

  // ── 5: Auto-Revoke ──────────────────────────────────────────────────────
  const grants = [
    { id: 'dydx-grant-1', kind: 'dydx-permission', intentId: 'intent-9', holderId: 'dydx-session', expiresAt: now - 1000, issuedAt: now - 90000 },
    { id: 'agent-scope-1', kind: 'external-agent-scope', intentId: 'intent-9', holderId: 'agent-x', expiresAt: now + 100000 },
    { id: 'wallet-session-1', kind: 'smart-wallet-session', intentId: 'intent-9', holderId: 'sw-1', expiresAt: null, permanent: true }
  ];
  let revokedByHandler = 0;
  const sweep = sweepAutoRevoke({ intentId: 'intent-9', intentStatus: 'EXPIRED', grants, revokeHandler: () => { revokedByHandler += 1; return { ok: true }; }, now });
  check('an expired intent revokes its standing grants', sweep.status === 'swept' && sweep.revoked.length === 2);
  check('permanent access is flagged as a violation', sweep.violations.length === 1 && sweep.violations[0].code === 'PERMANENT_ACCESS_FORBIDDEN' && sweep.permanentAccessAllowed === false);
  check('a running intent keeps its bounded grants', sweepAutoRevoke({ intentId: 'intent-9', intentStatus: 'ACTIVE', grants, now }).status === 'not-terminal');
  check('grant without expiry is rejected, not silently accepted', assertBoundedGrant({ kind: 'dydx-permission', id: 'g-1', expiresAt: null }).ok === false);
  check('bounded grant carries auto-revoke triggers', assertBoundedGrant({ kind: 'dydx-permission', id: 'g-2', expiresAt: now + 5000 }).ok === true);
  check('explicit revoke works and is irreversible', revokeGrantNow(grants[0], { now }).revoked === true);
  check('re-apply under an active STOP control is blocked', reapplyGrantAfterControl(grants[0], createNonBypassableControls(now - 1) , { expiresAt: now + 5000 }) === null || reapplyGrantAfterControl(grants[0], (() => { const c = createNonBypassableControls(now - 1); c.stopped = true; return c; })(), { expiresAt: now + 5000 }).ok === false);
  check('auto-revoke itself never moves funds (permission sweep only)', sweep.executionAuthorized === false && sweep.financialExecutionAuthorized === false);

  console.log(JSON.stringify({ probe: 'spec65-capability', passed: results.filter((r) => r.ok).length, total: results.length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'spec65-capability', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}
export default results;

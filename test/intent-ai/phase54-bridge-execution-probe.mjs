/**
 * PHASE 54 — BRIDGE EXECUTION
 * A swap route is not a cross-chain route. BRIDGE_EXECUTE_UNAVAILABLE only
 * disappears when a real adapter is attached, and a bridge never rides on the
 * swap step's approval.
 */
import {
  bridgeWired, bridgeHealth, assertBridgeApproval, executeBridge, trackBridgeDelivery,
  venueHealth
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const SRC = `0x${'11'.repeat(32)}`;
const DST = `0x${'22'.repeat(32)}`;
const APPROVAL = { scope: 'bridge', confirmed: true, termsHash: 'terms-1' };
const draft = { kind: 'bridge', chainId: 42161, toChainId: 8453, fromSymbol: 'USDC', toSymbol: 'USDC', amountIn: 100 };
const adapter = (over = {}) => ({
  execute: async () => ({ sourceTxHash: SRC, trackingId: 'track-1' }),
  status: async () => ({ destinationTxHash: DST }),
  ...over
});

try {
  /* --- honesty while nothing is wired --- */
  check('with no adapter the bridge is not wired', bridgeWired({}) === false);
  const unwired = bridgeHealth({});
  check('an unwired bridge reports BRIDGE_EXECUTE_UNAVAILABLE',
    unwired.ok === false && unwired.reasons.includes('BRIDGE_EXECUTE_UNAVAILABLE'));
  const venueUnwired = venueHealth(draft, {});
  check('venueHealth keeps saying BRIDGE_EXECUTE_UNAVAILABLE until it is wired',
    venueUnwired.ok === false && venueUnwired.reasons.includes('BRIDGE_EXECUTE_UNAVAILABLE'));

  /* --- the flag disappears only when it is really wired --- */
  const ctx = { bridgeAdapter: adapter(), provider: {}, signer: '0xabc', bridgeApproval: APPROVAL };
  const wired = bridgeHealth(ctx);
  check('a real adapter clears BRIDGE_EXECUTE_UNAVAILABLE', wired.ok === true && wired.wired === true && wired.reasons.length === 0);
  const venueWired = venueHealth(draft, ctx);
  check('venueHealth agrees once the adapter is really attached',
    venueWired.ok === true && !venueWired.reasons.includes('BRIDGE_EXECUTE_UNAVAILABLE'));
  const missingSigner = bridgeHealth({ bridgeAdapter: adapter(), provider: {} });
  check('a wired bridge without a signer is still unavailable', missingSigner.ok === false && missingSigner.reasons.includes('NO_SIGNER'));
  check('a wired bridge with no separate approval is unavailable in venueHealth',
    venueHealth(draft, { bridgeAdapter: adapter(), provider: {}, signer: '0xabc' }).reasons.includes('BRIDGE_APPROVAL_REQUIRED'));

  /* --- the bridge needs ITS OWN approval --- */
  check('no approval at all is refused', assertBridgeApproval({}).ok === false);
  check('a swap-scoped approval cannot authorize a bridge',
    assertBridgeApproval({ approval: { scope: 'swap', confirmed: true } }).ok === false);
  check('an unconfirmed bridge approval is refused',
    assertBridgeApproval({ approval: { scope: 'bridge', confirmed: false } }).ok === false);
  check('an approval for different terms is refused as changed terms',
    assertBridgeApproval({ approval: APPROVAL, termsHash: 'terms-2' }).error.code === 'TERMS_CHANGED');
  check('the bridge approval must be explicit and matching', assertBridgeApproval({ approval: APPROVAL, termsHash: 'terms-1' }).ok === true);

  /* --- execution --- */
  const withoutApproval = await executeBridge({ draft, ctx: { bridgeAdapter: adapter(), provider: {}, signer: '0xabc' } });
  check('a bridge never runs without its separate approval',
    withoutApproval.ok === false && withoutApproval.error.code === 'USER_AUTHORIZATION_REQUIRED');

  const unwiredRun = await executeBridge({ draft, ctx: {}, approval: APPROVAL, termsHash: 'terms-1' });
  check('an unwired bridge refuses to execute honestly',
    unwiredRun.ok === false && unwiredRun.reasons.includes('BRIDGE_EXECUTE_UNAVAILABLE'));

  const ran = await executeBridge({ draft, ctx, approval: APPROVAL, termsHash: 'terms-1' });
  check('a wired, separately approved bridge submits and returns a source hash',
    ran.ok === true && ran.sourceTxHash === SRC && ran.status === 'submitted');
  check('source-chain submission is NOT destination-chain delivery',
    ran.delivered === false && ran.confirmed === false && ran.fabricated === false);

  const badAdapter = await executeBridge({
    draft,
    ctx: { bridgeAdapter: adapter({ execute: async () => ({}) }), provider: {}, signer: '0xabc' },
    approval: APPROVAL,
    termsHash: 'terms-1'
  });
  check('an adapter that returns no hash is a failure, not a delivery', badAdapter.ok === false);

  /* --- delivery is tracked honestly --- */
  const noStatus = await trackBridgeDelivery({ execution: ran, ctx: { bridgeAdapter: { execute: adapter().execute } } });
  check('no status source keeps it submitted and undelivered', noStatus.delivered === false && noStatus.status === 'submitted');

  const pending = await trackBridgeDelivery({ execution: ran, ctx: { bridgeAdapter: adapter({ status: async () => ({}) }) } });
  check('no destination transaction yet is still undelivered', pending.ok === true && pending.delivered === false);

  const failed = await trackBridgeDelivery({ execution: ran, ctx: { bridgeAdapter: adapter({ status: async () => ({ status: 'failed' }) }) } });
  check('a failed bridge is reported failed, never completed', failed.ok === false && failed.status === 'failed');

  const delivered = await trackBridgeDelivery({ execution: ran, ctx });
  check('delivery is claimed only with a real destination transaction',
    delivered.ok === true && delivered.delivered === true && delivered.destinationTxHash === DST);

  console.log(JSON.stringify({ probe: 'phase54-bridge-execution', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;

/**
 * FBT INTENT AI — SUBMIT PIPELINE (Phase 6)
 * ---------------------------------------------------------------------------
 * sign → broadcast (existing adapter) → monitor → reconcile. It is honest and
 * fail-closed:
 *   - venue not configured → `unavailable`, never a fake success.
 *   - pre-sign simulation (when a provider + unsigned tx exist) is run BEFORE
 *     signing; a revert → NO SIGN.
 *   - an un-simulatable tx (no provider / no unsigned tx) → `simulation-unavailable`
 *     and NO SIGN, unless the venue does not require on-chain simulation.
 *   - reconciliation only reports COMPLETED from real confirmations; otherwise
 *     it reports a pending/partial/unconfirmed receipt, never a fabricated one.
 */

import { venueHealth } from './venueHealth.js';
import { createMonitor, heartbeat } from './executionMonitor.js';
import { reconcile } from './reconciliation.js';
import { classifyFailure } from './failureModes.js';
import { audit } from './audit.js';

/* Default simulation: the real pre-sign module, injected lazily so tests can
   substitute a deterministic stub. We do NOT call it here directly to keep the
   dependency surface explicit. */
async function defaultSimulate({ tx, provider }) {
  const sim = await import('../preSignSimulation.js');
  return sim.simulateUnsignedTransaction({ provider, tx });
}

/**
 * Run the submit pipeline for a draft.
 *
 * @param {object} opts
 * @param {object} opts.draft        { kind, chainId, protocol, id }
 * @param {object} opts.venueCtx     runtime capabilities { provider, signer,
 *                                   brokerHandle, dydxConnected, policy,
 *                                   explicitSignature }
 * @param {object} [opts.unsignedTx] the unsigned transaction for simulation
 * @param {function} [opts.simulate] injectable simulate(tx, provider) (default real)
 * @param {function} [opts.signer]   the wallet signer (draft) -> { signedTx }
 * @param {function} [opts.broadcast] the existing broadcast adapter:
 *                                   (draft, signed) -> { ok, receiptRef }
 * @param {boolean} [opts.emergencyStop] Emergency Stop flag (harden the monitor)
 * @param {object} [opts.session]    for audit
 * @returns {object} honest outcome
 */
export async function submitPipeline({
  draft,
  venueCtx = {},
  unsignedTx = null,
  simulate = defaultSimulate,
  signer = null,
  broadcast = null,
  emergencyStop = false,
  session = null
} = {}) {
  const health = venueHealth(draft, venueCtx);
  if (!health.ok) {
    if (session) audit(session, 'fbt.exec', 'submit.unavailable', { venue: health.venue, reasons: health.reasons }, 'warning');
    return {
      ok: false,
      status: 'unavailable',
      venue: health.venue,
      reasons: health.reasons,
      error: health.error,
      lifecycleStatus: 'FAILED',
      signed: false
    };
  }

  const venue = health.venue;

  /* ---- pre-sign simulation when the venue needs on-chain verification ---- */
  if (health.route.requiresProvider && !health.route.requiresBrokerHandle) {
    if (!unsignedTx || !venueCtx.provider) {
      return {
        ok: false,
        status: 'simulation-unavailable',
        venue,
        noSign: true,
        error: classifyFailure('SIMULATION_UNAVAILABLE', { detail: 'NO_UNSIGNED_TX_OR_PROVIDER' }),
        lifecycleStatus: 'RECOVERABLE',
        signed: false
      };
    }
    const sim = await simulate({ tx: unsignedTx, provider: venueCtx.provider });
    if (sim?.status === 'revert-detected' || sim?.status === 'provider-busy' || sim?.status === 'unknown') {
      const isRevert = sim.status === 'revert-detected';
      return {
        ok: false,
        status: sim.status,
        venue,
        noSign: true,
        simulation: sim,
        error: isRevert
          ? classifyFailure('SIMULATION_REVERT', { detail: sim.revertReason || 'REVERT' })
          : classifyFailure('SIMULATION_UNAVAILABLE', { detail: sim.notes || sim.status }),
        lifecycleStatus: isRevert ? 'FAILED' : 'RECOVERABLE',
        signed: false
      };
    }
    // simulated-clean → continue to sign.
  }

  /* ---- sign via the Phase 2 wallet adapter (never holds raw keys) ---- */
  let signed = null;
  if (signer) {
    try {
      signed = await signer(draft);
    } catch (e) {
      return { ok: false, status: 'sign-failed', venue, noSign: true, error: classifyFailure('PROVIDER_ERROR', { detail: String(e?.message || e) }), signed: false };
    }
    if (!signed || (!signed.signedTx && signed.ok !== true)) {
      return { ok: false, status: 'sign-failed', venue, noSign: true, error: classifyFailure('PROVIDER_ERROR', { detail: 'NO_SIGNATURE' }), signed: false };
    }
  }

  /* ---- broadcast via the existing adapter ---- */
  if (typeof broadcast !== 'function') {
    return { ok: false, status: 'no-broadcast-adapter', venue, noSign: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_BROADCAST_ADAPTER' }) };
  }
  const submit = await broadcast(draft, signed);
  if (!submit?.ok) {
    return { ok: false, status: 'submit-rejected', venue, error: submit?.error || classifyFailure('SUBMIT_REJECTED') };
  }

  /* ---- monitor + reconcile ---- */
  const mon = createMonitor({ txRef: submit.receiptRef });
  if (!mon.ok) return { ok: false, status: 'monitor-failed', venue, error: mon.error, lifecycleStatus: 'FAILED' };
  const beat = heartbeat(mon.monitor, {}, { emergencyStop });
  if (!beat.ok) {
    return { ok: false, status: beat.error?.code === 'EMERGENCY_STOP' ? 'emergency-stop' : 'monitor-failed', venue, error: beat.error, lifecycleStatus: 'CANCELLED' };
  }
  const rec = reconcile({ lifecycleStatus: beat.monitor.status, observation: {} });
  if (session) audit(session, 'fbt.exec', 'submit.receipt', { ref: submit.receiptRef, status: rec.receipt?.status, confirmed: rec.receipt?.confirmed }, rec.ok ? 'ok' : 'warning');

  return {
    ok: true,
    status: 'submitted',
    venue,
    signed: Boolean(signed),
    receiptRef: submit.receiptRef,
    monitor: beat.monitor,
    receipt: rec.receipt,
    lifecycleStatus: beat.monitor.status,
    simulatedClean: health.route.requiresProvider ? true : undefined
  };
}

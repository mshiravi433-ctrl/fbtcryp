import {
  assertSignerContext,
  isTransactionReplacement,
  isTransactionTimeout,
  isUserRejection,
  waitForMinedReceipt
} from './executionGuards';
import { buildUnsignedTransaction, simulateUnsignedTransaction } from '../preSignSimulation';

/**
 * Re-run the exact pre-sign simulation for the step about to be signed. A plan
 * can contain approval plus protocol execution; each transaction gets its own
 * fresh simulation after the preceding receipt, never a cached first-step
 * result.
 */
export async function simulateGuardedStep({ provider, owner, step, allowance } = {}) {
  const tx = buildUnsignedTransaction({
    from: owner, to: step.to, data: step.data, value: step.value ?? 0n
  });
  const outcome = await simulateUnsignedTransaction({ provider, tx, allowance });
  if (outcome?.status !== 'simulated-clean') {
    const error = new Error('EXECUTION_SIMULATION_NOT_CLEAN');
    error.code = 'EXECUTION_SIMULATION_NOT_CLEAN';
    error.detail = outcome;
    throw error;
  }
  return outcome;
}

/**
 * The one UI-to-wallet boundary used by the Farm panels.
 *
 * `verifyReceipt` is protocol-specific and must reject unless the expected
 * event and post-state are present. This helper deliberately does not catch
 * errors: callers classify user rejection, replacement, timeout, receipt
 * failure, and protocol failure separately for recovery and the local ledger.
 */
export async function executeGuardedStep({
  signer, provider, owner, chainId, step, verifyReceipt, timeoutMs = 180_000
} = {}) {
  await assertSignerContext(signer, { owner, chainId });
  const tx = await signer.sendTransaction({
    to: step.to,
    data: step.data,
    value: step.value ?? 0n
  });
  const mined = await waitForMinedReceipt(tx, { timeoutMs });
  const proof = typeof verifyReceipt === 'function'
    ? await verifyReceipt({ receipt: mined.receipt, tx, replaced: mined.replaced })
    : null;
  return { ...mined, tx, proof };
}

export { isTransactionReplacement, isTransactionTimeout, isUserRejection };

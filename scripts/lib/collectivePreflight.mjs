const REHEARSAL_GAS_UNITS = Object.freeze({
  // The deploy-side reference intentionally uses the full latest local
  // rehearsal total, making it conservative relative to the live phase-1 path.
  deploy: 23_658_989n,
  activate: 7_006_880n
});

const GAS_HEADROOM_BPS = 11_000n;
const BPS = 10_000n;

export function collectivePreflightGas(phase = 'preflight') {
  const normalized = String(phase ?? 'preflight').trim().toLowerCase().replace(/^testnet-/, '') || 'preflight';
  if (normalized === 'preflight' || normalized === 'deploy') {
    return Object.freeze({ operation: 'deploy', gasUnits: REHEARSAL_GAS_UNITS.deploy });
  }
  if (normalized === 'activate') {
    return Object.freeze({ operation: 'activate', gasUnits: REHEARSAL_GAS_UNITS.activate });
  }
  if (normalized === 'check') {
    return Object.freeze({ operation: 'check', gasUnits: 0n });
  }
  throw new Error(`unsupported preflight phase ${phase}; use preflight, deploy, activate, or check`);
}

/** Cost a conservative reference-gas budget at the current network fee cap. */
export function collectivePreflightGasBudget(phase, feePerGas) {
  const estimate = collectivePreflightGas(phase);
  if (estimate.gasUnits === 0n) {
    return Object.freeze({ ...estimate, feePerGas: 0n, estimatedCostWei: 0n, requiredBalanceWei: 0n });
  }
  const fee = BigInt(feePerGas);
  if (fee <= 0n) throw new Error('network gas fee must be greater than zero');
  const estimatedCostWei = estimate.gasUnits * fee;
  const requiredBalanceWei = (estimatedCostWei * GAS_HEADROOM_BPS + BPS - 1n) / BPS;
  return Object.freeze({ ...estimate, feePerGas: fee, estimatedCostWei, requiredBalanceWei });
}

export const COLLECTIVE_PREFLIGHT_GAS_HEADROOM_BPS = Number(GAS_HEADROOM_BPS);

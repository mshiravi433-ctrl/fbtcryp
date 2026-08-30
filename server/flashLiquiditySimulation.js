/**
 * FBT Flash Liquidity — REAL simulation gate (Phase 152, step 7 of 9).
 *
 * eth_call against a configured RPC node: the exact router calldata the
 * wallet would sign, executed against live state. A revert here is the
 * pipeline's hard stop — nothing gets signed, nothing gets sent.
 *
 * Honest scope: eth_call validates the call against the CURRENT state of one
 * node. It is not a bundle simulation and cannot guarantee inclusion-time
 * state; that is what the on-chain min-profit check is for (it reverts the
 * transaction instead of settling at a loss).
 *
 * Configuration: FLASH_LIQUIDITY_SIMULATION_RPC — an HTTPS RPC endpoint
 * (plain http is accepted only on loopback for local chains/forks). Until it
 * is configured, capabilities honestly report SIMULATION_UNAVAILABLE and
 * execution stays gated. Fail-closed by design.
 */

import { JsonRpcProvider, Network, isAddress } from 'ethers';

const MAX_DATA_BYTES = 24 * 1024;

export function simulationRpcFromEnv(env = process.env) {
  const raw = String(env.FLASH_LIQUIDITY_SIMULATION_RPC || '').trim();
  if (!raw) return null;
  let loopback = false;
  try {
    loopback = ['localhost', '127.0.0.1', '::1'].includes(new URL(raw).hostname);
  } catch {
    return null;
  }
  if (!/^https:\/\//.test(raw) && !(/^http:\/\//.test(raw) && loopback)) return null;
  return raw;
}

/**
 * Create the gate. `provider` is injectable for tests; production resolves
 * the provider lazily from `rpcUrl` so importing this module never dials out.
 */
export function createFlashSimulator({ rpcUrl = null, chainId = 0, provider = null } = {}) {
  let eth = provider;
  return {
    configured: Boolean(rpcUrl || provider),
    async simulate({ to, data, from = null } = {}) {
      if (!eth && !rpcUrl) return { ok: false, code: 'SIMULATION_RPC_NOT_CONFIGURED' };
      if (!isAddress(to || '')) return { ok: false, code: 'BAD_TARGET' };
      if (
        typeof data !== 'string'
        || !/^0x[0-9a-fA-F]*$/.test(data)
        || data.length / 2 - 1 > MAX_DATA_BYTES
      ) return { ok: false, code: 'BAD_DATA' };
      if (from != null && !isAddress(from)) return { ok: false, code: 'BAD_FROM' };

      if (!eth) {
        eth = new JsonRpcProvider(
          rpcUrl,
          new Network('fbt-flash-sim', Number(chainId) || 1),
          { staticNetwork: true }
        );
      }
      try {
        await eth.call({ to, data, ...(from ? { from } : {}) });
        const blockNumber = await eth.getBlockNumber();
        return { ok: true, mode: 'dry-run', simulated: true, blockNumber, broadcasts: false };
      } catch (error) {
        const reason = String(error?.shortMessage || error?.message || 'REVERT').slice(0, 200);
        return { ok: false, mode: 'dry-run', simulated: true, broadcasts: false, revertReason: reason };
      }
    }
  };
}

/**
 * GAS READINESS
 * ---------------------------------------------------------------------------
 * A common and expensive misunderstanding: "if this account has no gas, take it
 * from the next account."
 *
 * That is not possible on any EVM chain, and no app can make it possible:
 *
 *   • Gas is always paid in the chain's OWN native coin. A swap on Polygon
 *     needs POL; holding BNB does not help, because BNB does not exist on
 *     Polygon. There is no exchange rate applied at the protocol level.
 *
 *   • Gas is always paid by the account that SIGNS the transaction. The
 *     protocol debits the signer, full stop. Another wallet cannot volunteer.
 *     (ERC-4337 "paymasters" can sponsor gas, but that requires a smart-account
 *     wallet, a deployed paymaster and someone funding it — it is not a switch
 *     we can flip, and every major wallet the user already has is an EOA.)
 *
 * So instead of pretending, we do the thing that actually helps: check the
 * native balance on every chain up front, tell the user exactly which networks
 * they can trade on right now, and let them switch to one that works with a
 * single tap. Same outcome the user wanted — a swap that goes through — via a
 * mechanism that exists.
 */

import { EVM_CHAINS } from './chains';

/**
 * Rough native-coin cost of one swap, per chain.
 *
 * Deliberately generous: telling someone they have enough gas and watching the
 * transaction fail costs them a real (if small) amount and all their trust.
 * These cover an approve + a swap at typical congestion.
 */
export const GAS_BUFFER = {
  1: 0.004,      // Ethereum — by far the most expensive
  56: 0.0015,    // BNB Chain
  137: 0.25,     // Polygon (POL is cheap per unit)
  42161: 0.0004, // Arbitrum
  8453: 0.0003,  // Base
  10: 0.0003,    // Optimism
  43114: 0.02    // Avalanche
};

export const gasBufferFor = (chainId) => GAS_BUFFER[Number(chainId)] ?? 0.005;

/**
 * Can this balance cover a swap on this chain?
 * @param {number} chainId
 * @param {number} nativeBalance in whole coins
 */
export function hasEnoughGas(chainId, nativeBalance) {
  return Number(nativeBalance ?? 0) >= gasBufferFor(chainId);
}

/**
 * Native balance across every supported chain, so we can point the user at one
 * they can actually use.
 *
 * All chains are queried in parallel and a failure on one never rejects the
 * whole call — a single dead RPC endpoint must not hide the six working ones.
 *
 * @param {(chainId:number)=>Promise<any>} getProvider
 * @returns {Promise<Array<{chainId,name,short,symbol,balance,ready,error}>>}
 */
export async function scanGas(getProvider, address, chainIds = Object.keys(EVM_CHAINS).map(Number)) {
  const { formatEther } = await import('ethers');

  const results = await Promise.all(
    chainIds.map(async (chainId) => {
      const cfg = EVM_CHAINS[chainId];
      const base = {
        chainId,
        name: cfg?.name ?? String(chainId),
        short: cfg?.short ?? '',
        symbol: cfg?.native?.symbol ?? '',
        balance: null,
        ready: false,
        error: false
      };
      if (!cfg || !address) return base;

      try {
        const provider = await getProvider(chainId);
        const wei = await provider.getBalance(address);
        const balance = Number(formatEther(wei));
        return { ...base, balance, ready: hasEnoughGas(chainId, balance) };
      } catch {
        // Unreachable RPC — report it as unknown rather than "no gas", because
        // telling someone they have no funds when we simply couldn't look is
        // alarming and wrong.
        return { ...base, error: true };
      }
    })
  );

  // Chains the user can trade on first, then by balance.
  return results.sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    return (b.balance ?? -1) - (a.balance ?? -1);
  });
}

/**
 * Given a gas scan, suggest where to trade.
 * Returns null when the current chain is already fine.
 */
export function suggestChain(scan, currentChainId) {
  const current = scan.find((s) => s.chainId === Number(currentChainId));
  if (current?.ready) return null;
  return scan.find((s) => s.ready && s.chainId !== Number(currentChainId)) ?? null;
}

/**
 * Shared test double for the collateral-loop runtime: a tiny in-memory Aave-like
 * market plus a DEX, priced at $1, exposing exactly the deps loopRuntime.js uses.
 */
/* ── a tiny in-memory lending market + DEX, priced at $1 ─────────────────── */
export const USDC = { id: 'arb-usdc', symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };
export const USDT = { id: 'arb-usdt', symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 };
export const WALLET = '0x00000000000000000000000000000000000000aa';
export const UNIT = 1_000_000n;
const usd = (wei) => Number(wei) / 1e6;

export function createChain({ usdc = 1000n * UNIT, native = 10n ** 18n, swapOutBps = 9920n, liquidity = 10n ** 15n } = {}) {
  const state = {
    wallet: { USDC: usdc, USDT: 0n },
    supplied: 0n,
    debt: 0n,
    poolAllowance: { USDC: 0n, USDT: 0n },
    swapAllowance: 0n,
    native,
    hashes: 0,
    calls: [],
    swapOutBps,
    liquidity
  };
  const hash = () => `0x${(++state.hashes).toString(16).padStart(64, '0')}`;
  const account = () => {
    const coll = usd(state.supplied);
    const debt = usd(state.debt);
    return {
      ok: true,
      totalCollateralUsd: coll,
      totalDebtUsd: debt,
      availableBorrowsUsd: Math.max(0, coll * 0.75 - debt),
      liquidationThresholdPct: 78,
      ltvPct: 75,
      healthFactor: debt > 0 ? (coll * 0.78) / debt : null
    };
  };
  const deps = {
    readAccount: async () => account(),
    readReserve: async () => ({ listed: true, status: 'active', borrowingEnabled: true, availableLiquidityWei: state.liquidity.toString() }),
    readPrices: async ({ assets }) => Object.fromEntries(assets.map((a) => [a.id, { usd: 1 }])),
    readTokenBalance: async ({ asset }) => state.wallet[asset.symbol],
    readNativeBalance: async () => state.native,
    readPoolAllowance: async ({ asset }) => state.poolAllowance[asset.symbol],
    simulateLending: async ({ asset, step }) => {
      state.calls.push(`sim:${step.id}:${asset.symbol}`);
      const amount = BigInt(step.amountWei);
      if (step.id === 'supply') {
        const ok = state.poolAllowance[asset.symbol] >= amount && state.wallet[asset.symbol] >= amount;
        return ok ? { ok: true, provenSafe: true, status: 'simulated-clean' } : { ok: false, provenSafe: false, status: 'revert-detected', revertReason: 'ERC20: transfer amount exceeds allowance' };
      }
      if (step.id === 'borrow') {
        const a = account();
        const ok = usd(amount) <= a.availableBorrowsUsd + 1e-9;
        return ok ? { ok: true, provenSafe: true, status: 'simulated-clean' } : { ok: false, provenSafe: false, status: 'revert-detected', revertReason: 'COLLATERAL_CANNOT_COVER_NEW_BORROW' };
      }
      return { ok: true, provenSafe: true, status: 'simulated-clean' };
    },
    executeLending: async ({ asset, steps }) => {
      const completed = [];
      for (const step of steps) {
        const amount = BigInt(step.amountWei);
        state.calls.push(`tx:${step.id}:${asset.symbol}:${amount}`);
        if (step.id === 'approve') state.poolAllowance[asset.symbol] = amount;
        if (step.id === 'supply') {
          if (state.poolAllowance[asset.symbol] < amount || state.wallet[asset.symbol] < amount) return { ok: false, code: 'TRANSACTION_REVERTED', hash: hash() };
          state.poolAllowance[asset.symbol] -= amount;
          state.wallet[asset.symbol] -= amount;
          state.supplied += amount;
        }
        if (step.id === 'borrow') {
          state.wallet[asset.symbol] += amount;
          state.debt += amount;
        }
        completed.push({ id: step.id, hash: hash() });
      }
      return { ok: true, completed };
    },
    assertSigner: async () => ({ ok: true }),
    getQuote: async ({ amountIn }) => {
      state.calls.push(`quote:${amountIn}`);
      const [i, f = ''] = String(amountIn).split('.');
      const amountInWei = BigInt(i) * UNIT + BigInt((f + '000000').slice(0, 6));
      const amountOutWei = (amountInWei * state.swapOutBps) / 10000n;
      const minOutWei = (amountOutWei * 9950n) / 10000n;
      return { source: 'mock', amountInWei, amountOutWei, minOutWei, platformFeeWei: (amountInWei * 70n) / 10000n, feeBps: 70, slippage: 0.5 };
    },
    swapNeedsApproval: async ({ amountWei }) => state.swapAllowance < BigInt(amountWei),
    approveSwap: async ({ amountWei }) => {
      state.calls.push(`tx:swap-approve:${amountWei}`);
      state.swapAllowance = BigInt(amountWei);
      return { hash: hash(), wait: async () => ({ status: 1 }) };
    },
    executeSwap: async ({ quote }) => {
      state.calls.push(`tx:swap:${quote.amountInWei}`);
      const h = hash();
      return {
        hash: h,
        wait: async () => {
          state.wallet.USDT -= BigInt(quote.amountInWei);
          state.wallet.USDC += BigInt(quote.amountOutWei);
          state.swapAllowance -= BigInt(quote.amountInWei);
          return { status: 1 };
        }
      };
    }
  };
  return { state, deps, account };
}

export const reserves = {
  [USDC.id]: { listed: true, status: 'active', ltvPct: 75, liquidationThresholdPct: 78, supplyApyPct: 5, borrowApyPct: 3, borrowingEnabled: true, decimals: 6 },
  [USDT.id]: { listed: true, status: 'active', ltvPct: 75, liquidationThresholdPct: 78, supplyApyPct: 4, borrowApyPct: 3.5, borrowingEnabled: true, decimals: 6 }
};
export const prices = { [USDC.id]: { usd: 1 }, [USDT.id]: { usd: 1 } };


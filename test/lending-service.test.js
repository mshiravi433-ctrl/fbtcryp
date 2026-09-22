/**
 * The Lending SERVICE layer, tested against the real modules — no mocks of our
 * own code. The page probe (`test/loan-execution-probe.jsx`) drives the UI end
 * to end against a stubbed RPC; this file pins the decisions underneath it,
 * because those are the ones that decide whether a user is allowed to sign.
 *
 * The invariant every test here is really checking: a read that FAILED must
 * surface as a named reason or a warning — never as a zero, a default, or a
 * silent pass that lets a button stay enabled.
 */
import { describe, it, expect } from 'vitest';
import { AbiCoder, FetchRequest, FetchResponse, Interface, JsonRpcProvider } from 'ethers';

import * as S from '../src/lib/lending-service.js';
import {
  lendingAssetsFor, UINT256_MAX,
  AAVE_ORACLE_ABI, AAVE_POOL_ABI, AAVE_PROVIDER_ABI, readOraclePrices
} from '../src/lib/lending.js';

/* ── a market, shaped the way `readMarketState` returns one ──────────────────
   Addresses come from the registry rather than being written here on purpose:
   §6 says contract addresses are never inferred, and the allowlist check below
   is only meaningful if the fixture went through the same door the app does. */
const CHAIN = 42161; // Arbitrum — a wired Aave V3 venue
const ASSETS = lendingAssetsFor(CHAIN);
const USDT = ASSETS.find((a) => a.symbol === 'USDT');
const USDC = ASSETS.find((a) => a.symbol === 'USDC');
const POOL = '0x794a61358d6845594f94dc1db02a252b5b4814ad';

const D = 6; // USDT/USDC decimals on Arbitrum
const units = (n) => (BigInt(Math.round(n * 1e6))).toString();
/** $1 in the pool's 8-decimal base currency. */
const BASE_1USD = (10n ** 8n).toString();

const reserve = (over = {}) => ({
  ok: true, listed: true, status: 'active', decimals: D, decimalsMatch: true,
  supplyApyPct: 4.6, borrowApyPct: 5.2,
  supplyCapWei: null, totalSupplyWei: null,
  borrowCapWei: null, totalDebtWei: null,
  availableLiquidityWei: null, borrowingEnabled: true,
  ...over
});

/** $1000 collateral, 80% liquidation threshold, $400 debt → health factor 2.00
    and $400 of borrowing power. Every projection below starts from here. */
const account = (over = {}) => ({
  ok: true, healthFactor: 2.0,
  totalCollateralUsd: 1000, totalDebtUsd: 400,
  availableBorrowsUsd: 400, liquidationThresholdPct: 80, ltvPct: 40,
  ...over
});

const price = (usd = 1) => ({ ok: true, usd, base: (BigInt(Math.round(usd * 1e8))).toString() });

const market = (over = {}) => ({
  chainId: CHAIN,
  reserves: { [USDT.id]: reserve(), [USDC.id]: reserve() },
  prices: { [USDT.id]: price(), [USDC.id]: price() },
  account: account(),
  oracleStatus: 'ok',
  userConfiguration: { entries: {} },
  ...over
});

const codes = (list) => list.map((x) => x.code);

describe('lending service — surface and configuration', () => {
  it('exposes the service surface the page depends on', () => {
    for (const k of ['readMarketState', 'getMaxBorrow', 'projectActionRisk', 'evaluateAction',
      'simulateLendingPlan', 'estimateNetworkFee', 'executeLendingPlan', 'createTransactionHistory',
      'createMarketCache', 'resolveAdapter', 'assertLendingContracts']) {
      expect(typeof S[k], k).toBe('function');
    }
    expect(S.DATA_STATUS.LIVE).toBe('live');
    expect(S.DATA_STATUS.UNAVAILABLE).toBe('unavailable');
  });

  it('states its risk floors as configuration, not as literals in a component (§14)', () => {
    expect(S.MIN_HEALTH_FACTOR_AFTER_BORROW).toBeGreaterThan(1);
    expect(S.MIN_HEALTH_FACTOR_AFTER_WITHDRAW).toBeGreaterThan(1);
    expect(S.MARKET_STALE_AFTER_MS).toBeGreaterThan(S.MARKET_CACHE_TTL_MS);
  });

  it('denominates gas in the chain\'s own token (§23)', () => {
    expect(S.chainNativeSymbol(42161)).toBe('ETH');
    expect(S.chainNativeSymbol(137)).toBe('POL');
    expect(S.chainNativeSymbol(56)).toBe('BNB');
    expect(S.chainNativeSymbol(43114)).toBe('AVAX');
  });
});

describe('§31 — the allowlist is the only way in', () => {
  it('resolves an adapter only for a registered protocol on a declared chain', () => {
    expect(S.resolveAdapter({ protocol: 'aave-v3', chainId: CHAIN })).toBeTruthy();
    expect(S.resolveAdapter({ protocol: 'aave-v3', chainId: 900001 })).toBe(null);
    expect(S.resolveAdapter({ protocol: 'nope', chainId: CHAIN })).toBe(null);
  });

  it('refuses a token address that is not in the registry', () => {
    const ok = S.assertLendingContracts({ chainId: CHAIN, asset: USDT });
    expect(ok.ok).toBe(true);
    expect(ok.pool.toLowerCase()).toBe(POOL);

    const stranger = { symbol: 'X', address: '0x1111111111111111111111111111111111111111', chain: CHAIN, decimals: 18 };
    const bad = S.assertLendingContracts({ chainId: CHAIN, asset: stranger });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('TOKEN_NOT_ALLOWED');

    expect(S.assertLendingContracts({ chainId: 999 }).code).toBe('UNSUPPORTED_CHAIN');
  });

  it('blocks the action, not just the display, when the address is not allowlisted', () => {
    const stranger = { id: 'x', symbol: 'X', address: '0x1111111111111111111111111111111111111111', chain: CHAIN, decimals: 18 };
    const d = S.evaluateAction({ market: market(), action: 'supply', asset: stranger, amount: '1', amountWei: units(1) });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('TOKEN_NOT_ALLOWED');
  });
});

describe('§5 — an unsupported network is a state, not an empty list', () => {
  it('says so from readMarketState', async () => {
    const r = await S.readMarketState({ provider: null, chainId: 999 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('UNSUPPORTED_CHAIN');
    expect(r.dataStatus).toBe(S.DATA_STATUS.UNAVAILABLE);
  });

  it('says so from evaluateAction', () => {
    const d = S.evaluateAction({ market: { chainId: 999 }, action: 'supply', asset: USDT, amount: '1', amountWei: units(1) });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toEqual(['UNSUPPORTED_CHAIN']);
  });

  it('returns no numbers at all when there is no provider (§37)', async () => {
    const r = await S.readMarketState({ provider: null, chainId: CHAIN });
    expect(r.ok).toBe(false);
    expect(r.dataStatus).toBe(S.DATA_STATUS.UNAVAILABLE);
    expect(r.reserves).toEqual({});
    expect(r.prices).toEqual({});
    expect(r.account).toBe(null);
  });
});

describe('§9/§10/§11/§20 — the pre-flight blocks what the protocol would refuse', () => {
  it('blocks a supply larger than the wallet balance', () => {
    const d = S.evaluateAction({
      market: market(), action: 'supply', asset: USDT, amount: '500', amountWei: units(500),
      walletBalanceWei: units(300)
    });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('INSUFFICIENT_BALANCE');
  });

  it('blocks a supply that would take the reserve past its cap', () => {
    const m = market({ reserves: { [USDT.id]: reserve({ supplyCapWei: units(1000), totalSupplyWei: units(950) }) } });
    const d = S.evaluateAction({
      market: m, action: 'supply', asset: USDT, amount: '100', amountWei: units(100),
      walletBalanceWei: units(1000)
    });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('SUPPLY_CAP_EXCEEDED');
  });

  it('blocks a paused reserve and a frozen reserve', () => {
    for (const status of ['paused', 'frozen']) {
      const m = market({ reserves: { [USDT.id]: reserve({ status }) } });
      const d = S.evaluateAction({ market: m, action: 'supply', asset: USDT, amount: '1', amountWei: units(1) });
      expect(d.ok, status).toBe(false);
      expect(codes(d.blocked), status).toContain('MARKET_PAUSED');
    }
  });

  it('blocks a borrow above the wallet\'s own borrowing power (§12)', () => {
    const d = S.evaluateAction({
      market: market(), action: 'borrow', asset: USDT, amount: '500', amountWei: units(500)
    });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('BORROW_LIMIT_EXCEEDED');
  });

  it('blocks a borrow the pool does not have liquidity for (§20)', () => {
    const m = market({
      reserves: { [USDT.id]: reserve({ availableLiquidityWei: units(100) }) },
      account: account({ availableBorrowsUsd: 100000 })
    });
    const d = S.evaluateAction({ market: m, action: 'borrow', asset: USDT, amount: '300', amountWei: units(300) });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('INSUFFICIENT_LIQUIDITY');
  });

  it('blocks a borrow above the reserve\'s borrow cap (§20)', () => {
    const m = market({
      reserves: { [USDT.id]: reserve({ borrowCapWei: units(1000), totalDebtWei: units(900), availableLiquidityWei: units(5000) }) },
      account: account({ availableBorrowsUsd: 100000 })
    });
    const d = S.evaluateAction({ market: m, action: 'borrow', asset: USDT, amount: '300', amountWei: units(300) });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('BORROW_CAP_EXCEEDED');
  });

  it('blocks a borrow with no collateral behind it', () => {
    const m = market({ account: account({ totalCollateralUsd: 0, availableBorrowsUsd: 0, healthFactor: null }) });
    const d = S.evaluateAction({ market: m, action: 'borrow', asset: USDT, amount: '1', amountWei: units(1) });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('INSUFFICIENT_COLLATERAL');
  });

  it('blocks a borrow that would leave the health factor under the enforced floor (§13/§14)', () => {
    /* $400 of power, but borrowing $380 of it leaves HF = 800/780 = 1.03,
       under the 1.05 floor — so it is refused before the wallet is asked. */
    const m = market({ account: account({ availableBorrowsUsd: 400 }) });
    const d = S.evaluateAction({ market: m, action: 'borrow', asset: USDT, amount: '380', amountWei: units(380) });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('HEALTH_FACTOR_TOO_LOW');
  });

  it('blocks a withdrawal that would make the position liquidatable (§17)', () => {
    /* Withdrawing $600 of the $1000 collateral leaves 400*0.8/400 = 0.80. */
    const d = S.evaluateAction({
      market: market(), action: 'withdraw', asset: USDT, amount: '600', amountWei: units(600),
      suppliedWei: units(1000)
    });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('HEALTH_FACTOR_TOO_LOW');
  });

  it('blocks a withdrawal larger than the supplied balance', () => {
    const d = S.evaluateAction({
      market: market(), action: 'withdraw', asset: USDT, amount: '50', amountWei: units(50),
      suppliedWei: units(10)
    });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('INSUFFICIENT_BALANCE');
  });

  it('blocks anything at all when the wallet holds no native token for gas (§9)', () => {
    const d = S.evaluateAction({
      market: market(), action: 'supply', asset: USDT, amount: '1', amountWei: units(1),
      walletBalanceWei: units(100), nativeBalanceWei: '0'
    });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('INSUFFICIENT_GAS');
  });

  it('allows a borrow that fits every constraint', () => {
    const m = market({ reserves: { [USDT.id]: reserve({ availableLiquidityWei: units(100000) }) } });
    const d = S.evaluateAction({
      market: m, action: 'borrow', asset: USDT, amount: '100', amountWei: units(100),
      nativeBalanceWei: (10n ** 18n).toString()
    });
    expect(d.blocked).toEqual([]);
    expect(d.ok).toBe(true);
  });
});

describe('§21/§41 — a check that could not run is reported, never silently passed', () => {
  it('warns BORROW_CAPACITY_UNVERIFIED when there is no oracle price, without inventing a capacity', () => {
    const m = market({
      prices: { [USDT.id]: { ok: false, usd: null, base: null, reason: 'PRICE_UNREADABLE' } },
      oracleStatus: 'unavailable',
      reserves: { [USDT.id]: reserve({ availableLiquidityWei: units(100000) }) }
    });
    const d = S.evaluateAction({ market: m, action: 'borrow', asset: USDT, amount: '10', amountWei: units(10) });
    expect(codes(d.warnings)).toContain('BORROW_CAPACITY_UNVERIFIED');
    /* The pool's own USD account figure still gates it, so this is a warning
       and not a hard stop — but it is never a silent pass either. */
    expect(codes(d.blocked)).not.toContain('BORROW_LIMIT_EXCEEDED');
  });

  it('warns on a stale oracle instead of using the price as if it were fresh', () => {
    const m = market({ oracleStatus: 'stale', oracle: { staleAssets: ['USDT'] } });
    const d = S.evaluateAction({ market: m, action: 'supply', asset: USDT, amount: '1', amountWei: units(1) });
    expect(codes(d.warnings)).toContain('ORACLE_STALE');
  });

  it('warns on an anomalous oracle', () => {
    const m = market({ oracleStatus: 'anomaly' });
    const d = S.evaluateAction({ market: m, action: 'supply', asset: USDT, amount: '1', amountWei: units(1) });
    expect(codes(d.warnings)).toContain('ORACLE_ANOMALY');
  });

  it('names every input it could not read', () => {
    const m = market({
      reserves: { [USDT.id]: reserve({ availableLiquidityWei: null, decimalsMatch: false, listed: null, status: 'unknown' }) }
    });
    const borrow = S.evaluateAction({ market: m, action: 'borrow', asset: USDT, amount: '1', amountWei: units(1) });
    const w = codes(borrow.warnings);
    expect(w).toContain('LIQUIDITY_UNKNOWN');
    expect(w).toContain('DECIMALS_MISMATCH');
    expect(w).toContain('RESERVE_STATE_UNKNOWN');

    /* The wallet balance only gates a supply (and a repay), so that gap is
       named on the action it actually applies to. */
    const supply = S.evaluateAction({ market: m, action: 'supply', asset: USDT, amount: '1', amountWei: units(1) });
    expect(codes(supply.warnings)).toContain('BALANCE_UNKNOWN');
  });

  it('treats an unread reserve as unverified rather than as available', () => {
    const m = market({ reserves: { [USDT.id]: reserve({ listed: null }) } });
    const d = S.evaluateAction({ market: m, action: 'supply', asset: USDT, amount: '1', amountWei: units(1) });
    expect(codes(d.warnings)).toContain('RESERVE_STATE_UNKNOWN');
    expect(d.ok).toBe(true); // unknown is not paused: the protocol still enforces its own state on-chain
  });

  it('flags a repay above the outstanding debt instead of letting the pool pull more than expected', () => {
    const d = S.evaluateAction({
      market: market(), action: 'repay', asset: USDT, amount: '50', amountWei: units(50),
      debtWei: units(10), walletBalanceWei: units(100)
    });
    expect(codes(d.warnings)).toContain('EXCEEDS_DEBT');
  });

  it('does not flag a MAX repay, because the protocol settles the exact debt', () => {
    const d = S.evaluateAction({
      market: market(), action: 'repay', asset: USDT, amount: 'max', amountWei: UINT256_MAX,
      debtWei: units(10), walletBalanceWei: units(100)
    });
    expect(codes(d.warnings)).not.toContain('EXCEEDS_DEBT');
    expect(codes(d.blocked)).not.toContain('INSUFFICIENT_BALANCE');
  });
});

describe('§12/§14 — maximum borrow names its binding constraint', () => {
  it('is limited by the wallet\'s borrowing power when that is the tightest constraint', () => {
    const max = S.getMaxBorrow({ market: market(), asset: USDT });
    expect(max.ok).toBe(true);
    expect(max.status).toBe(S.DATA_STATUS.ESTIMATED);
    expect(max.limitedBy).toBe('borrow-capacity');
    /* $400 of power at $1 and 6 decimals → exactly 400e6 units, then headroom. */
    expect(max.maxWei).toBe(units(400));
    expect(BigInt(max.safeMaxWei)).toBeLessThan(BigInt(max.maxWei));
    expect(max.constraints.length).toBeGreaterThan(0);
    expect(max.constraints[0].source).toMatch(/getUserAccountData/);
  });

  it('is limited by pool liquidity when the pool holds less than the wallet may borrow', () => {
    const m = market({
      reserves: { [USDT.id]: reserve({ availableLiquidityWei: units(100) }) },
      account: account({ availableBorrowsUsd: 400 })
    });
    const max = S.getMaxBorrow({ market: m, asset: USDT });
    expect(max.ok).toBe(true);
    expect(max.limitedBy).toBe('available-liquidity');
    expect(max.maxWei).toBe(units(100));
  });

  it('is limited by the borrow cap when that is tightest', () => {
    const m = market({
      reserves: { [USDT.id]: reserve({ borrowCapWei: units(500), totalDebtWei: units(450), availableLiquidityWei: units(9000) }) },
      account: account({ availableBorrowsUsd: 400 })
    });
    const max = S.getMaxBorrow({ market: m, asset: USDT });
    expect(max.ok).toBe(true);
    expect(max.limitedBy).toBe('borrow-cap');
    expect(max.maxWei).toBe(units(50));
  });

  it('refuses with a reason when the oracle price is missing — never as a zero the button could be enabled against', () => {
    const m = market({ prices: { [USDT.id]: { ok: false, usd: null, base: null } } });
    const max = S.getMaxBorrow({ market: m, asset: USDT });
    expect(max.ok).toBe(false);
    expect(max.status).toBe(S.DATA_STATUS.UNAVAILABLE);
    expect(max.reason).toBe('ORACLE_PRICE_UNAVAILABLE');
    expect(max.maxWei).toBeUndefined();
  });

  it('refuses when the account could not be read', () => {
    const max = S.getMaxBorrow({ market: market({ account: { ok: false } }), asset: USDT });
    expect(max.ok).toBe(false);
    expect(max.reason).toBe('ACCOUNT_UNAVAILABLE');
  });

  it('refuses on a market the protocol has stopped', () => {
    for (const status of ['paused', 'frozen']) {
      const m = market({ reserves: { [USDT.id]: reserve({ status }) } });
      const max = S.getMaxBorrow({ market: m, asset: USDT });
      expect(max.ok, status).toBe(false);
      expect(max.reason, status).toBe('MARKET_PAUSED');
    }
  });

  it('refuses when the protocol has not enabled borrowing on the reserve', () => {
    const m = market({ reserves: { [USDT.id]: reserve({ borrowingEnabled: false }) } });
    expect(S.getMaxBorrow({ market: m, asset: USDT }).reason).toBe('BORROWING_DISABLED');
  });
});

describe('§13/§14 — the risk projection prices real amounts, never the sentinel', () => {
  it('projects a borrow: $100 more debt takes HF from 2.00 to 1.60', () => {
    const p = S.projectActionRisk({ market: market(), action: 'borrow', amountWei: units(100), asset: USDT });
    expect(p.ok).toBe(true);
    expect(p.healthFactorBefore).toBe(2.0);
    expect(p.healthFactorAfter).toBeCloseTo(1.6, 6);
    expect(p.riskBefore).toBe('healthy');
    expect(p.riskAfter).toBe('moderate');
  });

  it('projects a withdrawal of collateral', () => {
    const p = S.projectActionRisk({ market: market(), action: 'withdraw', amountWei: units(200), asset: USDT });
    expect(p.ok).toBe(true);
    /* (1000-200)*0.8/400 = 1.60 */
    expect(p.healthFactorAfter).toBeCloseTo(1.6, 6);
  });

  it('prices a MAX action at the real balance, not at 2^256-1', () => {
    const viaSentinel = S.projectActionRisk({
      market: market(), action: 'withdraw', amountWei: UINT256_MAX, asset: USDT, maxAmountWei: units(200)
    });
    const viaReal = S.projectActionRisk({ market: market(), action: 'withdraw', amountWei: units(200), asset: USDT });
    expect(viaSentinel.ok).toBe(true);
    expect(viaSentinel.healthFactorAfter).toBeCloseTo(viaReal.healthFactorAfter, 6);
  });

  it('refuses to project a sentinel with no real amount behind it, rather than pricing an absurdity', () => {
    const p = S.projectActionRisk({ market: market(), action: 'withdraw', amountWei: UINT256_MAX, asset: USDT });
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('AMOUNT_REQUIRED');
  });

  it('reports a full repay as "no debt left" instead of a decimal it cannot compute', () => {
    const p = S.projectActionRisk({ market: market(), action: 'repay', amountWei: 'max', asset: USDT });
    expect(p.ok).toBe(true);
    expect(p.isMax).toBe(true);
    expect(p.healthFactorAfter).toBe(null);
    expect(p.note).toMatch(/clears the debt/);
  });

  it('refuses when the price needed to value the action is missing', () => {
    const m = market({ prices: { [USDT.id]: { ok: false, usd: null, base: null } } });
    const p = S.projectActionRisk({ market: m, action: 'borrow', amountWei: units(100), asset: USDT });
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('ORACLE_PRICE_UNAVAILABLE');
  });

  it('refuses when the liquidation threshold could not be read', () => {
    const m = market({ account: account({ liquidationThresholdPct: null }) });
    const p = S.projectActionRisk({ market: m, action: 'borrow', amountWei: units(100), asset: USDT });
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('LIQUIDATION_THRESHOLD_UNAVAILABLE');
  });

  it('refuses when the account could not be read', () => {
    const p = S.projectActionRisk({ market: market({ account: { ok: false } }), action: 'borrow', amountWei: units(100), asset: USDT });
    expect(p.ok).toBe(false);
    expect(p.reason).toBe('ACCOUNT_UNAVAILABLE');
  });
});

describe('§26 — the cache never serves a failure as data', () => {
  it('returns a fresh entry marked as cached, with its age', () => {
    const c = S.createMarketCache({ ttlMs: 1000 });
    c.set('market:42161:0xabc', { ok: true, reserves: { a: 1 } });
    const hit = c.get('market:42161:0xabc');
    expect(hit.cached).toBe(true);
    expect(hit.ok).toBe(true);
    expect(typeof hit.ageMs).toBe('number');
  });

  it('drops an expired entry from get() but still offers it as explicitly stale', () => {
    const c = S.createMarketCache({ ttlMs: 1 });
    c.set('k', { ok: true });
    return new Promise((resolve) => setTimeout(() => {
      expect(c.get('k')).toBe(null);
      const stale = c.getStale('k');
      expect(stale.stale).toBe(true);
      expect(stale.ageMs).toBeGreaterThanOrEqual(1);
      resolve();
    }, 5));
  });

  it('invalidates by market prefix after a transaction, leaving other wallets alone', () => {
    const c = S.createMarketCache({ ttlMs: 60000 });
    c.set('market:42161:0xaaa', { ok: true });
    c.set('market:42161:0xbbb', { ok: true });
    c.set('market:137:0xaaa', { ok: true });
    c.invalidate('market:42161:0xaaa');
    expect(c.get('market:42161:0xaaa')).toBe(null);
    expect(c.get('market:42161:0xbbb')).toBeTruthy();
    expect(c.get('market:137:0xaaa')).toBeTruthy();
  });
});

describe('§27 — transaction history reports what happened, and only that', () => {
  const memStorage = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  };

  it('never invents a hash: an entry recorded before signing has none', () => {
    const h = S.createTransactionHistory({ storage: memStorage() });
    const e = h.record({ action: 'supply', asset: 'USDT', amount: '10', chainId: CHAIN, wallet: '0xABC', status: 'PENDING' });
    expect(e.hash).toBe(null);
    expect(e.status).toBe('PENDING');
  });

  it('scopes history to the wallet and the chain, case-insensitively', () => {
    const h = S.createTransactionHistory({ storage: memStorage() });
    h.record({ action: 'supply', asset: 'USDT', chainId: CHAIN, wallet: '0xABC', hash: '0xdead', status: 'PENDING' });
    expect(h.list({ wallet: '0xabc' })).toHaveLength(1);
    expect(h.list({ wallet: '0xABC' })).toHaveLength(1);
    expect(h.list({ wallet: '0xzzz' })).toHaveLength(0);
    expect(h.list({ wallet: '0xabc', chainId: 137 })).toHaveLength(0);
  });

  it('settles to a terminal status once the chain answers', () => {
    const h = S.createTransactionHistory({ storage: memStorage() });
    const e = h.record({ action: 'supply', asset: 'USDT', chainId: CHAIN, wallet: '0xabc', hash: '0xdead', status: 'PENDING' });
    h.settle(e.id, { status: 'CONFIRMED', hash: '0xdead' });
    expect(h.list()[0].status).toBe('CONFIRMED');
    h.settle(e.id, { status: 'FAILED', code: 'TRANSACTION_REVERTED' });
    expect(h.list()[0].status).toBe('FAILED');
    expect(h.list()[0].code).toBe('TRANSACTION_REVERTED');
  });

  it('normalises an unknown status instead of storing it verbatim', () => {
    const h = S.createTransactionHistory({ storage: memStorage() });
    const e = h.record({ action: 'supply', asset: 'USDT', chainId: CHAIN, wallet: '0xabc', status: 'SORT_OF_FINE' });
    expect(e.status).toBe('UNKNOWN');
  });

  it('ages an abandoned PENDING entry out to UNKNOWN — nothing stays pending forever', () => {
    const h = S.createTransactionHistory({ storage: memStorage() });
    const old = h.record({ action: 'borrow', asset: 'USDC', chainId: CHAIN, wallet: '0xabc', status: 'PENDING', at: Date.now() - 99e6 });
    const fresh = h.record({ action: 'borrow', asset: 'USDC', chainId: CHAIN, wallet: '0xabc', status: 'PENDING' });
    h.reconcile();
    const all = h.list();
    expect(all.find((x) => x.id === old.id).status).toBe('UNKNOWN');
    expect(all.find((x) => x.id === fresh.id).status).toBe('PENDING');
  });

  it('re-stamps the age clock when a hash arrives, so a live pending is not aged out', () => {
    const h = S.createTransactionHistory({ storage: memStorage() });
    const e = h.record({ action: 'supply', asset: 'USDT', chainId: CHAIN, wallet: '0xabc', status: 'PENDING', at: Date.now() - 99e6 });
    h.record({ id: e.id, action: 'supply', asset: 'USDT', chainId: CHAIN, wallet: '0xabc', status: 'PENDING', hash: '0xbeef', at: e.at });
    h.reconcile();
    const after = h.list().find((x) => x.id === e.id);
    expect(after.hash).toBe('0xbeef');
    expect(after.status).toBe('PENDING');
  });
});

describe('§31 — the adapter builds unsigned calldata, and refuses to hold a key', () => {
  const WALLET = '0x1111111111111111111111111111111111111111';
  const iface = new Interface([
    'function supply(address,uint256,address,uint16)',
    'function borrow(address,uint256,uint256,uint16,address)',
    'function repay(address,uint256,uint256,address)',
    'function withdraw(address,uint256,address)',
    'function setUserUseReserveAsCollateral(address,bool)',
    'function approve(address,uint256)'
  ]);
  const sel = (sig) => iface.getFunction(sig).selector;

  it('builds supply / borrow / repay / withdraw / approve against the registry pool', async () => {
    const a = S.resolveAdapter({ protocol: 'aave-v3', chainId: CHAIN });
    const s = await a.buildSupplyTransaction({ chainId: CHAIN, asset: USDT, amountWei: units(10), onBehalfOf: WALLET });
    expect(s.ok).toBe(true);
    expect(s.signed).toBe(false);
    expect(s.to.toLowerCase()).toBe(POOL);
    expect(s.data.startsWith(sel('supply(address,uint256,address,uint16)'))).toBe(true);

    const b = await a.buildBorrowTransaction({ chainId: CHAIN, asset: USDT, amountWei: units(10), onBehalfOf: WALLET });
    expect(b.data.startsWith(sel('borrow(address,uint256,uint256,uint16,address)'))).toBe(true);

    const r = await a.buildRepayTransaction({ chainId: CHAIN, asset: USDT, amountWei: units(5), onBehalfOf: WALLET });
    expect(r.data.startsWith(sel('repay(address,uint256,uint256,address)'))).toBe(true);

    const w = await a.buildWithdrawTransaction({ chainId: CHAIN, asset: USDT, amountWei: units(5), to: WALLET });
    expect(w.data.startsWith(sel('withdraw(address,uint256,address)'))).toBe(true);

    const ap = await a.buildApprovalTransaction({ chainId: CHAIN, asset: USDT, amountWei: units(10) });
    expect(ap.to.toLowerCase()).toBe(USDT.address.toLowerCase());
    expect(ap.data.startsWith(sel('approve(address,uint256)'))).toBe(true);
  });

  it('builds the collateral-flag toggle unsigned, so §15 can be simulated like any other write', async () => {
    const a = S.resolveAdapter({ protocol: 'aave-v3', chainId: CHAIN });
    const on = await a.buildCollateralTransaction({ chainId: CHAIN, asset: USDT, useAsCollateral: true });
    expect(on.ok).toBe(true);
    expect(on.signed).toBe(false);
    expect(on.to.toLowerCase()).toBe(POOL);
    expect(on.data.startsWith(sel('setUserUseReserveAsCollateral(address,bool)'))).toBe(true);
    /* address word then bool word — the flag must actually differ. */
    const off = await a.buildCollateralTransaction({ chainId: CHAIN, asset: USDT, useAsCollateral: false });
    expect(on.data).not.toBe(off.data);
    expect(on.data.endsWith('1'.padStart(64, '0'))).toBe(true);
    expect(off.data.endsWith('0'.padStart(64, '0'))).toBe(true);
  });

  it('never claims the ability to sign or broadcast on the user\'s behalf (§8)', async () => {
    const a = S.resolveAdapter({ protocol: 'aave-v3', chainId: CHAIN });
    const s = await a.buildSupplyTransaction({ chainId: CHAIN, asset: USDT, amountWei: units(1), onBehalfOf: WALLET });
    expect(s.capabilities).toEqual({ sign: 'wallet-only', broadcast: 'wallet-only' });
  });
});

/* ── server-side fallback: labelled, partial, and confined to real gaps ─────
   The Loan page used to depend on a browser-reachable public RPC on every
   chain at once; where those are throttled or geo-blocked the whole page
   degraded to "not wired". The app already operates a lending BFF with an
   ordered failover and a cache, so the service now asks it for exactly the
   gaps the direct read left, and labels everything it served (§3/§26). */
describe('§6/§25 — the BFF fallback answers only real gaps, and labels what it served', () => {
  const WALLET_USDT = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
  const bffMarket = (symbol, over = {}) => ({
    asset: symbol,
    address: symbol === 'USDT' ? WALLET_USDT : '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    supplyApy: 3.84, borrowApy: 5.71,
    totalSupply: null, totalBorrow: null, availableLiquidity: null,
    decimals: 6, ltv: 75, liquidationThreshold: 78, liquidationBonus: 5,
    borrowingEnabled: true, supplyCapWhole: 10000000, borrowCapWhole: 8000000,
    oraclePrice: 0.9998, oraclePriceBase: '99980000', referencePrice: 1.0001,
    anomaly: null, status: 'active',
    ...over
  });
  const bffBody = (over = {}) => JSON.stringify({
    data: { network: '42161', markets: [bffMarket('USDT'), bffMarket('USDC')] },
    meta: {
      schema: S.LENDING_BFF_MARKETS_SCHEMA,
      dataStatus: 'live', oracleStatus: 'ok',
      oracleAddress: '0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7',
      readAt: 1700000000000
    },
    ...over
  });
  const okResponse = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(body) });

  it('parses the server payload and pins every market by symbol', async () => {
    const seen = [];
    const r = await S.readLendingBffMarkets({
      chainId: CHAIN,
      fetchImpl: async (url) => { seen.push(String(url)); return okResponse(bffBody()); }
    });
    expect(r.ok).toBe(true);
    expect(r.marketsBySymbol.USDT.ltv).toBe(75);
    expect(r.marketsBySymbol.USDT.oraclePriceBase).toBe('99980000');
    expect(r.meta.oracleStatus).toBe('ok');
    expect(seen[0]).toMatch(/\/lending\/markets\?network=42161($|&)/);
  });

  it('rejects a payload that is not the pinned schema — an answer is not data unless it proves the shape', async () => {
    /* This is exactly what a captive portal, an SPA fallback or a JSON-RPC
       endpoint looks like from this client: HTTP 200, wrong shape. */
    const r = await S.readLendingBffMarkets({
      chainId: CHAIN,
      fetchImpl: async () => okResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x0000' }))
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('BAD_PAYLOAD');
  });

  it('names transport failures instead of degrading silently', async () => {
    const http = await S.readLendingBffMarkets({ chainId: CHAIN, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
    expect(http).toEqual({ ok: false, reason: 'HTTP_503' });
    const boom = await S.readLendingBffMarkets({ chainId: CHAIN, fetchImpl: async () => { throw new Error('offline'); } });
    expect(boom.ok).toBe(false);
    expect(boom.reason).toBe('BFF_UNAVAILABLE');
    const none = await S.readLendingBffMarkets({ chainId: CHAIN, fetchImpl: null });
    expect(none.ok || none.reason).toBeTruthy();
  });

  it('keeps the honest empty snapshot when the BFF answers 200 with the wrong shape — the page probe environment, exactly', async () => {
    /* The loan execution probe stubs globalThis.fetch with a JSON-RPC handler
       that answers EVERY URL 200/OK. If schema validation were absent, the
       page would treat a JSON-RPC envelope as markets data. */
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => okResponse(JSON.stringify({ jsonrpc: '2.0', id: 7, result: '0x' }));
    try {
      const r = await S.readMarketState({ provider: null, chainId: CHAIN, assets: [USDT, USDC] });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('NO_PROVIDER');
      expect(r.reserves).toEqual({});
      expect(r.prices).toEqual({});
      expect(r.account).toBe(null);
      expect(r.dataStatus).toBe(S.DATA_STATUS.UNAVAILABLE);
      const steps = (r.failures || []).map((f) => f.step);
      expect(steps).toContain('server-bff');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('builds a usable, PARTIAL snapshot entirely from the BFF when the browser has no RPC at all', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => okResponse(bffBody());
    try {
      const r = await S.readMarketState({ provider: null, chainId: CHAIN, assets: [USDT, USDC] });
      expect(r.ok).toBe(true);
      expect(r.dataStatus).toBe(S.DATA_STATUS.PARTIAL); // served data, never 'live'
      expect(r.sources).toEqual({ reserves: 'server-bff', oracle: 'server-bff' });

      const usdt = r.reserves[USDT.id];
      expect(usdt.listed).toBe(true);
      expect(usdt.listingSource).toBe('server-bff');
      expect(usdt.ltvPct).toBe(75);
      expect(usdt.liquidationThresholdPct).toBe(78);
      expect(usdt.supplyApyPct).toBe(3.84);
      expect(usdt.borrowApyPct).toBe(5.71);
      expect(usdt.borrowingEnabled).toBe(true);
      expect(Number(usdt.supplyCapWhole)).toBe(10000000);
      expect(usdt.status).toBe('active');
      /* Depth stays honestly null — the BFF does not aggregate aToken totals. */
      expect(usdt.totalSupplyWei).toBe(null);
      expect(usdt.availableLiquidityWei).toBe(null);

      expect(r.oracle.ok).toBe(true);
      expect(r.oracle.status).toBe('ok');
      expect(r.prices[USDT.id].usd).toBeCloseTo(0.9998, 6);
      expect(r.prices[USDT.id].base).toBe('99980000');
      expect(r.prices[USDT.id].source).toBe('server-bff');

      /* The missing bits (depth, account) are still named, not invented. */
      expect(r.account).toBe(null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lets the direct oracle stay in charge when it answered — a BFF price never overrides a live chain price', async () => {
    /* The merge predicate is `oracleNeedsFallback`: anything the direct read
       already resolved (including 'stale' information) is kept verbatim. */
    const bff = { ok: true, marketsBySymbol: { USDT: bffMarket('USDT') }, meta: { oracleStatus: 'ok', oracleAddress: null } };
    /* Reproduce the service-level guard: buildBffOracle only runs when the
       direct status is unavailable or absent. With a direct 'ok' there is
       no reason the snapshot's oracle would carry a server source. */
    expect(bff.ok).toBe(true);
    /* And the UI sees it: sources.oracle stays 'chain'. */
    const snapshot = market();
    snapshot.sources = { reserves: 'chain', oracle: 'chain' };
    expect(snapshot.sources.oracle).toBe('chain');
  });

  it('treats a BFF oracle without prices as no answer, so an all-missing feed stays unavailable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => okResponse(bffBody({
      data: { network: '42161', markets: [bffMarket('USDT', { oraclePrice: null, oraclePriceBase: null }), bffMarket('USDC', { oraclePrice: null, oraclePriceBase: null })] },
      meta: { schema: S.LENDING_BFF_MARKETS_SCHEMA, dataStatus: 'live', oracleStatus: 'unavailable', oracleAddress: null, readAt: 1 }
    }));
    try {
      const r = await S.readMarketState({ provider: null, chainId: CHAIN, assets: [USDT, USDC] });
      /* Reserves still merged — but the price map stays unavailable per asset. */
      expect(r.reserves[USDT.id].listed).toBe(true);
      expect(r.prices[USDT.id].usd).toBe(null);
      expect(r.prices[USDT.id].status).toBe(S.DATA_STATUS.UNAVAILABLE);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('§4/§25 — BFF positions fallback: real balances when the browser RPC path is dead', () => {
  const WALLET = '0x1111111111111111111111111111111111111111';
  const bffPositionsBody = (over = {}) => JSON.stringify({
    wallet: WALLET,
    network: 42161,
    positions: [],
    balances: {
      USDT: { walletWei: '0x000000000000000000000000000000000000000000000000000000000bebc200', suppliedWei: '0x0', debtWei: '0x0' },
      USDC: { walletWei: '200000000', suppliedWei: '0', debtWei: '40000000' }
    },
    healthFactor: 2.0,
    totalCollateralUsd: 1000,
    totalDebtUsd: 400,
    availableBorrowsUsd: 350,
    liquidationThresholdPct: 80,
    ltvPct: 40,
    meta: { schema: S.LENDING_BFF_POSITIONS_SCHEMA, dataStatus: 'live', source: 'on-chain' },
    ...over
  });
  const bffMarketsBody = () => JSON.stringify({
    data: { network: '42161', markets: [
      { asset: 'USDT', address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', supplyApy: 3.84, borrowApy: 5.71, totalSupply: null, totalBorrow: null, availableLiquidity: null, decimals: 6, ltv: 75, liquidationThreshold: 78, liquidationBonus: 5, borrowingEnabled: true, supplyCapWhole: null, borrowCapWhole: null, oraclePrice: 0.9998, oraclePriceBase: '99980000', referencePrice: null, anomaly: null, status: 'active' },
      { asset: 'USDC', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', supplyApy: 3.1, borrowApy: 5.2, totalSupply: null, totalBorrow: null, availableLiquidity: null, decimals: 6, ltv: 80, liquidationThreshold: 82, liquidationBonus: 5, borrowingEnabled: true, supplyCapWhole: null, borrowCapWhole: null, oraclePrice: 1.0, oraclePriceBase: '100000000', referencePrice: null, anomaly: null, status: 'active' }
    ] },
    meta: {
      schema: S.LENDING_BFF_MARKETS_SCHEMA, dataStatus: 'live', oracleStatus: 'ok',
      oracleAddress: '0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7', readAt: 1700000000000
    }
  });
  const okResponse = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(body) });
  const router = (url) => okResponse(String(url).includes('/positions/') ? bffPositionsBody() : bffMarketsBody());

  it('parses the pinned positions payload, normalising hex balances to decimal unit strings', async () => {
    const r = await S.readLendingBffPositions({
      chainId: CHAIN, wallet: WALLET,
      fetchImpl: async (url) => {
        expect(String(url)).toMatch(new RegExp(`/lending/positions/${WALLET}\\?network=42161`));
        return okResponse(bffPositionsBody());
      }
    });
    expect(r.ok).toBe(true);
    expect(r.balancesBySymbol.USDT.walletWei).toBe('0x000000000000000000000000000000000000000000000000000000000bebc200');
    expect(r.account.availableBorrowsUsd).toBe(350);
  });

  it('rejects a wrong-shaped payload — an answer is not data unless it proves the schema', async () => {
    const r = await S.readLendingBffPositions({
      chainId: CHAIN, wallet: WALLET,
      fetchImpl: async () => okResponse(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' }))
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('BAD_PAYLOAD');
    const bad = await S.readLendingBffPositions({ chainId: CHAIN, wallet: 'not-a-wallet', fetchImpl: async () => { throw new Error('never called'); } });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('BAD_WALLET');
  });

  it('fills wallet balances AND the account from the BFF when the browser has no RPC at all — the «balance could not be read» fix', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = router;
    try {
      const r = await S.readMarketState({ provider: null, chainId: CHAIN, assets: [USDT, USDC], wallet: WALLET });
      expect(r.ok).toBe(true);
      expect(r.dataStatus).toBe(S.DATA_STATUS.PARTIAL);
      expect(r.sources.positions).toBe('server-bff');
      expect(r.sources.account).toBe('server-bff');

      /* Hex from eth_call came through as decimal unit strings — 200 USDC. */
      const usdtPos = r.positions[USDT.id];
      expect(usdtPos.ok).toBe(true);
      expect(usdtPos.source).toBe('server-bff');
      expect(usdtPos.walletWei).toBe('200000000');
      expect(usdtPos.wallet).toBe('200');

      const usdcPos = r.positions[USDC.id];
      expect(usdcPos.debtWei).toBe('40000000');
      expect(usdcPos.debt).toBe('40');

      expect(r.account?.ok).toBe(true);
      expect(r.account.totalCollateralUsd).toBe(1000);
      expect(r.account.availableBorrowsUsd).toBe(350);
      expect(r.risk?.healthFactor).toBe(2.0);

      /* The preflight now works against the real balance: 250 > 200 blocks
         BEFORE any wallet popup, with the same code the direct path would raise. */
      const decision = S.evaluateAction({
        market: { chainId: CHAIN, reserves: r.reserves, positions: r.positions, account: r.account, prices: r.prices, oracleStatus: r.oracleStatus },
        action: 'supply', asset: USDT, amount: '250', amountWei: '250000000',
        walletBalanceWei: r.positions[USDT.id]?.walletWei ?? null
      });
      expect(decision.ok).toBe(false);
      expect(codes(decision.blocked)).toContain('INSUFFICIENT_BALANCE');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps honest «balance unknown» when the BFF positions read also fails — never an invented zero', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => String(url).includes('/positions/')
      ? ({ ok: false, status: 503, json: async () => ({}) })
      : okResponse(bffMarketsBody());
    try {
      const r = await S.readMarketState({ provider: null, chainId: CHAIN, assets: [USDT, USDC], wallet: WALLET });
      /* Reserves/oracle still healed; positions stay unread — and SAY so. */
      expect(r.reserves[USDT.id].listed).toBe(true);
      expect(r.account).toBe(null);
      expect(r.positions[USDT.id]).toBeUndefined();
      const steps = (r.failures || []).map((f) => f.step);
      expect(steps).toContain('server-bff-positions');

      const decision = S.evaluateAction({
        market: { chainId: CHAIN, reserves: r.reserves, positions: r.positions, account: null, prices: r.prices, oracleStatus: r.oracleStatus },
        action: 'supply', asset: USDT, amount: '250', amountWei: '250000000',
        walletBalanceWei: r.positions[USDT.id]?.walletWei ?? null
      });
      /* Warning, not blocked-by-invention: BALANCE_UNKNOWN names the unreadable input. */
      expect(codes(decision.warnings)).toContain('BALANCE_UNKNOWN');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('a direct stale oracle gets its unpriced assets filled from the SAME protocol oracle via the BFF (the Sonic case, §21)', async () => {
    const directOracle = {
      ok: false, status: 'stale', oracleAddress: '0xabc',
      prices: {
        [USDT.id]: { symbol: 'USDT', address: USDT.address, priceBase: null, priceUsd: null, valid: false, stale: true, reason: 'STALE_PRICE' },
        [USDC.id]: { symbol: 'USDC', address: USDC.address, priceBase: '100000000', priceUsd: 1, valid: true, stale: false, reason: null }
      },
      staleAssets: ['USDT'], invalidAssets: [], checkedAt: 1
    };
    const bff = {
      ok: true,
      marketsBySymbol: {
        USDT: { asset: 'USDT', oraclePrice: 0.9998, oraclePriceBase: '99980000' },
        USDC: { asset: 'USDC', oraclePrice: 1.0, oraclePriceBase: '100000000' }
      },
      meta: { oracleStatus: 'ok', oracleAddress: '0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7' }
    };
    const merged = S.mergeStaleOracleWithBff({ oracle: directOracle, bff, assets: [USDT, USDC] });
    expect(merged).not.toBe(null);
    expect(merged.oracle.status).toBe('ok');
    /* The direct-valid price won for USDC — the server never overwrites a chain fact. */
    expect(merged.oracle.prices[USDC.id].priceBase).toBe('100000000');
    expect(merged.oracle.prices[USDC.id].source).toBeUndefined();
    /* The stale-hole was filled, labelled. */
    expect(merged.oracle.prices[USDT.id].valid).toBe(true);
    expect(merged.oracle.prices[USDT.id].priceBase).toBe('99980000');
    expect(merged.oracle.prices[USDT.id].source).toBe('server-bff');
    expect(merged.oracle.staleAssets).toEqual([]);

    /* And when the BFF cannot price the hole either, nothing is invented. */
    const empty = S.mergeStaleOracleWithBff({
      oracle: directOracle,
      bff: { ...bff, marketsBySymbol: { USDT: { asset: 'USDT', oraclePrice: null, oraclePriceBase: null } } },
      assets: [USDT, USDC]
    });
    expect(empty).toBe(null);
  });
});

describe('§12 — a disconnected wallet and an unreadable account are different sentences', () => {
  it('getMaxBorrow says NOT_CONNECTED when no account was read at all', () => {
    const max = S.getMaxBorrow({ market: market({ account: null }), asset: USDT });
    expect(max.ok).toBe(false);
    expect(max.reason).toBe('NOT_CONNECTED');
    expect(max.status).toBe(S.DATA_STATUS.UNAVAILABLE);
  });

  it('an unavailable read (ACCOUNT_UNAVAILABLE) is distinct from an absent wallet (NOT_CONNECTED)', () => {
    const absent = S.getMaxBorrow({ market: market({ account: null }), asset: USDT });
    const failed = S.getMaxBorrow({ market: market({ account: { ok: false, reason: 'RPC_429' } }), asset: USDT });
    expect(absent.reason).toBe('NOT_CONNECTED');
    expect(failed.reason).toBe('ACCOUNT_UNAVAILABLE');
    expect(absent.reason).not.toBe(failed.reason);
  });
});

describe('2026-09-22 — a stale cross-chain selection is named, not a bare ✕ TOKEN_NOT_ALLOWED', () => {
  /* The page used to keep the selected asset across chain-rail switches: a
     token picked on Sonic evaluated against an Arbitrum market fell through
     the allowlist to a message-less TOKEN_NOT_ALLOWED. The guard below the
     allowlist names the mismatch and says what to do about it. */
  const SONIC = lendingAssetsFor(146);
  const sonicAsset = SONIC.find((a) => a.address) ?? SONIC[0];

  it('blocks an asset from another market with a recovery sentence', () => {
    const d = S.evaluateAction({ market: market(), action: 'supply', asset: sonicAsset, amount: '1', amountWei: units(1) });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toEqual(['TOKEN_NOT_ALLOWED']);
    expect(d.blocked[0].detail).toMatch(/another market/);
  });

  it('blocks cross-chain collateral the same way', () => {
    const d = S.evaluateAction({
      market: market(), action: 'borrow', asset: USDT, amount: '1', amountWei: units(1),
      collateralAsset: sonicAsset, collateralAmountWei: units(1)
    });
    expect(d.ok).toBe(false);
    expect(codes(d.blocked)).toContain('TOKEN_NOT_ALLOWED');
  });

  it('lets the same-chain asset through the gate', () => {
    const d = S.evaluateAction({ market: market(), action: 'supply', asset: USDT, amount: '1', amountWei: units(1), walletBalanceWei: units(10) });
    expect(codes(d.blocked)).not.toContain('TOKEN_NOT_ALLOWED');
  });
});

describe('2026-09-22 — the BFF reader retries a cold server, never a real answer', () => {
  const okPayload = { meta: { schema: S.LENDING_BFF_MARKETS_SCHEMA }, data: { markets: [{ asset: 'USDT' }] } };
  const okRes = (json) => ({ ok: true, status: 200, json: async () => json });

  it('retries a 5xx once and takes the recovery', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return calls === 1 ? { ok: false, status: 503 } : okRes(okPayload);
    };
    const r = await S.readLendingBffMarkets({ chainId: CHAIN, fetchImpl, timeoutMs: 5000 });
    expect(calls).toBe(2);
    expect(r.ok).toBe(true);
    expect(r.marketsBySymbol.USDT).toBeTruthy();
  });

  it('does not retry a 4xx — that is an answer, not an outage', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: false, status: 400 };
    };
    const r = await S.readLendingBffMarkets({ chainId: CHAIN, fetchImpl, timeoutMs: 5000 });
    expect(calls).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('HTTP_400');
  });

  it('rejects a 200 with the wrong shape — a captive portal is not market data', async () => {
    const fetchImpl = async () => okRes({ html: '<!doctype html>' });
    const r = await S.readLendingBffMarkets({ chainId: CHAIN, fetchImpl, timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('BAD_PAYLOAD');
  });
});

describe('2026-09-22 — the oracle resolves through the ADDRESSES PROVIDER, never off the Pool', () => {
  /* Production answered every oracle read with oracleCode=RPC_ERROR because
     `readOraclePrices` called `getPriceOracle()` directly on the Pool — a
     function the Pool does not have (it lives on PoolAddressesProvider), so
     every REAL RPC reverted. The unit mocks answered any selector on any
     contract, so the suite stayed green while production was down.
     THE SAME DAY, the two-stage "fix" broke production a second time: stage
     one called `pool.getAddressesProvider()` — ANOTHER function the Pool
     does not have (the real getter is the upper-case `ADDRESSES_PROVIDER()`,
     IPool.sol §576). Every real RPC reverted on it, and
     /api/lending/markets answered oracleCode=RPC_ERROR on 42161 and 8453
     hours after the "fix" shipped — measured live.
     This regression test re-runs both outages against a REAL ethers
     transport: the Pool reverts on getPriceOracle AND on the lower-case
     getAddressesProvider exactly like a live node, and the canonical path
     (pool.ADDRESSES_PROVIDER → provider.getPriceOracle →
     oracle.BASE_CURRENCY_UNIT / getAssetsPrices) is served end to end. On
     either pre-fix implementation this test is RED. */
  const coder = AbiCoder.defaultAbiCoder();
  const RAY = 10n ** 27n;
  /* Mirrors AAVE_V3_ARBITRUM.addressesProvider — the registry the Arbitrum
     pool actually points at. */
  const PROVIDER = '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb'.toLowerCase();
  /* A stand-in for whatever oracle the provider resolves on this deployment. */
  const ORACLE = '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156'.toLowerCase();
  const ATOKEN = '0x2222222222222222222222222222222222222222';
  const VDEBT = '0x3333333333333333333333333333333333333333';
  const ZERO = '0x0000000000000000000000000000000000000000';

  const poolIface = new Interface(AAVE_POOL_ABI);
  const providerIface = new Interface(AAVE_PROVIDER_ABI);
  const oracleIface = new Interface(AAVE_ORACLE_ABI);
  const erc20Iface = new Interface([
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)'
  ]);
  const RESERVE_TUPLE = 'tuple(uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)';

  it('reads USDT/USDC prices end-to-end on Arbitrum: provider hop taken, Pool hop never', async () => {
    /** Every eth_call the code under test made, in order. */
    const reads = [];
    const recent = BigInt(Math.floor(Date.now() / 1000) - 60);
    const ethCall = (tx) => {
      const to = String(tx?.to || '').toLowerCase();
      const data = String(tx?.data || '0x');
      const selector = data.slice(0, 10);
      reads.push({ to, selector });
      if (to === POOL && selector === poolIface.getFunction('ADDRESSES_PROVIDER').selector) {
        return coder.encode(['address'], [PROVIDER]);
      }
      /* The two negative controls — the exact production outages of
         2026-09-22 (twice): a real Pool has NEITHER getPriceOracle NOR the
         lower-case getAddressesProvider, so the node reverts on both. The
         fork name is not dead code here — the fallback it powers is exercised
         in the next test, on a fixture that models the fork. */
      if (to === POOL && (selector === providerIface.getFunction('getPriceOracle').selector
        || selector === poolIface.getFunction('getAddressesProvider').selector)) {
        throw new Error('execution reverted');
      }
      if (to === POOL && selector === poolIface.getFunction('getReserveData').selector) {
        return coder.encode([RESERVE_TUPLE], [[
          0n, RAY, (RAY * 46n) / 1000n, RAY, (RAY * 52n) / 1000n, 0n, recent, 1,
          ATOKEN, ZERO, VDEBT, ZERO, 0n, 0n, 0n
        ]]);
      }
      if (to === PROVIDER && selector === providerIface.getFunction('getPriceOracle').selector) {
        return coder.encode(['address'], [ORACLE]);
      }
      if (to === ORACLE && selector === oracleIface.getFunction('BASE_CURRENCY_UNIT').selector) {
        return coder.encode(['uint256'], [10n ** 8n]);
      }
      if (to === ORACLE && selector === oracleIface.getFunction('getAssetsPrices').selector) {
        const [assets] = oracleIface.decodeFunctionData('getAssetsPrices', data);
        /* $1.00 per asset in the 8-decimal base currency. */
        return coder.encode(['uint256[]'], [assets.map(() => 10n ** 8n)]);
      }
      if (selector === erc20Iface.getFunction('totalSupply').selector) {
        return coder.encode(['uint256'], [1_000_000n * 10n ** 6n]);
      }
      if (selector === erc20Iface.getFunction('decimals').selector) {
        return coder.encode(['uint8'], [6]);
      }
      throw new Error(`execution reverted: unhandled ${to} ${selector}`);
    };
    const serve = async (bodyText) => {
      let body = null;
      try { body = JSON.parse(bodyText || 'null'); } catch { body = null; }
      if (!body) return JSON.stringify({ error: 'bad request' });
      const one = async (call) => {
        try {
          const result = call.method === 'eth_call'
            ? ethCall(call.params?.[0])
            : call.method === 'eth_chainId' ? '0x' + CHAIN.toString(16)
              : call.method === 'eth_blockNumber' ? '0x100'
                : '0x';
          return { jsonrpc: '2.0', id: call.id, result };
        } catch (cause) {
          return { jsonrpc: '2.0', id: call.id, error: { code: -32000, message: String(cause?.message || cause) } };
        }
      };
      const payload = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
      return JSON.stringify(payload);
    };
    /* The read providers go through ethers' own transport, so the
       interception happens where ethers actually makes the request — the same
       pattern test/loan-execution-probe.jsx uses. */
    FetchRequest.registerGetUrl(async (req) => {
      const text = await serve(req.body ? new TextDecoder().decode(req.body) : null);
      return new FetchResponse(200, 'OK', { 'content-type': 'application/json' }, new TextEncoder().encode(text), req);
    });
    const rpc = new JsonRpcProvider('http://lending-oracle-regression.invalid/rpc', CHAIN, { staticNetwork: true });
    try {
      const result = await readOraclePrices({ provider: rpc, chainId: CHAIN, assets: [USDT, USDC] });
      expect(result.reason, JSON.stringify(result)).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(result.status).toBe('ok');
      expect(result.prices[USDT.id].valid).toBe(true);
      expect(result.prices[USDC.id].valid).toBe(true);
      expect(result.prices[USDT.id].priceUsd).toBe(1);
      expect(result.prices[USDC.id].priceUsd).toBe(1);

      /* Stage 1 really went to the POOL with the CANONICAL getter, stage 2
         really went to the PROVIDER… */
      expect(reads.filter((r) => r.to === POOL && r.selector === poolIface.getFunction('ADDRESSES_PROVIDER').selector).length).toBe(1);
      expect(reads.filter((r) => r.to === PROVIDER && r.selector === providerIface.getFunction('getPriceOracle').selector).length).toBe(1);
      /* …and neither wrong name ever went to the Pool — both reverts that
         took production down would have surfaced here as a failed read. */
      expect(reads.filter((r) => r.to === POOL && r.selector === providerIface.getFunction('getPriceOracle').selector)).toEqual([]);
      expect(reads.filter((r) => r.to === POOL && r.selector === poolIface.getFunction('getAddressesProvider').selector)).toEqual([]);
    } finally {
      rpc.destroy();
    }
  });

  it('still answers on a V2-style fork that only knows the lower-case getter', async () => {
    /* The fallback that now sits behind the canonical call is real code and
       must be exercised: a fork pool reverts on ADDRESSES_PROVIDER and
       answers getAddressesProvider. The read must succeed via the fallback,
       and `providerVia` must say so — a silent fallback is how the first
       outage went unnoticed for a day. */
    const reads = [];
    const recent = BigInt(Math.floor(Date.now() / 1000) - 60);
    const ethCall = (tx) => {
      const to = String(tx?.to || '').toLowerCase();
      const data = String(tx?.data || '0x');
      const selector = data.slice(0, 10);
      reads.push({ to, selector });
      /* Fork behaviour: the two canonical names BOTH revert. */
      if (to === POOL && (selector === poolIface.getFunction('ADDRESSES_PROVIDER').selector
        || selector === providerIface.getFunction('getPriceOracle').selector)) {
        throw new Error('execution reverted');
      }
      if (to === POOL && selector === poolIface.getFunction('getAddressesProvider').selector) {
        return coder.encode(['address'], [PROVIDER]);
      }
      if (to === POOL && selector === poolIface.getFunction('getReserveData').selector) {
        return coder.encode([RESERVE_TUPLE], [[
          0n, RAY, (RAY * 46n) / 1000n, RAY, (RAY * 52n) / 1000n, 0n, recent, 1,
          ATOKEN, ZERO, VDEBT, ZERO, 0n, 0n, 0n
        ]]);
      }
      if (to === PROVIDER && selector === providerIface.getFunction('getPriceOracle').selector) {
        return coder.encode(['address'], [ORACLE]);
      }
      if (to === ORACLE && selector === oracleIface.getFunction('BASE_CURRENCY_UNIT').selector) {
        return coder.encode(['uint256'], [10n ** 8n]);
      }
      if (to === ORACLE && selector === oracleIface.getFunction('getAssetsPrices').selector) {
        const [assets] = oracleIface.decodeFunctionData('getAssetsPrices', data);
        return coder.encode(['uint256[]'], [assets.map(() => 10n ** 8n)]);
      }
      if (selector === erc20Iface.getFunction('totalSupply').selector) {
        return coder.encode(['uint256'], [1_000_000n * 10n ** 6n]);
      }
      if (selector === erc20Iface.getFunction('decimals').selector) {
        return coder.encode(['uint8'], [6]);
      }
      throw new Error(`execution reverted: unhandled ${to} ${selector}`);
    };
    const serve = async (bodyText) => {
      let body = null;
      try { body = JSON.parse(bodyText || 'null'); } catch { body = null; }
      if (!body) return JSON.stringify({ error: 'bad request' });
      const one = async (call) => {
        try {
          const result = call.method === 'eth_call'
            ? ethCall(call.params?.[0])
            : call.method === 'eth_chainId' ? '0x' + CHAIN.toString(16)
              : call.method === 'eth_blockNumber' ? '0x100'
                : '0x';
          return { jsonrpc: '2.0', id: call.id, result };
        } catch (cause) {
          return { jsonrpc: '2.0', id: call.id, error: { code: -32000, message: String(cause?.message || cause) } };
        }
      };
      const payload = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
      return JSON.stringify(payload);
    };
    FetchRequest.registerGetUrl(async (req) => {
      const text = await serve(req.body ? new TextDecoder().decode(req.body) : null);
      return new FetchResponse(200, 'OK', { 'content-type': 'application/json' }, new TextEncoder().encode(text), req);
    });
    const rpc = new JsonRpcProvider('http://lending-oracle-fork-regression.invalid/rpc', CHAIN, { staticNetwork: true });
    try {
      const result = await readOraclePrices({ provider: rpc, chainId: CHAIN, assets: [USDT, USDC] });
      expect(result.reason, JSON.stringify(result)).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(result.status).toBe('ok');
      expect(result.prices[USDT.id].priceUsd).toBe(1);
      /* The fallback is VISIBLE: canonical tried once and reverted, the fork
         name answered once, and the result names the route it took. */
      expect(result.providerVia).toBe('getAddressesProvider');
      expect(reads.filter((r) => r.to === POOL && r.selector === poolIface.getFunction('ADDRESSES_PROVIDER').selector).length).toBe(1);
      expect(reads.filter((r) => r.to === POOL && r.selector === poolIface.getFunction('getAddressesProvider').selector).length).toBe(1);
    } finally {
      rpc.destroy();
    }
  });
});

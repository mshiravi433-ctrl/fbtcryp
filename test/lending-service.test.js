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
import { Interface } from 'ethers';

import * as S from '../src/lib/lending-service.js';
import { lendingAssetsFor, UINT256_MAX } from '../src/lib/lending.js';

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

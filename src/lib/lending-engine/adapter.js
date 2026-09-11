/**
 * LENDING ENGINE — protocol adapters (§8, §31 of the production spec).
 * ---------------------------------------------------------------------------
 * A protocol must never impose its own logic on the frontend. Every lending
 * protocol the engine talks to implements `LendingProtocolAdapter`; the UI,
 * the router and the BFF only ever see this interface.
 *
 * SECURITY (§31): the registry is an ALLOWLIST. No contract address coming
 * from a request, a URL or a token picker is ever dialed before it passes
 * `assertAllowedContract` against the protocol's own audited addresses. An
 * adapter that is not enabled here cannot be instantiated by callers.
 *
 * The Aave adapter below is the reference implementation: every read and
 * write delegates to src/lib/lending.js — the same on-chain path the /loan
 * screen already executes — and `build*Transaction` returns an UNSIGNED
 * payload ({ to, data, value }). The backend never signs; the wallet signs
 * (§30: "Backend نباید بتواند دارایی کاربر را جابه‌جا کند").
 */

const NOT_IMPLEMENTED = new Error('Adapter method not implemented');

/**
 * The interface every protocol adapter must satisfy. Every method has a
 * throwing base implementation so a half-written adapter fails loudly at
 * call time instead of silently returning garbage.
 */
export class LendingProtocolAdapter {
  constructor({ id, name, chainIds = [], enabled = true } = {}) {
    this.id = id;
    this.name = name;
    this.chainIds = Array.isArray(chainIds) ? chainIds : [];
    this.enabled = enabled;
  }

  async getMarkets() { throw NOT_IMPLEMENTED; }
  async getMarket() { throw NOT_IMPLEMENTED; }
  async getUserPosition() { throw NOT_IMPLEMENTED; }
  async getUserPositions() { throw NOT_IMPLEMENTED; }
  async getSupplyQuote() { throw NOT_IMPLEMENTED; }
  async getBorrowQuote() { throw NOT_IMPLEMENTED; }
  async getRepayQuote() { throw NOT_IMPLEMENTED; }
  async getWithdrawQuote() { throw NOT_IMPLEMENTED; }
  async buildSupplyTransaction() { throw NOT_IMPLEMENTED; }
  async buildBorrowTransaction() { throw NOT_IMPLEMENTED; }
  async buildRepayTransaction() { throw NOT_IMPLEMENTED; }
  async buildWithdrawTransaction() { throw NOT_IMPLEMENTED; }
  async getHealthFactor() { throw NOT_IMPLEMENTED; }
  async getRewards() { throw NOT_IMPLEMENTED; }
}

/* ─────────────────────────── allowlist (§31) ────────────────────────────── */

/** Registry: protocol id → adapter factory + allowlist metadata. */
const REGISTRY = new Map();

export function registerAdapter({ id, name, chainIds, enabled, factory }) {
  if (typeof factory !== 'function') throw new Error('registerAdapter: factory required');
  REGISTRY.set(id, { id, name, chainIds: chainIds || [], enabled: enabled !== false, factory });
  return id;
}

export function adapterFor(protocol) {
  const entry = REGISTRY.get(protocol);
  if (!entry || !entry.enabled) return null;
  return entry;
}

export function listAdapters() {
  return [...REGISTRY.values()].map(({ id, name, chainIds, enabled }) => ({ id, name, chainIds, enabled }));
}

/** The §31 protocol allowlist: which protocols may exist in the engine at all. */
export const PROTOCOL_ALLOWLIST = Object.freeze([
  { id: 'aave-v3', enabled: true, note: 'Aave V3 — wired end-to-end (src/lib/lending.js)' },
  /*
   * Phase 216: the pending state ended — every id the engine can name has
   * code to drive it. Compound III: supply/withdraw were already real
   * (src/lib/defi/compoundV3Base.js, Base/USDC); borrow/repay are now built
   * in the SAME file with the same gates (deployment verification, the
   * collateral gate, the native gas floor, unsigned steps only).
   */
  { id: 'compound-v3', enabled: true, note: 'Comet Base/USDC — supply/withdraw via src/lib/defi/compoundV3Base.js, borrow/repay/health via src/lib/defi/compoundV3Lending.js' },
  { id: 'morpho', enabled: true, note: 'Morpho Blue Base USDC/cbBTC — supply/withdraw/borrow/repay via src/lib/defi/morphoBlueBase.js' },
  /*
   * Phase 216: real, enabled adapter with an HONEST boundary — the pool
   * registry. No audited Solana lending program is registered in this
   * deployment, so every quote/build refuses with NO_POOL_REGISTERED instead
   * of dialing an unverified program. Registering a pool (program id + vault
   * + mint, with a source) is a deployment decision, not an adapter one.
   */
  { id: 'solana-lending', enabled: true, note: 'Solana lending — pool-registry adapter; refuses with NO_POOL_REGISTERED until a pool is registered' }
]);

/**
 * Contract-address gate. `kind` is 'pool' | 'token'. Returns
 * { ok:true } or { ok:false, code } — an unknown address is never dialed.
 */
export function assertAllowedContract({ chainId, address, kind, poolByChain = {}, tokenLookup = null }) {
  const target = String(address || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(target)) return { ok: false, code: 'BAD_ADDRESS' };
  if (kind === 'pool') {
    const expected = String(poolByChain[Number(chainId)] || '').toLowerCase();
    if (!expected) return { ok: false, code: 'UNSUPPORTED_CHAIN' };
    if (target !== expected) return { ok: false, code: 'POOL_NOT_ALLOWED' };
    return { ok: true };
  }
  if (kind === 'token') {
    if (typeof tokenLookup !== 'function') return { ok: false, code: 'NO_TOKEN_REGISTRY' };
    const found = tokenLookup(Number(chainId), target);
    if (!found) return { ok: false, code: 'TOKEN_NOT_ALLOWED' };
    return { ok: true, token: found };
  }
  return { ok: false, code: 'BAD_KIND' };
}

/* ─────────────────────────── Aave adapter ───────────────────────────────── */

const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const ZERO = '0x0000000000000000000000000000000000000000';

const loadLending = () => import('../lending.js');
const loadEthers = () => import('ethers');

/**
 * AaveAdapter — the reference implementation. `poolByChain` comes from
 * lending.js's AAVE_V3_POOLS; `tokenLookup(chainId, addressLower)` resolves a
 * token through the app's audited token registry.
 */
export function createAaveAdapter({ tokenLookup = null } = {}) {
  return new AaveLendingAdapter({ tokenLookup });
}

class AaveLendingAdapter extends LendingProtocolAdapter {
  constructor({ tokenLookup = null }) {
    super({ id: 'aave-v3', name: 'Aave V3', chainIds: [1, 10, 56, 137, 42161, 43114, 8453], enabled: true });
    this.tokenLookup = tokenLookup;
  }

  async _lending() { return loadLending(); }

  async _venue(chainId) {
    const lending = await this._lending();
    return lending.lendingVenue(chainId);
  }

  async _poolContract(chainId, runner = null) {
    const [lending, { Contract }] = await Promise.all([this._lending(), loadEthers()]);
    const venue = lending.lendingVenue(chainId);
    if (!venue) throw new Error('UNSUPPORTED_CHAIN');
    return new Contract(venue.pool, lending.AAVE_POOL_ABI, runner);
  }

  /* reads ---------------------------------------------------------------- */

  async getMarkets({ provider, chainId, assets } = {}) {
    const lending = await this._lending();
    const entries = await lending.readReserves({ provider, chainId, assets });
    return { ok: true, protocol: this.id, chainId, reserves: entries };
  }

  async getMarket({ provider, chainId, asset } = {}) {
    const lending = await this._lending();
    const reserve = await lending.readReserve({ provider, chainId, asset });
    return { ok: true, protocol: this.id, chainId, asset, reserve };
  }

  async getUserPosition({ provider, chainId, wallet, asset, reserve = null } = {}) {
    const lending = await this._lending();
    return lending.readAssetPosition({ provider, chainId, asset, user: wallet, reserve });
  }

  async getUserPositions({ provider, chainId, wallet, assets } = {}) {
    const lending = await this._lending();
    const [account, reserves] = await Promise.all([
      lending.readUserAccount({ provider, chainId, user: wallet }),
      lending.readReserves({ provider, chainId, assets })
    ]);
    const entries = await Promise.all((assets || []).map(async (asset) => [
      asset.id,
      await lending.readAssetPosition({ provider, chainId, asset, user: wallet, reserve: reserves[asset.id] })
    ]));
    return { ok: true, protocol: this.id, chainId, account, positions: Object.fromEntries(entries) };
  }

  async getHealthFactor({ provider, chainId, wallet } = {}) {
    const lending = await this._lending();
    const account = await lending.readUserAccount({ provider, chainId, user: wallet });
    return { ok: account.ok, healthFactor: account.ok ? account.healthFactor : null };
  }

  /** Rewards need an indexer; the on-chain pool does not expose them. Honest answer, never a fake zero. */
  async getRewards() {
    return { ok: false, reason: 'NOT_INDEXED', rewards: [] };
  }

  /* quotes — pure projections from live on-chain numbers ------------------- */

  async getSupplyQuote({ provider, chainId, wallet, asset, amount } = {}) {
    const lending = await this._lending();
    const [reserve, position, allowance] = await Promise.all([
      lending.readReserve({ provider, chainId, asset }),
      lending.readAssetPosition({ provider, chainId, asset, user: wallet, reserve: null }),
      lending.readAllowance({ provider, chainId, asset, owner: wallet })
    ]);
    const units = lending.toUnits(amount, asset.decimals);
    const needsApproval = units == null ? null
      : !reserve.listed ? null
        : allowance == null ? null
          : BigInt(allowance) < BigInt(units);
    const venue = await this._venue(chainId);
    return {
      ok: Boolean(units),
      amountWei: units?.toString() ?? null,
      reserve: { listed: reserve.listed, supplyApyPct: reserve.supplyApyPct },
      balanceWei: position.ok ? position.walletWei : null,
      sufficientBalance: (position.ok && units != null) ? BigInt(position.walletWei) >= BigInt(units) : null,
      needsApproval,
      approveTarget: reserve.listed ? venue?.pool : null
    };
  }

  async getBorrowQuote({ provider, chainId, wallet, asset, amount } = {}) {
    const lending = await this._lending();
    const [account, reserve] = await Promise.all([
      lending.readUserAccount({ provider, chainId, user: wallet }),
      lending.readReserve({ provider, chainId, asset })
    ]);
    const units = lending.toUnits(amount, asset.decimals);
    const withinLimit = account.ok
      ? Number(amount) <= (account.availableBorrowsUsd ?? 0)
      : null;
    return {
      ok: Boolean(units),
      amountWei: units?.toString() ?? null,
      reserve: { listed: reserve.listed, borrowApyPct: reserve.borrowApyPct },
      account: account.ok ? account : null,
      withinBorrowLimit: withinLimit
    };
  }

  async getRepayQuote({ provider, chainId, wallet, asset, amount } = {}) {
    const lending = await this._lending();
    const [position, allowance] = await Promise.all([
      lending.readAssetPosition({ provider, chainId, asset, user: wallet, reserve: null }),
      lending.readAllowance({ provider, chainId, asset, owner: wallet })
    ]);
    const units = lending.toUnits(amount, asset.decimals);
    return {
      ok: Boolean(units),
      amountWei: units?.toString() ?? null,
      debtWei: position.ok ? position.debtWei : null,
      exceedsDebt: (position.ok && units != null) ? BigInt(units) > BigInt(position.debtWei) : null,
      needsApproval: (allowance == null || units == null) ? null : BigInt(allowance) < BigInt(units)
    };
  }

  async getWithdrawQuote({ provider, chainId, wallet, asset, amount } = {}) {
    const lending = await this._lending();
    const position = await lending.readAssetPosition({ provider, chainId, asset, user: wallet, reserve: null });
    const units = lending.toUnits(amount, asset.decimals);
    return {
      ok: Boolean(units),
      amountWei: units?.toString() ?? null,
      suppliedWei: position.ok ? position.suppliedWei : null,
      exceedsSupplied: (position.ok && units != null) ? BigInt(units) > BigInt(position.suppliedWei) : null
    };
  }

  /* UNSIGNED transaction builders (§30) ------------------------------------ */

  async buildSupplyTransaction({ chainId, asset, amountWei, onBehalfOf }) {
    const pool = await this._poolContract(chainId, null);
    const { AAVE_REFERRAL_CODE } = await this._lending();
    const tx = await pool.supply.populateTransaction(asset.address, amountWei, onBehalfOf, AAVE_REFERRAL_CODE);
    return this._unsigned(pool, tx, chainId);
  }

  async buildBorrowTransaction({ chainId, asset, amountWei, onBehalfOf }) {
    const pool = await this._poolContract(chainId, null);
    const { AAVE_REFERRAL_CODE, VARIABLE_RATE_MODE } = await this._lending();
    const tx = await pool.borrow.populateTransaction(asset.address, amountWei, VARIABLE_RATE_MODE, AAVE_REFERRAL_CODE, onBehalfOf);
    return this._unsigned(pool, tx, chainId);
  }

  async buildRepayTransaction({ chainId, asset, amountWei, onBehalfOf }) {
    const pool = await this._poolContract(chainId, null);
    const { VARIABLE_RATE_MODE } = await this._lending();
    const tx = await pool.repay.populateTransaction(asset.address, amountWei, VARIABLE_RATE_MODE, onBehalfOf);
    return this._unsigned(pool, tx, chainId);
  }

  async buildWithdrawTransaction({ chainId, asset, amountWei, to }) {
    const pool = await this._poolContract(chainId, null);
    const tx = await pool.withdraw.populateTransaction(asset.address, amountWei, to);
    return this._unsigned(pool, tx, chainId);
  }

  async buildApprovalTransaction({ chainId, asset, amountWei }) {
    const { Contract } = await loadEthers();
    const { ERC20_MIN_ABI } = await this._lending();
    const venue = await this._venue(chainId);
    const token = new Contract(asset.address, ERC20_MIN_ABI, null);
    const tx = await token.approve.populateTransaction(venue.pool, amountWei);
    return this._unsigned(token, tx, chainId);
  }

  _unsigned(contract, tx, chainId) {
    return {
      ok: true,
      protocol: this.id,
      chainId: Number(chainId),
      to: String(tx.to || contract.target || ''),
      data: String(tx.data || '0x'),
      value: String(tx.value ?? 0),
      /* The payload is unsigned by construction: the wallet signs it. */
      signed: false,
      capabilities: { sign: 'wallet-only', broadcast: 'wallet-only' }
    };
  }
}

/* ─────────────────────────── Compound III adapter ────────────────────────── */

/**
 * CompoundV3LendingAdapter — the Comet market on Base (8453), USDC base
 * asset. Every read and write delegates to the defi modules — supply/withdraw
 * and the market/position reads to src/lib/defi/compoundV3Base.js (the SAME
 * module the Farm money path uses, with its deployment verification and its
 * unsigned-step discipline), borrow/repay/health-factor to the sibling
 * src/lib/defi/compoundV3Lending.js (which imports the base's verification
 * and contract handles). Nothing is re-implemented here; a second Comet
 * implementation is a second bug surface.
 */
export function createCompoundV3Adapter({ } = {}) {
  return new CompoundV3LendingAdapter();
}

/* The plan builders that live in the lending sibling module (the Farm module
   stays supply/withdraw-only by design — a wiring pin reads its ABIs). */
const COMPOUND_LENDING_METHODS = new Set(['buildBorrowPlan', 'buildRepayPlan']);

class CompoundV3LendingAdapter extends LendingProtocolAdapter {
  constructor() {
    super({ id: 'compound-v3', name: 'Compound III (Comet)', chainIds: [8453], enabled: true });
  }

  /* The base module is Vite-shaped (extensionless imports inside it), so in
     a plain-node runtime the dynamic import can fail. The adapter must be
     TOTAL — every path answers with a value or an error code, never a crash,
     never a success: a runtime without the module says so with a code. */
  async _base() {
    try { return await import('../defi/compoundV3Base.js'); }
    catch (err) {
      return { __unavailable: true, ok: false, code: 'ADAPTER_MODULE_UNAVAILABLE', detail: `on-chain module not loadable in this runtime: ${String(err?.message || err).slice(0, 120)}` };
    }
  }

  /* The borrow/repay/health-factor surface lives in the lending sibling —
     the Farm module stays supply/withdraw-only by design (wiring pin). */
  async _compoundLending() {
    try { return await import('../defi/compoundV3Lending.js'); }
    catch (err) {
      return { __unavailable: true, ok: false, code: 'ADAPTER_MODULE_UNAVAILABLE', detail: `on-chain module not loadable in this runtime: ${String(err?.message || err).slice(0, 120)}` };
    }
  }

  _noProvider() { return { ok: false, code: 'PROVIDER_REQUIRED', detail: 'an on-chain read needs a provider; nothing was estimated' }; }

  async _guarded(fn) {
    try { return { __ok: true, __value: await fn() }; }
    catch (err) {
      /* A failure is a CODE, never a success: the typed CompoundAdapterError
         codes (COMPOUND_MARKET_UNREADABLE, COMPOUND_WRONG_CHAIN, …) surface
         as-is; anything else is ADAPTER_ERROR with the message sanitized. */
      const code = String(err?.code || 'ADAPTER_ERROR').slice(0, 64);
      return { __ok: false, __error: { code, detail: String(err?.detail?.reason || err?.message || err).slice(0, 160) } };
    }
  }

  async getMarkets({ provider, chainId = 8453, assets } = {}) {
    if (!provider) return this._noProvider();
    const base = await this._base();
    if (base.__unavailable) return base;
    const out = await this._guarded(() => base.getMarketStatus(provider));
    if (!out.__ok) return out.__error;
    const s = out.__value;
    return {
      ok: true, protocol: this.id, chainId,
      reserves: [{
        id: 'USDC', symbol: 'USDC', listed: true,
        supplyApyPct: s.supplyApyPct, borrowApyPct: null,
        supplyPaused: s.supplyPaused, withdrawPaused: s.withdrawPaused,
        utilizationPct: s.utilizationPct,
        totalSupplyUsdc: s.totalSupplyUsdc, totalBorrowUsdc: s.totalBorrowUsdc,
        hasSupplyCap: s.hasSupplyCap, supplyCapUsdc: s.supplyCapUsdc,
        readAt: s.readAt
      }]
    };
  }

  async getMarket({ provider, chainId = 8453, asset } = {}) {
    if (!provider) return this._noProvider();
    if (String(asset || 'USDC').toUpperCase() !== 'USDC') {
      return { ok: false, code: 'ASSET_NOT_SUPPORTED', detail: `this market is USDC-only (Base); ${asset} has no Comet market in this deployment` };
    }
    const out = await this.getMarkets({ provider, chainId });
    return out.ok ? { ok: true, protocol: this.id, chainId, asset: 'USDC', reserve: out.reserves[0] } : out;
  }

  async getUserPosition({ provider, chainId = 8453, wallet, asset, reserve = null } = {}) {
    if (!provider) return this._noProvider();
    if (!wallet) return { ok: false, code: 'WALLET_REQUIRED', detail: 'a position is per-wallet; name the wallet' };
    const base = await this._base();
    if (base.__unavailable) return base;
    const out = await this._guarded(() => base.getPosition(provider, wallet));
    if (!out.__ok) return out.__error;
    const p = out.__value;
    return {
      ok: true, protocol: this.id, chainId, asset: 'USDC',
      position: {
        suppliedUsdc: base.fromUsdcWei(p.suppliedUsdc),
        suppliedUsd: p.suppliedUsd,
        borrowedUsdc: p.borrowedUsdc == null ? null : base.fromUsdcWei(p.borrowedUsdc),
        hasBorrow: p.hasBorrow,
        rewardsOwedUsdc: p.rewardsOwed == null ? null : base.fromUsdcWei(p.rewardsOwed),
        readAt: p.readAt
      }
    };
  }

  async getUserPositions({ provider, chainId = 8453, wallet, assets } = {}) {
    const one = await this.getUserPosition({ provider, chainId, wallet, asset: 'USDC' });
    return one.ok
      ? { ok: true, protocol: this.id, chainId, positions: { USDC: one.position } }
      : { ok: false, code: one.code, detail: one.detail };
  }

  async _plan(method, args) {
    if (!args.provider) return this._noProvider();
    if (!args.wallet && args.owner === undefined) return { ok: false, code: 'WALLET_REQUIRED', detail: 'a plan needs the acting wallet' };
    /* borrow/repay/health-factor live in the lending sibling; supply/withdraw
       in the Farm module. One plan, one owner, one ABI surface. */
    const mod = COMPOUND_LENDING_METHODS.has(method) ? await this._compoundLending() : await this._base();
    if (mod.__unavailable) return mod;
    /* The base plans gate on a REAL native balance (Comet reverts a borrow
       that cannot pay gas) — read it here rather than assuming. */
    let nativeBalance = null;
    if (typeof args.provider.getBalance === 'function') {
      try { nativeBalance = await args.provider.getBalance(args.wallet ?? args.owner); } catch { nativeBalance = null; }
    }
    const out = await this._guarded(() => mod[method]({ ...args, owner: args.wallet ?? args.owner, nativeBalance }));
    if (!out.__ok) return out.__error;
    const plan = out.__value;
    if (!plan.steps.length) {
      return { ok: false, code: plan.checks.blocked[0] || 'PLAN_REFUSED', detail: `refused: ${plan.checks.blocked.join(', ')}`, checks: plan.checks };
    }
    return { ok: true, plan, checks: plan.checks };
  }

  async getSupplyQuote({ provider, chainId = 8453, wallet, asset, amount } = {}) {
    const out = await this._plan('buildSupplyPlan', { provider, wallet, amountUsdc: amount });
    if (!out.ok) return out;
    const c = out.checks;
    return {
      ok: true, amountWei: String(c.amountWei),
      reserve: { listed: true, supplyApyPct: null },
      balanceWei: c.balanceUsdc != null ? String(c.balanceUsdc) : null,
      sufficientBalance: c.balanceSufficient,
      needsApproval: c.needsApproval,
      blocked: c.blocked
    };
  }

  async getBorrowQuote({ provider, chainId = 8453, wallet, asset, amount } = {}) {
    const out = await this._plan('buildBorrowPlan', { provider, wallet, amountUsdc: amount });
    if (!out.ok) return out;
    const c = out.checks;
    return {
      ok: true, amountWei: String(c.amountWei),
      hasCollateral: c.hasCollateral,
      existingBorrowUsdcWei: c.existingBorrowUsdcWei != null ? String(c.existingBorrowUsdcWei) : null,
      withinBorrowLimit: c.hasCollateral !== false && c.blocked.length === 0,
      blocked: c.blocked
    };
  }

  async getRepayQuote({ provider, chainId = 8453, wallet, asset, amount } = {}) {
    const out = await this._plan('buildRepayPlan', { provider, wallet, amountUsdc: amount });
    if (!out.ok) return out;
    const c = out.checks;
    return {
      ok: true, amountWei: String(c.amountWei),
      debtWei: c.debtUsdcWei != null ? String(c.debtUsdcWei) : null,
      exceedsDebt: c.withinDebt === false,
      blocked: c.blocked
    };
  }

  async getWithdrawQuote({ provider, chainId = 8453, wallet, asset, amount } = {}) {
    const out = await this._plan('buildWithdrawPlan', { provider, wallet, amountUsdc: amount });
    if (!out.ok) return out;
    const c = out.checks;
    return {
      ok: true, amountWei: c.isMax ? 'max' : String(c.amountWei),
      suppliedWei: c.positionUsdcWei != null ? String(c.positionUsdcWei) : null,
      exceedsSupplied: c.withinPosition === false,
      blocked: c.blocked
    };
  }

  _unsigned(plan) {
    const step = plan.steps[plan.steps.length - 1];
    return {
      ok: true, protocol: this.id, chainId: 8453,
      to: String(step.to), data: String(step.data), value: '0',
      steps: plan.steps.map((s) => ({ kind: s.kind, to: String(s.to), data: String(s.data), value: '0' })),
      signed: false,
      capabilities: { sign: 'wallet-only', broadcast: 'wallet-only' }
    };
  }

  /* 6-dp USDC → plain decimal string (exact, no float). */
  _weiToUsdc(wei) {
    const s = String(wei ?? '0');
    const n = s.length;
    if (n <= 6) return `0.${s.padStart(6, '0')}`;
    return `${s.slice(0, n - 6)}.${s.slice(n - 6)}`;
  }

  async buildSupplyTransaction({ chainId = 8453, asset, amountWei, onBehalfOf, provider, wallet }) {
    const out = await this._plan('buildSupplyPlan', { provider, wallet, amountUsdc: this._weiToUsdc(amountWei) });
    return out.ok ? this._unsigned(out.plan) : out;
  }

  async buildBorrowTransaction({ chainId = 8453, asset, amountWei, onBehalfOf, provider, wallet }) {
    const out = await this._plan('buildBorrowPlan', { provider, wallet, amountUsdc: this._weiToUsdc(amountWei) });
    return out.ok ? this._unsigned(out.plan) : out;
  }

  async buildRepayTransaction({ chainId = 8453, asset, amountWei, onBehalfOf, provider, wallet }) {
    const out = await this._plan('buildRepayPlan', { provider, wallet, amountUsdc: this._weiToUsdc(amountWei) });
    return out.ok ? this._unsigned(out.plan) : out;
  }

  async buildWithdrawTransaction({ chainId = 8453, asset, amountWei, to, provider, wallet }) {
    const max = String(amountWei || '').toLowerCase() === 'max' || String(amountWei) === ((1n << 256n) - 1n).toString();
    const out = await this._plan('buildWithdrawPlan', { provider, wallet, amountUsdc: max ? 'max' : this._weiToUsdc(amountWei) });
    return out.ok ? this._unsigned(out.plan) : out;
  }

  async getHealthFactor({ provider, chainId = 8453, wallet } = {}) {
    if (!provider) return this._noProvider();
    if (!wallet) return { ok: false, code: 'WALLET_REQUIRED', detail: 'a health factor is per-wallet; name the wallet' };
    const lending = await this._compoundLending();
    if (lending.__unavailable) return lending;
    const out = await this._guarded(() => lending.getHealthFactor(provider, wallet));
    if (!out.__ok) return { ok: false, code: out.__error.code, healthFactor: null };
    const hf = out.__value;
    return { ok: hf != null, healthFactor: hf == null ? null : Number(hf) / 1e18 };
  }

  async getRewards({ provider, chainId = 8453, wallet } = {}) {
    if (!provider) return this._noProvider();
    if (!wallet) return { ok: false, code: 'WALLET_REQUIRED', detail: 'rewards are per-wallet; name the wallet' };
    const base = await this._base();
    if (base.__unavailable) return base;
    const out = await this._guarded(() => base.getRewardsOwed(provider, wallet));
    if (!out.__ok) return { ok: false, code: 'NOT_INDEXED', rewards: [] };
    const r = out.__value;
    return r
      ? { ok: true, rewards: [{ token: r.token, owedUsdc: base.fromUsdcWei(r.owed) }] }
      : { ok: true, rewards: [], note: 'no COMP owed readable — reported as none, not a fabricated zero' };
  }
}

/* ─────────────────────────── Morpho Blue adapter ─────────────────────────── */

/**
 * MorphoLendingAdapter — the pinned Morpho Blue market on Base (8453):
 * USDC loan / cbBTC collateral. Same delegation rule as Compound: the calldata
 * and checks live in src/lib/defi/morphoBlueBase.js, where the market
 * parameters are pinned and verified on-chain before every plan.
 */
export function createMorphoAdapter({ } = {}) {
  return new MorphoLendingAdapter();
}

class MorphoLendingAdapter extends LendingProtocolAdapter {
  constructor() {
    super({ id: 'morpho', name: 'Morpho Blue', chainIds: [8453], enabled: true });
  }

  /* Same totality rule as the Compound adapter — see there. */
  async _base() {
    try { return await import('../defi/morphoBlueBase.js'); }
    catch (err) {
      return { __unavailable: true, ok: false, code: 'ADAPTER_MODULE_UNAVAILABLE', detail: `on-chain module not loadable in this runtime: ${String(err?.message || err).slice(0, 120)}` };
    }
  }

  _noProvider() { return { ok: false, code: 'PROVIDER_REQUIRED', detail: 'an on-chain read needs a provider; nothing was estimated' }; }

  async _guarded(fn) {
    try { return { __ok: true, __value: await fn() }; }
    catch (err) {
      const code = String(err?.code || 'ADAPTER_ERROR').slice(0, 64);
      return { __ok: false, __error: { code, detail: String(err?.detail?.reason || err?.message || err).slice(0, 160) } };
    }
  }

  async getMarkets({ provider, chainId = 8453 } = {}) {
    if (!provider) {
      /* The pinned market is a FACT of this deployment — report it as
         registered, with the live state null. A fake state would be a lie.
         (Also keeps this path working in runtimes that cannot load the
         Vite-shaped on-chain module.) */
      return {
        ok: true, protocol: this.id, chainId,
        reserves: [{ id: 'USDC', symbol: 'USDC', listed: true, supplyApyPct: null, live: false, note: 'no provider — registered market, live state unread' }],
        live: false
      };
    }
    const base = await this._base();
    if (base.__unavailable) return base;
    const out = await this._guarded(() => base.getMarketState(provider));
    if (!out.__ok) return out.__error;
    const s = out.__value;
    return {
      ok: true, protocol: this.id, chainId, live: true,
      reserves: [{
        id: 'USDC', symbol: 'USDC', listed: true,
        supplyApyPct: null, /* Morpho has no per-second base rate — a supply APY needs the IRM's curve; unread here, never invented */
        borrowApyPct: null,
        totalSupplyUsdc: base.fromUsdcWei(s.totalSupplyAssets),
        totalBorrowUsdc: base.fromUsdcWei(s.totalBorrowAssets),
        marketId: base.MORPHO_BLUE_BASE.marketId,
        lastUpdate: s.lastUpdate,
        readAt: s.readAt
      }]
    };
  }

  async getMarket({ provider, chainId = 8453, asset } = {}) {
    if (String(asset || 'USDC').toUpperCase() !== 'USDC') {
      return { ok: false, code: 'ASSET_NOT_SUPPORTED', detail: `this market loans USDC only (Base); ${asset} is not its loan token` };
    }
    const out = await this.getMarkets({ provider, chainId });
    return out.ok ? { ok: true, protocol: this.id, chainId, asset: 'USDC', reserve: out.reserves[0] } : out;
  }

  async getUserPosition({ provider, chainId = 8453, wallet } = {}) {
    if (!provider) return this._noProvider();
    if (!wallet) return { ok: false, code: 'WALLET_REQUIRED', detail: 'a position is per-wallet; name the wallet' };
    const base = await this._base();
    if (base.__unavailable) return base;
    const out = await this._guarded(() => base.getPosition(provider, wallet));
    if (!out.__ok) return out.__error;
    const p = out.__value;
    return {
      ok: true, protocol: this.id, chainId, asset: 'USDC',
      position: {
        suppliedUsdc: base.fromUsdcWei(p.suppliedUsdc),
        borrowShares: p.borrowShares,
        collateralCbBtc: p.collateralCbBtc,
        hasBorrow: p.hasBorrow,
        readAt: p.readAt
      }
    };
  }

  async getUserPositions({ provider, chainId = 8453, wallet, assets } = {}) {
    const one = await this.getUserPosition({ provider, chainId, wallet });
    return one.ok
      ? { ok: true, protocol: this.id, chainId, positions: { USDC: one.position } }
      : { ok: false, code: one.code, detail: one.detail };
  }

  async _plan(method, args) {
    if (!args.provider) return this._noProvider();
    if (!args.wallet) return { ok: false, code: 'WALLET_REQUIRED', detail: 'a plan needs the acting wallet' };
    const base = await this._base();
    if (base.__unavailable) return base;
    /* Same native-balance discipline as the Compound adapter. */
    let nativeBalance = null;
    if (typeof args.provider.getBalance === 'function') {
      try { nativeBalance = await args.provider.getBalance(args.wallet); } catch { nativeBalance = null; }
    }
    const out = await this._guarded(() => base[method]({ ...args, nativeBalance }));
    if (!out.__ok) return out.__error;
    const plan = out.__value;
    if (!plan.steps.length) {
      return { ok: false, code: plan.checks.blocked[0] || 'PLAN_REFUSED', detail: `refused: ${plan.checks.blocked.join(', ')}`, checks: plan.checks };
    }
    return { ok: true, plan, checks: plan.checks };
  }

  async getSupplyQuote({ provider, chainId = 8453, wallet, asset, amount } = {}) {
    const out = await this._plan('buildSupplyPlan', { provider, owner: wallet, amountUsdc: amount });
    if (!out.ok) return out;
    const c = out.checks;
    return {
      ok: true, amountWei: String(c.amountWei),
      reserve: { listed: true, supplyApyPct: null },
      balanceWei: null,
      sufficientBalance: c.balanceSufficient,
      needsApproval: c.needsApproval,
      blocked: c.blocked
    };
  }

  async getBorrowQuote({ provider, chainId = 8453, wallet, asset, amount } = {}) {
    const out = await this._plan('buildBorrowPlan', { provider, owner: wallet, amountUsdc: amount });
    if (!out.ok) return out;
    const c = out.checks;
    return {
      ok: true, amountWei: String(c.amountWei),
      hasCollateral: c.hasCollateral,
      withinBorrowLimit: c.hasCollateral !== false && c.blocked.length === 0,
      blocked: c.blocked
    };
  }

  async getRepayQuote({ provider, chainId = 8453, wallet, asset, amount } = {}) {
    const out = await this._plan('buildRepayPlan', { provider, owner: wallet, amountUsdc: amount });
    if (!out.ok) return out;
    const c = out.checks;
    return {
      ok: true, amountWei: String(c.amountWei),
      debtWei: c.debtUsdcWei != null ? String(c.debtUsdcWei) : null,
      exceedsDebt: c.withinDebt === false,
      blocked: c.blocked
    };
  }

  async getWithdrawQuote({ provider, chainId = 8453, wallet, asset, amount } = {}) {
    const out = await this._plan('buildWithdrawPlan', { provider, owner: wallet, amountUsdc: amount });
    if (!out.ok) return out;
    const c = out.checks;
    return {
      ok: true, amountWei: c.isMax ? 'max' : String(c.amountWei),
      suppliedWei: c.positionUsdcWei != null ? String(c.positionUsdcWei) : null,
      exceedsSupplied: c.withinPosition === false,
      blocked: c.blocked
    };
  }

  _unsigned(plan) {
    const step = plan.steps[plan.steps.length - 1];
    return {
      ok: true, protocol: this.id, chainId: 8453,
      to: String(step.to), data: String(step.data), value: '0',
      steps: plan.steps.map((s) => ({ kind: s.kind, to: String(s.to), data: String(s.data), value: '0' })),
      signed: false,
      capabilities: { sign: 'wallet-only', broadcast: 'wallet-only' }
    };
  }

  _weiToUsdc(wei) {
    const s = String(wei ?? '0');
    const n = s.length;
    if (n <= 6) return `0.${s.padStart(6, '0')}`;
    return `${s.slice(0, n - 6)}.${s.slice(n - 6)}`;
  }

  async buildSupplyTransaction({ chainId = 8453, asset, amountWei, onBehalfOf, provider, wallet }) {
    const out = await this._plan('buildSupplyPlan', { provider, owner: wallet, amountUsdc: this._weiToUsdc(amountWei) });
    return out.ok ? this._unsigned(out.plan) : out;
  }

  async buildBorrowTransaction({ chainId = 8453, asset, amountWei, onBehalfOf, provider, wallet }) {
    const out = await this._plan('buildBorrowPlan', { provider, owner: wallet, amountUsdc: this._weiToUsdc(amountWei) });
    return out.ok ? this._unsigned(out.plan) : out;
  }

  async buildRepayTransaction({ chainId = 8453, asset, amountWei, onBehalfOf, provider, wallet }) {
    const out = await this._plan('buildRepayPlan', { provider, owner: wallet, amountUsdc: this._weiToUsdc(amountWei) });
    return out.ok ? this._unsigned(out.plan) : out;
  }

  async buildWithdrawTransaction({ chainId = 8453, asset, amountWei, to, provider, wallet }) {
    const max = String(amountWei || '').toLowerCase() === 'max';
    const out = await this._plan('buildWithdrawPlan', { provider, owner: wallet, amountUsdc: max ? 'max' : this._weiToUsdc(amountWei) });
    return out.ok ? this._unsigned(out.plan) : out;
  }

  async getHealthFactor({ provider, chainId = 8453, wallet } = {}) {
    if (!provider) return this._noProvider();
    if (!wallet) return { ok: false, code: 'WALLET_REQUIRED', detail: 'a health factor is per-wallet; name the wallet' };
    const base = await this._base();
    if (base.__unavailable) return base;
    const out = await this._guarded(() => base.getHealthFactor(provider, wallet));
    if (!out.__ok) return { ok: false, code: out.__error.code, healthFactor: null };
    const res = out.__value || {};
    const hf = res.healthFactor == null ? null : Number(res.healthFactor);
    return {
      ok: hf != null, healthFactor: hf,
      reason: hf == null ? (res.reason || 'unreadable — no number is better than a guess') : undefined
    };
  }

  async getRewards() {
    return { ok: false, reason: 'NOT_INDEXED', rewards: [] };
  }
}

/* ─────────────────────────── Solana lending adapter ──────────────────────── */

/**
 * SolanaLendingAdapter — the SOLANA leg of the lending engine.
 *
 * The honest boundary of this deployment: the repo integrates NO audited
 * Solana lending program yet, and dialing a program address without a
 * registered, source-pinned pool would be exactly the failure the §31
 * allowlist exists to prevent. So the adapter is REAL in the parts that can
 * be real now — the interface, the registry, the network config, the failure
 * modes — and REFUSES in the parts that would need an unverified program:
 *
 *   getMarkets            the registered pools (zero until a deployment
 *                         registers one) — a truthful registry read, ok:true
 *   every quote / build   NO_POOL_REGISTERED when the registry is empty;
 *                         CLIENT_REQUIRED when a pool IS registered but this
 *                         deployment has not wired its read client yet.
 *                         Always a code, never a success, never a
 *                         fabricated quote.
 *
 * `registerSolanaLendingPool` is the seam: a deployment that has audited a
 * program registers it (program id + vault + mint + source) and points its
 * read client at that pool through the same interface.
 */

const SOLANA_LENDING_POOLS = new Map();

export function registerSolanaLendingPool({ id, programId, mint, vault, name = id, source = null, chainId = 900001 } = {}) {
  if (!id || !programId || !mint) throw new Error('registerSolanaLendingPool: id, programId and mint are required');
  if (!source) throw new Error('registerSolanaLendingPool: a source is required — a pool without provenance is not allowed into the engine');
  SOLANA_LENDING_POOLS.set(String(id), {
    id: String(id), name: String(name), programId: String(programId),
    mint: String(mint), vault: vault ? String(vault) : null,
    source: String(source).slice(0, 200), chainId: Number(chainId) || 900001
  });
  return id;
}

export function unregisterSolanaLendingPool(id) {
  return SOLANA_LENDING_POOLS.delete(String(id));
}

export function listSolanaLendingPools() {
  return [...SOLANA_LENDING_POOLS.values()].map((p) => ({ ...p }));
}

export function createSolanaLendingAdapter({ } = {}) {
  return new SolanaLendingAdapter();
}

class SolanaLendingAdapter extends LendingProtocolAdapter {
  constructor() {
    super({ id: 'solana-lending', name: 'Solana Lending', chainIds: [900001], enabled: true });
  }

  _noPool() {
    if (SOLANA_LENDING_POOLS.size > 0) {
      return {
        ok: false,
        code: 'CLIENT_REQUIRED',
        detail: `${SOLANA_LENDING_POOLS.size} pool(s) registered, but no Solana read client is wired in this deployment — a quote needs a live feed, so it is refused, not estimated`
      };
    }
    return {
      ok: false,
      code: 'NO_POOL_REGISTERED',
      detail: 'no audited Solana lending pool is registered in this deployment; the adapter refuses rather than dial an unverified program'
    };
  }

  async getMarkets({ chainId = 900001 } = {}) {
    const pools = [...SOLANA_LENDING_POOLS.values()].filter((p) => p.chainId === Number(chainId));
    return {
      ok: true, protocol: this.id, chainId,
      reserves: pools.map((p) => ({ id: p.id, symbol: p.mint, listed: true, source: p.source, programId: p.programId, vault: p.vault })),
      note: pools.length ? 'registered pools, quoted on demand' : 'empty registry — a truthful read, not a failure'
    };
  }

  async getMarket() { return this._noPool(); }
  async getUserPosition() { return this._noPool(); }
  async getUserPositions() { return this._noPool(); }
  async getSupplyQuote() { return this._noPool(); }
  async getBorrowQuote() { return this._noPool(); }
  async getRepayQuote() { return this._noPool(); }
  async getWithdrawQuote() { return this._noPool(); }
  async buildSupplyTransaction() { return this._noPool(); }
  async buildBorrowTransaction() { return this._noPool(); }
  async buildRepayTransaction() { return this._noPool(); }
  async buildWithdrawTransaction() { return this._noPool(); }
  async getHealthFactor() { return this._noPool(); }
  async getRewards() { return this._noPool(); }
}

/* ─────────────────────────── registrations ───────────────────────────────── */

registerAdapter({
  id: 'aave-v3',
  name: 'Aave V3',
  chainIds: [1, 10, 56, 137, 42161, 43114, 8453],
  enabled: true,
  factory: ({ tokenLookup } = {}) => createAaveAdapter({ tokenLookup })
});

/* Phase 216 — the three pending adapters, now implemented and enabled.
   Each factory takes the same shape as Aave's; the on-chain boundary is the
   `provider` the caller injects (a fixture in tests, the wallet's read
   provider in production). */
registerAdapter({
  id: 'compound-v3',
  name: 'Compound III (Comet)',
  chainIds: [8453],
  enabled: true,
  factory: () => createCompoundV3Adapter()
});

registerAdapter({
  id: 'morpho',
  name: 'Morpho Blue',
  chainIds: [8453],
  enabled: true,
  factory: () => createMorphoAdapter()
});

registerAdapter({
  id: 'solana-lending',
  name: 'Solana Lending',
  chainIds: [900001],
  enabled: true,
  factory: () => createSolanaLendingAdapter()
});

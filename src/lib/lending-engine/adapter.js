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
  { id: 'compound-v3', enabled: false, note: 'Adapter pending' },
  { id: 'morpho', enabled: false, note: 'Adapter pending' },
  { id: 'solana-lending', enabled: false, note: 'Adapter pending' }
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

/* Register the wired adapter; pending ones are listed but disabled. */
registerAdapter({
  id: 'aave-v3',
  name: 'Aave V3',
  chainIds: [1, 10, 56, 137, 42161, 43114, 8453],
  enabled: true,
  factory: ({ tokenLookup } = {}) => createAaveAdapter({ tokenLookup })
});

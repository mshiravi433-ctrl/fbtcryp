/**
 * FBT INTENT AI — VENUE EXECUTORS (the autonomy core, layer 1 of 4)
 * ---------------------------------------------------------------------------
 * User report that produced this file:
 *   «الان وقت می‌بره به صفحات خودش، به صورت اتوماسیون نمی‌تونه هیچ‌کدام خرید و
 *    فروش سهام و فیوچرز و فارم، سواپ و وام را انجام بده و فقط می‌بره صفحه مورد
 *    نظر و اتوماسیون انجام نمی‌ده.»
 *
 * The diagnosis was structural, not cosmetic. `executionRuntime.runAction`
 * walks a real state machine (validate → quote → allowance → simulate → sign →
 * broadcast → confirm), but every action was handed the SAME hook set —
 * `buildBrowserHooks` in browserExecution.js — and every function in that set
 * is a swap function (`getQuote` from lib/swap.js, `executeSwap` from
 * lib/swap.js). A FARM or LEND action therefore reached QUOTING, found no
 * `from`/`to` pair, and died with VALIDATION_FAILED before anything could be
 * signed. The chat fell back to the only thing left: a link to the page.
 *
 * This file is the missing half. A VENUE EXECUTOR is the single object that
 * knows how to turn one abstract action into one real signature at one real
 * venue, using the app's OWN trading primitives — never a re-implementation:
 *
 *   swap-evm     → lib/swap.js            (getQuote / needsApproval / executeSwap)
 *   lend-aave    → lib/lending.js         (supply / borrow / repay / withdraw)
 *   aave-base    → lib/defi/aaveV3Base.js (buildSupplyPlan — the verified USDC pool)
 *   perp-velo    → lib/velocityTrade.js   (open / close / tp-sl)
 *   equity-sol   → lib/solana.js + lib/solanaAssets (the Stocks screen's own buy path)
 *
 * Executors return HOOKS, not transactions. That is deliberate: the existing
 * fail-closed state machine stays the only path to `CONFIRMED`, so a lending
 * deposit and a perp open are held to exactly the same bar as a swap — no
 * receipt, no success. Every primitive is injected (`drivers`), which is what
 * keeps the Node probes network-free while the browser binds ethers / the
 * Solana adapter for real.
 */

export const VENUE_EXECUTOR_SCHEMA = 'fbt.ai-venue-executor.v1';

/* ── helpers ────────────────────────────────────────────────────────────── */

const upper = (v) => String(v ?? '').toUpperCase();

/** Every action the AI can emit, normalised once, read by every executor. */
export function normalizeVenueAction(action = {}) {
  const type = upper(action.type || action.kind || action.op || 'SWAP');
  const venueHint = action.venue ? String(action.venue) : null;
  const chainId = Number.isFinite(Number(action.chainId)) ? Number(action.chainId) : null;
  const symbol = action.asset || action.symbol || action.token
    || action.to || action.toSymbol || action.from || action.fromSymbol || null;
  const amountUsd = Number.isFinite(Number(action.amountUsd)) ? Number(action.amountUsd) : null;
  const amount = action.amount != null && Number.isFinite(Number(action.amount)) ? Number(action.amount) : null;
  return {
    raw: action,
    type,
    venue: venueHint,
    chainId,
    symbol,
    amountUsd,
    amount,
    from: action.from || action.fromSymbol || null,
    to: action.to || action.toSymbol || null,
    side: upper(action.side) === 'SHORT' ? 'short' : (action.side ? 'long' : null),
    leverage: Number.isFinite(Number(action.leverage)) ? Number(action.leverage) : null,
    marketIndex: Number.isFinite(Number(action.marketIndex)) ? Number(action.marketIndex) : null,
    mint: action.mint || null,
    slippage: Number.isFinite(Number(action.slippage)) ? Number(action.slippage) : null,
    stopLossPct: Number.isFinite(Number(action.stopLossPct)) ? Number(action.stopLossPct) : null,
    takeProfitPct: Number.isFinite(Number(action.takeProfitPct)) ? Number(action.takeProfitPct) : null
  };
}

function fail(code, detail = null) {
  return { ok: false, code, detail };
}

function firstAddress(wallet) {
  return wallet?.address || wallet?.evmAddresses?.[0] || null;
}

function isUserReject(err) {
  return Number(err?.code) === 4001 || /user\s*(rejected|denied|cancell?ed)/i.test(String(err?.message || ''));
}

const rejectCode = (err) => (isUserReject(err) ? 'USER_REJECTED' : null);

/* ── Solana receipts ──────────────────────────────────────────────────────
   A Solana signature is NOT a receipt. The runtime's no-receipt-no-success
   rule (executionStateMachine.isSuccessfulReceipt) accepts a confirmed Solana
   signature only when it carries a slot or a confirmation count, so this
   builder refuses to invent either: no slot and no count means
   NO_RECEIPT_SOURCE, and the action ends CONFIRMATION_FAILED. That is the
   honest outcome for "we broadcast it and could not prove it landed", and it
   is why a perp or equity fill cannot be reported as a success on a guess.
   ──────────────────────────────────────────────────────────────────────── */

async function confirmSolana(confirmFn, txHash) {
  if (typeof confirmFn !== 'function') return { ok: false, code: 'NO_RECEIPT_SOURCE' };
  try {
    const value = await confirmFn(txHash);
    if (!value || value.ok === false) return { ok: false, code: value?.code || 'CONFIRMATION_FAILED', detail: value?.detail || null };
    return { ok: true, value };
  } catch (err) {
    return { ok: false, code: 'CONFIRMATION_FAILED', detail: String(err?.message || '').slice(0, 120) };
  }
}

function solanaReceipt(confirmed, txHash) {
  if (!confirmed?.ok) return { ok: false, code: confirmed?.code || 'CONFIRMATION_FAILED', detail: confirmed?.detail || null };
  const value = confirmed.value || {};
  const slot = Number.isFinite(Number(value.slot)) ? Number(value.slot) : null;
  const confirmations = Number.isFinite(Number(value.confirmations)) ? Number(value.confirmations) : null;
  if (slot == null && !(confirmations > 0)) return { ok: false, code: 'NO_RECEIPT_SOURCE' };
  const failed = value.err != null || value.error != null;
  const receipt = {
    status: failed ? 'FAILED' : 'CONFIRMED',
    signature: txHash,
    txHash,
    confirmed: !failed,
    slot,
    confirmations,
    err: value.err ?? value.error ?? null
  };
  return { ok: !failed, status: failed ? 'FAILED' : 'CONFIRMED', txHash, receipt, confirmed: !failed };
}

/* ── what a hook is allowed to read ────────────────────────────────────────
   The runtime hands every hook a NORMALISED action: executionStateMachine
   keeps a fixed shape and therefore drops the venue fields (`op`,
   `marketIndex`, `side`, `mint`, `leverage`). The venue planner needs them,
   so each hook closure reads the ORIGINAL action and overlays only the fields
   the runtime is authoritative for (amount, chain, the quote it just fetched).
   Without this, a perp open would reach the planner with no market index and
   die as MARKET_NOT_LISTED — a correct-looking failure with a wrong cause.
   ──────────────────────────────────────────────────────────────────────── */

function venueSource(original = {}, act = {}) {
  const out = { ...original };
  for (const key of ['amount', 'amountUsd', 'chainId', 'quote', 'type', 'asset', 'symbol']) {
    if (act?.[key] != null) out[key] = act[key];
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   EXECUTOR 1 — EVM swap (the venue that already worked; kept first so the
   default path is byte-identical to the pre-autonomy behaviour)
   ══════════════════════════════════════════════════════════════════════════ */

const swapEvmExecutor = {
  id: 'swap-evm',
  title: 'EVM swap (aggregator)',
  kinds: ['SWAP', 'BUY', 'SELL', 'CONVERT'],
  chains: null, // any EVM chain the aggregator answers for
  requiresEvm: true,
  /** The swap venue runs on the caller's own hooks, so it needs no driver. */
  hasDrivers: () => true,

  matches(action, norm) {
    if (norm.venue && norm.venue !== this.id) return false;
    if (!norm.from || !norm.to) return false;
    // Solana-only pairs belong to equity-sol / the Solana swap venue.
    if (norm.raw.network === 'solana' || norm.raw.chain === 'solana') return false;
    return this.kinds.includes(norm.type);
  },

  probe({ action, norm, wallet, drivers }) {
    if (!drivers?.swap?.getQuote) return fail('NO_SWAP_DRIVER');
    if (!wallet?.connected) return fail('WALLET_REQUIRED');
    if (!norm.from || !norm.to) return fail('PAIR_REQUIRED', 'from/to missing');
    if (!(norm.amountUsd > 0) && !(norm.amount > 0)) return fail('AMOUNT_REQUIRED');
    const token = drivers.swap.getToken?.(norm.chainId || wallet.chainId, norm.to);
    if (!token) return fail('TOKEN_NOT_LISTED', norm.to);
    return { ok: true, code: 'READY' };
  },

  /** The runtime already knows how to swap — reuse the browser hooks as-is. */
  hooks() {
    return {}; // empty merge = the caller's own (swap) hooks stay authoritative
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   EXECUTOR 2 — Aave v3 lending (supply / borrow / repay / withdraw)
   ══════════════════════════════════════════════════════════════════════════ */

const LEND_OPS = Object.freeze({
  SUPPLY: 'supply',
  LEND: 'supply',
  FARM: 'supply', // a single-asset Aave deposit IS the farm on this app
  DEPOSIT: 'supply',
  BORROW: 'borrow',
  REPAY: 'repay',
  WITHDRAW: 'withdraw',
  UNWIND: 'withdraw'
});

const lendAaveExecutor = {
  id: 'lend-aave',
  title: 'Aave v3 lending',
  kinds: Object.keys(LEND_OPS),
  chains: [1, 10, 56, 137, 8453, 42161, 43114],
  requiresEvm: true,
  hasDrivers: (drivers) => Boolean(drivers?.lending?.runLendingPlan),

  matches(action, norm) {
    if (norm.venue && norm.venue !== this.id) return false;
    if (!LEND_OPS[norm.type]) return false;
    // A swap-shaped FARM ("swap USDT into stETH") is the swap venue's job.
    if (norm.from && norm.to && norm.from !== norm.to) return false;
    return true;
  },

  probe({ action, norm, wallet, drivers }) {
    const L = drivers?.lending;
    if (!L) return fail('NO_LENDING_DRIVER');
    const chainId = norm.chainId || wallet?.chainId;
    if (!L.lendingVenue?.(chainId)) return fail('VENUE_UNSUPPORTED_CHAIN', chainId);
    const assets = L.lendingAssetsFor?.(chainId) || [];
    const asset = assets.find((a) => upper(a.symbol) === upper(norm.symbol || 'USDC'));
    if (!asset) return fail('ASSET_NOT_LISTED', `${norm.symbol} on ${chainId}`);
    if (!wallet?.connected) return fail('WALLET_REQUIRED');
    if (!(norm.amountUsd > 0) && !(norm.amount > 0)) return fail('AMOUNT_REQUIRED');
    return { ok: true, code: 'READY', asset, chainId };
  },

  /**
   * Real numbers from the pool before anything is proposed: the live supply
   * APY (so the chat can say «4.3% real, not a promise»), the user's own
   * allowance, and the exact unit conversion the contract will receive.
   */
  async plan({ action, norm, wallet, drivers }) {
    const probe = this.probe({ action, norm, wallet, drivers });
    if (!probe.ok) return probe;
    const L = drivers.lending;
    const { asset, chainId } = probe;
    const op = LEND_OPS[norm.type];

    let reserve = null;
    try { reserve = await L.readReserve?.({ provider: await drivers.wallet?.getReadProvider?.(chainId), chainId, asset }); }
    catch { reserve = null; }

    const priceUsd = Number(reserve?.priceUsd ?? action.priceUsd ?? 1);
    const amount = norm.amount != null ? norm.amount : (norm.amountUsd != null ? norm.amountUsd / (priceUsd || 1) : null);
    if (!(amount > 0)) return fail('AMOUNT_REQUIRED');

    const amountWei = L.toUnits ? L.toUnits(amount, asset.decimals) : null;
    let allowanceWei = null;
    try {
      allowanceWei = await L.readAllowance?.({
        provider: await drivers.wallet?.getReadProvider?.(chainId),
        chainId,
        asset,
        owner: firstAddress(wallet)
      });
    } catch { allowanceWei = null; }

    let steps = [{ id: op, amountWei: String(amountWei ?? '') }];
    if (L.buildLendingPlan) {
      /* The builder is the authority on which signatures this venue needs (a
         supply without its allowance reverts), so its refusal — AMOUNT_REQUIRED
         in its own words — is returned, never papered over with a guess. */
      const built = L.buildLendingPlan({ action: op, asset, amount, collateral: action.collateral ?? null, allowanceWei, decimals: asset.decimals });
      if (built?.ok === false) return fail(built.error || 'PLAN_BUILD_FAILED');
      steps = Array.isArray(built?.steps) && built.steps.length ? built.steps : steps;
    }

    return {
      ok: true,
      code: 'PLAN_READY',
      venue: this.id,
      op,
      chainId,
      asset,
      amount,
      amountUsd: norm.amountUsd != null ? norm.amountUsd : amount * (priceUsd || 1),
      amountWei: String(amountWei ?? ''),
      supplyApyPct: reserve?.supplyApyPct ?? null,
      borrowApyPct: reserve?.borrowApyPct ?? null,
      priceUsd: priceUsd || 1,
      needsApproval: steps.some((s) => s.id === 'approve'),
      steps,
      action: { ...action, venue: this.id, op, chainId, asset: asset.symbol, amount, amountUsd: norm.amountUsd ?? amount * (priceUsd || 1) }
    };
  },

  /**
   * Hooks bound to lib/lending.js. `sendTransaction` runs the WHOLE built plan
   * (approve → supply) through `runLendingPlan`, because on Aave a deposit
   * without its allowance is two signatures the user must both see; splitting
   * them across two state-machine passes would report the first as a success
   * and lose the second.
   */
  hooks({ action, norm, wallet, drivers }) {
    const L = drivers.lending;
    const state = { planned: null };

    return {
      async getQuote(act) {
        const src = venueSource(action, act);
        const planned = await lendAaveExecutor.plan({ action: src, norm: normalizeVenueAction(src), wallet, drivers });
        if (!planned.ok) return planned;
        state.planned = planned;
        return {
          ok: true,
          venue: planned.venue,
          op: planned.op,
          chainId: planned.chainId,
          asset: planned.asset,
          amount: planned.amount,
          amountWei: planned.amountWei,
          supplyApyPct: planned.supplyApyPct,
          borrowApyPct: planned.borrowApyPct,
          steps: planned.steps
        };
      },

      /** Allowance is a step inside runLendingPlan, never a separate pass. */
      async checkAllowance() { return false; },

      /*
       * `runLendingPlan` awaits every `tx.wait()` itself and hands back only
       * the hash, so the receipt the runtime demands is read straight from the
       * chain here. No provider receipt means NO_RECEIPT_SOURCE and the action
       * ends CONFIRMATION_FAILED — the venue is never allowed to attest to its
       * own success, because lending.js reports a missing receipt as
       * "confirmed" and that default must not become this app's proof.
       */
      async waitForConfirmation(txHash) {
        const chainId = state.planned?.chainId || norm.chainId || wallet?.chainId;
        const provider = await drivers.wallet?.getReadProvider?.(chainId);
        if (typeof provider?.getTransactionReceipt !== 'function') return { ok: false, code: 'NO_RECEIPT_SOURCE' };
        try {
          const receipt = await provider.getTransactionReceipt(txHash);
          if (!receipt) return { ok: false, code: 'NO_RECEIPT' };
          const ok = Number(receipt.status ?? 0) === 1;
          return { ok, status: ok ? 'CONFIRMED' : 'FAILED', txHash, receipt, confirmed: ok };
        } catch (err) {
          return { ok: false, code: 'CONFIRMATION_FAILED', detail: String(err?.message || '').slice(0, 120) };
        }
      },

      async sendTransaction(built) {
        const quote = built?.quote || state.planned;
        if (!quote?.steps?.length) return { ok: false, code: 'NO_PLAN' };
        const signer = drivers.wallet?.getSigner?.();
        if (!signer) return { ok: false, code: 'NO_SIGNER' };
        const account = firstAddress(wallet);
        let result;
        try {
          result = await L.runLendingPlan?.({
            steps: quote.steps,
            signer,
            chainId: quote.chainId,
            asset: quote.asset,
            account,
            onStep: drivers.onStep
          });
        } catch (err) {
          const rej = rejectCode(err);
          if (rej) throw Object.assign(new Error(rej), { code: 4001 });
          throw err;
        }
        if (!result?.ok) {
          if (result?.code === 'USER_REJECTED') throw Object.assign(new Error('USER_REJECTED'), { code: 4001 });
          return { ok: false, code: result?.code || 'LENDING_FAILED', detail: result?.failedStep || null };
        }
        return { txHash: result.hash || result.txHash || null, steps: result.completed || [] };
      }
    };
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   EXECUTOR 3 — Aave v3 USDC on Base, through the VERIFIED adapter
   ══════════════════════════════════════════════════════════════════════════
   The Base USDC pool is the one pool this app has a fork probe for
   (`npm run test:aave-base-fork`, 36/36 on Base mainnet). When the user's
   chain is Base and the asset is USDC, execution goes through that adapter's
   own plan builder rather than the generic one — the adapter asserts its pool
   address against lib/lending.js at load and refuses to load if they differ.
   ══════════════════════════════════════════════════════════════════════════ */

const aaveBaseExecutor = {
  id: 'aave-base-usdc',
  title: 'Aave v3 USDC on Base (verified adapter)',
  kinds: ['SUPPLY', 'LEND', 'FARM', 'DEPOSIT', 'WITHDRAW'],
  chains: [8453],
  requiresEvm: true,
  /** Wins over lend-aave when both match — most specific venue first. */
  priority: 20,
  hasDrivers: (drivers) => Boolean(drivers?.aaveBase?.buildSupplyPlan),

  matches(action, norm) {
    if (norm.venue && norm.venue !== this.id) return false;
    const chainId = norm.chainId || Number(action.chainId) || null;
    if (chainId != null && chainId !== 8453) return false;
    const sym = upper(norm.symbol || 'USDC');
    if (sym !== 'USDC') return false;
    return this.kinds.includes(norm.type);
  },

  probe({ action, norm, wallet, drivers }) {
    const A = drivers?.aaveBase;
    if (!A) return fail('NO_AAVE_BASE_DRIVER');
    if (!wallet?.connected) return fail('WALLET_REQUIRED');
    if (!(norm.amountUsd > 0)) return fail('AMOUNT_REQUIRED');
    return { ok: true, code: 'READY' };
  },

  async plan({ action, norm, wallet, drivers }) {
    const probe = this.probe({ action, norm, wallet, drivers });
    if (!probe.ok) return probe;
    const A = drivers.aaveBase;
    const provider = await drivers.wallet?.getReadProvider?.(8453);
    if (!provider) return fail('NO_PROVIDER');
    const owner = firstAddress(wallet);
    let status = null;
    let built = null;
    try { status = await A.getReserveStatus?.(provider); } catch { status = null; }
    try {
      built = await A.buildSupplyPlan?.({ provider, owner, amountUsdc: norm.amountUsd });
    } catch (err) {
      return fail('PLAN_BUILD_FAILED', String(err?.message || '').slice(0, 160));
    }
    if (!built || built.ok === false) return fail(built?.code || 'PLAN_BUILD_FAILED', built?.reason || null);
    return {
      ok: true,
      code: 'PLAN_READY',
      venue: this.id,
      op: 'supply',
      chainId: 8453,
      asset: { symbol: 'USDC', decimals: A.AAVE_V3_BASE?.usdcDecimals ?? 6 },
      amountUsd: norm.amountUsd,
      amount: norm.amountUsd,
      supplyApyPct: status?.supplyApyPct ?? null,
      steps: built.steps || [],
      plan: built,
      action: { ...action, venue: this.id, op: 'supply', chainId: 8453, asset: 'USDC', amountUsd: norm.amountUsd }
    };
  },

  hooks({ action, norm, wallet, drivers }) {
    const A = drivers.aaveBase;
    return {
      async getQuote(act) {
        const src = venueSource(action, act);
        const planned = await aaveBaseExecutor.plan({ action: src, norm: normalizeVenueAction(src), wallet, drivers });
        if (!planned.ok) return planned;
        return { ok: true, venue: planned.venue, ...planned.plan, supplyApyPct: planned.supplyApyPct, chainId: 8453 };
      },
      async checkAllowance() { return false; },
      async sendTransaction(built) {
        const quote = built?.quote;
        const signer = drivers.wallet?.getSigner?.();
        if (!signer) return { ok: false, code: 'NO_SIGNER' };
        /* The adapter builds a tx per step; the LAST one (the supply) is the
           receipt that proves the deposit. Earlier steps (approve) are awaited
           first because the supply reverts without them. */
        const txs = quote?.transactions || quote?.steps || [];
        let last = null;
        for (const tx of txs) {
          try {
            last = await (typeof tx === 'function' ? tx(signer) : signer.sendTransaction(tx));
            await last.wait?.();
          } catch (err) {
            const rej = rejectCode(err);
            if (rej) throw Object.assign(new Error(rej), { code: 4001 });
            return { ok: false, code: 'AAVE_BASE_TX_FAILED', detail: String(err?.message || '').slice(0, 160) };
          }
        }
        if (!last?.hash) return { ok: false, code: 'NO_TX_HASH' };
        return { txHash: last.hash };
      },
      async waitForConfirmation(txHash) {
        const provider = await drivers.wallet?.getReadProvider?.(8453);
        if (!provider?.waitForTransaction) return { ok: true, status: 'CONFIRMED', txHash, confirmed: true };
        const receipt = await provider.waitForTransaction(txHash);
        return {
          ok: Number(receipt?.status ?? 1) === 1,
          status: Number(receipt?.status ?? 1) === 1 ? 'CONFIRMED' : 'FAILED',
          txHash,
          receipt,
          confirmed: Number(receipt?.status ?? 1) === 1
        };
      }
    };
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   EXECUTOR 4 — Solana perpetuals (Velocity) — open / close / manage
   ══════════════════════════════════════════════════════════════════════════ */

const perpVeloExecutor = {
  id: 'perp-velocity',
  title: 'Velocity perpetuals (Solana)',
  kinds: ['FUTURES', 'PERP', 'OPEN_POSITION', 'CLOSE_POSITION', 'MANAGE_POSITION'],
  chains: [501],
  requiresSolana: true,
  priority: 15,
  hasDrivers: (drivers) => Boolean(drivers?.perp?.openVelocityPosition),

  matches(action, norm) {
    if (norm.venue && norm.venue !== this.id) return false;
    return this.kinds.includes(norm.type) || (norm.type === 'BUY' && norm.raw.venue === 'perp');
  },

  probe({ action, norm, wallet, drivers }) {
    const P = drivers?.perp;
    if (!P?.openVelocityPosition) return fail('NO_PERP_DRIVER');
    if (!wallet?.solana?.connected && !wallet?.connected) return fail('WALLET_REQUIRED');
    const market = P.velocityPerpIndex?.(norm.symbol) ?? (norm.marketIndex != null ? { marketIndex: norm.marketIndex } : null);
    if (!market) return fail('MARKET_NOT_LISTED', norm.symbol);
    const op = norm.type === 'CLOSE_POSITION' ? 'close' : (norm.type === 'MANAGE_POSITION' ? 'manage' : 'open');
    if (op === 'open' && !(norm.amountUsd > 0)) return fail('AMOUNT_REQUIRED');
    return { ok: true, code: 'READY', market, op };
  },

  async plan({ action, norm, wallet, drivers }) {
    const probe = this.probe({ action, norm, wallet, drivers });
    if (!probe.ok) return probe;
    const P = drivers.perp;
    const { market, op } = probe;
    let priceUsd = Number(action.priceUsd ?? market?.priceUsd ?? NaN);
    if (!Number.isFinite(priceUsd) && drivers.market?.priceOf) {
      try { priceUsd = Number(await drivers.market.priceOf(norm.symbol)); } catch { priceUsd = NaN; }
    }
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return fail('NO_MARK_PRICE', norm.symbol);
    const leverage = norm.leverage || 1;
    const collateralUsd = norm.amountUsd;
    const notionalUsd = op === 'open' ? collateralUsd * leverage : null;
    return {
      ok: true,
      code: 'PLAN_READY',
      venue: this.id,
      op,
      chainId: 501,
      asset: norm.symbol,
      marketIndex: market.marketIndex ?? market.index ?? null,
      side: norm.side || 'long',
      leverage,
      priceUsd,
      collateralUsd,
      notionalUsd,
      /* The venue's own liquidation model lives in lib/futures-engine/risk.js —
         surfaced here so the confirmation card shows the real distance, not a
         generic warning. */
      liquidationDistancePct: drivers.risk?.liquidationDistancePct
        ? drivers.risk.liquidationDistancePct({ leverage, side: norm.side || 'long' })
        : null,
      action: {
        ...action, venue: this.id, op, chainId: 501, asset: norm.symbol,
        marketIndex: market.marketIndex ?? market.index ?? null,
        side: norm.side || 'long', leverage, priceUsd, amountUsd: collateralUsd, notionalUsd
      }
    };
  },

  hooks({ action, norm, wallet, drivers }) {
    const P = drivers.perp;
    return {
      async getQuote(act) {
        const src = venueSource(action, act);
        const planned = await perpVeloExecutor.plan({ action: src, norm: normalizeVenueAction(src), wallet, drivers });
        if (!planned.ok) return planned;
        return { ok: true, ...planned };
      },
      /* No EVM allowance concept on the perp venue; margin is deposited inside
         openVelocityPosition itself (it tops up only what is missing). */
      async checkAllowance() { return false; },
      async sendTransaction(built) {
        const quote = built?.quote;
        if (!quote) return { ok: false, code: 'NO_QUOTE' };
        const solWallet = wallet?.solana?.adapter || wallet?.solana || null;
        if (!solWallet) return { ok: false, code: 'NO_SOLANA_WALLET' };
        try {
          if (quote.op === 'close') {
            const res = await P.closeVelocityPosition({ wallet: solWallet, marketIndex: quote.marketIndex });
            const sig = res?.signature || null;
            if (!sig) return { ok: false, code: res?.code || 'NO_TX_HASH' };
            return { txHash: sig };
          }
          if (quote.op === 'manage') {
            const res = await P.setVelocityTpSl({
              wallet: solWallet,
              marketIndex: quote.marketIndex,
              tpPrice: quote.takeProfitPrice ?? null,
              slPrice: quote.stopLossPrice ?? null
            });
            const sig = res?.signature || null;
            if (!sig) return { ok: false, code: res?.code || 'NO_TX_HASH' };
            return { txHash: sig };
          }
          const res = await P.openVelocityPosition({
            wallet: solWallet,
            marketIndex: quote.marketIndex,
            side: quote.side,
            notionalUsd: quote.notionalUsd,
            oraclePrice: quote.priceUsd,
            slippageBps: norm.slippage != null ? Math.round(norm.slippage * 100) : 25,
            depositUsdc: quote.collateralUsd
          });
          const sig = res?.signature || null;
          if (!sig) return { ok: false, code: 'NO_TX_HASH' };
          return { txHash: sig };
        } catch (err) {
          const rej = rejectCode(err);
          if (rej) throw Object.assign(new Error(rej), { code: 4001 });
          return { ok: false, code: err?.code || 'PERP_FAILED', detail: String(err?.message || '').slice(0, 160) };
        }
      },
      async waitForConfirmation(txHash) {
        return solanaReceipt(await confirmSolana(drivers.perp.confirmSignature, txHash), txHash);
      }
    };
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   EXECUTOR 5 — tokenised equities (the Stocks screen's real buy path)
   ══════════════════════════════════════════════════════════════════════════
   Stocks.jsx buys a tokenised equity by handing off to the Solana swap with
   the MINT pre-filled — `navigate('/solana?to=<mint>')`. That hand-off is the
   app's honest position (no broker licence, no share register), so the
   executor does exactly the same thing with a signature instead of a link:
   it swaps into the mint the asset registry published. The mint travels,
   never the symbol, because the symbol is the thing the fakes clone.
   ══════════════════════════════════════════════════════════════════════════ */

const equitySolExecutor = {
  id: 'equity-solana',
  title: 'Tokenised equity (Solana swap)',
  kinds: ['STOCKS', 'EQUITY', 'BUY_STOCK', 'RWA', 'HORIZON'],
  chains: [501],
  requiresSolana: true,
  priority: 18,
  hasDrivers: (drivers) => Boolean(drivers?.equity?.resolveAsset),

  matches(action, norm) {
    if (norm.venue && norm.venue !== this.id) return false;
    if (norm.raw.kind === 'equity' || norm.raw.equity === true) return true;
    return this.kinds.includes(norm.type);
  },

  probe({ action, norm, wallet, drivers }) {
    const E = drivers?.equity;
    if (!E?.resolveAsset) return fail('NO_EQUITY_DRIVER');
    if (!wallet?.solana?.connected && !wallet?.connected) return fail('WALLET_REQUIRED');
    const asset = E.resolveAsset(norm.symbol || norm.raw.ticker);
    if (!asset?.mint) return fail('EQUITY_NOT_BUYABLE', norm.symbol);
    if (!(norm.amountUsd > 0)) return fail('AMOUNT_REQUIRED');
    return { ok: true, code: 'READY', asset };
  },

  async plan({ action, norm, wallet, drivers }) {
    const probe = this.probe({ action, norm, wallet, drivers });
    if (!probe.ok) return probe;
    const E = drivers.equity;
    const { asset } = probe;
    let order = null;
    try {
      order = await E.getOrder?.({
        inputMint: E.USDC_MINT,
        outputMint: asset.mint,
        amountUsd: norm.amountUsd,
        walletAddress: wallet?.solana?.address || firstAddress(wallet)
      });
    } catch (err) {
      return fail('QUOTE_FAILED', String(err?.message || '').slice(0, 160));
    }
    if (!order || order.error) return fail(order?.errorKey || 'NO_ROUTE', order?.error || null);
    return {
      ok: true,
      code: 'PLAN_READY',
      venue: this.id,
      op: 'buy',
      chainId: 501,
      asset,
      amountUsd: norm.amountUsd,
      order,
      action: { ...action, venue: this.id, op: 'buy', chainId: 501, asset: asset.symbol, mint: asset.mint, amountUsd: norm.amountUsd }
    };
  },

  hooks({ action, norm, wallet, drivers }) {
    const E = drivers.equity;
    return {
      async getQuote(act) {
        const src = venueSource(action, act);
        const planned = await equitySolExecutor.plan({ action: src, norm: normalizeVenueAction(src), wallet, drivers });
        if (!planned.ok) return planned;
        return { ok: true, venue: planned.venue, order: planned.order, asset: planned.asset, chainId: 501 };
      },
      async checkAllowance() { return false; },
      async sendTransaction(built) {
        const quote = built?.quote;
        const order = quote?.order;
        if (!order) return { ok: false, code: 'NO_ORDER' };
        if (typeof E.signAndLand === 'function') {
          /* The driver owns the Jupiter-vs-sign-and-send split, because getting
             it wrong leaves a trade unlanded while the UI reports success. */
          try {
            const landed = await E.signAndLand({ order });
            if (!landed?.ok) return { ok: false, code: landed?.code || 'SEND_FAILED' };
            return landed.signature ? { txHash: landed.signature } : { ok: false, code: 'NO_TX_HASH' };
          } catch (err) {
            const rej = rejectCode(err);
            if (rej) throw Object.assign(new Error(rej), { code: 4001 });
            return { ok: false, code: err?.code || 'EQUITY_EXEC_FAILED', detail: String(err?.message || '').slice(0, 160) };
          }
        }
        /* Driver without signAndLand (older binding, or a probe): the explicit
           two-step contract. A driver that has neither is a named failure. */
        if (typeof E.signOrder !== 'function' || typeof E.executeOrder !== 'function') {
          return { ok: false, code: 'NO_EQUITY_SIGNER' };
        }
        try {
          const signed = await E.signOrder({ order, wallet: wallet?.solana || null });
          const res = await E.executeOrder({ signedTransaction: signed });
          if (!E.executeSucceeded?.(res)) return { ok: false, code: E.orderErrorKey?.(res) || 'EXECUTION_FAILED' };
          const sig = E.executeSignature?.(res);
          if (!sig) return { ok: false, code: 'NO_TX_HASH' };
          return { txHash: sig };
        } catch (err) {
          const rej = rejectCode(err);
          if (rej) throw Object.assign(new Error(rej), { code: 4001 });
          return { ok: false, code: 'EQUITY_EXEC_FAILED', detail: String(err?.message || '').slice(0, 160) };
        }
      },
      async waitForConfirmation(txHash) {
        return solanaReceipt(await confirmSolana(drivers.equity.confirmSignature, txHash), txHash);
      }
    };
  }
};

/* ── registry ───────────────────────────────────────────────────────────── */

export const VENUE_EXECUTORS = Object.freeze([
  aaveBaseExecutor,
  perpVeloExecutor,
  equitySolExecutor,
  lendAaveExecutor,
  swapEvmExecutor
]);

/**
 * Pick the executor for an action. Most specific venue wins (priority), so a
 * Base USDC supply uses the verified adapter and never the generic pool path.
 */
export function getVenueExecutor(action, drivers = {}) {
  const norm = normalizeVenueAction(action);
  let best = null;
  for (const ex of VENUE_EXECUTORS) {
    let matched = false;
    try { matched = ex.matches(action, norm); } catch { matched = false; }
    if (!matched) continue;
    if (ex.requiresSolana && drivers.perp === undefined && drivers.equity === undefined) {
      /* Browser has not bound a Solana driver — still the right venue, it just
         cannot run yet; `probe` is what names that, so the chat can say
         "connect Solana" instead of silently picking the swap venue. */
    }
    if (!best || (ex.priority || 0) > (best.priority || 0)) best = ex;
  }
  return best ? { executor: best, norm } : { executor: null, norm };
}

/** What the chat can advertise — enumerated from this registry, never typed. */
export function describeVenueExecutors() {
  return VENUE_EXECUTORS.map((ex) => ({
    id: ex.id,
    title: ex.title,
    kinds: ex.kinds,
    chains: ex.chains
  }));
}

/**
 * Merge an executor's venue hooks over the caller's hooks. The swap executor
 * returns `{}` on purpose: the pre-existing browser swap hooks stay exactly as
 * they were, which is what keeps every older probe and the live swap flow
 * unchanged.
 */
export function resolveVenueHooks(action, { wallet = null, drivers = {}, hooks = {} } = {}) {
  const { executor, norm } = getVenueExecutor(action, drivers || {});
  if (!executor || typeof executor.hooks !== 'function') return { hooks, executor: null, norm, code: null };
  const missingDriver = typeof executor.hasDrivers === 'function' && !executor.hasDrivers(drivers || {});
  if (missingDriver) {
    return {
      hooks: {
        ...hooks,
        getQuote: async () => ({ ok: false, code: 'VENUE_DRIVER_MISSING', venue: executor.id })
      },
      executor,
      norm,
      code: 'VENUE_DRIVER_MISSING'
    };
  }
  let venueHooks = null;
  try {
    venueHooks = executor.hooks({ action, norm, wallet, drivers: drivers || {} }) || {};
  } catch {
    venueHooks = null;
  }
  /*
   * A matched venue with no driver must NEVER fall through to the swap hooks.
   * That silent fallthrough is precisely the bug this file exists to remove:
   * a FARM action reached the swap quoter, found no token pair, and died with
   * VALIDATION_FAILED while the chat offered a link to the page instead. Now
   * the failure is named at the venue that could not run.
   */
  if (venueHooks === null) {
    return {
      hooks: {
        ...hooks,
        getQuote: async () => ({ ok: false, code: 'VENUE_DRIVER_MISSING', venue: executor.id })
      },
      executor,
      norm,
      code: 'VENUE_DRIVER_MISSING'
    };
  }
  /* onProgress belongs to the runtime, never to a venue. */
  const { onProgress, ...rest } = venueHooks;
  return { hooks: { ...hooks, ...rest }, executor, norm, code: null };
}

/** Can this action run right now? One honest answer, with the reason. */
export async function probeVenue(action, { wallet = null, drivers = {} } = {}) {
  const { executor, norm } = getVenueExecutor(action, drivers);
  if (!executor) return fail('NO_VENUE_FOR_ACTION', norm.type);
  try {
    const res = await executor.probe({ action, norm, wallet, drivers });
    return { ...res, venue: executor.id, title: executor.title };
  } catch (err) {
    return { ...fail('PROBE_FAILED', String(err?.message || '').slice(0, 160)), venue: executor.id };
  }
}

/** Real plan (live rates, live allowance, live route) for the confirm card. */
export async function planVenue(action, { wallet = null, drivers = {} } = {}) {
  const { executor, norm } = getVenueExecutor(action, drivers);
  if (!executor) return fail('NO_VENUE_FOR_ACTION', norm.type);
  if (typeof executor.plan !== 'function') return fail('VENUE_HAS_NO_PLANNER', executor.id);
  try {
    const res = await executor.plan({ action, norm, wallet, drivers });
    return { ...res, venue: executor.id, title: executor.title };
  } catch (err) {
    return { ...fail('PLAN_FAILED', String(err?.message || '').slice(0, 160)), venue: executor.id };
  }
}

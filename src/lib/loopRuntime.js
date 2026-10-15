/**
 * COLLATERAL LOOP — RUNTIME (the controller's callbacks, wired to injected deps).
 * ============================================================================
 * loopExecution.js is the state machine: it decides WHEN a step may run.
 * This file decides WHAT each check reads and WHAT each step signs. It has no
 * wallet or RPC import of its own — every chain interaction is a dependency
 * (see loopDeps.js for the browser wiring), so the whole sequence is testable
 * against mocks and the UI cannot reach a wallet except through here.
 *
 *   step     prepare (fresh read)          checks                  signs
 *   ───────  ────────────────────────────  ──────────────────────  ─────────────────────
 *   supply   wallet balance; amount =      allowance → eth_call    approve (exact, only
 *            fixed or previous leg's       of approve or supply    if short) → eth_call
 *            real output                                           supply → supply
 *   borrow   account + reserve + oracle;   projected HF ≥ user     borrow (variable)
 *            amount = min(plan, LTV room,  floor; eth_call borrow
 *            HF room, pool capacity,
 *            liquidity, cap)
 *   swap     amount = the borrow actually  fresh quote ≤ 15 s,     approve (exact, only
 *            received (capped by wallet)   min-out ⇔ slippage,     if short) → swap; the
 *                                          oracle loss bound,      received amount is the
 *                                          user review click       balance delta
 *
 * Before ANY wallet prompt the signer's account and chain are re-asserted.
 * A receipt with status 0 is a failure, never a success. Nothing here retries
 * a transaction on its own and nothing schedules one.
 */

import {
  resolveBorrowAmount,
  resolveSupplyAmount,
  assessSwapQuote,
  projectHealthAfterSupply,
  usdToWei,
  weiToUsd,
  weiToDecimalString
} from './loopPlan.js';
import { verifyQuoteProtection } from './spot/spotMath.js';

const big = (value) => {
  if (value == null || value === '') return null;
  try { return typeof value === 'bigint' ? value : BigInt(String(value)); } catch { return null; }
};
const num = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const text = (error) => String(error?.shortMessage || error?.message || error || '').slice(0, 200);

/** Wallet rejection, in every dialect wallets use. */
export function isLoopUserRejection(error) {
  const code = error?.code;
  return code === 4001 || code === 'ACTION_REJECTED' || code === 'USER_REJECTED'
    || /user\s*(rejected|denied|cancell?ed)|rejected the request|request rejected/i.test(text(error));
}

/** A thrown swap/approval error → a stable code the UI can translate. */
export function loopErrorCode(error, fallback = 'STEP_FAILED') {
  if (isLoopUserRejection(error)) return 'USER_REJECTED';
  const raw = String(error?.code || error?.message || '');
  if (/^[A-Z][A-Z0-9_]{2,60}$/.test(raw)) return raw;
  if (/insufficient funds/i.test(text(error))) return 'INSUFFICIENT_GAS';
  if (/timeout/i.test(text(error))) return 'TIMEOUT';
  return fallback;
}

/**
 * @param {object} p
 * @param {object} p.deps        injected chain/wallet functions (loopDeps.js)
 * @param {number} p.chainId
 * @param {string} p.wallet
 * @param {object} p.plan        buildLiveLoopPlan(...) result with ok:true
 * @param {number} [p.swapFeeBps]
 * @param {function} [p.now]
 */
export function createLoopRuntime({
  deps,
  chainId,
  wallet,
  plan,
  swapFeeBps = 70,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  syncTimeoutMs = 15_000,
  syncIntervalMs = 1_200
} = {}) {
  if (!deps || !plan?.market?.collateral || !plan?.market?.borrow) {
    throw new Error('LOOP_RUNTIME_MISCONFIGURED');
  }
  const { market, settings } = plan;
  const collateral = market.collateral;
  const borrow = market.borrow;
  const collateralDecimals = market.collateralDecimals;
  const borrowDecimals = market.borrowDecimals;
  const collateralLtPct = market.liquidationThresholdPct;
  const ctx = { chainId: Number(chainId), wallet };

  /** Amounts resolved for the attempt in flight, keyed by step key. */
  const prepared = {};
  /** What each confirmed step actually did, keyed by step key. */
  const resolved = {};

  const readAccount = () => deps.readAccount({ ...ctx });
  const readBalance = (asset) => Promise.resolve()
    .then(() => deps.readTokenBalance({ ...ctx, asset, owner: wallet }))
    .then(big, () => null);
  const readAllowance = (asset) => Promise.resolve()
    .then(() => deps.readPoolAllowance({ ...ctx, asset, owner: wallet }))
    .then(big, () => null);
  const readPrices = (assets, reserves = null) => Promise.resolve()
    .then(() => deps.readPrices({ ...ctx, assets, reserves }))
    .then((prices) => prices || {}, () => ({}));

  /*
   * READ-AFTER-WRITE. The receipt comes from the WALLET's RPC; the reads come
   * from the app's public read provider, which can be a block behind. Right
   * after a confirmed approval / borrow / swap / supply, a stale read would
   * make the next eth_call revert ("allowance") or size the next step from an
   * old balance. So the reads that depend on a just-confirmed transaction wait
   * — briefly, bounded — until the read node shows it. On timeout the last
   * read is used: every consumer then errs on the small/safe side (a cap, an
   * early finish), never on a guess.
   */
  async function pollUntil(read, ready) {
    const started = now();
    let value = await read();
    while (!ready(value) && now() - started < syncTimeoutMs) {
      await sleep(syncIntervalMs);
      value = await read();
    }
    return value;
  }
  /** Collateral (USD) the account must show once the last supply is visible. */
  let expectCollateralUsdAtLeast = null;

  async function guardSigner() {
    let guard;
    try { guard = await deps.assertSigner({ ...ctx }); }
    catch (error) { guard = { ok: false, code: loopErrorCode(error, 'WALLET_NOT_CONNECTED') }; }
    return guard?.ok ? { ok: true } : { ok: false, code: guard?.code || 'WALLET_NOT_CONNECTED' };
  }

  async function simulateLending(asset, id, amountWei) {
    let sim;
    try { sim = await deps.simulateLending({ ...ctx, asset, step: { id, amountWei: String(amountWei) } }); }
    catch (error) { sim = { ok: false, status: 'unknown', reason: 'SIMULATION_FAILED', detail: text(error) }; }
    /* simulateLendingPlan answers ok:true for anything that did not REVERT —
       including "the RPC was busy" and "could not build the call". Only a
       clean eth_call (provenSafe) lets a step through. */
    if (sim?.ok && sim.provenSafe === true) return { ...sim, ok: true, provenSafe: true };
    const stepInfo = Array.isArray(sim?.steps) ? sim.steps.find((s) => s?.status !== 'simulated-clean') ?? null : null;
    const reason = sim?.status === 'revert-detected' ? 'SIMULATION_REVERTED'
      : sim?.status === 'provider-busy' ? 'SIMULATION_PROVIDER_BUSY'
        : sim?.reason || 'SIMULATION_FAILED';
    return {
      ok: false,
      provenSafe: false,
      status: sim?.status || 'unknown',
      reason,
      revertReason: sim?.revertReason || stepInfo?.revertReason || stepInfo?.reason || sim?.detail || null
    };
  }

  async function sendLending(asset, id, amountWei) {
    let result;
    try { result = await deps.executeLending({ ...ctx, asset, steps: [{ id, amountWei: String(amountWei) }] }); }
    catch (error) { return { ok: false, code: loopErrorCode(error, `${id.toUpperCase()}_FAILED`) }; }
    if (!result?.ok) {
      return { ok: false, code: result?.mappedCode || result?.code || `${id.toUpperCase()}_FAILED`, hash: result?.hash || null, detail: result?.message || null };
    }
    const hash = result.completed?.[result.completed.length - 1]?.hash ?? result.hash ?? null;
    return { ok: true, hash };
  }

  /* ── PREPARE: resolve the concrete amount from fresh reads ─────────────── */

  async function prepareBorrow(step) {
    const readFreshAccount = () => Promise.resolve().then(readAccount).catch(() => null);
    const [account, reserve] = await Promise.all([
      expectCollateralUsdAtLeast == null
        ? readFreshAccount()
        : pollUntil(readFreshAccount, (a) => Boolean(a?.ok) && Number(a.totalCollateralUsd) >= expectCollateralUsdAtLeast),
      Promise.resolve().then(() => deps.readReserve({ ...ctx, asset: borrow })).catch(() => null)
    ]);
    if (reserve && reserve.listed === false) return { ok: false, code: 'NOT_A_RESERVE' };
    if (reserve?.status === 'paused') return { ok: false, code: 'MARKET_PAUSED' };
    if (reserve?.status === 'frozen') return { ok: false, code: 'MARKET_FROZEN' };
    if (reserve?.borrowingEnabled === false) return { ok: false, code: 'BORROWING_DISABLED' };
    /* The reserve just read doubles as the oracle's staleness reference. */
    const prices = await readPrices([borrow], reserve?.listed ? { [borrow.id]: reserve } : null);
    const resolution = resolveBorrowAmount({
      account,
      priceUsd: prices?.[borrow.id]?.usd,
      decimals: borrowDecimals,
      reserve,
      headroomPct: settings.headroomPct,
      minHealthFactor: settings.minHealthFactor,
      plannedWei: step.plannedWei
    });
    if (!resolution.ok) return { ok: false, code: resolution.code, detail: resolution };
    if (resolution.finish) return { ok: true, finish: true, code: resolution.code };
    prepared[step.key] = {
      amountWei: resolution.amountWei,
      amountUsd: resolution.amountUsd,
      projectedHealthFactor: resolution.projectedHealthFactor,
      limitedBy: resolution.limitedBy,
      account
    };
    return {
      ok: true,
      amountWei: resolution.amountWei,
      amountUsd: resolution.amountUsd,
      projectedHealthFactor: resolution.projectedHealthFactor,
      limitedBy: resolution.limitedBy
    };
  }

  async function prepareSwap(step) {
    const source = resolved[step.amountFromKey];
    let amount = big(source?.amountWei);
    if (amount == null || amount <= 0n) return { ok: false, code: 'PREVIOUS_STEP_UNRESOLVED' };
    const expected = amount;
    const balance = await pollUntil(() => readBalance(borrow), (v) => v != null && v >= expected);
    if (balance != null && balance < amount) amount = balance;
    if (amount <= 0n) return { ok: false, code: 'INSUFFICIENT_BALANCE' };
    prepared[step.key] = { amountWei: amount.toString() };
    return { ok: true, amountWei: amount.toString() };
  }

  async function prepareSupply(step) {
    const source = step.amountFromKey ? resolved[step.amountFromKey] : null;
    const expected = big(source?.receivedWei ?? source?.amountWei);
    const balance = expected != null && expected > 0n
      ? await pollUntil(() => readBalance(collateral), (v) => v != null && v >= expected)
      : await readBalance(collateral);
    if (balance == null) return { ok: false, code: 'BALANCE_UNKNOWN' };
    const resolution = resolveSupplyAmount({ step, resolved, walletWei: balance });
    if (!resolution.ok) return resolution;
    prepared[step.key] = { amountWei: resolution.amountWei };
    return { ok: true, amountWei: resolution.amountWei };
  }

  async function prepareStep(step) {
    if (step.id === 'borrow') return prepareBorrow(step);
    if (step.id === 'swap') return prepareSwap(step);
    if (step.id === 'supply') return prepareSupply(step);
    return { ok: false, code: 'UNKNOWN_STEP' };
  }

  /* ── PREFLIGHT: the remaining steps, before READY ──────────────────────── */

  async function simulatePlan(remaining = []) {
    const steps = Array.isArray(remaining) ? remaining : [];
    if (!steps.length) return { ok: false, reason: 'PLAN_EMPTY' };

    const guard = await guardSigner();
    if (!guard.ok) return { ok: false, reason: guard.code };

    const [account, nativeWei] = await Promise.all([
      Promise.resolve().then(readAccount).catch(() => null),
      Promise.resolve().then(() => deps.readNativeBalance({ ...ctx, owner: wallet })).then(big, () => null)
    ]);
    if (!account?.ok) return { ok: false, reason: 'RISK_DATA_UNAVAILABLE' };
    if (nativeWei != null && nativeWei <= 0n) return { ok: false, reason: 'INSUFFICIENT_GAS' };

    const checks = ['signer', 'account', 'gas'];
    const first = steps[0];
    let firstSimulation = null;

    if (first.id === 'supply' && first.fixedAmount) {
      const balance = await readBalance(collateral);
      if (balance == null) return { ok: false, reason: 'BALANCE_UNKNOWN' };
      const amount = big(first.amountWei);
      if (amount == null || amount <= 0n) return { ok: false, reason: 'AMOUNT_REQUIRED' };
      if (balance < amount) return { ok: false, reason: 'INSUFFICIENT_BALANCE' };
      const allowance = await readAllowance(collateral);
      const id = allowance != null && allowance >= amount ? 'supply' : 'approve';
      firstSimulation = await simulateLending(collateral, id, amount);
      if (!firstSimulation.ok) return firstSimulation;
      checks.push(`simulated:${id}`);
    } else if (first.id === 'borrow') {
      const prep = await prepareBorrow(first);
      if (!prep.ok) return { ok: false, reason: prep.code, detail: prep.detail ?? null };
      if (prep.finish) return { ok: false, reason: 'NOTHING_TO_BORROW' };
      firstSimulation = await simulateLending(borrow, 'borrow', prep.amountWei);
      if (!firstSimulation.ok) return firstSimulation;
      checks.push('simulated:borrow');
    }

    /* A swap leg is checked for a route BEFORE the user commits the first
       supply or borrow: discovering "no route" after borrowing would leave a
       position the user did not ask for. */
    const swapStep = steps.find((s) => s.id === 'swap');
    if (swapStep) {
      const prices = await readPrices([borrow, collateral]);
      const fromPrice = num(prices?.[borrow.id]?.usd);
      const toPrice = num(prices?.[collateral.id]?.usd);
      if (!(fromPrice > 0) || !(toPrice > 0)) return { ok: false, reason: 'ORACLE_PRICE_UNAVAILABLE' };
      const probeWei = big(resolved[swapStep.amountFromKey]?.amountWei)
        ?? big(prepared[swapStep.amountFromKey]?.amountWei)
        ?? usdToWei(swapStep.projectedUsd, fromPrice, borrowDecimals);
      const amountIn = weiToDecimalString(probeWei, borrowDecimals);
      if (!amountIn) return { ok: false, reason: 'AMOUNT_REQUIRED' };
      let quote;
      try {
        quote = await deps.getQuote({
          ...ctx, fromToken: borrow, toToken: collateral, amountIn,
          slippage: settings.slippagePct, fromAddress: wallet
        });
      } catch (error) { quote = { error: loopErrorCode(error, 'QUOTE_FAILED') }; }
      if (!quote || quote.error) return { ok: false, reason: 'NO_SWAP_ROUTE', detail: quote?.error || null };
      const assessment = assessSwapQuote({
        quote, fromPriceUsd: fromPrice, toPriceUsd: toPrice,
        fromDecimals: borrowDecimals, toDecimals: collateralDecimals,
        slippagePct: settings.slippagePct, feeBps: swapFeeBps
      });
      if (!assessment.ok) return { ok: false, reason: assessment.code, detail: assessment };
      checks.push('swap-route');
    }

    return {
      ok: true,
      provenSafe: true,
      status: 'preflight-clean',
      checks,
      healthFactor: account.healthFactor ?? null,
      nativeWei: nativeWei != null ? nativeWei.toString() : null,
      gasLimit: firstSimulation?.totalGasLimit ?? firstSimulation?.steps?.[0]?.gasLimit ?? null,
      checkedAt: now()
    };
  }

  /* ── PER-STEP RISK ──────────────────────────────────────────────────────── */

  async function readRisk(step) {
    if (step.id === 'borrow') {
      const p = prepared[step.key];
      if (!p?.account?.ok) return { ok: false, code: 'RISK_DATA_UNAVAILABLE' };
      return {
        ok: true,
        healthFactor: p.projectedHealthFactor,
        debtUsd: Number(p.account.totalDebtUsd) + Number(p.amountUsd || 0),
        minHealthFactor: settings.minHealthFactor,
        currentHealthFactor: p.account.healthFactor ?? null
      };
    }
    let account;
    try { account = await readAccount(); } catch { account = null; }
    if (!account?.ok) {
      /* A supply can only raise the health factor, so an unreadable account
         does not block it — the supply's own simulation still must pass. */
      if (step.id === 'supply') return { ok: true, floorExempt: true, healthFactor: null, debtUsd: null };
      return { ok: false, code: 'RISK_DATA_UNAVAILABLE' };
    }
    const debt = Number(account.totalDebtUsd);
    const hf = debt > 0 ? num(account.healthFactor) : null;
    if (step.id === 'swap') {
      /* Between a borrow and its supply the position is at its most
         leveraged; it must not already be liquidatable. */
      return { ok: true, healthFactor: hf, debtUsd: debt, minHealthFactor: 1 };
    }
    return { ok: true, floorExempt: true, healthFactor: hf, debtUsd: debt };
  }

  /* ── SWAP QUOTE ─────────────────────────────────────────────────────────── */

  async function getFreshQuote(step) {
    const amountWei = big(prepared[step.key]?.amountWei);
    if (amountWei == null || amountWei <= 0n) return { ok: false, code: 'PREVIOUS_STEP_UNRESOLVED' };
    const amountIn = weiToDecimalString(amountWei, borrowDecimals);
    let quote;
    try {
      quote = await deps.getQuote({
        ...ctx, fromToken: borrow, toToken: collateral, amountIn,
        slippage: settings.slippagePct, fromAddress: wallet
      });
    } catch (error) { return { ok: false, code: loopErrorCode(error, 'QUOTE_FAILED') }; }
    if (!quote) return { ok: false, code: 'QUOTE_UNAVAILABLE' };
    if (quote.error) return { ok: false, code: quote.error === 'NO_ROUTE' ? 'NO_SWAP_ROUTE' : String(quote.error) };
    if (big(quote.amountInWei) !== amountWei) return { ok: false, code: 'QUOTE_AMOUNT_MISMATCH' };
    const protection = verifyQuoteProtection({ quote, slippagePct: settings.slippagePct });
    if (!protection.ok) return { ok: false, code: protection.code };
    return {
      ok: true,
      quote,
      quotedAt: now(),
      metadata: {
        amountInWei: amountWei.toString(),
        amountOutWei: big(quote.amountOutWei)?.toString() ?? null,
        minOutWei: big(quote.minOutWei)?.toString() ?? null,
        platformFeeWei: big(quote.platformFeeWei)?.toString() ?? null,
        feeBps: quote.feeBps ?? swapFeeBps,
        source: quote.selectedSolver || quote.source || null,
        fromSymbol: borrow.symbol,
        toSymbol: collateral.symbol,
        fromDecimals: borrowDecimals,
        toDecimals: collateralDecimals
      }
    };
  }

  async function simulateRemaining(remaining, step, quote) {
    const prices = await readPrices([borrow, collateral]);
    const assessment = assessSwapQuote({
      quote,
      fromPriceUsd: prices?.[borrow.id]?.usd,
      toPriceUsd: prices?.[collateral.id]?.usd,
      fromDecimals: borrowDecimals,
      toDecimals: collateralDecimals,
      slippagePct: settings.slippagePct,
      feeBps: swapFeeBps
    });
    if (!assessment.ok) return { ok: false, reason: assessment.code, detail: assessment };
    let account = null;
    try { account = await readAccount(); } catch { account = null; }
    const projectedHealthFactor = account?.ok
      ? projectHealthAfterSupply({ account, addUsd: assessment.minOutUsd, addLtPct: collateralLtPct })
      : null;
    return {
      ok: true,
      provenSafe: true,
      status: 'quote-verified',
      assessment,
      projectedHealthFactor,
      remainingSteps: Array.isArray(remaining) ? remaining.length : null
    };
  }

  /* ── PER-STEP SIMULATION ────────────────────────────────────────────────── */

  async function simulateStep(step, quote) {
    const p = prepared[step.key];
    const amount = big(p?.amountWei);
    if (amount == null || amount <= 0n) return { ok: false, reason: 'PREVIOUS_STEP_UNRESOLVED' };
    if (step.id === 'borrow') return simulateLending(borrow, 'borrow', amount);
    if (step.id === 'supply') {
      const allowance = await readAllowance(collateral);
      if (allowance == null) return { ok: false, reason: 'ALLOWANCE_UNREADABLE' };
      const needsApproval = allowance < amount;
      p.needsApproval = needsApproval;
      /* Before the allowance exists the supply itself cannot be eth_call'ed;
         the approval is simulated now and the supply right after it confirms. */
      const sim = await simulateLending(collateral, needsApproval ? 'approve' : 'supply', amount);
      return sim.ok ? { ...sim, needsApproval, simulatedStep: needsApproval ? 'approve' : 'supply' } : sim;
    }
    if (step.id === 'swap') {
      if (!quote) return { ok: false, reason: 'QUOTE_UNAVAILABLE' };
      if (big(quote.amountInWei) !== amount) return { ok: false, reason: 'QUOTE_AMOUNT_MISMATCH' };
      let needsApproval;
      try {
        needsApproval = await deps.swapNeedsApproval({ ...ctx, token: borrow, owner: wallet, amountWei: amount, quote });
      } catch { return { ok: false, reason: 'ALLOWANCE_UNREADABLE' }; }
      p.needsApproval = Boolean(needsApproval);
      /* The swap's protection is on-chain: the router reverts below minOut.
         The quote was verified (age, min-out vs slippage, oracle loss bound)
         and reviewed by the user before this point. */
      return { ok: true, provenSafe: true, status: 'quote-verified', needsApproval: Boolean(needsApproval) };
    }
    return { ok: false, reason: 'UNKNOWN_STEP' };
  }

  /* ── EXECUTION ──────────────────────────────────────────────────────────── */

  async function executeBorrow(step) {
    const p = prepared[step.key];
    const sent = await sendLending(borrow, 'borrow', p.amountWei);
    if (!sent.ok) return sent;
    resolved[step.key] = { amountWei: p.amountWei, hash: sent.hash };
    return { ok: true, hash: sent.hash, amountWei: p.amountWei };
  }

  async function executeSupply(step) {
    const p = prepared[step.key];
    const amount = big(p.amountWei);
    let approvalHash = null;
    const accountBefore = await Promise.resolve().then(readAccount).catch(() => null);
    const allowance = await readAllowance(collateral);
    if (allowance == null || allowance < amount) {
      const approval = await sendLending(collateral, 'approve', amount);
      if (!approval.ok) return { ...approval, code: approval.code || 'APPROVE_FAILED' };
      approvalHash = approval.hash;
      const guard = await guardSigner();
      if (!guard.ok) return { ok: false, code: guard.code, approvalHash };
      await pollUntil(() => readAllowance(collateral), (v) => v != null && v >= amount);
      const sim = await simulateLending(collateral, 'supply', amount);
      if (!sim.ok) return { ok: false, code: sim.reason, detail: sim.revertReason, approvalHash };
    }
    const sent = await sendLending(collateral, 'supply', amount);
    if (!sent.ok) return { ...sent, approvalHash };
    /* The next borrow must size itself from an account that already counts
       this supply (98%: oracle ticks between the two reads). */
    const suppliedUsd = weiToUsd(amount, market.collateralPriceUsd, collateralDecimals);
    expectCollateralUsdAtLeast = accountBefore?.ok && suppliedUsd != null
      ? Number(accountBefore.totalCollateralUsd) + suppliedUsd * 0.98
      : null;
    resolved[step.key] = { amountWei: amount.toString(), hash: sent.hash, approvalHash };
    return { ok: true, hash: sent.hash, amountWei: amount.toString(), approvalHash };
  }

  async function executeSwapStep(step, quote) {
    const p = prepared[step.key];
    const amount = big(p.amountWei);
    if (!quote || big(quote.amountInWei) !== amount) return { ok: false, code: 'QUOTE_AMOUNT_MISMATCH' };
    const before = await readBalance(collateral);
    let approvalHash = null;
    try {
      const needs = await deps.swapNeedsApproval({ ...ctx, token: borrow, owner: wallet, amountWei: amount, quote });
      if (needs) {
        const approval = await deps.approveSwap({ ...ctx, token: borrow, amountWei: amount, quote });
        approvalHash = approval?.hash ?? null;
        const receipt = await approval?.wait?.();
        if (Number(receipt?.status ?? 1) !== 1) return { ok: false, code: 'APPROVE_FAILED', hash: approvalHash };
        const guard = await guardSigner();
        if (!guard.ok) return { ok: false, code: guard.code, approvalHash };
      }
    } catch (error) {
      return { ok: false, code: loopErrorCode(error, 'APPROVE_FAILED'), approvalHash };
    }

    let tx;
    try {
      tx = await deps.executeSwap({ ...ctx, fromToken: borrow, toToken: collateral, quote });
    } catch (error) {
      return { ok: false, code: loopErrorCode(error, 'SWAP_FAILED'), approvalHash };
    }
    let receipt;
    try { receipt = await tx?.wait?.(); }
    catch (error) { return { ok: false, code: loopErrorCode(error, 'TRANSACTION_REVERTED'), hash: tx?.hash ?? null, approvalHash }; }
    if (!tx?.hash) return { ok: false, code: 'SWAP_FAILED', approvalHash };
    if (Number(receipt?.status ?? 1) !== 1) return { ok: false, code: 'TRANSACTION_REVERTED', hash: tx.hash, approvalHash };

    /* What the swap really delivered: the balance delta, bounded by the quote
       (an unrelated incoming transfer must not be supplied as if it were the
       swap's output). If the balance cannot be read, the on-chain minimum —
       which the router guaranteed — is used; the supply step re-reads the
       wallet and caps at what is really there either way. */
    const after = await pollUntil(() => readBalance(collateral), (v) => v != null && (before == null || v > before));
    const minOut = big(quote.minOutWei) ?? 0n;
    const outCeiling = ((big(quote.amountOutWei) ?? minOut) * 102n) / 100n;
    let received = before != null && after != null && after > before ? after - before : null;
    if (received == null) received = after != null && after < minOut ? after : minOut;
    if (received > outCeiling) received = outCeiling;
    resolved[step.key] = { amountWei: amount.toString(), receivedWei: received.toString(), hash: tx.hash, approvalHash };
    return { ok: true, hash: tx.hash, amountWei: amount.toString(), receivedWei: received.toString(), approvalHash };
  }

  async function executeStep(step, quote) {
    const p = prepared[step.key];
    if (!p?.amountWei) return { ok: false, code: 'PREVIOUS_STEP_UNRESOLVED' };
    const guard = await guardSigner();
    if (!guard.ok) return { ok: false, code: guard.code };
    try {
      if (step.id === 'borrow') return await executeBorrow(step);
      if (step.id === 'supply') return await executeSupply(step);
      if (step.id === 'swap') return await executeSwapStep(step, quote);
      return { ok: false, code: 'UNKNOWN_STEP' };
    } catch (error) {
      return { ok: false, code: loopErrorCode(error) };
    }
  }

  return {
    prepareStep,
    simulatePlan,
    readRisk,
    getFreshQuote,
    simulateRemaining,
    simulateStep,
    executeStep,
    /** Read-only views for the UI and tests. */
    resolved: () => ({ ...resolved }),
    prepared: () => ({ ...prepared })
  };
}

#!/usr/bin/env node
/**
 * AAVE V3 · BASE MAINNET FORK PROBE — the acceptance test for the supply adapter.
 * ---------------------------------------------------------------------------
 *   npm run test:aave-base-fork
 *   node test/aave-base-fork-probe.mjs            (skips cleanly with no anvil)
 *   node test/aave-base-fork-probe.mjs --strict   (fails instead of skipping)
 *
 * ─── WHY A FORK AND NOT TESTNET ─────────────────────────────────────────────
 * Base Sepolia carries a DIFFERENT Aave deployment: different Pool, different
 * aToken, different caps, and USDC there is a test asset with no real market.
 * A green run on Sepolia would prove the code talks to *an* Aave; it would not
 * prove it talks to the one this adapter pins. Forking Base mainnet state
 * exercises the exact contracts, the exact reserve configuration and the exact
 * aToken, with no real funds at risk. This probe — not testnet — is the
 * acceptance test in docs/defi/aave-v3-base.md.
 *
 * ─── WHAT IT RUNS ───────────────────────────────────────────────────────────
 * The REAL adapter from src/lib/defi/aaveV3Base.js, bundled by Vite so the
 * extensionless imports and import.meta.env resolve exactly as they do in the
 * app (see test/aave-base-fork-adapter.mjs). Nothing about the transaction is
 * re-implemented here: the calldata the fork sees is the calldata the user's
 * wallet would be asked to sign.
 *
 *   1. verifyDeployment() agrees with the forked chain
 *   2. getReserveStatus() decodes the live USDC reserve
 *   3. buildSupplyPlan(5) → approve EXACTLY 5 USDC, then supply
 *   4. both transactions land; the position reflects the supply
 *   5. buildWithdrawPlan('max') → one step, MaxUint256
 *   6. the withdraw lands; the aToken balance is zero
 *   7. explainRevert maps REAL on-chain reverts (a zero-amount supply and an
 *      over-withdraw, fired with eth_call) to i18n keys — in whichever revert
 *      era the forked pool runs (numeric code ≤ v3.3, custom error v3.4+)
 *
 * ─── REQUIREMENTS ───────────────────────────────────────────────────────────
 * `anvil` (Foundry) on PATH and an RPC that can serve Base mainnet state. This
 * repository has no hardhat/foundry tooling in package.json, so the probe is
 * NOT wired into `npm test` or CI: it self-skips with a printed, copy-pasteable
 * command when anvil is absent. Install Foundry with:
 *
 *     curl -L https://foundry.paradigm.xyz | bash && foundryup
 *
 * and run it against any Base archive-capable RPC:
 *
 *     BASE_RPC_URL=https://mainnet.base.org node test/aave-base-fork-probe.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { execSync } from 'node:child_process';
import { Wallet, JsonRpcProvider, Contract, Interface, MaxUint256, formatUnits } from 'ethers';

const PORT = Number(process.env.ANVIL_PORT || 8551);
const EXPLICIT_RPC = String(process.env.BASE_RPC_URL ?? '').trim();
const RPC = EXPLICIT_RPC || 'https://mainnet.base.org';
const STRICT = process.argv.includes('--strict');
const ANVIL_ACCOUNT_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const rows = [];
const t = (name, ok, detail = '') => {
  rows.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`);
};
const rule = (title) => console.log(`\n${'─'.repeat(78)}\n${title}\n${'─'.repeat(78)}`);

function haveAnvil() {
  try {
    execFileSync('anvil', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

let anvil = null;
let exitCode = 0;

try {
  rule('Aave v3 · Base (8453) · USDC — mainnet fork probe');

  if (STRICT && !EXPLICIT_RPC) {
    t('BASE_RPC_URL provided (--strict)', false, 'missing; strict evidence requires an explicit read-only fork RPC');
    exitCode = 1;
  } else if (!haveAnvil()) {
    console.log(`\n⏭  SKIPPED — 'anvil' is not on PATH.\n
    This probe is the acceptance test for the Aave Base supply adapter, so it
    must be run by hand before the flag is enabled. Exact commands:

      curl -L https://foundry.paradigm.xyz | bash && foundryup
      BASE_RPC_URL=${RPC} node test/aave-base-fork-probe.mjs --strict
`);
    if (STRICT) {
      t('anvil available (--strict)', false, 'not found on PATH');
      exitCode = 1;
    }
  } else {
    /* ── start the fork ───────────────────────────────────────────────────── */
    console.log(`forking ${RPC} on 127.0.0.1:${PORT} …`);
    anvil = spawn('anvil', [
      '--fork-url', RPC,
      '--chain-id', '8453',
      '--port', String(PORT),
      '--accounts', '1',
      '--silent'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const url = `http://127.0.0.1:${PORT}`;
    const up = await (async () => {
      for (let i = 0; i < 60; i += 1) {
        try {
          if (await rpc(url, 'eth_blockNumber', [])) return true;
        } catch { /* still booting */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    })();
    if (!up) throw new Error('anvil did not come up within 30s');
    t('anvil fork of Base mainnet is serving', true, url);

    const provider = new JsonRpcProvider(url, 8453, { staticNetwork: true });
    const signer = new Wallet(ANVIL_ACCOUNT_KEY, provider);

    /* The bundle is built from the real source; import it AFTER anvil is up so
       a failed fork does not look like a failed adapter. */
    execSync('npx vite build -c test/vite.aavefork.mjs --logLevel error', { stdio: 'ignore' });
    const adapter = await import('./.out/aavefork/aave-base-fork-adapter.js');
    const { AAVE_V3_BASE } = adapter;

    rule('0 · pinned constants and shipped defaults');
    t('flag ships OFF in this bundle', adapter.AAVE_BASE_SUPPLY_ENABLED === false);
    t('per-tx cap is the shipped 100 USDC', adapter.AAVE_BASE_SUPPLY_MAX_USDC_PER_TX === 100,
      `got ${adapter.AAVE_BASE_SUPPLY_MAX_USDC_PER_TX}`);
    t('total cap is the shipped 500 USDC', adapter.AAVE_BASE_SUPPLY_MAX_USDC_TOTAL === 500,
      `got ${adapter.AAVE_BASE_SUPPLY_MAX_USDC_TOTAL}`);

    /* ── fund the test account ────────────────────────────────────────────── */
    rule('1 · funding the test account from forked state');
    /*
     * On a fork every account keeps its REAL Base state: the protocol
     * contracts hold USDC but — being contracts — no ETH to pay gas, and the
     * anvil dev account's ETH is whatever Base says it is. First give the
     * accounts a little ETH from thin air (anvil_setBalance touches only the
     * local fork, never mainnet); then get USDC into the test account by
     * impersonating the USDC minter and minting on the fork (mint is how USDC
     * enters circulation — no whale address hardcoded, none kept current).
     * If minting is not enabled in the forked state, fall back to moving
     * tokens from whichever of the pinned protocol contracts actually holds
     * the reserve's USDC (aBasUSDC in v3; the Pool in some deployments).
     */
    await rpc(url, 'anvil_setBalance', [AAVE_V3_BASE.aUsdc, '0xDE0B6B3A7640000']); // 1 ETH — gas if aToken has to move its own balance
    await rpc(url, 'anvil_setBalance', [ANVIL_ACCOUNT, '0xDE0B6B3A7640000']);     // 1 ETH — gas for approve/supply/withdraw
    // The dev key is a REAL address on Base and has sent real transactions
    // there (its mainnet nonce is ~3.4M), so anvil's pending-nonce accounting
    // for it is unreliable across consecutive local sends (observed: approve
    // mined, then supply rejected as "nonce too low"). Reset the nonce in the
    // LOCAL fork state and drive every send with explicit sequential nonces.
    await rpc(url, 'anvil_setNonce', [ANVIL_ACCOUNT, '0x0']);
    let nextNonce = 0;

    const usdc = new Contract(AAVE_V3_BASE.usdc, [
      'function balanceOf(address) view returns (uint256)',
      'function minter() view returns (address)',
      'function mint(address,uint256) returns (bool)',
      'function transfer(address,uint256) returns (bool)'
    ], provider);

    const fundingErrors = [];
    let fundedVia = null;
    const tryFund = async (label, fn) => {
      if (fundedVia) return;
      try {
        const hash = await fn();
        if (hash) fundedVia = label;
      } catch (err) {
        fundingErrors.push(`${label}: ${err.message}`);
      }
    };
    await tryFund('mint (impersonating the USDC minter)', async () => {
      const minter = await usdc.minter();
      await rpc(url, 'anvil_impersonateAccount', [minter]);
      try {
        return await rpc(url, 'eth_sendTransaction', [{
          from: minter,
          to: AAVE_V3_BASE.usdc,
          data: usdc.interface.encodeFunctionData('mint', [ANVIL_ACCOUNT, 1_000_000_000n])
        }]);
      } finally {
        await rpc(url, 'anvil_stopImpersonatingAccount', [minter]);
      }
    });
    for (const holder of [AAVE_V3_BASE.aUsdc, AAVE_V3_BASE.pool]) {
      await tryFund(`transfer from ${holder === AAVE_V3_BASE.aUsdc ? 'aBasUSDC' : 'Pool'}`, async () => {
        await rpc(url, 'anvil_impersonateAccount', [holder]);
        try {
          return await rpc(url, 'eth_sendTransaction', [{
            from: holder,
            to: AAVE_V3_BASE.usdc,
            data: usdc.interface.encodeFunctionData('transfer', [ANVIL_ACCOUNT, 1_000_000_000n])
          }]);
        } finally {
          await rpc(url, 'anvil_stopImpersonatingAccount', [holder]);
        }
      });
    }
    const walletUsdc = await usdc.balanceOf(ANVIL_ACCOUNT);
    if (!fundedVia) {
      const aTokenHeld = await usdc.balanceOf(AAVE_V3_BASE.aUsdc);
      const poolHeld = await usdc.balanceOf(AAVE_V3_BASE.pool);
      let minter = 'n/a';
      try { minter = await usdc.minter(); } catch { /* read-only probe of the probe */ }
      throw new Error(
        `funding failed (${fundingErrors.join(' | ')}) — for diagnostics: aBasUSDC holds ${formatUnits(aTokenHeld, 6)} USDC, Pool holds ${formatUnits(poolHeld, 6)} USDC, minter ${minter}`
      );
    }
    t('test account funded with USDC on the fork', walletUsdc >= 1_000_000_000n,
      `${fundedVia} → ${formatUnits(walletUsdc, 6)} USDC`);

    /* ── 2. deployment verification against real state ─────────────────────── */
    rule('2 · verifyDeployment against the forked chain');
    const evidence = await adapter.verifyDeployment(provider);
    t('PoolAddressesProvider.getPool() equals the pinned Pool', evidence.ok === true && evidence.pool === AAVE_V3_BASE.pool);
    t('the USDC reserve names the pinned aBasUSDC',
      evidence.verifiedVia === 'pool.getReserveData' || evidence.verifiedVia === 'atoken.self-report',
      `via ${evidence.verifiedVia}`);
    t('ReserveData decoded with a declared struct layout',
      Boolean(evidence.reserveDataShape), `shape ${evidence.reserveDataShape ?? 'n/a'}`);

    /* ── 3. live reserve state ─────────────────────────────────────────────── */
    rule('3 · getReserveStatus');
    const status = await adapter.getReserveStatus(provider);
    t('the USDC reserve is active', status.active === true);
    t('...not paused', status.paused === false);
    t('...not frozen', status.frozen === false);
    t('reserve decimals read as 6', status.decimals === 6);
    t('supply APY decoded from the ray liquidity rate',
      Number.isFinite(status.supplyApyPct) && status.supplyApyPct >= 0 && status.supplyApyPct < 100,
      `${status.supplyApyPct.toFixed(4)}%`);
    t('supply cap decoded from the configuration bitmap',
      status.supplyCapUsdc == null || status.supplyCapUsdc > 0n,
      status.supplyCapUsdc == null ? 'no cap configured' : `${formatUnits(status.supplyCapUsdc, 6)} USDC`);

    /* ── 4. supply 5 USDC ──────────────────────────────────────────────────── */
    rule('4 · buildSupplyPlan(5) and execution');
    const native = await provider.getBalance(ANVIL_ACCOUNT);
    const supplyPlan = await adapter.buildSupplyPlan({
      provider, owner: ANVIL_ACCOUNT, amountUsdc: '5',
      nativeBalance: native
    });
    t('no check blocked the plan', supplyPlan.checks.blocked.length === 0,
      supplyPlan.checks.blocked.join(', ') || 'none');
    t('two unsigned steps: approve then supply',
      supplyPlan.steps.map((s) => s.kind).join(',') === 'approve,supply',
      supplyPlan.steps.map((s) => s.kind).join(' → '));
    t('every step carries value 0', supplyPlan.steps.every((s) => s.value === 0n));

    const approveValue = BigInt('0x' + supplyPlan.steps[0].data.slice(10 + 64, 10 + 128));
    t('the approval is for EXACTLY 5 USDC (not an unbounded allowance)',
      approveValue === 5_000_000n && approveValue !== MaxUint256, formatUnits(approveValue, 6));
    const onBehalf = '0x' + supplyPlan.steps[1].data.slice(10 + 128 + 24, 10 + 128 + 64);
    t('onBehalfOf is the connected account',
      onBehalf.toLowerCase() === ANVIL_ACCOUNT.toLowerCase());

    const hashes = [];
    const beforeSupplyPosition = await adapter.getPosition(provider, ANVIL_ACCOUNT);
    for (const step of supplyPlan.steps) {
      const simulation = await adapter.simulateGuardedStep({
        provider,
        owner: ANVIL_ACCOUNT,
        step,
        allowance: step.kind === 'supply'
          ? { token: AAVE_V3_BASE.usdc, owner: ANVIL_ACCOUNT, spender: AAVE_V3_BASE.pool, amountWei: supplyPlan.checks.amountWei }
          : undefined
      });
      t(`${step.kind} passed real eth_call and estimateGas`,
        simulation.status === 'simulated-clean' && simulation.provenSafe === true && simulation.gasLimit > 0n,
        `gas ${simulation.gasLimit}`);
      const context = await adapter.assertSignerContext(signer, { owner: ANVIL_ACCOUNT, chainId: AAVE_V3_BASE.chainId });
      t(`${step.kind} re-checked account and network before signing`,
        context.chainId === AAVE_V3_BASE.chainId && context.owner.toLowerCase() === ANVIL_ACCOUNT.toLowerCase());
      const tx = await signer.sendTransaction({ to: step.to, data: step.data, value: 0n, nonce: nextNonce++ });
      const receipt = await tx.wait();
      hashes.push(receipt.hash);
      t(`${step.kind} landed on the fork`, receipt.status === 1, receipt.hash.slice(0, 18));
      const proof = await adapter.verifyAaveReceipt({
        provider, receipt, owner: ANVIL_ACCOUNT, action: step.kind,
        amountWei: supplyPlan.checks.amountWei,
        beforePositionWei: step.kind === 'supply' ? beforeSupplyPosition.aTokenBalance : null
      });
      t(`${step.kind} receipt contains the expected event and proof`, proof.ok === true, proof.event);
    }

    /* ── 5. the position reflects it ───────────────────────────────────────── */
    rule('5 · getPosition after the supply');
    const aToken = new Contract(AAVE_V3_BASE.aUsdc, ['function balanceOf(address) view returns (uint256)'], provider);
    const afterSupply = await aToken.balanceOf(ANVIL_ACCOUNT);
    // aTokens accrue the reserve's liquidity index, so 5 USDC supplied mints
    // fewer than 5.000000 aToken units (4.999999 on Base today). The balance
    // never exceeds the deposit; allow up to 5% so a higher index on a later
    // run cannot fail the check. The point is that the supply landed, not the
    // exact unit count.
    t('the aToken balance reflects the 5 USDC supplied (dust-tolerant)',
      afterSupply > 0n && afterSupply <= 5_000_000n && 5_000_000n - afterSupply <= 250_000n,
      formatUnits(afterSupply, 6));
    const position = await adapter.getPosition(provider, ANVIL_ACCOUNT);
    t('getPosition reports the supplied amount', position.suppliedUsdc === afterSupply,
      `${formatUnits(position.suppliedUsdc, 6)} USDC`);
    t('health factor is null because there is no debt', position.healthFactor === null);
    t('accrued-since is null with no local records (never estimated from the APY)',
      position.accruedSinceUsdc === null);

    /* ── 6. withdraw everything ────────────────────────────────────────────── */
    rule("6 · buildWithdrawPlan('max') and execution");
    const withdrawPlan = await adapter.buildWithdrawPlan({
      provider, owner: ANVIL_ACCOUNT, amountUsdc: 'max'
    });
    t('a single withdraw step', withdrawPlan.steps.length === 1);
    const wAmount = BigInt('0x' + withdrawPlan.steps[0].data.slice(10 + 64, 10 + 128));
    t("'max' encodes as MaxUint256, as Aave expects", wAmount === MaxUint256);
    const wTo = '0x' + withdrawPlan.steps[0].data.slice(10 + 128 + 24, 10 + 128 + 64);
    t('the recipient is the connected account', wTo.toLowerCase() === ANVIL_ACCOUNT.toLowerCase());

    const beforeWithdrawPosition = await adapter.getPosition(provider, ANVIL_ACCOUNT);
    const withdrawSimulation = await adapter.simulateGuardedStep({
      provider, owner: ANVIL_ACCOUNT, step: withdrawPlan.steps[0]
    });
    t('withdraw passed real eth_call and estimateGas',
      withdrawSimulation.status === 'simulated-clean' && withdrawSimulation.provenSafe === true && withdrawSimulation.gasLimit > 0n,
      `gas ${withdrawSimulation.gasLimit}`);
    const withdrawContext = await adapter.assertSignerContext(signer, {
      owner: ANVIL_ACCOUNT, chainId: AAVE_V3_BASE.chainId
    });
    t('withdraw re-checked account and network before signing',
      withdrawContext.chainId === AAVE_V3_BASE.chainId
        && withdrawContext.owner.toLowerCase() === ANVIL_ACCOUNT.toLowerCase());
    const wTx = await signer.sendTransaction({
      to: withdrawPlan.steps[0].to, data: withdrawPlan.steps[0].data, value: 0n, nonce: nextNonce++
    });
    const wReceipt = await wTx.wait();
    t('the withdraw landed on the fork', wReceipt.status === 1, wReceipt.hash.slice(0, 18));
    const withdrawProof = await adapter.verifyAaveReceipt({
      provider, receipt: wReceipt, owner: ANVIL_ACCOUNT, action: 'withdraw',
      amountWei: withdrawPlan.checks.amountWei, beforePositionWei: beforeWithdrawPosition.aTokenBalance
    });
    t('the withdraw receipt contains the expected event and position proof', withdrawProof.ok === true, withdrawProof.event);

    const afterWithdraw = await aToken.balanceOf(ANVIL_ACCOUNT);
    t('the aToken balance is back to zero', afterWithdraw === 0n, formatUnits(afterWithdraw, 6));
    const finalUsdc = await usdc.balanceOf(ANVIL_ACCOUNT);
    // The full round-trip (1000 → −5 supply → +aToken×index withdraw) can be a
    // few base units short because aToken units round DOWN to 6 decimals
    // (5 USDC → 4.999999 aToken → 4.999999 USDC back). Allow sub-cent dust.
    t('the USDC is back in the wallet (within dust rounding)',
      finalUsdc + 1_000n >= walletUsdc,
      `${formatUnits(finalUsdc, 6)} USDC (Δ ${formatUnits(finalUsdc - walletUsdc, 6)})`);

    /* ── 7. revert mapping against a real revert ───────────────────────────── */
    rule('7 · explainRevert against a real on-chain revert');
    /*
     * Aave changed how it reverts: instances on v3.0.x–v3.3 revert with the
     * numeric Error(string) codes ("26"), instances on v3.4+ revert with the
     * equivalent custom error (InvalidAmount()). Which one THIS fork answers
     * with is decided by the chain, not by us — so the check is
     * version-agnostic: the revert must be real, and explainRevert must map
     * it to the right i18n key either way.
     */
    const poolIface = new Interface([
      'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
      'function withdraw(address asset, uint256 amount, address to)'
    ]);
    const ethCallRevert = async (data) => {
      try {
        // `from` is explicit: anvil's default caller (0x0) can hold real
        // aToken dust on a mainnet fork, which would make an over-withdraw
        // from it succeed instead of reverting. We know ANVIL_ACCOUNT's
        // position is exactly zero (measured above), so the over-withdraw is
        // evaluated against a provably empty position.
        await provider.call({ from: ANVIL_ACCOUNT, to: AAVE_V3_BASE.pool, data });
        return null; // no revert — the caller decides what that means
      } catch (err) {
        return err;
      }
    };
    const zeroSupply = await ethCallRevert(poolIface.encodeFunctionData('supply', [
      AAVE_V3_BASE.usdc, 0n, ANVIL_ACCOUNT, AAVE_V3_BASE.referralCode
    ]));
    const zeroSupplyExplained = zeroSupply ? adapter.explainRevert(zeroSupply) : null;
    t('a zero-amount supply really reverts on the fork', Boolean(zeroSupply));
    t('explainRevert maps it to the invalid-amount key (code 26 or InvalidAmount)',
      zeroSupplyExplained?.known === true
        && (zeroSupplyExplained.code === '26' || zeroSupplyExplained.code === null)
        && zeroSupplyExplained.key === 'farm.aave.err.invalidAmount',
      zeroSupplyExplained ? `${zeroSupplyExplained.code ?? 'custom'}: ${zeroSupplyExplained.key}` : 'no revert');

    const overWithdraw = await ethCallRevert(poolIface.encodeFunctionData('withdraw', [
      AAVE_V3_BASE.usdc, 1n, ANVIL_ACCOUNT
    ]));
    const overWithdrawExplained = overWithdraw ? adapter.explainRevert(overWithdraw) : null;
    t('withdrawing past an empty position really reverts on the fork', Boolean(overWithdraw));
    t('explainRevert maps it to the not-enough-balance key (code 32 or custom)',
      overWithdrawExplained?.known === true
        && (overWithdrawExplained.code === '32' || overWithdrawExplained.code === null)
        && overWithdrawExplained.key === 'farm.aave.err.notEnoughBalance',
      overWithdrawExplained ? `${overWithdrawExplained.code ?? 'custom'}: ${overWithdrawExplained.key}` : 'no revert');

    try {
      const tooMuch = await adapter.buildSupplyPlan({
        provider, owner: ANVIL_ACCOUNT, amountUsdc: String(adapter.AAVE_BASE_SUPPLY_MAX_USDC_PER_TX + 1),
        nativeBalance: await provider.getBalance(ANVIL_ACCOUNT)
      });
      t('the per-tx cap refused an over-cap supply on the fork',
        tooMuch.steps.length === 0 && tooMuch.checks.blocked.includes('AAVE_PER_TX_CAP'),
        tooMuch.checks.blocked.join(', '));
    } catch (err) {
      t('the per-tx cap refused an over-cap supply on the fork', false, err.message);
    }

    /* ── 8. wallet lifecycle failures stay distinct ──────────────────────── */
    rule('8 · account/network/rejection/timeout/replacement taxonomy');
    let changedAccount = null;
    try {
      await adapter.assertSignerContext({
        provider,
        getAddress: async () => '0x2222222222222222222222222222222222222222'
      }, { owner: ANVIL_ACCOUNT, chainId: AAVE_V3_BASE.chainId });
    } catch (err) {
      changedAccount = err;
    }
    t('an account change before signing is rejected separately',
      changedAccount?.code === 'EXECUTION_ACCOUNT_CHANGED', changedAccount?.code ?? 'no rejection');

    let changedNetwork = null;
    try {
      await adapter.assertSignerContext({
        provider: { getNetwork: async () => ({ chainId: 1 }) },
        getAddress: async () => ANVIL_ACCOUNT
      }, { owner: ANVIL_ACCOUNT, chainId: AAVE_V3_BASE.chainId });
    } catch (err) {
      changedNetwork = err;
    }
    t('a network change before signing is rejected separately',
      changedNetwork?.code === 'EXECUTION_WRONG_CHAIN', changedNetwork?.code ?? 'no rejection');

    t('wallet rejection has its own recovery class',
      adapter.isUserRejection({ code: 4001, message: 'User rejected request' }) === true);

    let timeoutError = null;
    try {
      await adapter.waitForMinedReceipt({ hash: '0xpending', wait: () => new Promise(() => {}) }, { timeoutMs: 5 });
    } catch (err) {
      timeoutError = err;
    }
    t('a pending transaction timeout is not marked confirmed',
      timeoutError?.code === 'TRANSACTION_TIMEOUT' && adapter.isTransactionTimeout(timeoutError),
      timeoutError?.code ?? 'no timeout');

    const replacementReceipt = { status: 1, hash: '0xreplacement' };
    const replacement = await adapter.waitForMinedReceipt({
      hash: '0xoriginal',
      wait: async () => {
        throw {
          code: 'TRANSACTION_REPLACED',
          replacement: { hash: replacementReceipt.hash },
          receipt: replacementReceipt
        };
      }
    }, { timeoutMs: 50 });
    t('a mined replacement is recorded as replacement, not original success',
      replacement.replaced === true
        && replacement.replacementHash === replacementReceipt.hash
        && adapter.isTransactionReplacement({ code: 'TRANSACTION_REPLACED' }));
  }
} catch (err) {
  t('probe completed without an unexpected error', false, `${err?.name ?? 'Error'}: ${err?.message}`);
  exitCode = 1;
} finally {
  if (anvil) {
    anvil.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
  }
}

rule('result');
const failed = rows.filter((r) => !r.ok);
const w = Math.max(...rows.map((r) => r.name.length), 40);
for (const r of rows) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail}`);
}
console.log('─'.repeat(78));
console.log(`${rows.length - failed.length}/${rows.length} passed`);
process.exit(exitCode || (failed.length ? 1 : 0));

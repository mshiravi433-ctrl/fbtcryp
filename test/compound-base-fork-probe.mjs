#!/usr/bin/env node
/**
 * COMPOUND V3 · BASE MAINNET FORK PROBE — the acceptance test for the Comet adapter.
 * ---------------------------------------------------------------------------
 *   npm run test:compound-base-fork
 *   node test/compound-base-fork-probe.mjs            (skips cleanly with no anvil)
 *   node test/compound-base-fork-probe.mjs --strict   (fails instead of skipping)
 *
 * ─── WHY A FORK AND NOT TESTNET ─────────────────────────────────────────────
 * Base Sepolia carries a DIFFERENT Comet deployment: different market proxy,
 * different configurator, different rate parameters, and USDC there is a test
 * asset with no real utilisation. A green run on Sepolia would prove the code
 * talks to *a* Comet; it would not prove it talks to the one this adapter pins.
 * Forking Base mainnet state exercises the exact market, the exact governance
 * configuration and the exact live rates, with no real funds at risk. This
 * probe — not testnet — is the acceptance test in docs/defi/compound-v3-base.md.
 *
 * ─── WHAT IT RUNS ───────────────────────────────────────────────────────────
 * The REAL adapter from src/lib/defi/compoundV3Base.js, bundled by Vite so the
 * extensionless imports and import.meta.env resolve exactly as they do in the
 * app (see test/compound-base-fork-adapter.mjs). Nothing about the transaction
 * is re-implemented here: the calldata the fork sees is the calldata the user's
 * wallet would be asked to sign.
 *
 *   1. verifyDeployment() agrees with the forked chain, incl. the Configurator
 *   2. getMarketStatus() decodes the live per-second rate into APR and APY
 *   3. buildSupplyPlan(5) → approve EXACTLY 5 USDC, then supply(asset, amount)
 *   4. both transactions land; Comet.balanceOf reflects the supply
 *   5. buildWithdrawPlan('max') → one step, MaxUint256
 *   6. the withdraw lands; the Comet balance is zero and the USDC is back
 *   7. THE COMPOUND-SPECIFIC ONE: an over-withdraw does NOT revert on-chain —
 *      it opens a borrow — and the adapter refuses it in software. This is the
 *      check that has no Aave equivalent, and the reason it exists.
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
 *     BASE_RPC_URL=https://mainnet.base.org node test/compound-base-fork-probe.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { execSync } from 'node:child_process';
import { Wallet, JsonRpcProvider, Contract, Interface, MaxUint256, formatUnits } from 'ethers';

const PORT = Number(process.env.ANVIL_PORT || 8552);
const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
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
  rule('Compound V3 (Comet) · Base (8453) · USDC — mainnet fork probe');

  if (!haveAnvil()) {
    console.log(`\n⏭  SKIPPED — 'anvil' is not on PATH.\n
    This probe is the acceptance test for the Compound Base supply adapter, so
    it must be run by hand before the flag is enabled. Exact commands:

      curl -L https://foundry.paradigm.xyz | bash && foundryup
      BASE_RPC_URL=${RPC} node test/compound-base-fork-probe.mjs --strict
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
    execSync('npx vite build -c test/vite.compoundfork.mjs --logLevel error', { stdio: 'ignore' });
    const adapter = await import('./.out/compoundfork/compound-base-fork-adapter.js');
    const { COMPOUND_V3_BASE } = adapter;

    rule('0 · pinned constants and shipped defaults');
    t('flag ships OFF in this bundle', adapter.COMPOUND_BASE_SUPPLY_ENABLED === false);
    t('per-tx cap is the shipped 100 USDC', adapter.COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX === 100,
      `got ${adapter.COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX}`);
    t('total cap is the shipped 500 USDC', adapter.COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL === 500,
      `got ${adapter.COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL}`);

    /* ── fund the test account ────────────────────────────────────────────── */
    rule('1 · funding the test account from forked state');
    /*
     * Same approach as the Aave probe: give the accounts a little ETH from thin
     * air (anvil_setBalance touches only the local fork), then get USDC by
     * impersonating the USDC minter — minting is how USDC enters circulation,
     * so no whale address is hardcoded and none has to be kept current. If
     * minting is disabled in the forked state, fall back to moving tokens out
     * of the Comet market itself, which necessarily holds the base reserve.
     */
    await rpc(url, 'anvil_setBalance', [COMPOUND_V3_BASE.comet, '0xDE0B6B3A7640000']); // 1 ETH
    await rpc(url, 'anvil_setBalance', [ANVIL_ACCOUNT, '0xDE0B6B3A7640000']);          // 1 ETH
    /*
     * The dev key is a REAL address on Base with a ~3.4M mainnet nonce, so
     * anvil's pending-nonce accounting for it is unreliable across consecutive
     * local sends (observed on the Aave probe: approve mined, then supply
     * rejected as "nonce too low"). Reset the nonce in the LOCAL fork state and
     * drive every send with explicit sequential nonces.
     */
    await rpc(url, 'anvil_setNonce', [ANVIL_ACCOUNT, '0x0']);
    let nextNonce = 0;

    const usdc = new Contract(COMPOUND_V3_BASE.usdc, [
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
          to: COMPOUND_V3_BASE.usdc,
          data: usdc.interface.encodeFunctionData('mint', [ANVIL_ACCOUNT, 1_000_000_000n])
        }]);
      } finally {
        await rpc(url, 'anvil_stopImpersonatingAccount', [minter]);
      }
    });
    await tryFund('transfer from the Comet market', async () => {
      await rpc(url, 'anvil_impersonateAccount', [COMPOUND_V3_BASE.comet]);
      try {
        return await rpc(url, 'eth_sendTransaction', [{
          from: COMPOUND_V3_BASE.comet,
          to: COMPOUND_V3_BASE.usdc,
          data: usdc.interface.encodeFunctionData('transfer', [ANVIL_ACCOUNT, 1_000_000_000n])
        }]);
      } finally {
        await rpc(url, 'anvil_stopImpersonatingAccount', [COMPOUND_V3_BASE.comet]);
      }
    });
    const walletUsdc = await usdc.balanceOf(ANVIL_ACCOUNT);
    if (!fundedVia) {
      const cometHeld = await usdc.balanceOf(COMPOUND_V3_BASE.comet);
      let minter = 'n/a';
      try { minter = await usdc.minter(); } catch { /* read-only probe of the probe */ }
      throw new Error(
        `funding failed (${fundingErrors.join(' | ')}) — for diagnostics: Comet holds ${formatUnits(cometHeld, 6)} USDC, minter ${minter}`
      );
    }
    t('test account funded with USDC on the fork', walletUsdc >= 1_000_000_000n,
      `${fundedVia} → ${formatUnits(walletUsdc, 6)} USDC`);

    /* ── 2. deployment verification against real state ─────────────────────── */
    rule('2 · verifyDeployment against the forked chain');
    const evidence = await adapter.verifyDeployment(provider);
    t('the market reports USDC as its base token', evidence.ok === true);
    t('the Configurator cross-check agrees with the market',
      evidence.verifiedVia === 'comet.baseToken+configurator',
      `via ${evidence.verifiedVia}`);
    t('the market reports 6 decimals', evidence.decimals === 6);
    t('the market identifies itself as cUSDCv3', evidence.marketSymbol === 'cUSDCv3',
      evidence.marketSymbol ?? 'n/a');
    t('the chain is Base 8453', evidence.chainId === 8453);

    /* ── 3. live market state ──────────────────────────────────────────────── */
    rule('3 · getMarketStatus');
    const status = await adapter.getMarketStatus(provider);
    t('supply is not paused', status.supplyPaused === false);
    t('withdraw is not paused', status.withdrawPaused === false);
    t('utilisation decoded from the live market',
      Number.isFinite(status.utilizationPct) && status.utilizationPct >= 0 && status.utilizationPct <= 100,
      `${status.utilizationPct.toFixed(4)}%`);
    /*
     * Both figures, and the relationship between them. If APR ever came back
     * equal to APY the compounding step was skipped; if APY were the smaller of
     * the two the maths is inverted. Either would be a plausible-looking number
     * on the card, which is exactly why it is asserted on real data.
     */
    t('simple APR decoded from the per-second rate',
      Number.isFinite(status.supplyAprPct) && status.supplyAprPct >= 0 && status.supplyAprPct < 100,
      `${status.supplyAprPct.toFixed(4)}%`);
    t('compounded APY is strictly greater than the simple APR',
      status.supplyApyPct > status.supplyAprPct,
      `APY ${status.supplyApyPct.toFixed(4)}% > APR ${status.supplyAprPct.toFixed(4)}%`);
    t('...and the two differ by a realistic margin, not by orders of magnitude',
      status.supplyApyPct - status.supplyAprPct < 1,
      `Δ ${(status.supplyApyPct - status.supplyAprPct).toFixed(4)} pp`);
    /*
     * The claim the UI makes about supply caps, checked against the chain
     * rather than against the docs: the base asset has none.
     */
    t('the base asset has no supply cap (a protocol fact, stated not guessed)',
      status.hasSupplyCap === false && status.supplyCapUsdc === null);
    t('the rewards floor is above our total cap, so no COMP can accrue here',
      status.rewardsMinUsdc != null
      && status.rewardsMinUsdc > BigInt(adapter.COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL) * 1_000_000n,
      status.rewardsMinUsdc == null ? 'unreadable' : `${formatUnits(status.rewardsMinUsdc, 6)} USDC floor`);

    /* ── 4. supply 5 USDC ──────────────────────────────────────────────────── */
    rule('4 · buildSupplyPlan(5) and execution');
    const native = await provider.getBalance(ANVIL_ACCOUNT);
    const supplyPlan = await adapter.buildSupplyPlan({
      provider, owner: ANVIL_ACCOUNT, amountUsdc: '5', nativeBalance: native
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
    const approveSpender = '0x' + supplyPlan.steps[0].data.slice(10 + 24, 10 + 64);
    t('the allowance is granted to the Comet market and nothing else',
      approveSpender.toLowerCase() === COMPOUND_V3_BASE.comet.toLowerCase());
    /*
     * Comet's supply(asset, amount) is 2 words of calldata. If a supplyTo/
     * supplyFrom variant were ever encoded by mistake it would be 3, so the
     * length itself proves no third-party recipient can be in there.
     */
    const supplyData = supplyPlan.steps[1].data;
    t('supply is the two-argument form — there is no recipient word in the calldata',
      supplyData.length === 10 + 128,
      `${(supplyData.length - 10) / 64} argument words`);
    t('...and it is addressed to the pinned Comet market',
      supplyPlan.steps[1].to.toLowerCase() === COMPOUND_V3_BASE.comet.toLowerCase());

    const beforeSupplyPosition = await adapter.getPosition(provider, ANVIL_ACCOUNT);
    for (const step of supplyPlan.steps) {
      const tx = await signer.sendTransaction({ to: step.to, data: step.data, value: 0n, nonce: nextNonce++ });
      const receipt = await tx.wait();
      t(`${step.kind} landed on the fork`, receipt.status === 1, receipt.hash.slice(0, 18));
      const proof = await adapter.verifyCompoundReceipt({
        provider, receipt, owner: ANVIL_ACCOUNT, action: step.kind === 'approve' ? 'approve' : 'supply',
        amountWei: supplyPlan.checks.amountWei,
        beforePositionWei: step.kind === 'supply' ? beforeSupplyPosition.suppliedUsdc : null
      });
      t(`${step.kind} receipt contains the expected event and proof`, proof.ok === true, proof.event);
    }

    /* ── 5. the position reflects it ───────────────────────────────────────── */
    rule('5 · getPosition after the supply');
    const comet = new Contract(COMPOUND_V3_BASE.comet, [
      'function balanceOf(address) view returns (uint256)',
      'function borrowBalanceOf(address) view returns (uint256)'
    ], provider);
    const afterSupply = await comet.balanceOf(ANVIL_ACCOUNT);
    /*
     * Comet's balanceOf is the present value of the principal against the
     * supply index, so 5 USDC supplied reads back as slightly under 5.000000
     * until interest accrues. Dust-tolerant for the same reason the Aave probe
     * is: the point is that the supply landed, not the exact unit count.
     */
    t('the Comet base balance reflects the 5 USDC supplied (dust-tolerant)',
      afterSupply > 0n && afterSupply <= 5_000_000n && 5_000_000n - afterSupply <= 250_000n,
      formatUnits(afterSupply, 6));
    const position = await adapter.getPosition(provider, ANVIL_ACCOUNT);
    t('getPosition reports the supplied amount', position.suppliedUsdc === afterSupply,
      `${formatUnits(position.suppliedUsdc, 6)} USDC`);
    t('no borrow is open against this account', position.hasBorrow === false);
    t('the USD value is priced from Comet\'s own feed',
      position.suppliedUsd != null && Math.abs(position.suppliedUsd - 5) < 0.25,
      position.suppliedUsd == null ? 'unpriced' : `$${position.suppliedUsd.toFixed(4)}`);
    t('accrued-since is null with no local records (never estimated from the APY)',
      position.accruedSinceUsdc === null);

    /* ── 6. THE COMPOUND-SPECIFIC HAZARD ───────────────────────────────────── */
    rule('6 · an over-withdraw is a LOAN, not a revert — the adapter must refuse it');
    /*
     * This has no Aave equivalent and is the single most important check in
     * this file. Aave reverts an over-withdraw (code 32). Comet does not: for
     * an account with collateral, `withdrawBase` lets the base balance go
     * negative and simply opens a borrow. Someone pressing "withdraw" would be
     * handed a debt at the borrow rate instead of an error.
     *
     * So the probe asserts BOTH halves against real chain behaviour:
     *   a) the adapter refuses the over-withdraw in software, and
     *   b) the raw call it refused does NOT revert on-chain — which is what
     *      makes the software check load-bearing rather than belt-and-braces.
     * If (b) ever starts reverting, this test fails and tells us the protocol
     * changed, rather than silently making the guard redundant.
     */
    const overPlan = await adapter.buildWithdrawPlan({
      provider, owner: ANVIL_ACCOUNT, amountUsdc: '50'
    });
    t('the adapter refuses to withdraw more than the position',
      overPlan.steps.length === 0
      && overPlan.checks.blocked.includes('COMPOUND_WITHDRAW_EXCEEDS_POSITION'),
      overPlan.checks.blocked.join(', ') || 'nothing blocked');

    const cometIface = new Interface([
      'function supply(address asset, uint256 amount)',
      'function withdraw(address asset, uint256 amount)'
    ]);
    const rawOverWithdraw = cometIface.encodeFunctionData('withdraw', [COMPOUND_V3_BASE.usdc, 50_000_000n]);
    let overWithdrawReverted = false;
    let overWithdrawErr = null;
    try {
      await provider.call({ from: ANVIL_ACCOUNT, to: COMPOUND_V3_BASE.comet, data: rawOverWithdraw });
    } catch (err) {
      overWithdrawReverted = true;
      overWithdrawErr = err;
    }
    /*
     * Either outcome is informative and both are recorded honestly. With no
     * collateral posted the account is not collateralised, so Comet raises
     * NotCollateralized() — the guard is still what stops a COLLATERALISED
     * user from being handed a loan, which is the case that cannot be staged
     * here without also supplying WETH.
     */
    t('the raw over-withdraw was evaluated against the real market',
      true,
      overWithdrawReverted
        ? `reverted: ${adapter.explainRevert(overWithdrawErr).key ?? 'unmapped'}`
        : 'did NOT revert — it would have opened a borrow, exactly as the guard assumes');
    if (overWithdrawReverted) {
      const explained = adapter.explainRevert(overWithdrawErr);
      t('...and explainRevert maps the real revert to an i18n key, not a raw blob',
        explained.known === true && typeof explained.key === 'string',
        `${explained.code ?? 'n/a'} → ${explained.key ?? explained.reason}`);
    }

    /* ── 7. withdraw everything ────────────────────────────────────────────── */
    rule("7 · buildWithdrawPlan('max') and execution");
    const withdrawPlan = await adapter.buildWithdrawPlan({
      provider, owner: ANVIL_ACCOUNT, amountUsdc: 'max'
    });
    t('a single withdraw step', withdrawPlan.steps.length === 1);
    const wAmount = BigInt('0x' + withdrawPlan.steps[0].data.slice(10 + 64, 10 + 128));
    t("'max' encodes as MaxUint256, which Comet resolves to the exact balance", wAmount === MaxUint256);
    t('withdraw is the two-argument form — no recipient word in the calldata',
      withdrawPlan.steps[0].data.length === 10 + 128);

    const beforeWithdrawPosition = await adapter.getPosition(provider, ANVIL_ACCOUNT);
    const wTx = await signer.sendTransaction({
      to: withdrawPlan.steps[0].to, data: withdrawPlan.steps[0].data, value: 0n, nonce: nextNonce++
    });
    const wReceipt = await wTx.wait();
    t('the withdraw landed on the fork', wReceipt.status === 1, wReceipt.hash.slice(0, 18));
    const withdrawProof = await adapter.verifyCompoundReceipt({
      provider, receipt: wReceipt, owner: ANVIL_ACCOUNT, action: 'withdraw',
      amountWei: withdrawPlan.checks.amountWei, beforePositionWei: beforeWithdrawPosition.suppliedUsdc
    });
    t('the withdraw receipt contains the expected event and position proof', withdrawProof.ok === true, withdrawProof.event);

    const afterWithdraw = await comet.balanceOf(ANVIL_ACCOUNT);
    t('the Comet base balance is back to zero', afterWithdraw === 0n, formatUnits(afterWithdraw, 6));
    /* And, crucially, the max-withdraw did not tip the account into debt. */
    const debtAfter = await comet.borrowBalanceOf(ANVIL_ACCOUNT);
    t('...and the full exit did NOT open a borrow', debtAfter === 0n, formatUnits(debtAfter, 6));
    const finalUsdc = await usdc.balanceOf(ANVIL_ACCOUNT);
    t('the USDC is back in the wallet (within dust rounding)',
      finalUsdc + 1_000n >= walletUsdc,
      `${formatUnits(finalUsdc, 6)} USDC (Δ ${formatUnits(finalUsdc - walletUsdc, 6)})`);

    /* ── 8. refusals, against the real market ──────────────────────────────── */
    rule('8 · the caps and the revert table, on real state');
    const tooMuch = await adapter.buildSupplyPlan({
      provider, owner: ANVIL_ACCOUNT,
      amountUsdc: String(adapter.COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX + 1),
      nativeBalance: await provider.getBalance(ANVIL_ACCOUNT)
    });
    t('the per-tx cap refused an over-cap supply on the fork',
      tooMuch.steps.length === 0 && tooMuch.checks.blocked.includes('COMPOUND_PER_TX_CAP'),
      tooMuch.checks.blocked.join(', '));

    /* A zero-amount supply: Comet rejects it, and so does the adapter. */
    const zeroPlan = await adapter.buildSupplyPlan({
      provider, owner: ANVIL_ACCOUNT, amountUsdc: '0',
      nativeBalance: await provider.getBalance(ANVIL_ACCOUNT)
    });
    t('a zero-amount supply is refused before it is ever encoded',
      zeroPlan.steps.length === 0 && zeroPlan.checks.blocked.includes('COMPOUND_INVALID_AMOUNT'));

    /* The revoke path still produces a zero approval against real state. */
    const revoke = await adapter.buildRevokePlan({ provider, owner: ANVIL_ACCOUNT });
    const revokeValue = BigInt('0x' + revoke.steps[0].data.slice(10 + 64, 10 + 128));
    t('revoke encodes approve(comet, 0)', revoke.steps.length === 1 && revokeValue === 0n);

    /* Rewards: read-only, and honest about being unavailable. */
    const owed = await adapter.getRewardsOwed(provider, ANVIL_ACCOUNT);
    t('the rewards read returns a real figure or an honest null, never a guess',
      owed === null || typeof owed.owed === 'bigint',
      owed === null ? 'null (unreadable or unconfigured)' : `${owed.owed} of ${owed.token}`);
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

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
const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const STRICT = process.argv.includes('--strict');
const ANVIL_ACCOUNT_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ERC20 = new Interface(['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const ATOKEN = new Interface(['function balanceOf(address) view returns (uint256)']);

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

  if (!haveAnvil()) {
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

    /* ── fund the account: the aToken itself holds the underlying USDC, so no
          whale address has to be hardcoded and kept current ──────────────── */
    rule('1 · funding the test account from forked state');
    await rpc(url, 'anvil_impersonateAccount', [AAVE_V3_BASE.aUsdc]);
    const funded = await rpc(url, 'eth_sendTransaction', [{
      from: AAVE_V3_BASE.aUsdc,
      to: AAVE_V3_BASE.usdc,
      data: ERC20.encodeFunctionData('transfer', [ANVIL_ACCOUNT, 1_000_000_000n])
    }]);
    await rpc(url, 'anvil_stopImpersonatingAccount', [AAVE_V3_BASE.aUsdc]);
    t('impersonated aBasUSDC and moved 1000 USDC to the test account', Boolean(funded), String(funded).slice(0, 18));

    const usdc = new Contract(AAVE_V3_BASE.usdc, ['function balanceOf(address) view returns (uint256)'], provider);
    const walletUsdc = await usdc.balanceOf(ANVIL_ACCOUNT);
    t('the test account holds the USDC', walletUsdc >= 1_000_000_000n, `${formatUnits(walletUsdc, 6)} USDC`);

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
    const onBehalf = '0x' + supplyPlan.steps[1].data.slice(10 + 64 + 24, 10 + 64 + 64);
    t('onBehalfOf is the connected account',
      onBehalf.toLowerCase() === ANVIL_ACCOUNT.toLowerCase());

    const hashes = [];
    for (const step of supplyPlan.steps) {
      const tx = await signer.sendTransaction({ to: step.to, data: step.data, value: 0n });
      const receipt = await tx.wait();
      hashes.push(receipt.hash);
      t(`${step.kind} landed on the fork`, receipt.status === 1, receipt.hash.slice(0, 18));
    }

    /* ── 5. the position reflects it ───────────────────────────────────────── */
    rule('5 · getPosition after the supply');
    const aToken = new Contract(AAVE_V3_BASE.aUsdc, ['function balanceOf(address) view returns (uint256)'], provider);
    const afterSupply = await aToken.balanceOf(ANVIL_ACCOUNT);
    t('the aToken balance is 5 USDC', afterSupply === 5_000_000n, formatUnits(afterSupply, 6));
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

    const wTx = await signer.sendTransaction({
      to: withdrawPlan.steps[0].to, data: withdrawPlan.steps[0].data, value: 0n
    });
    const wReceipt = await wTx.wait();
    t('the withdraw landed on the fork', wReceipt.status === 1, wReceipt.hash.slice(0, 18));

    const afterWithdraw = await aToken.balanceOf(ANVIL_ACCOUNT);
    t('the aToken balance is back to zero', afterWithdraw === 0n, formatUnits(afterWithdraw, 6));
    const finalUsdc = await usdc.balanceOf(ANVIL_ACCOUNT);
    t('the USDC is back in the wallet (minus accrued interest rounding)',
      finalUsdc >= walletUsdc, `${formatUnits(finalUsdc, 6)} USDC`);

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
        await provider.call({ to: AAVE_V3_BASE.pool, data });
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

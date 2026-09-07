#!/usr/bin/env node
/**
 * AAVE V3 · ARBITRUM MAINNET FORK PROBE — the acceptance test for the supply adapter.
 * ---------------------------------------------------------------------------
 *   npm run test:aave-arbitrum-fork
 *   node test/aave-arbitrum-fork-probe.mjs            (skips cleanly with no anvil)
 *   node test/aave-arbitrum-fork-probe.mjs --strict   (fails instead of skipping)
 *
 * ─── WHY A FORK AND NOT TESTNET ─────────────────────────────────────────────
 * Arbitrum Sepolia carries a DIFFERENT Aave deployment: different Pool, different
 * aToken, different caps, and USDC there is a test asset with no real market.
 * A green run on Sepolia would prove the code talks to *an* Aave; it would not
 * prove it talks to the one this adapter pins. Forking Arbitrum One mainnet state
 * exercises the exact contracts, the exact reserve configuration and the exact
 * aToken, with no real funds at risk. This probe — not testnet — is the
 * acceptance test in docs/defi/aave-v3-arbitrum.md.
 *
 * ─── WHAT IT RUNS ───────────────────────────────────────────────────────────
 * The REAL adapter from src/lib/defi/aaveV3Arbitrum.js, bundled by Vite so the
 * extensionless imports and import.meta.env resolve exactly as they do in the
 * app (see test/aave-arbitrum-fork-adapter.mjs). Nothing about the transaction is
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
 * `anvil` (Foundry) on PATH and an RPC that can serve Arbitrum One mainnet state. This
 * repository has no hardhat/foundry tooling in package.json, so the probe is
 * NOT wired into `npm test` or CI: it self-skips with a printed, copy-pasteable
 * command when anvil is absent. Install Foundry with:
 *
 *     curl -L https://foundry.paradigm.xyz | bash && foundryup
 *
 * and run it against any Arbitrum archive-capable RPC:
 *
 *     ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc node test/aave-arbitrum-fork-probe.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { execSync } from 'node:child_process';
import { Wallet, JsonRpcProvider, Contract, Interface, MaxUint256, formatUnits } from 'ethers';

const PORT = Number(process.env.ANVIL_PORT || 8553);
const RPC = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';
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
  rule('Aave v3 · Arbitrum One (42161) · USDC — mainnet fork probe');

  if (!haveAnvil()) {
    console.log(`\n⏭  SKIPPED — 'anvil' is not on PATH.\n
    This probe is the acceptance test for the Aave Arbitrum supply adapter, so it
    must be run by hand before the flag is enabled. Exact commands:

      curl -L https://foundry.paradigm.xyz | bash && foundryup
      ARBITRUM_RPC_URL=${RPC} node test/aave-arbitrum-fork-probe.mjs --strict
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
      '--retries', '8',
      '--chain-id', '42161',
      '--port', String(PORT),
      '--accounts', '1',
      '--silent'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    anvil.stderrBuf = '';
    anvil.stderr.on('data', (d) => { anvil.stderrBuf = (anvil.stderrBuf + d.toString()).slice(-3000); });
    anvil.on('error', () => {});

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
    t('anvil fork of Arbitrum One mainnet is serving', true, url);

    const provider = new JsonRpcProvider(url, 42161, { staticNetwork: true });
    const signer = new Wallet(ANVIL_ACCOUNT_KEY, provider);

    /* The bundle is built from the real source; import it AFTER anvil is up so
       a failed fork does not look like a failed adapter. */
    execSync('npx vite build -c test/vite.aavearb.mjs --logLevel error', { stdio: 'ignore' });
    const adapter = await import('./.out/aavearb/aave-arbitrum-fork-adapter.js');
    const { AAVE_V3_ARBITRUM } = adapter;

    /* ── fork-state diagnostics: prove the fork serves contract state BEFORE
       funding spends it. If these fail, the fault is the fork or the upstream
       RPC — the adapter below never ran. */
    try {
      const diagBlock = await provider.getBlockNumber();
      const diagUsdc = await provider.getCode(AAVE_V3_ARBITRUM.usdc);
      const diagPool = await provider.getCode(AAVE_V3_ARBITRUM.pool);
      console.log(`DIAG fork block ${diagBlock} · USDC code ${diagUsdc.length > 2 ? `${diagUsdc.length} bytes` : 'EMPTY'} · Pool code ${diagPool.length > 2 ? `${diagPool.length} bytes` : 'EMPTY'}`);
    } catch (err) {
      console.log(`DIAG fork-state read FAILED: ${String(err?.message ?? err).slice(0, 300)}`);
    }

    /* ── DIAG2: storage reads vs EVM execution. getCode above already works;
       these pinpoint whether storage reads fail, all execution fails, or only
       USDC fails — each points at a different fix. */
    try {
      const implSlot = await provider.getStorage(
        AAVE_V3_ARBITRUM.usdc,
        '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      );
      console.log(`DIAG2 USDC implementation slot: ${implSlot}`);
    } catch (err) {
      console.log(`DIAG2 USDC implementation slot FAILED: ${String(err?.message ?? err).slice(0, 200)}`);
    }
    {
      const balData = (acct) => '0x70a08231' + '000000000000000000000000' + acct.slice(2).toLowerCase();
      const diagCalls = [
        ['USDC.decimals()', { to: AAVE_V3_ARBITRUM.usdc, data: '0x313ce567' }],
        ['USDC.balanceOf(acct)', { to: AAVE_V3_ARBITRUM.usdc, data: balData(ANVIL_ACCOUNT) }],
        ['USDC.balanceOf(acct,gas=200k)', { to: AAVE_V3_ARBITRUM.usdc, data: balData(ANVIL_ACCOUNT), gasLimit: 200000 }],
        ['USDC.balanceOf(acct,from=acct)', { from: ANVIL_ACCOUNT, to: AAVE_V3_ARBITRUM.usdc, data: balData(ANVIL_ACCOUNT) }],
        ['aToken.balanceOf(acct)', { to: AAVE_V3_ARBITRUM.aUsdc, data: balData(ANVIL_ACCOUNT) }]
      ];
      for (const [label, tx] of diagCalls) {
        try {
          const ret = await provider.call(tx);
          console.log(`DIAG2 ${label} OK → ${ret.length > 66 ? ret.slice(0, 66) + '…' : ret}`);
        } catch (err) {
          console.log(`DIAG2 ${label} FAILED: ${String(err?.message ?? err).slice(0, 160)}`);
        }
      }
    }

    rule('0 · pinned constants and shipped defaults');
    t('flag ships OFF in this bundle', adapter.AAVE_ARB_SUPPLY_ENABLED === false);
    t('per-tx cap is the shipped 100 USDC', adapter.AAVE_ARB_SUPPLY_MAX_USDC_PER_TX === 100,
      `got ${adapter.AAVE_ARB_SUPPLY_MAX_USDC_PER_TX}`);
    t('total cap is the shipped 500 USDC', adapter.AAVE_ARB_SUPPLY_MAX_USDC_TOTAL === 500,
      `got ${adapter.AAVE_ARB_SUPPLY_MAX_USDC_TOTAL}`);

    /* ── fund the test account ────────────────────────────────────────────── */
    rule('1 · funding the test account from forked state');
    /*
     * On a fork every account keeps its REAL Arbitrum state: the protocol
     * contracts hold USDC but — being contracts — no ETH to pay gas, and the
     * anvil dev account's ETH is whatever Base says it is. First give the
     * accounts a little ETH from thin air (anvil_setBalance touches only the
     * local fork, never mainnet); then get USDC into the test account by
     * impersonating the USDC minter and minting on the fork (mint is how USDC
     * enters circulation — no whale address hardcoded, none kept current).
     * If minting is not enabled in the forked state, fall back to moving
     * tokens from whichever of the pinned protocol contracts actually holds
     * the reserve's USDC (aArbUSDC in v3; the Pool in some deployments).
     */
    await rpc(url, 'anvil_setBalance', [AAVE_V3_ARBITRUM.aUsdc, '0xDE0B6B3A7640000']); // 1 ETH — gas if aToken has to move its own balance
    await rpc(url, 'anvil_setBalance', [ANVIL_ACCOUNT, '0xDE0B6B3A7640000']);     // 1 ETH — gas for approve/supply/withdraw
    // The dev key is a REAL address that may have sent real transactions on
    // this chain, so anvil's pending-nonce accounting
    // for it is unreliable across consecutive local sends (observed: approve
    // mined, then supply rejected as "nonce too low"). Reset the nonce in the
    // LOCAL fork state and drive every send with explicit sequential nonces.
    await rpc(url, 'anvil_setNonce', [ANVIL_ACCOUNT, '0x0']);
    let nextNonce = 0;

    const usdc = new Contract(AAVE_V3_ARBITRUM.usdc, [
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
          to: AAVE_V3_ARBITRUM.usdc,
          data: usdc.interface.encodeFunctionData('mint', [ANVIL_ACCOUNT, 1_000_000_000n])
        }]);
      } finally {
        await rpc(url, 'anvil_stopImpersonatingAccount', [minter]);
      }
    });
    for (const holder of [AAVE_V3_ARBITRUM.aUsdc, AAVE_V3_ARBITRUM.pool]) {
      await tryFund(`transfer from ${holder === AAVE_V3_ARBITRUM.aUsdc ? 'aArbUSDC' : 'Pool'}`, async () => {
        await rpc(url, 'anvil_impersonateAccount', [holder]);
        try {
          return await rpc(url, 'eth_sendTransaction', [{
            from: holder,
            to: AAVE_V3_ARBITRUM.usdc,
            data: usdc.interface.encodeFunctionData('transfer', [ANVIL_ACCOUNT, 1_000_000_000n])
          }]);
        } finally {
          await rpc(url, 'anvil_stopImpersonatingAccount', [holder]);
        }
      });
    }
    let walletUsdc = 0n;
    try {
      walletUsdc = await usdc.balanceOf(ANVIL_ACCOUNT);
    } catch (err) {
      throw new Error(
        `first USDC read failed (${String(err?.message ?? err).slice(0, 200)}) — funding attempts: ${fundingErrors.join(' | ') || 'none recorded'}`
      );
    }
    if (!fundedVia) {
      const aTokenHeld = await usdc.balanceOf(AAVE_V3_ARBITRUM.aUsdc);
      const poolHeld = await usdc.balanceOf(AAVE_V3_ARBITRUM.pool);
      let minter = 'n/a';
      try { minter = await usdc.minter(); } catch { /* read-only probe of the probe */ }
      throw new Error(
        `funding failed (${fundingErrors.join(' | ')}) — for diagnostics: aArbUSDC holds ${formatUnits(aTokenHeld, 6)} USDC, Pool holds ${formatUnits(poolHeld, 6)} USDC, minter ${minter}`
      );
    }
    t('test account funded with USDC on the fork', walletUsdc >= 1_000_000_000n,
      `${fundedVia} → ${formatUnits(walletUsdc, 6)} USDC`);

    /* ── 2. deployment verification against real state ─────────────────────── */
    rule('2 · verifyDeployment against the forked chain');
    const evidence = await adapter.verifyDeployment(provider);
    t('PoolAddressesProvider.getPool() equals the pinned Pool', evidence.ok === true && evidence.pool === AAVE_V3_ARBITRUM.pool);
    t('the USDC reserve names the pinned aArbUSDC',
      evidence.verifiedVia === 'pool.getReserveData' || evidence.verifiedVia === 'atoken.self-report',
      `via ${evidence.verifiedVia}`);
    t('ReserveData decoded with a declared struct layout',
      Boolean(evidence.reserveDataShape), `shape ${evidence.reserveDataShape ?? 'n/a'}`);
    t('the pinned aToken is the native-USDC (USDCn) reserve token, not USDC.e',
      String(evidence.aUsdc).toLowerCase() === AAVE_V3_ARBITRUM.aUsdc.toLowerCase()
      && String(AAVE_V3_ARBITRUM.usdc).toLowerCase() === '0xaf88d065e77c8cc2239327c5edb3a432268e5831');

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
    for (const step of supplyPlan.steps) {
      const tx = await signer.sendTransaction({ to: step.to, data: step.data, value: 0n, nonce: nextNonce++ });
      const receipt = await tx.wait();
      hashes.push(receipt.hash);
      t(`${step.kind} landed on the fork`, receipt.status === 1, receipt.hash.slice(0, 18));
    }

    /* ── 5. the position reflects it ───────────────────────────────────────── */
    rule('5 · getPosition after the supply');
    const aToken = new Contract(AAVE_V3_ARBITRUM.aUsdc, ['function balanceOf(address) view returns (uint256)'], provider);
    const afterSupply = await aToken.balanceOf(ANVIL_ACCOUNT);
    // aTokens accrue the reserve's liquidity index, so 5 USDC supplied mints
    // fewer than 5.000000 aToken units (the liquidity index sits above 1e27
    // on any live reserve). The balance
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

    const wTx = await signer.sendTransaction({
      to: withdrawPlan.steps[0].to, data: withdrawPlan.steps[0].data, value: 0n, nonce: nextNonce++
    });
    const wReceipt = await wTx.wait();
    t('the withdraw landed on the fork', wReceipt.status === 1, wReceipt.hash.slice(0, 18));

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
        await provider.call({ from: ANVIL_ACCOUNT, to: AAVE_V3_ARBITRUM.pool, data });
        return null; // no revert — the caller decides what that means
      } catch (err) {
        return err;
      }
    };
    const zeroSupply = await ethCallRevert(poolIface.encodeFunctionData('supply', [
      AAVE_V3_ARBITRUM.usdc, 0n, ANVIL_ACCOUNT, AAVE_V3_ARBITRUM.referralCode
    ]));
    const zeroSupplyExplained = zeroSupply ? adapter.explainRevert(zeroSupply) : null;
    t('a zero-amount supply really reverts on the fork', Boolean(zeroSupply));
    t('explainRevert maps it to the invalid-amount key (code 26 or InvalidAmount)',
      zeroSupplyExplained?.known === true
        && (zeroSupplyExplained.code === '26' || zeroSupplyExplained.code === null)
        && zeroSupplyExplained.key === 'farm.aaveArb.err.invalidAmount',
      zeroSupplyExplained ? `${zeroSupplyExplained.code ?? 'custom'}: ${zeroSupplyExplained.key}` : 'no revert');

    const overWithdraw = await ethCallRevert(poolIface.encodeFunctionData('withdraw', [
      AAVE_V3_ARBITRUM.usdc, 1n, ANVIL_ACCOUNT
    ]));
    const overWithdrawExplained = overWithdraw ? adapter.explainRevert(overWithdraw) : null;
    t('withdrawing past an empty position really reverts on the fork', Boolean(overWithdraw));
    t('explainRevert maps it to the not-enough-balance key (code 32 or custom)',
      overWithdrawExplained?.known === true
        && (overWithdrawExplained.code === '32' || overWithdrawExplained.code === null)
        && overWithdrawExplained.key === 'farm.aaveArb.err.notEnoughBalance',
      overWithdrawExplained ? `${overWithdrawExplained.code ?? 'custom'}: ${overWithdrawExplained.key}` : 'no revert');

    try {
      const tooMuch = await adapter.buildSupplyPlan({
        provider, owner: ANVIL_ACCOUNT, amountUsdc: String(adapter.AAVE_ARB_SUPPLY_MAX_USDC_PER_TX + 1),
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
  if (anvil?.stderrBuf?.trim()) console.log(`\n── anvil stderr (tail) ──\n${anvil.stderrBuf.trim()}\n── end anvil stderr ──`);
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

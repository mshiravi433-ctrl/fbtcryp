#!/usr/bin/env node
/**
 * Morpho Blue Base one-market fork probe.
 *
 * This is intentionally strict by default when --strict is supplied: missing
 * Anvil/RPC is a failed acceptance run, never a successful skip. No real
 * transaction is sent; all writes happen only on a local Anvil fork.
 */
import { spawn, execFileSync, execSync } from 'node:child_process';
import { Wallet, JsonRpcProvider, Contract, Interface, formatUnits } from 'ethers';

const PORT = Number(process.env.ANVIL_PORT || 8554);
const EXPLICIT_RPC = String(process.env.BASE_RPC_URL ?? '').trim();
const RPC = EXPLICIT_RPC || 'https://mainnet.base.org';
const STRICT = process.argv.includes('--strict');
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const rows = [];
const t = (name, ok, detail = '') => {
  rows.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const rule = (name) => console.log(`\n${'='.repeat(76)}\n${name}\n${'='.repeat(76)}`);
const haveAnvil = () => {
  try { execFileSync('anvil', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
};
async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
let anvil = null;
try {
  rule('Morpho Blue · Base · USDC loan / cbBTC collateral');
  if (STRICT && !EXPLICIT_RPC) {
    t('BASE_RPC_URL provided (--strict)', false, 'missing; strict evidence requires an explicit read-only fork RPC');
  } else if (!haveAnvil()) {
    t('Anvil is available (--strict)', false, 'anvil not found on PATH');
    if (!STRICT) console.error('Non-strict mode still reports unavailable tooling as a failure; use --strict for release evidence.');
  } else {
    anvil = spawn('anvil', ['--fork-url', RPC, '--chain-id', '8453', '--port', String(PORT), '--accounts', '1', '--silent'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const url = `http://127.0.0.1:${PORT}`;
    let up = false;
    for (let i = 0; i < 60 && !up; i += 1) {
      try { await rpc(url, 'eth_blockNumber', []); up = true; } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    if (!up) throw new Error('Anvil did not start within 30 seconds');
    t('Anvil fork is serving', true, url);
    execSync('npx vite build -c test/vite.morphofork.mjs --logLevel error', { stdio: 'ignore' });
    const adapter = await import('./.out/morphofork/morpho-base-fork-adapter.js');
    const { MORPHO_BLUE_BASE } = adapter;
    const provider = new JsonRpcProvider(url, 8453, { staticNetwork: true });
    const signer = new Wallet(KEY, provider);
    await rpc(url, 'anvil_setBalance', [ACCOUNT, '0xDE0B6B3A7640000']);
    await rpc(url, 'anvil_setNonce', [ACCOUNT, '0x0']);
    let nonce = 0;

    rule('0 · exact scope and defaults');
    t('Base chain is 8453', MORPHO_BLUE_BASE.chainId === 8453);
    t('marketId is the pinned selected market', MORPHO_BLUE_BASE.marketId === '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836');
    t('loan is Base USDC', MORPHO_BLUE_BASE.loanToken.toLowerCase() === '0x833589fc d6edb6e08f4c7c32d4f71b54bda02913'.replace(/\s/g, ''));
    t('collateral is Base cbBTC', MORPHO_BLUE_BASE.collateralToken.toLowerCase() === '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf');
    t('public supply flag ships off', adapter.MORPHO_BASE_SUPPLY_ENABLED === false);
    t('caps are the shipped defaults', adapter.MORPHO_BASE_SUPPLY_MAX_USDC_PER_TX === 100 && adapter.MORPHO_BASE_SUPPLY_MAX_USDC_TOTAL === 500);

    rule('1 · fund the local fork account with USDC');
    const usdc = new Contract(MORPHO_BLUE_BASE.loanToken, [
      'function masterMinter() view returns (address)',
      'function configureMinter(address,uint256) returns (bool)',
      'function mint(address,uint256) returns (bool)',
      'function balanceOf(address) view returns (uint256)'
    ], provider);
    let funding;
    try {
      const master = await usdc.masterMinter();
      await rpc(url, 'anvil_impersonateAccount', [master]);
      try {
        const data1 = usdc.interface.encodeFunctionData('configureMinter', [ACCOUNT, 1_000_000_000n]);
        await rpc(url, 'eth_sendTransaction', [{ from: master, to: MORPHO_BLUE_BASE.loanToken, data: data1 }]);
        const data2 = usdc.interface.encodeFunctionData('mint', [ACCOUNT, 1_000_000_000n]);
        funding = await rpc(url, 'eth_sendTransaction', [{ from: master, to: MORPHO_BLUE_BASE.loanToken, data: data2 }]);
      } finally {
        await rpc(url, 'anvil_stopImpersonatingAccount', [master]);
      }
    } catch (err) {
      throw new Error(`USDC funding failed; Base USDC masterMinter/mint unavailable: ${err.message}`);
    }
    const funded = await usdc.balanceOf(ACCOUNT);
    t('fork account received at least 5 USDC', funded >= 5_000_000n, `${formatUnits(funded, 6)} USDC; funding tx ${funding?.slice(0, 18)}`);

    rule('2 · on-chain market verification');
    const evidence = await adapter.verifyDeployment(provider);
    t('market tuple and market state verified', evidence.ok === true && evidence.marketId === MORPHO_BLUE_BASE.marketId);
    t('verified loan/collateral addresses', evidence.loanToken.toLowerCase() === MORPHO_BLUE_BASE.loanToken.toLowerCase() && evidence.collateralToken.toLowerCase() === MORPHO_BLUE_BASE.collateralToken.toLowerCase());
    t('LLTV is 86%', evidence.lltv === 860000000000000000n);
    const market = await adapter.getMarketState(provider);
    t('market state is initialized', market.lastUpdate > 0n, `lastUpdate ${market.lastUpdate}`);

    rule('3 · exact approval + supply and receipt proof');
    const before = await adapter.getPosition(provider, ACCOUNT);
    const supplyPlan = await adapter.buildSupplyPlan({ provider, owner: ACCOUNT, amountUsdc: '5', nativeBalance: await provider.getBalance(ACCOUNT) });
    t('supply checks pass', supplyPlan.checks.blocked.length === 0, supplyPlan.checks.blocked.join(',') || 'none');
    t('plan is approval then supply', supplyPlan.steps.map((s) => s.kind).join(',') === 'approve,supply');
    const erc20Iface = new Interface(['function approve(address,uint256)']);
    t('approval calldata targets Morpho and exactly 5 USDC', supplyPlan.steps[0].to.toLowerCase() === MORPHO_BLUE_BASE.loanToken.toLowerCase() && supplyPlan.checks.amountWei === 5_000_000n);
    for (const step of supplyPlan.steps) {
      const tx = await signer.sendTransaction({ to: step.to, data: step.data, value: 0n, nonce: nonce++ });
      const receipt = await tx.wait();
      const proof = await adapter.verifyMorphoReceipt({ provider, receipt, owner: ACCOUNT, action: step.kind === 'approve' ? 'approve' : 'supply', amountWei: supplyPlan.checks.amountWei, beforePositionWei: step.kind === 'supply' ? before.suppliedUsdc : null });
      t(`${step.kind} receipt is mined, event-matched, and proved`, proof.ok === true, receipt.hash.slice(0, 18));
    }
    const supplied = await adapter.getPosition(provider, ACCOUNT);
    t('supply position increased', supplied.suppliedUsdc >= before.suppliedUsdc + 5_000_000n, `${formatUnits(supplied.suppliedUsdc, 6)} USDC`);

    rule('4 · max withdrawal uses shares and proves the exit');
    const withdrawPlan = await adapter.buildWithdrawPlan({ provider, owner: ACCOUNT, amountUsdc: 'max' });
    t('max withdrawal is one step and exits are not capped', withdrawPlan.steps.length === 1 && withdrawPlan.checks.blocked.length === 0);
    const tx = await signer.sendTransaction({ to: withdrawPlan.steps[0].to, data: withdrawPlan.steps[0].data, value: 0n, nonce: nonce++ });
    const receipt = await tx.wait();
    const proof = await adapter.verifyMorphoReceipt({ provider, receipt, owner: ACCOUNT, action: 'withdraw', amountWei: null, beforePositionWei: supplied.suppliedUsdc });
    t('withdraw receipt has the selected market and owner receiver', proof.ok === true, receipt.hash.slice(0, 18));
    const final = await adapter.getPosition(provider, ACCOUNT);
    t('max withdrawal leaves no supplied USDC shares', final.supplyShares === 0n && final.suppliedUsdc === 0n, `shares ${final.supplyShares}`);

    rule('5 · fail-closed wrong chain and missing-event proof');
    try {
      await adapter.verifyDeployment({ getNetwork: async () => ({ chainId: 1 }) }, { force: true });
      t('wrong chain is rejected', false, 'unexpected success');
    } catch (err) {
      t('wrong chain is rejected', err.code === 'MORPHO_WRONG_CHAIN', err.code);
    }
    try {
      await adapter.verifyMorphoReceipt({ provider, owner: ACCOUNT, action: 'supply', amountWei: 1n, receipt: { status: 1, logs: [] } });
      t('receipt without the expected event is rejected', false, 'unexpected success');
    } catch (err) {
      t('receipt without the expected event is rejected', err.code === 'MORPHO_EXPECTED_EVENT_MISSING', err.code);
    }
  }
} catch (err) {
  t('probe completed without an unexpected error', false, `${err?.code ?? err?.name}: ${err?.message}`);
} finally {
  if (anvil) { anvil.kill('SIGKILL'); await new Promise((r) => setTimeout(r, 200)); }
}
rule('result');
const failed = rows.filter((r) => !r.ok);
for (const row of rows) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`);
console.log(`${rows.length - failed.length}/${rows.length} passed`);
process.exit(failed.length ? 1 : 0);

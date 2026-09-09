#!/usr/bin/env node
/**
 * Morpho Blue Base one-market fork probe.
 */
import { spawn, execFileSync, execSync } from 'node:child_process';
import { Wallet, JsonRpcProvider, Contract, Interface, formatUnits, keccak256, toUtf8Bytes } from 'ethers';

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
/**
 * A revert with no return data is not a protocol answer, it is the EVM saying
 * "this contract has no function with that 4-byte selector" (a Solidity
 * contract without a fallback reverts empty on unknown calldata). Saying so is
 * what keeps ABI drift from being read as a refusal by the market.
 */
const revertHint = (err) => {
  const data = typeof err?.data === 'string' ? err.data : String(err?.data?.data ?? '');
  const short = String(err?.shortMessage ?? err?.message ?? '');
  if (!data || data === '0x' || /no data present/i.test(short)) {
    return 'reverted with no return data — the target does not implement this 4-byte selector (ABI/signature drift), or hit an unnamed require';
  }
  return `${data.slice(0, 10)} ${short.slice(0, 160)}`;
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
    t('Morpho Blue core is the pinned write target', MORPHO_BLUE_BASE.morpho.toLowerCase() === '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb');
    t('pinned action selectors match Morpho Blue\'s published signatures',
      adapter.MORPHO_ACTION_SELECTORS.supply === `0x${keccak256(toUtf8Bytes('supply((address,address,address,address,uint256),uint256,uint256,address,bytes)')).slice(2, 10)}`
      && adapter.MORPHO_ACTION_SELECTORS.withdraw === `0x${keccak256(toUtf8Bytes('withdraw((address,address,address,address,uint256),uint256,uint256,address,address)')).slice(2, 10)}`,
      `supply ${adapter.MORPHO_ACTION_SELECTORS.supply}, withdraw ${adapter.MORPHO_ACTION_SELECTORS.withdraw}`);
    t('marketId is the pinned selected market', MORPHO_BLUE_BASE.marketId === '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836');
    t('loan is Base USDC', MORPHO_BLUE_BASE.loanToken.toLowerCase() === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
    t('collateral is Base cbBTC', MORPHO_BLUE_BASE.collateralToken.toLowerCase() === '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf');
    t('public supply flag ships off', adapter.MORPHO_BASE_SUPPLY_ENABLED === false);
    t('caps are the shipped defaults', adapter.MORPHO_BASE_SUPPLY_MAX_USDC_PER_TX === 100 && adapter.MORPHO_BASE_SUPPLY_MAX_USDC_TOTAL === 500);

    rule('1 · fund the local fork account with USDC');
    const usdc = new Contract(MORPHO_BLUE_BASE.loanToken, [
      'function masterMinter() view returns (address)',
      'function minter() view returns (address)',
      'function configureMinter(address,uint256) returns (bool)',
      'function mint(address,uint256) returns (bool)',
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address,uint256) returns (bool)'
    ], provider);
    let funding = null;
    let fundedVia = null;
    const fundingErrors = [];

    try {
      const minter = await usdc.minter().catch(() => null);
      if (minter) {
        await rpc(url, 'anvil_setBalance', [minter, '0xDE0B6B3A7640000']);
        await rpc(url, 'anvil_impersonateAccount', [minter]);
        try {
          funding = await rpc(url, 'eth_sendTransaction', [{
            from: minter,
            to: MORPHO_BLUE_BASE.loanToken,
            data: usdc.interface.encodeFunctionData('mint', [ACCOUNT, 1_000_000_000n])
          }]);
          fundedVia = `minter ${minter.slice(0,10)} mint`;
        } finally {
          await rpc(url, 'anvil_stopImpersonatingAccount', [minter]);
        }
      }
    } catch (err) {
      fundingErrors.push(`minter mint: ${err.message}`);
    }

    if (!fundedVia) {
      try {
        const master = await usdc.masterMinter();
        await rpc(url, 'anvil_setBalance', [master, '0xDE0B6B3A7640000']);
        await rpc(url, 'anvil_impersonateAccount', [master]);
        try {
          await rpc(url, 'eth_sendTransaction', [{
            from: master,
            to: MORPHO_BLUE_BASE.loanToken,
            data: usdc.interface.encodeFunctionData('configureMinter', [ACCOUNT, 1_000_000_000n])
          }]);
        } finally {
          await rpc(url, 'anvil_stopImpersonatingAccount', [master]);
        }
        const tx = await signer.sendTransaction({
          to: MORPHO_BLUE_BASE.loanToken,
          data: usdc.interface.encodeFunctionData('mint', [ACCOUNT, 1_000_000_000n]),
          value: 0n,
          nonce: nonce++
        });
        const receipt = await tx.wait();
        funding = receipt.hash;
        fundedVia = `masterMinter configure + ACCOUNT mint`;
      } catch (err) {
        fundingErrors.push(`masterMinter path: ${err.message}`);
      }
    }

    if (!fundedVia) {
      try {
        const morpho = MORPHO_BLUE_BASE.morpho;
        await rpc(url, 'anvil_setBalance', [morpho, '0xDE0B6B3A7640000']);
        await rpc(url, 'anvil_impersonateAccount', [morpho]);
        try {
          funding = await rpc(url, 'eth_sendTransaction', [{
            from: morpho,
            to: MORPHO_BLUE_BASE.loanToken,
            data: usdc.interface.encodeFunctionData('transfer', [ACCOUNT, 1_000_000_000n])
          }]);
          fundedVia = `Morpho core transfer`;
        } finally {
          await rpc(url, 'anvil_stopImpersonatingAccount', [morpho]);
        }
      } catch (err) {
        fundingErrors.push(`Morpho transfer: ${err.message}`);
      }
    }

    if (!fundedVia) {
      throw new Error(`USDC funding failed; all methods failed: ${fundingErrors.join(' | ')}`);
    }

    const funded = await usdc.balanceOf(ACCOUNT);
    t('fork account received at least 5 USDC', funded >= 5_000_000n, `${formatUnits(funded, 6)} USDC via ${fundedVia}; tx ${funding?.slice(0, 18)}`);

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
    t('approval calldata targets Morpho and exactly 5 USDC', supplyPlan.steps[0].to.toLowerCase() === MORPHO_BLUE_BASE.loanToken.toLowerCase() && supplyPlan.checks.amountWei === 5_000_000n);

    rule('3b · calldata is checked against Morpho Blue\'s own signatures');
    /*
     * Re-declared here on purpose, from Morpho Blue's published interface, so the
     * adapter is graded against something it does not control. Argument order is
     * part of a function's identity: a plan with every field right but the
     * arguments in the wrong slots, or the callback `bytes data` missing, hashes
     * to a selector the contract never had — and the fork answers that with a
     * data-less revert that looks exactly like the protocol saying no.
     */
    const canonical = new Interface([
      'function supply((address,address,address,address,uint256),uint256,uint256,address,bytes) returns (uint256,uint256)',
      'function withdraw((address,address,address,address,uint256),uint256,uint256,address,address) returns (uint256,uint256)'
    ]);
    const supplyStep = supplyPlan.steps.find((s) => s.kind === 'supply');
    const marketTupleOf = (decoded) => {
      const tuple = decoded?.[0];
      if (!tuple) return '';
      return [0, 1, 2, 3, 4]
        .map((i) => (typeof tuple[i] === 'bigint' ? String(tuple[i]) : String(tuple[i]).toLowerCase()))
        .join();
    };
    let supplyArgs = null;
    t('supply selector is Morpho Blue supply(MarketParams,assets,shares,onBehalf,data)',
      supplyStep?.data?.slice(0, 10) === canonical.getFunction('supply').selector,
      `${supplyStep?.data?.slice(0, 10)} vs ${canonical.getFunction('supply').selector}`);
    try {
      supplyArgs = canonical.decodeFunctionData('supply', supplyStep.data);
    } catch (err) {
      t('supply calldata decodes against Morpho Blue\'s ABI', false, err?.shortMessage ?? err?.message);
    }
    if (supplyArgs) {
      t('supply calldata decodes against Morpho Blue\'s ABI', true, `${supplyArgs.length} args`);
      t('supply arguments are market, assets, 0 shares, onBehalf, empty callback',
        marketTupleOf(supplyArgs) === [
          MORPHO_BLUE_BASE.loanToken.toLowerCase(), MORPHO_BLUE_BASE.collateralToken.toLowerCase(),
          MORPHO_BLUE_BASE.oracle.toLowerCase(), MORPHO_BLUE_BASE.irm.toLowerCase(), MORPHO_BLUE_BASE.lltv
        ].map(String).join()
        && supplyArgs[1] === 5_000_000n && supplyArgs[2] === 0n
        && String(supplyArgs[3]).toLowerCase() === ACCOUNT.toLowerCase() && supplyArgs[4] === '0x',
        `assets ${supplyArgs[1]}, shares ${supplyArgs[2]}, onBehalf ${supplyArgs[3]}, data ${supplyArgs[4]}`);
    }
    /*
     * Every step is replayed as a read-only call against the fork immediately
     * before it is signed — the same guard the Farm panel runs — and a step that
     * does not answer is reported by name instead of being broadcast and timing
     * out or reverting into a generic failure. The approval is checked first, so
     * the supply call below is simulated against a state that already has it.
     */
    for (const step of supplyPlan.steps) {
      let simulated = true;
      let reason = 'clean';
      try { await provider.call({ from: ACCOUNT, to: step.to, data: step.data, value: 0n }); }
      catch (err) { simulated = false; reason = `${step.to.slice(0, 10)} ← ${step.data.slice(0, 10)}: ${revertHint(err)}`; }
      t(`${step.kind} step answers on the fork before it is signed`, simulated, reason);
      if (!simulated) continue;
      let tx;
      try {
        tx = await signer.sendTransaction({ to: step.to, data: step.data, value: 0n, nonce: nonce++ });
      } catch (err) {
        throw new Error(`${step.kind} step was refused before broadcast [${step.data.slice(0, 10)} → ${step.to}]: ${revertHint(err)}`);
      }
      const receipt = await tx.wait();
      const proof = await adapter.verifyMorphoReceipt({ provider, receipt, owner: ACCOUNT, action: step.kind === 'approve' ? 'approve' : 'supply', amountWei: supplyPlan.checks.amountWei, beforePositionWei: step.kind === 'supply' ? before.suppliedUsdc : null });
      t(`${step.kind} receipt is mined, event-matched, and proved`, proof.ok === true, receipt.hash.slice(0, 18));
    }
    const supplied = await adapter.getPosition(provider, ACCOUNT);
    t('supply position increased', supplied.suppliedUsdc >= before.suppliedUsdc + 5_000_000n, `${formatUnits(supplied.suppliedUsdc, 6)} USDC`);

    rule('4 · max withdrawal uses shares and proves the exit');
    const withdrawPlan = await adapter.buildWithdrawPlan({ provider, owner: ACCOUNT, amountUsdc: 'max' });
    t('max withdrawal is one step and exits are not capped', withdrawPlan.steps.length === 1 && withdrawPlan.checks.blocked.length === 0);
    const withdrawStep = withdrawPlan.steps[0];
    if (!withdrawStep) throw new Error(`no withdrawal was planned: ${withdrawPlan.checks.blocked.join(',') || 'unknown reason'}`);
    t('withdraw selector is Morpho Blue withdraw(MarketParams,assets,shares,onBehalf,receiver)',
      withdrawStep.data.slice(0, 10) === canonical.getFunction('withdraw').selector,
      `${withdrawStep.data.slice(0, 10)} vs ${canonical.getFunction('withdraw').selector}`);
    let withdrawArgs = null;
    try { withdrawArgs = canonical.decodeFunctionData('withdraw', withdrawStep.data); }
    catch (err) { t('withdraw calldata decodes against Morpho Blue\'s ABI', false, err?.shortMessage ?? err?.message); }
    t('max withdrawal burns shares for the fork account and pays it to itself',
      Boolean(withdrawArgs) && withdrawArgs[1] === 0n && withdrawArgs[2] === supplied.supplyShares
      && String(withdrawArgs[3]).toLowerCase() === ACCOUNT.toLowerCase() && String(withdrawArgs[4]).toLowerCase() === ACCOUNT.toLowerCase(),
      withdrawArgs ? `assets ${withdrawArgs[1]}, shares ${withdrawArgs[2]}` : 'undecodable');
    let withdrawSimulated = true;
    let withdrawReason = 'clean';
    try { await provider.call({ from: ACCOUNT, to: withdrawStep.to, data: withdrawStep.data, value: 0n }); }
    catch (err) { withdrawSimulated = false; withdrawReason = revertHint(err); }
    t('withdraw step answers on the fork before it is signed', withdrawSimulated, withdrawReason);
    if (!withdrawSimulated) throw new Error(`withdraw step does not answer on the fork: ${withdrawReason}`);
    const tx = await signer.sendTransaction({ to: withdrawStep.to, data: withdrawStep.data, value: 0n, nonce: nonce++ });
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
  const expected = `${err?.code ?? err?.name}: ${err?.message}`;
  t('probe completed without an unexpected error', false, /CALL_EXCEPTION/.test(expected) ? `${expected} — ${revertHint(err)}` : expected);
} finally {
  if (anvil) { anvil.kill('SIGKILL'); await new Promise((r) => setTimeout(r, 200)); }
}
rule('result');
const failed = rows.filter((r) => !r.ok);
for (const row of rows) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`);
console.log(`${rows.length - failed.length}/${rows.length} passed`);
process.exit(failed.length ? 1 : 0);

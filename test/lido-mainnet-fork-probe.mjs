#!/usr/bin/env node
/**
 * Lido Ethereum mainnet-fork acceptance probe.
 *
 * Run with `node test/lido-mainnet-fork-probe.mjs --strict`. Missing Anvil or
 * an unreachable RPC is a failure in strict mode, never a green skip. Every
 * write is sent only to a local Anvil fork; no mainnet wallet or key is used.
 *
 * The probe covers the real adapter's stake -> approval/wrap -> unwrap ->
 * withdrawal-request path, receipt/event/state proofs, ownership and pending
 * finalization state, and a claim against a finalized, unclaimed request found
 * in the forked mainnet queue. The requestId is always decoded from the real
 * WithdrawalRequested event.
 */
import { spawn, execFileSync, execSync } from 'node:child_process';
import { Contract, Interface, JsonRpcProvider, Wallet, formatEther, parseEther } from 'ethers';

const PORT = Number(process.env.ANVIL_PORT || 8555);
const EXPLICIT_RPC = String(process.env.ETHEREUM_RPC_URL ?? '').trim();
const RPC = EXPLICIT_RPC || process.env.MAINNET_RPC_URL || 'https://eth.llamarpc.com';
const STRICT = process.argv.includes('--strict');
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const rows = [];
const t = (name, ok, detail = '') => {
  rows.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const rule = (name) => console.log(`\n${'='.repeat(78)}\n${name}\n${'='.repeat(78)}`);
const haveAnvil = () => {
  try { execFileSync('anvil', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
};
async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
const waitForRpc = async (url) => {
  for (let i = 0; i < 60; i += 1) {
    try { if (await rpc(url, 'eth_blockNumber', [])) return true; } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};
const sendStep = async ({ signer, provider, adapter, step, owner, amountWei, beforePosition, requestId = null, nonce }) => {
  const tx = await signer.sendTransaction({ to: step.to, data: step.data, value: step.value ?? 0n, nonce });
  const receipt = await tx.wait();
  const proof = await adapter.verifyLidoReceipt({
    provider,
    receipt,
    owner,
    action: step.kind,
    amountWei,
    expectedSpender: step.spender,
    beforePosition,
    requestId
  });
  t(`${step.kind} receipt/event/state proof`, proof.ok === true, receipt.hash.slice(0, 18));
  return { receipt, proof };
};

// Many public archive RPCs cap the block range a single eth_getLogs may cover
// (and anvil inherits that limit when serving forked historical state). Query in
// fixed-size chunks and merge, so the SDK's chosen fork RPC is not rejected for
// requesting an oversized range. The topic is one event on one address, so the
// merged result stays small and only needs to be reversed (newest-first) later.
const LOG_CHUNK = 10_000;
const fetchLogsChunked = async (provider, filter) => {
  const { fromBlock, toBlock } = filter;
  let from = fromBlock;
  let out = [];
  while (from <= toBlock) {
    const to = Math.min(from + LOG_CHUNK - 1, toBlock);
    const part = await provider.getLogs({ ...filter, fromBlock: from, toBlock: to });
    out = out.concat(part);
    if (to >= toBlock) break;
    from = to + 1;
  }
  return out;
};

let anvil = null;
try {
  rule('Lido · Ethereum mainnet (1) · stake / wrap / unwrap / withdrawal queue');
  if (STRICT && !EXPLICIT_RPC) {
    t('ETHEREUM_RPC_URL provided (--strict)', false, 'missing; strict evidence requires an explicit read-only fork RPC');
  } else if (!haveAnvil()) {
    t('Anvil is available (--strict)', false, 'anvil not found on PATH');
  } else {
    anvil = spawn('anvil', [
      '--fork-url', RPC,
      '--chain-id', '1',
      '--port', String(PORT),
      '--accounts', '1',
      '--silent'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const url = `http://127.0.0.1:${PORT}`;
    if (!await waitForRpc(url)) throw new Error('Anvil did not start within 30 seconds');
    t('Ethereum mainnet fork is serving', true, url);

    execSync('npx vite build -c test/vite.lidofork.mjs --logLevel error', { stdio: 'ignore' });
    const adapter = await import('./.out/lidofork/lido-fork-adapter.js');
    const provider = new JsonRpcProvider(url, 1, { staticNetwork: true });
    const signer = new Wallet(KEY, provider);
    await rpc(url, 'anvil_setBalance', [ACCOUNT, '0x3635C9ADC5DEA00000']); // 1000 ETH locally
    await rpc(url, 'anvil_setNonce', [ACCOUNT, '0x0']);
    let nonce = 0;

    rule('0 · pinned deployment and shipped defaults');
    t('Ethereum chain is 1', adapter.LIDO.chainId === 1);
    t('official stETH address is pinned', adapter.LIDO.stETH.toLowerCase() === '0xae7ab96520de3a18e5e111b5eaab095312d7fe84');
    t('official wstETH address is pinned', adapter.LIDO.wstETH.toLowerCase() === '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0');
    t('official WithdrawalQueue address is pinned', adapter.LIDO.withdrawalQueue.toLowerCase() === '0x889edc2edab5f40e902b864ad4d7ade8e412f9b1');
    t('staking flag ships off', adapter.LIDO_STAKE_ENABLED === false);
    t('stake caps are 1 / 10 ETH', adapter.LIDO_STAKE_MAX_ETH_PER_TX === 1 && adapter.LIDO_STAKE_MAX_ETH_TOTAL === 10);
    const deployment = await adapter.verifyDeployment(provider);
    t('stETH, wstETH and queue immutable links verify', deployment.stETH === adapter.LIDO.stETH && deployment.wstETH === adapter.LIDO.wstETH && deployment.withdrawalQueue === adapter.LIDO.withdrawalQueue);
    const status = await adapter.getProtocolStatus(provider);
    t('protocol status is readable without fabricated values', status.totalPooledEtherWei > 0n && status.withdrawalQueueLength >= 0n, `${formatEther(status.totalPooledEtherWei)} pooled ETH`);

    rule('1 · stake exact ETH and prove stETH position change');
    const stakeAmount = parseEther('0.01');
    const beforeStake = await adapter.getPosition(provider, ACCOUNT);
    const stakePlan = await adapter.buildStakePlan({
      provider,
      owner: ACCOUNT,
      amountEth: '0.01',
      nativeBalance: await provider.getBalance(ACCOUNT)
    });
    t('stake plan is not blocked', stakePlan.checks.blocked.length === 0, stakePlan.checks.blocked.join(',') || 'none');
    t('stake calldata targets pinned stETH', stakePlan.steps.length === 1 && stakePlan.steps[0].to.toLowerCase() === adapter.LIDO.stETH.toLowerCase());
    await sendStep({ signer, provider, adapter, step: stakePlan.steps[0], owner: ACCOUNT, amountWei: stakeAmount, beforePosition: beforeStake, nonce: nonce++ });
    const afterStake = await adapter.getPosition(provider, ACCOUNT);
    t('stake increased the stETH balance', afterStake.stETHWei > beforeStake.stETHWei, `${formatEther(afterStake.stETHWei)} stETH`);

    rule('2 · exact approval + wrap, then unwrap');
    const wrapAmount = '0.005';
    const wrapWei = parseEther(wrapAmount);
    const wrapPlan = await adapter.buildWrapPlan({ provider, owner: ACCOUNT, amountStETH: wrapAmount });
    t('wrap plan is exact approval then wrap', wrapPlan.steps.map((s) => s.kind).join(',') === 'approve,wrap');
    const beforeWrap = await adapter.getPosition(provider, ACCOUNT);
    for (const step of wrapPlan.steps) {
      await sendStep({ signer, provider, adapter, step, owner: ACCOUNT, amountWei: wrapWei, beforePosition: step.kind === 'wrap' ? beforeWrap : null, nonce: nonce++ });
    }
    const afterWrap = await adapter.getPosition(provider, ACCOUNT);
    t('wrap created wstETH position', afterWrap.wstETHWei > beforeWrap.wstETHWei && afterWrap.stETHWei < beforeWrap.stETHWei, `${formatEther(afterWrap.wstETHWei)} wstETH`);

    // stETH -> wstETH is NOT 1:1 at the share price, so the wstETH held differs
    // from the stETH that produced it. Unwrap must use the REAL wstETH balance
    // (read from the position), not the stETH input amount — otherwise the plan
    // comes back blocked (LIDO_INSUFFICIENT_WSTETH) and steps[] is empty.
    const unwrapAmount = formatEther(afterWrap.wstETHWei);
    const unwrapWei = afterWrap.wstETHWei;
    const unwrapPlan = await adapter.buildUnwrapPlan({ provider, owner: ACCOUNT, amountWstETH: unwrapAmount });
    const beforeUnwrap = await adapter.getPosition(provider, ACCOUNT);
    t('unwrap plan is one exact step', unwrapPlan.steps.length === 1 && unwrapPlan.steps[0].kind === 'unwrap');
    await sendStep({ signer, provider, adapter, step: unwrapPlan.steps[0], owner: ACCOUNT, amountWei: unwrapWei, beforePosition: beforeUnwrap, nonce: nonce++ });
    const afterUnwrap = await adapter.getPosition(provider, ACCOUNT);
    t('unwrap returned stETH and reduced wstETH', afterUnwrap.stETHWei > beforeUnwrap.stETHWei && afterUnwrap.wstETHWei < beforeUnwrap.wstETHWei, `${formatEther(afterUnwrap.stETHWei)} stETH`);

    rule('3 · request withdrawal and extract the real requestId');
    const requestAmount = '0.005';
    const requestWei = parseEther(requestAmount);
    const requestPlan = await adapter.buildRequestWithdrawPlan({ provider, owner: ACCOUNT, amountStETH: requestAmount });
    t('withdrawal request plan is exact approval then queue request', requestPlan.steps.map((s) => s.kind).join(',') === 'approve,requestWithdraw');
    let requestProof = null;
    for (const step of requestPlan.steps) {
      const result = await sendStep({ signer, provider, adapter, step, owner: ACCOUNT, amountWei: requestWei, nonce: nonce++ });
      if (step.kind === 'requestWithdraw') requestProof = result.proof;
    }
    const requestId = requestProof?.requestId;
    t('requestId came from WithdrawalRequested', typeof requestId === 'bigint' && requestId > 0n, String(requestId));
    const afterRequest = await adapter.getPosition(provider, ACCOUNT);
    const ownPending = afterRequest.withdrawals.statuses.find((row) => row.requestId === requestId);
    t('request ownership is the connected account', Boolean(ownPending && ownPending.owner.toLowerCase() === ACCOUNT.toLowerCase()));
    t('a fresh request is not falsely treated as finalized', ownPending && ownPending.isFinalized === false && ownPending.isClaimed === false);
    const blockedClaim = await adapter.buildClaimPlan({ provider, owner: ACCOUNT, requestId });
    t('claim remains blocked until finalization', blockedClaim.steps.length === 0 && blockedClaim.checks.blocked.includes('LIDO_NOT_FINALIZED'));

    rule('4 · finalized ownership + claim proof on a real queue request');
    const queueIface = new Interface(['event WithdrawalRequested(uint256 indexed requestId, address indexed requestor, address indexed owner, uint256 amountOfStETH, uint256 amountOfShares)']);
    const topic = queueIface.getEvent('WithdrawalRequested').topicHash;
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - Number(process.env.LIDO_LOG_WINDOW || 100_000));
    // Chunked so the fork RPC is not rejected for an oversized eth_getLogs range.
    const logs = await fetchLogsChunked(provider, { address: adapter.LIDO.withdrawalQueue, topics: [topic], fromBlock, toBlock: latest });
    let claimCandidate = null;
    for (const log of logs.slice().reverse()) {
      const parsed = queueIface.parseLog({ topics: log.topics, data: log.data });
      const id = BigInt(String(parsed.args.requestId));
      const owner = String(parsed.args.owner);
      const queue = new Contract(adapter.LIDO.withdrawalQueue, [
        'function getWithdrawalStatus(uint256[]) view returns (tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])'
      ], provider);
      const row = (await queue.getWithdrawalStatus([id]))?.[0];
      if (row && String(row.owner).toLowerCase() === owner.toLowerCase() && Boolean(row.isFinalized) && !Boolean(row.isClaimed)) {
        claimCandidate = { id, owner };
        break;
      }
    }
    t('found a real finalized, unclaimed request for ownership/claim proof', Boolean(claimCandidate), claimCandidate ? `#${claimCandidate.id}` : `searched ${logs.length} requests`);
    if (claimCandidate) {
      const claimPlan = await adapter.buildClaimPlan({ provider, owner: claimCandidate.owner, requestId: claimCandidate.id });
      t('claim plan accepts the finalized owner only', claimPlan.steps.length === 1 && claimPlan.steps[0].kind === 'claim');
      await rpc(url, 'anvil_setBalance', [claimCandidate.owner, '0xDE0B6B3A7640000']);
      await rpc(url, 'anvil_impersonateAccount', [claimCandidate.owner]);
      try {
        const claimSigner = await provider.getSigner(claimCandidate.owner);
        const tx = await claimSigner.sendTransaction({ to: claimPlan.steps[0].to, data: claimPlan.steps[0].data });
        const receipt = await tx.wait();
        const proof = await adapter.verifyLidoReceipt({ provider, receipt, owner: claimCandidate.owner, action: 'claim', requestId: claimCandidate.id });
        t('claim receipt/event/state proves finalization and ownership', proof.ok === true && proof.requestId === claimCandidate.id, receipt.hash.slice(0, 18));
      } finally {
        await rpc(url, 'anvil_stopImpersonatingAccount', [claimCandidate.owner]);
      }
    }
  }
} catch (err) {
  t('probe completed without an unexpected error', false, `${err?.code ?? err?.name}: ${err?.message}`);
} finally {
  if (anvil) { anvil.kill('SIGKILL'); await new Promise((resolve) => setTimeout(resolve, 200)); }
}
rule('result');
const failed = rows.filter((row) => !row.ok);
for (const row of rows) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name} ${row.detail}`);
console.log(`${rows.length - failed.length}/${rows.length} passed`);
process.exit(failed.length || (STRICT && rows.length === 0) ? 1 : 0);

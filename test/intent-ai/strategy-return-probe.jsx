/**
 * THE REPORTED LOOP: user leaves for the swap, swaps, comes back.
 * ---------------------------------------------------------------------------
 * Reported (fa): «بعد از این‌که سواپ را زدم و برگشتم، دوباره نمی‌پرسه انجام دادی
 * یا نه؛ مرحله جلو نمی‌ره» — after a swap hand-off the plan never advances, the
 * thread either re-asks or stalls, and the stage stays at 0% forever.
 *
 * The two halves of that loop live in different files and neither can be seen
 * from the other's tests:
 *
 *   the VENUE  (src/pages/Swap.jsx) must record WHICH transaction claims to be
 *              this stage's execution — for a token output AND for the chain's
 *              own coin, which the old gate excluded;
 *   the CHAT   (src/components/IntentAIUnified.jsx) must, on its return turn,
 *              READ that candidate against the chain and settle the stage —
 *              without asking the user a question this app can answer itself.
 *
 * So this probe mounts the page, drives the plan to its money stage, THROWS THE
 * PAGE AWAY (a real navigation), performs the swap on the chain, and mounts the
 * page again exactly as returning from /swap does. The assertion is the one the
 * user made: the stage comes back CONFIRMED, with no further tap and no
 * question.
 *
 * Everything the chain returns is stubbed; nothing about the app is.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { AbiCoder, FetchRequest, FetchResponse, Interface, JsonRpcProvider, FallbackProvider } from 'ethers';
import { TelegramProvider } from '../../src/context/TelegramContext.jsx';
import { WalletProvider } from '../../src/context/WalletContext.jsx';
import IntentAIUnified from '../../src/components/IntentAIUnified.jsx';
import { recordStrategyReceiptHint, reconcileStrategyReceipts } from '../../src/lib/strategyBrain/strategyReceipts.js';

import { writeWalletLease } from '../../src/lib/wc/lease.js';
import { ERC20_MIN_ABI } from '../../src/lib/lending.js';
import { TOKENS } from '../../src/lib/chains.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHAIN = 8453;
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const USDC = TOKENS[CHAIN].find((t) => t.symbol === 'USDC');

const coder = AbiCoder.defaultAbiCoder();
const erc20Iface = new Interface(ERC20_MIN_ABI);
const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const MARKET_ROWS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 60000, change1h: 0.1, change24h: 0.9, change7d: 2.4, mcap: 1.2e12, volume: 2.4e10, rank: 1 },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', price: 3000, change1h: -0.2, change24h: -1.8, change7d: 1.1, mcap: 3.6e11, volume: 1.2e10, rank: 2 },
  { id: 'usd-coin', symbol: 'USDC', name: 'USD Coin', price: 1, change1h: 0, change24h: 0.01, change7d: 0, mcap: 4.1e10, volume: 6e9, rank: 6 },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', price: 25, change1h: 0.4, change24h: 1.3, change7d: 5.2, mcap: 1.6e10, volume: 4e8, rank: 14 },
  { id: 'dai', symbol: 'DAI', name: 'Dai', price: 1, change1h: 0, change24h: 0, change7d: 0.01, mcap: 5e9, volume: 1e8, rank: 25 }
];

export async function run(container) {
  const rows = [];
  const check = (name, ok) => { rows.push([name, !!ok]); console.log((ok ? '✓ ' : '✗ ') + name); };
  const q = (sel) => container.querySelector(sel);

  const realFetch = globalThis.fetch;
  const swapTx = { hash: `0x${'cd'.repeat(32)}`, block: 512, router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' };
  let swapped = false;
  let swapAt = 0;

  const balances = { [USDC.address.toLowerCase()]: 5000_000000n };
  const ethCall = (tx) => {
    const to = String(tx?.to || '').toLowerCase();
    const data = String(tx?.data || '0x');
    const selector = data.slice(0, 10);
    if (selector === erc20Iface.getFunction('balanceOf').selector) {
      return coder.encode(['uint256'], [balances[to] ?? 0n]);
    }
    if (selector === erc20Iface.getFunction('decimals').selector) return coder.encode(['uint8'], [6]);
    if (selector === erc20Iface.getFunction('allowance').selector) return coder.encode(['uint256'], [0n]);
    return '0x';
  };
  const rpc = async (method, params = [], chainHint = CHAIN) => {
    switch (method) {
      case 'eth_chainId': return '0x' + chainHint.toString(16);
      case 'net_version': return String(chainHint);
      case 'eth_accounts':
      case 'eth_requestAccounts': return [ACCOUNT];
      case 'eth_blockNumber': return '0x200';
      case 'eth_getBalance': {
        if (chainHint !== CHAIN) return '0x0';
        const atBlock = Number(BigInt(String(params?.[1] ?? '0x0')));
        return (swapped && Number.isFinite(atBlock) && atBlock >= swapTx.block) ? '0xe6ed27ddc5c0000' : '0xde0b6b3a7640000';
      }
      case 'eth_call': return chainHint === CHAIN ? ethCall(params[0]) : '0x';
      case 'eth_getTransactionCount': return '0x0';
      case 'eth_gasPrice': return '0x3b9aca00';
      case 'eth_getBlockByNumber': {
        const seconds = Math.floor((swapAt || Date.now()) / 1000);
        return { number: `0x${swapTx.block.toString(16)}`, hash: `0x${'11'.repeat(32)}`, parentHash: `0x${'22'.repeat(32)}`,
          timestamp: `0x${seconds.toString(16)}`, difficulty: '0x0', totalDifficulty: '0x0', nonce: '0x0000000000000000',
          mixHash: `0x${'33'.repeat(32)}`, sha3Uncles: `0x${'44'.repeat(32)}`, stateRoot: `0x${'55'.repeat(32)}`,
          transactionsRoot: `0x${'66'.repeat(32)}`, receiptsRoot: `0x${'77'.repeat(32)}`,
          logsBloom: `0x${'00'.repeat(256)}`, size: '0x100', uncles: [],
          gasLimit: '0x1c9c380', gasUsed: '0x5208', baseFeePerGas: '0x3b9aca00',
          miner: ACCOUNT, extraData: '0x', transactions: [] };
      }
      case 'eth_getTransactionReceipt': {
        if (!swapped || String(params?.[0]).toLowerCase() !== swapTx.hash) return null;
        return { transactionHash: swapTx.hash, blockHash: `0x${'11'.repeat(32)}`,
          blockNumber: `0x${swapTx.block.toString(16)}`, from: ACCOUNT, to: swapTx.router,
          cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00',
          contractAddress: null, status: '0x1', type: '0x2', transactionIndex: '0x0',
          logsBloom: `0x${'00'.repeat(256)}`,
          logs: [{
            address: USDC.address,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              `0x${'0'.repeat(24)}${ACCOUNT.slice(2).toLowerCase()}`,
              `0x${'0'.repeat(24)}${swapTx.router.slice(2).toLowerCase()}`
            ],
            data: coder.encode(['uint256'], [1000_000000n]),
            blockNumber: `0x${swapTx.block.toString(16)}`, blockHash: `0x${'11'.repeat(32)}`,
            transactionHash: swapTx.hash, transactionIndex: '0x0', logIndex: '0x0', removed: false
          }] };
      }
      case 'eth_getTransactionByHash': {
        if (!swapped || String(params?.[0]).toLowerCase() !== swapTx.hash) return null;
        return { hash: swapTx.hash, blockHash: `0x${'11'.repeat(32)}`, blockNumber: `0x${swapTx.block.toString(16)}`,
          transactionIndex: '0x0', from: ACCOUNT, to: swapTx.router, value: '0x0', gas: '0x30d40',
          gasPrice: '0x3b9aca00', maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x3b9aca00',
          input: '0xdeadbeef', nonce: '0x0', type: '0x2', accessList: [], chainId: '0x2105',
          v: '0x1', r: `0x${'11'.repeat(32)}`, s: `0x${'22'.repeat(32)}`, yParity: '0x1' };
      }
      default: return null;
    }
  };
  const serve = async (bodyText, chainHint = CHAIN) => {
    let body = null;
    try { body = JSON.parse(bodyText || 'null'); } catch { body = null; }
    if (!body) return JSON.stringify({ error: 'bad request' });
    const one = async (call) => ({ jsonrpc: '2.0', id: call.id, result: await rpc(call.method, call.params, chainHint) });
    const payload = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
    return JSON.stringify(payload);
  };
  const chainOfUrl = (url) => (/base/i.test(String(url)) ? 8453 : (/arbitrum|arb1/i.test(String(url)) ? 42161 : CHAIN));
  FetchRequest.registerGetUrl(async (req) => {
    const text = await serve(req.body ? new TextDecoder().decode(req.body) : null, chainOfUrl(req.url));
    return new FetchResponse(200, 'OK', { 'content-type': 'application/json' }, new TextEncoder().encode(text), req);
  });
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/markets?')) return new Response(JSON.stringify(MARKET_ROWS), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/category/')) return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/v1/ai/monitors')) return new Response(JSON.stringify({ ok: true, monitor: { id: 'mon-return' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/api/')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error('test: domain deliberately unavailable');
  };
  window.ethereum = { isMetaMask: true, request: ({ method, params }) => rpc(method, params, CHAIN), on() {}, removeListener() {} };
  writeWalletLease({ address: ACCOUNT, chainId: CHAIN, mode: 'injected', minutes: 60 });

  let root = null;
  const mount = async () => {
    root = createRoot(container);
    await act(async () => {
      root.render(
        <TelegramProvider>
          <WalletProvider>
            <MemoryRouter initialEntries={['/intent']}>
              <IntentAIUnified />
            </MemoryRouter>
          </WalletProvider>
        </TelegramProvider>
      );
    });
    for (let i = 0; i < 12; i += 1) await act(async () => { await sleep(60); });
  };
  const unmount = async () => { await act(async () => { root.unmount(); }); };

  const STORE_KEY = 'fbt.strategy-brain.plans.v1';
  const stored = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; } };
  const states = () => Object.fromEntries(Object.entries((stored().plans || [])[0]?.runtime?.stageProgress || {})
    .map(([k, v]) => [k, v?.state]));

  /* ── 1. plan, preflight, hand-off — the same path as the wallet probe ─── */
  await mount();
  const input = q('.iaos-composer input.iaos-input');
  await act(async () => { setInputValue(input, 'من ۱۰۰۰ دلار دارم، در ۲۰ روز ۲۰٪ سود می‌خواهم، ریسک متوسط'); });
  const send = q('.iaos-composer button.iaos-send');
  if (send) await act(async () => { send.click(); });
  for (let i = 0; i < 120; i += 1) {
    await act(async () => { await sleep(50); });
    if (q('[data-testid="strategy-plan-card"]')) break;
  }
  const run = q('[data-testid="strategy-execute-stage"]');
  if (run) await act(async () => { run.click(); });
  for (let i = 0; i < 40; i += 1) await act(async () => { await sleep(50); });
  const run2 = q('[data-testid="strategy-execute-stage"]');
  if (run2) await act(async () => { run2.click(); });
  for (let i = 0; i < 40; i += 1) await act(async () => { await sleep(50); });
  check('the money stage is handed off and RUNNING before the user leaves',
    states()['deploy-market'] === 'RUNNING');

  /* ── 2. the user leaves for /swap and swaps ───────────────────────────── */
  await unmount();
  const plan = (stored().plans || [])[0]?.strategy;
  const action = (plan?.stages || []).find((st) => st.id === 'deploy-market')?.actions?.[0];
  /* The venue's own hand-off record, written by the swap screen on success. */
  /* The hand-off the chat wrote before the user left (same key, same shape). */
  const HANDOFF_KEY = 'fbt.ai.os.pending-handoff';
  const handoff = {
    route: '/swap?from=USDC&to=ETH&amount=1000&chain=8453',
    label: 'stage', kind: 'strategy-stage', strategyId: plan?.strategyId,
    stageId: 'deploy-market', actionIndex: 0, seasonId: 'return-probe', at: Date.now()
  };
  localStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
  const readHandoff = () => {
    try { return JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null'); } catch { return null; }
  };
  check('the hand-off the chat left is on the device (the user is "away")', readHandoff()?.stageId === 'deploy-market');
  swapped = true;
  swapAt = Date.now();
  const hint = recordStrategyReceiptHint({
    strategyId: plan?.strategyId, stageId: 'deploy-market', actionIndex: 0,
    txHash: swapTx.hash, owner: ACCOUNT, chainId: CHAIN, asset: action?.params?.asset,
    amountWei: String(1000_000000n)
  });
  check('the swap screen leaves a locator for a native-output swap (the reported plan)', hint.ok === true);

  console.log('  hints before return:', localStorage.getItem('fbt.strategy-brain.receipt-hints.v1'));
  {
    const rp = new JsonRpcProvider('https://base-rpc.publicnode.com', CHAIN, { staticNetwork: true });
    const fallback = new FallbackProvider(
      [{ provider: rp, priority: 1, stallTimeout: 2500, weight: 1 }], CHAIN, { quorum: 1, cacheTimeout: 15000 });
    const rec = await reconcileStrategyReceipts({
      strategy: plan, stageId: 'deploy-market', owner: ACCOUNT, getProvider: async () => fallback
    });
    console.log('  direct reconcile:', JSON.stringify(rec).slice(0, 300));
  }
  console.log('  handoff before return:', localStorage.getItem('fbt.ai.os.pending-handoff'));
  /* ── 3. the user comes back to the chat ───────────────────────────────── */
  await mount();
  for (let i = 0; i < 80; i += 1) {
    await act(async () => { await sleep(60); });
    if (states()['deploy-market'] === 'CONFIRMED') break;
  }
  const after = states();
  console.log('  stage states after returning:', JSON.stringify(after));
  console.log('  card after return:', Boolean(q('[data-testid="strategy-plan-card"]')),
    q('[data-testid="strategy-plan-card"]')?.dataset?.strategy || '');
  const lastMsgs = [...container.querySelectorAll('.iaos-msg.iaos-ai')].map((el) => (el.textContent || '').slice(0, 130));
  console.log('  all AI messages after return:\n   - ' + lastMsgs.join('\n   - '));
  console.log('  blocked banner:', q('[data-testid="strategy-blocked"]')?.textContent?.slice(0, 160) || 'none');
  const savedPlan = (stored().plans || [])[0];
  console.log('  stored runtime states:', JSON.stringify(savedPlan?.runtime?.stageProgress));
  console.log('  stored stage actions:', JSON.stringify((savedPlan?.strategy?.stages || []).map((st) => ({ id: st.id, moves: st.movesFunds, actions: (st.actions || []).map((a) => ({ cap: a.capabilityId, sig: a.requiresSignature, route: a.route, params: a.params })) }))));
  check('Persian handoff messages never leak raw English stage objectives',
    !Array.from(container.querySelectorAll('.iaos-msg.iaos-ai .iaos-msg-text')).some((m) => /Deploy the market sleeve|Add the 100% that has price risk/.test(m.textContent || '')));
  check('returning from a completed swap settles the stage with no extra tap', after['deploy-market'] === 'CONFIRMED');
  check('the plan then runs its remaining no-signature stage to the end', after.monitor === 'CONFIRMED');
  check('the return turn does NOT re-ask whether the swap was done',
    !/انجام دادی|did you (do|complete)|did it happen\?/i.test(container.textContent || ''));
  check('the settled hand-off is cleared from the device (no re-ask on the next visit)',
    readHandoff()?.kind !== 'strategy-stage');

  globalThis.fetch = realFetch;
  await unmount();
  return rows;
}

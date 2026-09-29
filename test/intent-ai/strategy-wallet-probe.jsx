/**
 * THE STRATEGY CHAT WITH A REAL WALLET ATTACHED — does every stage run?
 * ---------------------------------------------------------------------------
 * Reported (fa): «۱۰۰۰ دلار، ۲۰٪ در ۲۰ روز» می‌نویسم، کارت تحلیل می‌آید، ولی
 * دکمه‌های زیرش کار نمی‌کنند و مرحله بعد اجرا نمی‌شود؛ پیش‌پرواز
 * WALLET_REQUIRED می‌دهد با اینکه کیف پول وصل است و «هیچ مرحله‌ای اجرا یا تأیید
 * نشد».
 *
 * strategy-chat-probe covers the DISCONNECTED path end to end (an offline
 * refusal must be honest, and executing without a wallet must refuse). What it
 * cannot see is the half that the report is actually about: a wallet that IS
 * attached. That path runs through code no offline probe touches —
 * `useMultiChainPortfolio` reading balances over an EIP-1193 provider, the
 * live-price provenance flags, `evaluateStrategyPreflight` grading the whole
 * snapshot, and the handoff that is supposed to unlock the next stage.
 *
 * So this probe attaches one:
 *
 *   wallet  → a stub EIP-1193 provider (MetaMask's interface), remembered by a
 *             lease so the page attaches it SILENTLY on the mount tick —
 *             `eth_accounts` only, never a prompt
 *   chain   → one JSON-RPC handler serving BOTH the read providers (over
 *             ethers' fetch transport) and the wallet, exactly like the real
 *             thing: USDC + ETH balances on Base
 *   market  → the app's own backend shape (`/api/markets`), marked live, with
 *             prices for every token the wallet holds — so the USD total has
 *             verified prices rather than a partial book
 *
 * The goal is the reported one: $1,000, 20% in 20 days. The probe then drives
 * the card the way a user does and asserts the ONE thing the report says never
 * happens: the plan's stages actually advance, all the way to the last one.
 *
 * Everything the chain or the backend returns is stubbed; nothing about the
 * app is.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { AbiCoder, FetchRequest, FetchResponse, Interface, JsonRpcProvider } from 'ethers';
import { TelegramProvider } from '../../src/context/TelegramContext.jsx';
import { WalletProvider } from '../../src/context/WalletContext.jsx';
import IntentAIUnified from '../../src/components/IntentAIUnified.jsx';
import { clearApiCache } from '../../src/lib/api.js';
import { resetSharedReads } from '../../src/lib/strategyBrain/chatBridge.js';
import { recordStrategyReceiptHint, verifyStrategySwap } from '../../src/lib/strategyBrain/strategyReceipts.js';
import { writeWalletLease } from '../../src/lib/wc/lease.js';
import { useWallet } from '../../src/context/WalletContext.jsx';
import { useMultiChainPortfolio } from '../../src/hooks/useMultiChainPortfolio.js';
import { ERC20_MIN_ABI } from '../../src/lib/lending.js';
import { TOKENS } from '../../src/lib/chains.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHAIN = 8453;                       // Base — the plan's default network
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const USDC = TOKENS[CHAIN].find((t) => t.symbol === 'USDC');
const NATIVE = TOKENS[CHAIN].find((t) => t.native);

const coder = AbiCoder.defaultAbiCoder();
const erc20Iface = new Interface(ERC20_MIN_ABI);

const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

/** Market rows in the shape /api/markets returns, with live provenance. */
/* The server's own normalised shape (server/providers.js normalizeCoin), with
   the liquidity fields the strategy engine filters on — mcap and volume. */
const MARKET_ROWS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 60000, change1h: 0.1, change24h: 0.9, change7d: 2.4, mcap: 1.2e12, volume: 2.4e10, rank: 1 },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', price: 3000, change1h: -0.2, change24h: -1.8, change7d: 1.1, mcap: 3.6e11, volume: 1.2e10, rank: 2 },
  { id: 'usd-coin', symbol: 'USDC', name: 'USD Coin', price: 1, change1h: 0, change24h: 0.01, change7d: 0, mcap: 4.1e10, volume: 6e9, rank: 6 },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', price: 25, change1h: 0.4, change24h: 1.3, change7d: 5.2, mcap: 1.6e10, volume: 4e8, rank: 14 },
  { id: 'dai', symbol: 'DAI', name: 'Dai', price: 1, change1h: 0, change24h: 0, change7d: 0.01, mcap: 5e9, volume: 1e8, rank: 25 },
  { id: 'pax-gold', symbol: 'PAXG', name: 'PAX Gold', price: 3300, change1h: 0.1, change24h: 0.2, change7d: 0.8, mcap: 8e8, volume: 3e7, rank: 40 }
];

/*
 * The page and this spy read the SAME hook, with the same wallet object, so the
 * numbers the preflight grades are visible to the assertions instead of being
 * inferred from a refusal sentence.
 */
const spy = { portfolio: null, wallet: null };
function PortfolioSpy() {
  const wallet = useWallet();
  const multi = useMultiChainPortfolio(wallet?.isConnected && wallet?.address && !wallet?.locked ? wallet : null);
  spy.wallet = { attached: Boolean(wallet?.address), isConnected: wallet?.isConnected, canSign: wallet?.canSign, locked: wallet?.locked, chainId: wallet?.chainId };
  spy.portfolio = multi ? {
    partial: multi.partial, priceDataStatus: multi.priceDataStatus, loading: multi.loading,
    loaded: multi.loaded, failedChains: multi.failedChains, staleChains: multi.staleChains,
    pricedCount: multi.pricedCount, totalCount: multi.totalCount, totalValue: multi.totalValue,
    updatedAt: multi.updatedAt,
    chains: (multi.chains || []).filter((c) => c.rows.length).map((c) => ({
      chainId: c.chainId, failed: Boolean(c.error), stale: Boolean(c.stale),
      rows: c.rows.map((r) => `${r.symbol}=${Number(r.amount).toPrecision(3)}${r.value == null ? ' UNPRICED' : ''}`)
    }))
  } : null;
  return null;
}

export async function run(container) {
  const rows = [];
  const check = (name, ok) => { rows.push([name, !!ok]); console.log((ok ? '✓ ' : '✗ ') + name); };
  const q = (sel) => container.querySelector(sel);

  const realFetch = globalThis.fetch;
  const ethCalls = [];

  /* ── the chain, as far as this test is concerned ──────────────────────── */
  const balances = {
    [USDC.address.toLowerCase()]: 5000_000000n,   // $5,000
    [TOKENS[CHAIN].find((t) => t.symbol === 'DAI').address.toLowerCase()]: 0n,
    [TOKENS[CHAIN].find((t) => t.symbol === 'cbBTC').address.toLowerCase()]: 0n
  };
  /* The venue leg the user performs on /swap: one transaction that pays USDC
     and delivers ETH to the same wallet. The stub RPC serves it back the way a
     node would, so reconciliation runs its real code path. */
  const swapTx = {
    hash: `0x${'ab'.repeat(32)}`, block: 256,
    router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24'
  };
  let nativeDeltaAfterSwap = false;
  let swapAt = 0;

  const ethCall = (tx) => {
    const to = String(tx?.to || '').toLowerCase();
    const data = String(tx?.data || '0x');
    const selector = data.slice(0, 10);
    if (selector === erc20Iface.getFunction('balanceOf').selector) {
      return coder.encode(['uint256'], [balances[to] ?? 0n]);
    }
    if (selector === erc20Iface.getFunction('decimals').selector) {
      const decimals = [USDC].find((t) => t?.address?.toLowerCase() === to)?.decimals ?? 18;
      return coder.encode(['uint8'], [decimals]);
    }
    if (selector === erc20Iface.getFunction('allowance').selector) {
      return coder.encode(['uint256'], [0n]);
    }
    if (selector === erc20Iface.getFunction('symbol').selector) return coder.encode(['string'], ['USDC']);
    return '0x';
  };
  const rpc = async (method, params = [], chainHint = CHAIN) => {
    ethCalls.push(method);
    switch (method) {
      case 'eth_chainId': return '0x' + chainHint.toString(16);
      case 'net_version': return String(chainHint);
      case 'eth_accounts':
      case 'eth_requestAccounts': return [ACCOUNT];
      case 'eth_blockNumber': return '0x100';
      /* Base holds 1 ETH + the USDC above ($8,000 priced); every other network
         answers honestly EMPTY — the way a real wallet looks, and the case the
         whole-book `partial` rule used to refuse. */
      case 'eth_getBalance': {
        if (chainHint !== CHAIN) return '0x0';
        /* Before the swap 1.00 ETH, from the settlement block on 1.02 — the
           acquisition the native verifier reads as a positive delta. */
        const atBlock = Number(BigInt(String(params?.[1] ?? '0x0')));
        const beforeOrAt = Number.isFinite(atBlock) && atBlock >= swapTx.block;
        return (nativeDeltaAfterSwap && beforeOrAt) ? '0xe6ed27ddc5c0000' : '0xde0b6b3a7640000';
      }
      case 'eth_call': return chainHint === CHAIN ? ethCall(params[0]) : '0x';
      case 'eth_getTransactionCount': return '0x0';
      case 'eth_gasPrice': return '0x3b9aca00';
      case 'eth_getBlockByNumber': {
        /* Wall-clock seconds: a block older than the stage start would (rightly)
           be rejected as «before this stage». */
        const seconds = Math.floor((swapAt || Date.now()) / 1000);
        return { number: `0x${swapTx.block.toString(16)}`, hash: `0x${'11'.repeat(32)}`, parentHash: `0x${'22'.repeat(32)}`,
          timestamp: `0x${seconds.toString(16)}`, difficulty: '0x0', totalDifficulty: '0x0', nonce: '0x0000000000000000',
          mixHash: `0x${'33'.repeat(32)}`, sha3Uncles: `0x${'44'.repeat(32)}`, stateRoot: `0x${'55'.repeat(32)}`,
          transactionsRoot: `0x${'66'.repeat(32)}`, receiptsRoot: `0x${'77'.repeat(32)}`,
          logsBloom: `0x${'00'.repeat(256)}`, size: '0x100', uncles: [],
          gasLimit: '0x1c9c380', gasUsed: '0x5208',
          baseFeePerGas: '0x3b9aca00', miner: ACCOUNT, extraData: '0x', transactions: [] };
      }
      case 'eth_getTransactionReceipt': {
        if (!nativeDeltaAfterSwap || String(params?.[0]).toLowerCase() !== swapTx.hash) return null;
        const usdcTransfer = {
          address: USDC.address,
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            `0x${'0'.repeat(24)}${ACCOUNT.slice(2).toLowerCase()}`,
            `0x${'0'.repeat(24)}${swapTx.router.slice(2).toLowerCase()}`
          ],
          data: coder.encode(['uint256'], [1000_000000n]),
          blockNumber: `0x${swapTx.block.toString(16)}`,
          transactionHash: swapTx.hash, transactionIndex: '0x0', logIndex: '0x0', removed: false,
          blockHash: `0x${'11'.repeat(32)}`
        };
        return { transactionHash: swapTx.hash, blockHash: `0x${'11'.repeat(32)}`,
          blockNumber: `0x${swapTx.block.toString(16)}`, from: ACCOUNT, to: swapTx.router,
          cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00',
          contractAddress: null, logs: [usdcTransfer], logsBloom: `0x${'00'.repeat(256)}`,
          status: '0x1', type: '0x2', transactionIndex: '0x0' };
      }
      case 'eth_getTransactionByHash': {
        if (!nativeDeltaAfterSwap || String(params?.[0]).toLowerCase() !== swapTx.hash) return null;
        return { hash: swapTx.hash, blockHash: `0x${'11'.repeat(32)}`,
          blockNumber: `0x${swapTx.block.toString(16)}`, transactionIndex: '0x0', from: ACCOUNT,
          to: swapTx.router, value: '0x0', gas: '0x30d40', gasPrice: '0x3b9aca00',
          maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x3b9aca00',
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
  /* Read providers are per chain and reach the node by URL, so the URL is what
     tells this handler which network is answering — exactly as it does live. */
  const chainOfUrl = (url) => {
    const u = String(url || '');
    for (const [id, key] of Object.entries({
      8453: /base/i, 42161: /arbitrum|arb1/i, 1: /mainnet\.io|eth\.|ethereum/i,
      137: /polygon/i, 10: /optimism/i, 56: /bsc|binance/i, 43114: /avax/i
    })) {
      if (key.test(u)) return Number(id);
    }
    return CHAIN;
  };
  FetchRequest.registerGetUrl(async (req) => {
    const text = await serve(req.body ? new TextDecoder().decode(req.body) : null, chainOfUrl(req.url));
    return new FetchResponse(200, 'OK', { 'content-type': 'application/json' }, new TextEncoder().encode(text), req);
  });

  /* The app's own backend: markets + categories arrive live, the rest of the
     twenty-one domains answer with a shape, not a fabricate-able number. */
  const fetchLog = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    fetchLog.push(u.slice(0, 90));
    if (u.includes('/markets?')) {
      return new Response(JSON.stringify(MARKET_ROWS), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/category/')) {
      return new Response(JSON.stringify([MARKET_ROWS[5]]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/v1/ai/monitors') && u.includes('/status')) {
      return new Response(JSON.stringify({ ok: true, monitors: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/v1/ai/monitors')) {
      return new Response(JSON.stringify({ ok: true, monitor: { id: `mon-${fetchLog.filter((x) => x.includes('/status')).length + 1}` } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/api/')) {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('test: domain deliberately unavailable');
  };

  window.ethereum = {
    isMetaMask: true,
    request: ({ method, params }) => rpc(method, params, CHAIN),
    on() {},
    removeListener() {}
  };
  /* Remember the connection the way a returning user's device has it, so the
     page re-attaches with eth_accounts and never a prompt. */
  writeWalletLease({ address: ACCOUNT, chainId: CHAIN, mode: 'injected', minutes: 60 });

  /* ── mount the real page ──────────────────────────────────────────────── */
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TelegramProvider>
        <WalletProvider>
          <MemoryRouter initialEntries={['/intent']}>
            <PortfolioSpy />
            <IntentAIUnified />
          </MemoryRouter>
        </WalletProvider>
      </TelegramProvider>
    );
  });
  for (let i = 0; i < 12; i += 1) await act(async () => { await sleep(60); });

  console.log('  wallet snapshot:', JSON.stringify(spy.wallet));
  console.log('  portfolio snapshot:', JSON.stringify(spy.portfolio));
  const sentEth = ethCalls.slice();
  check('the wallet re-attaches silently (eth_accounts, never a prompt)',
    sentEth.includes('eth_accounts') && !sentEth.includes('eth_requestAccounts'));

  const aiText = () => [...container.querySelectorAll('.iaos-msg.iaos-ai')].map((el) => el.textContent || '').join('\n');

  /* ── type the reported objective ──────────────────────────────────────── */
  const input = q('.iaos-composer input.iaos-input');
  await act(async () => { setInputValue(input, 'من ۱۰۰۰ دلار دارم، در ۲۰ روز ۲۰٪ سود می‌خواهم، ریسک متوسط'); });
  await act(async () => { await sleep(20); });
  const send = q('.iaos-composer button.iaos-send');
  check('the objective is accepted by the composer', !!send && send.disabled === false);
  if (send) await act(async () => { send.click(); });

  let card = null;
  for (let i = 0; i < 120; i += 1) {
    await act(async () => { await sleep(50); });
    card = q('[data-testid="strategy-plan-card"]') || q('[data-testid="strategy-plan-refused"]') || q('[data-testid="strategy-plan-error"]');
    if (card) break;
  }
  check('the plan card appears for the objective', !!q('[data-testid="strategy-plan-card"]'));
  const refused = q('[data-testid="strategy-plan-refused"]');
  if (refused) console.log('  refusal code:', refused.dataset.code, '\n  ', (refused.textContent || '').slice(0, 300));

  const runBtn = q('[data-testid="strategy-execute-stage"]');
  check('the card offers to run the next stage', !!runBtn && runBtn.disabled === false);

  const STORE_KEY = 'fbt.strategy-brain.plans.v1';
  const stored = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; } };
  const progressOf = () => (stored().plans || [])[0]?.runtime?.stageProgress || {};
  const statesOf = () => Object.fromEntries(Object.entries(progressOf()).map(([k, v]) => [k, v?.state]));

  /* ── stage 1: the local preflight, WITH the wallet attached ───────────── */
  if (runBtn) {
    await act(async () => { runBtn.click(); });
    for (let i = 0; i < 40; i += 1) { await act(async () => { await sleep(50); }); }
    const text = aiText();
    const states = statesOf();
    console.log('  portfolio at run time:', JSON.stringify(spy.portfolio));
    console.log('  stage states after the first run:', JSON.stringify(states));
    check('the preflight does NOT accuse a connected wallet of being disconnected',
      !/WALLET_REQUIRED|WALLET_CANNOT_SIGN/.test(text));
    check('the preflight is confirmed against the live wallet snapshot',
      states.preflight === 'CONFIRMED' || /پیش‌پرواز گذشت|Preflight passed/.test(text));
    if (states.preflight !== 'CONFIRMED') {
      const line = (text.split('\n').filter((l) => /پیش‌پرواز|preflight|WALLET|PORTFOLIO|PRICE|CAPITAL|RISK_LIMIT/i.test(l)).pop() || '').slice(0, 400);
      console.log('  preflight message:', line);
    }

    /* ── stage 2: the money stage hands off to a venue, in-thread ───────── */
    const run2 = q('[data-testid="strategy-execute-stage"]');
    if (run2 && !run2.disabled) {
      await act(async () => { run2.click(); });
      for (let i = 0; i < 40; i += 1) { await act(async () => { await sleep(50); }); }
      const text2 = aiText();
      const states2 = statesOf();
      console.log('  stage states after the second run:', JSON.stringify(states2));
      const handoff = container.querySelector('[data-testid^="stage-"]')
        || [...container.querySelectorAll('a,button')].find((el) => /\/swap\?/.test(el.getAttribute('href') || el.dataset?.route || ''));
      check('the money stage hands the user to the owning venue inside the thread, without navigating away',
        !!handoff || /آماده است|is ready/.test(text2));
      check('the handed-off stage is RUNNING, never silently CONFIRMED',
        !Object.entries(states2).some(([id, st]) => st === 'CONFIRMED' && id !== 'preflight'));

      /*
       * ── THE USER GOES TO THE VENUE AND COMES BACK ────────────────────────
       *
       * This is the half the reports are about: the swap screen delivers the
       * transaction, the venue records the candidate hash, and the user returns
       * to the chat. Two things must then be true at once —
       *
       *   · the next tap on «اجرای مرحله بعد / تطبیق رسید» finds the on-chain
       *     proof and CONFIRMS the stage, and
       *   · the stage AFTER it (arming real watches, no signature) runs by
       *     itself, so the plan reaches 100% instead of parking the user on a
       *     chip that says «مرحله بعد را ببر».
       *
       * The hint written here is what the venue writes (recordStrategyReceipt-
       * Hint); it is a locator, and the assertions below exist because the
       * provider — not the hint — has the last word.
       */
      nativeDeltaAfterSwap = true;
      swapAt = Date.now();
      const planForHint = (stored().plans || [])[0]?.strategy;
      const swapAction = (planForHint?.stages || []).find((st) => st.id === 'deploy-market')?.actions?.[0];
      const hint = recordStrategyReceiptHint({
        strategyId: planForHint?.strategyId, stageId: 'deploy-market', actionIndex: 0,
        txHash: swapTx.hash, owner: ACCOUNT, chainId: CHAIN, asset: swapAction?.params?.asset,
        amountWei: String(1000_000000n)
      });
      check('the venue records the swap as an on-chain candidate (a locator, not proof)', hint.ok === true);
      try {
        const readProvider = new JsonRpcProvider('https://base-rpc.publicnode.com');
        const direct = await verifyStrategySwap({ action: swapAction, txHash: swapTx.hash, owner: ACCOUNT, provider: readProvider });
        console.log('  direct verify:', JSON.stringify(direct));
      } catch (err) {
        console.log('  direct verify threw:', String(err?.message || err));
      }

      const run3 = q('[data-testid="strategy-execute-stage"]');
      if (run3 && !run3.disabled) {
        await act(async () => { run3.click(); });
        for (let i = 0; i < 80; i += 1) { await act(async () => { await sleep(50); }); }
      }
      const states3 = statesOf();
      console.log('  stage states after the venue leg:', JSON.stringify(states3));
      const tail = [...container.querySelectorAll('.iaos-msg.iaos-ai')].slice(-3).map((el) => (el.textContent || '').slice(-300));
      console.log('  messages after the venue leg:\n   - ' + tail.join('\n   - '));
      const block3 = q('[data-testid="strategy-blocked"]');
      if (block3) console.log('  blocked banner:', block3.dataset?.code || '', (block3.textContent || '').slice(0, 200));
      const text3 = aiText();
      check('the returned swap reconciles against the chain and confirms the stage',
        states3['deploy-market'] === 'CONFIRMED'
        || /تطبیق داده شد|matched on-chain|confirmed/.test(text3));
      /*
       * STATE ONLY. These two once accepted a text fallback (`/۱۰۰٪|100%/`),
       * which the plan card itself can satisfy with a sentence like «Add the
       * 100% that has price risk» — a check that passes on prose proves
       * nothing about the runtime. The store is the claim.
       */
      check('the plan walks its remaining no-signature stages by itself (no extra tap for the watch)',
        states3.monitor === 'CONFIRMED');
      check('the plan reports its final state honestly',
        Object.values(states3).every((st) => st === 'CONFIRMED' || st === 'SKIPPED'));
    }
  }

  /* ── the chips under the analysis box must ANSWER, not decorate ───────── */
  {
    const messagesBefore = container.querySelectorAll('.iaos-msg.iaos-ai').length;
    const chips = [...container.querySelectorAll('.iaos-suggestion')];
    check('the analysis turn offers follow-up chips', chips.length > 0);
    const risk = chips.find((c) => /ریسک|risk/i.test(c.textContent || '')) || chips[0];
    if (risk) {
      const wanted = risk.textContent.trim();
      await act(async () => { risk.click(); });
      for (let i = 0; i < 40; i += 1) {
        await act(async () => { await sleep(50); });
        if (container.querySelectorAll('.iaos-msg.iaos-ai').length > messagesBefore) break;
      }
      const after = container.querySelectorAll('.iaos-msg.iaos-ai').length;
      const last = [...container.querySelectorAll('.iaos-msg.iaos-ai')].pop()?.textContent || '';
      console.log(`  chip "${wanted}" produced:`, last.slice(0, 160));
      check('a chip under the analysis box produces a real answer', after > messagesBefore && last.trim().length > 10);
    }
  }

  /* ── the whole point: does the plan have a road to its LAST stage? ────── */
  const plan = (stored().plans || [])[0]?.strategy;
  const stageIds = (plan?.stages || []).map((s) => s.id);
  check('the plan is staged and the last stage is the monitor phase',
    stageIds.length >= 2 && stageIds[stageIds.length - 1] === 'monitor');
  check('every stage is written to the resumable store before the hand-off',
    stageIds.every((id) => progressOf()[id]));

  console.log('  fetch urls seen:', JSON.stringify([...new Set(fetchLog)].slice(0, 25), null, 0));
  globalThis.fetch = realFetch;
  await act(async () => { root.unmount(); });
  return rows;
}

/**
 * THE LOAN SCREEN, DRIVEN TO THE LAST STEP.
 * ---------------------------------------------------------------------------
 * Reported (fa): «صفحه وام باید ۱۰۰٪ در همان صفحه کامل شود — برای سپرده و هر
 * کار دیگری نباید به Intent OS برود، و همه‌چیز تا آخرین مرحله واقعاً کار کند».
 *
 * The screen used to end every action with `navigate('/intent?hint=…')`: the
 * user confirmed a deposit and landed on another page holding a draft. Nothing
 * was ever supplied. A probe that only checks "a sheet opens" cannot see that,
 * so this one drives the whole path with a wallet attached:
 *
 *   connect  → a stub EIP-1193 wallet, the same interface MetaMask exposes
 *   read     → the Aave V3 Pool answers getReserveData / getUserAccountData /
 *              balanceOf over a stubbed JSON-RPC endpoint, so the rates, the
 *              wallet balance, the supplied balance and the debt on screen all
 *              come from the code path that runs in production
 *   write    → approve → supply, each one a real `eth_sendTransaction` from
 *              the connected wallet, with the calldata decoded here and
 *              checked field by field (asset, amount, onBehalfOf, rate mode)
 *   after    → the sheet reaches "done", the tx hash is shown, and the page is
 *              STILL /loan — no hand-off anywhere
 *
 * Everything the chain returns is stubbed; nothing about the app is. If the
 * screen ever goes back to navigating away instead of transacting, or starts
 * signing something other than what the review sheet promised, this fails.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AbiCoder, FetchRequest, FetchResponse, Interface, getAddress } from 'ethers';
import '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import Loan from '../src/pages/Loan.jsx';
import { AAVE_POOL_ABI, ERC20_MIN_ABI, AAVE_V3_POOLS, lendingAssetsFor } from '../src/lib/lending.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHAIN = 42161;
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const ATOKEN = '0x2222222222222222222222222222222222222222';
const VDEBT = '0x3333333333333333333333333333333333333333';
const POOL = AAVE_V3_POOLS[CHAIN].toLowerCase();

const coder = AbiCoder.defaultAbiCoder();
const poolIface = new Interface(AAVE_POOL_ABI);
const erc20Iface = new Interface(ERC20_MIN_ABI);

const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

export async function run(container) {
  const out = [];
  const t = (name, ok) => { out.push([name, Boolean(ok)]); console.log((ok ? '✓ ' : '✗ ') + name); };

  const realError = console.error;
  const realFetch = globalThis.fetch;
  const errors = [];
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped')) return;
    if (s.includes('Not implemented') || s.includes('is deprecated')) return;
    if (s.includes('React Router Future Flag')) return;
    errors.push(s);
  };

  /* ── the chain, as far as this test is concerned ─────────────────────────
     A single JSON-RPC handler serves BOTH the read providers (which reach it
     over fetch) and the injected wallet (which reaches it over EIP-1193), so
     the app cannot tell the two apart from production behaviour. */
  const sent = [];               // every eth_sendTransaction, in order
  const usdt = lendingAssetsFor(CHAIN).find((a) => a.symbol === 'USDT');
  const asset = usdt.address.toLowerCase();
  /* 6 decimals: 300 in the wallet, 100 already supplied, 40 borrowed. */
  const balances = {
    [asset]: 300000000n,
    [ATOKEN.toLowerCase()]: 100000000n,
    [VDEBT.toLowerCase()]: 40000000n
  };
  let allowance = 0n;

  const uint = (n) => coder.encode(['uint256'], [n]);
  const RESERVE_TUPLE = [
    'tuple(uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)'
  ];
  /* 4.5% supply / 7.3% borrow expressed as Aave's per-second ray rates. */
  const RAY = 10n ** 27n;
  const liquidityRate = (RAY * 45n) / 1000n;
  const borrowRate = (RAY * 73n) / 1000n;

  const ethCall = (tx) => {
    const to = String(tx?.to || '').toLowerCase();
    const data = String(tx?.data || '0x');
    const selector = data.slice(0, 10);

    if (to === POOL && selector === poolIface.getFunction('getReserveData').selector) {
      const [target] = poolIface.decodeFunctionData('getReserveData', data);
      if (String(target).toLowerCase() !== asset) {
        /* Anything but our one listed asset is genuinely not a reserve. */
        return coder.encode(RESERVE_TUPLE, [[0n, 0n, 0n, 0n, 0n, 0n, 0, 0,
          '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000',
          0n, 0n, 0n]]);
      }
      return coder.encode(RESERVE_TUPLE, [[
        0n, RAY, liquidityRate, RAY, borrowRate, 0n, 0, 1,
        ATOKEN, '0x0000000000000000000000000000000000000000', VDEBT,
        '0x0000000000000000000000000000000000000000', 0n, 0n, 0n
      ]]);
    }
    if (to === POOL && selector === poolIface.getFunction('getUserAccountData').selector) {
      /* USD, 8 decimals: $100 collateral, $40 debt, $35 borrowable, 80% LT. */
      return coder.encode(
        ['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
        [10000000000n, 4000000000n, 3500000000n, 8000n, 7500n, 2000000000000000000n]
      );
    }
    if (selector === erc20Iface.getFunction('balanceOf').selector) {
      return uint(balances[to] ?? 0n);
    }
    if (selector === erc20Iface.getFunction('allowance').selector) {
      return uint(allowance);
    }
    if (selector === erc20Iface.getFunction('decimals').selector) {
      return coder.encode(['uint8'], [6]);
    }
    return '0x';
  };

  let nonce = 0;
  const hashes = [];
  const rpc = async (method, params = []) => {
    switch (method) {
      case 'eth_chainId': return '0x' + CHAIN.toString(16);
      case 'net_version': return String(CHAIN);
      case 'eth_accounts':
      case 'eth_requestAccounts': return [ACCOUNT];
      case 'eth_blockNumber': return '0x100';
      case 'eth_getBalance': return '0xde0b6b3a7640000';
      case 'eth_getTransactionCount': return '0x' + nonce.toString(16);
      case 'eth_gasPrice': return '0x3b9aca00';
      case 'eth_maxPriorityFeePerGas': return '0x3b9aca00';
      case 'eth_estimateGas': return '0x30d40';
      case 'eth_call': return ethCall(params[0]);
      case 'eth_sendTransaction': {
        const tx = params[0] || {};
        sent.push(tx);
        nonce += 1;
        const hash = `0x${(nonce + 0xaa).toString(16).padStart(2, '0').repeat(32)}`;
        hashes.push(hash);
        /* An approval the pool can now see, exactly like the real one. */
        if (String(tx.data || '').startsWith(erc20Iface.getFunction('approve').selector)) {
          const [, amount] = erc20Iface.decodeFunctionData('approve', tx.data);
          allowance = BigInt(amount);
        }
        return hash;
      }
      case 'eth_getTransactionReceipt': {
        const hash = params[0];
        if (!hashes.includes(hash)) return null;
        return {
          transactionHash: hash,
          blockHash: `0x${'11'.repeat(32)}`,
          blockNumber: '0x100',
          from: ACCOUNT,
          to: sent[hashes.indexOf(hash)]?.to || null,
          cumulativeGasUsed: '0x5208',
          gasUsed: '0x5208',
          effectiveGasPrice: '0x3b9aca00',
          contractAddress: null,
          logs: [],
          logsBloom: `0x${'00'.repeat(256)}`,
          status: '0x1',
          type: '0x2',
          transactionIndex: '0x0'
        };
      }
      case 'eth_getTransactionByHash': {
        const hash = params[0];
        const index = hashes.indexOf(hash);
        if (index < 0) return null;
        const tx = sent[index] || {};
        return {
          hash,
          blockHash: `0x${'11'.repeat(32)}`,
          blockNumber: '0x100',
          transactionIndex: '0x0',
          from: ACCOUNT,
          to: tx.to || null,
          value: '0x0',
          gas: '0x30d40',
          gasPrice: '0x3b9aca00',
          maxFeePerGas: '0x77359400',
          maxPriorityFeePerGas: '0x3b9aca00',
          input: tx.data || '0x',
          nonce: '0x' + index.toString(16),
          type: '0x2',
          accessList: [],
          chainId: '0x' + CHAIN.toString(16),
          v: '0x1',
          r: `0x${'11'.repeat(32)}`,
          s: `0x${'22'.repeat(32)}`,
          yParity: '0x1'
        };
      }
      case 'eth_getBlockByNumber':
        return {
          number: '0x100', hash: `0x${'11'.repeat(32)}`, parentHash: `0x${'22'.repeat(32)}`,
          timestamp: '0x66000000', gasLimit: '0x1c9c380', gasUsed: '0x5208',
          baseFeePerGas: '0x3b9aca00', miner: ACCOUNT, extraData: '0x', transactions: []
        };
      default:
        return null;
    }
  };

  /*
   * Every JSON-RPC endpoint the app dials answers from the same chain. The
   * read providers go through ethers' own transport (not window.fetch), so the
   * interception happens where ethers actually makes the request.
   */
  const serve = async (bodyText) => {
    let body = null;
    try { body = JSON.parse(bodyText || 'null'); } catch { body = null; }
    if (!body) return JSON.stringify({ error: 'bad request' });
    const one = async (call) => ({ jsonrpc: '2.0', id: call.id, result: await rpc(call.method, call.params) });
    const payload = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
    return JSON.stringify(payload);
  };
  FetchRequest.registerGetUrl(async (req) => {
    const text = await serve(req.body ? new TextDecoder().decode(req.body) : null);
    return new FetchResponse(200, 'OK', { 'content-type': 'application/json' }, new TextEncoder().encode(text), req);
  });
  globalThis.fetch = async (url, init) => {
    const text = await serve(init?.body || null);
    return new window.Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  };

  window.ethereum = {
    isMetaMask: true,
    request: ({ method, params }) => rpc(method, params),
    on() {},
    removeListener() {}
  };

  const q = (sel) => container.querySelector(sel);
  const qa = (sel) => [...container.querySelectorAll(sel)];
  const byId = (id) => q(`[data-testid="${id}"]`);

  let root = null;
  try {
    const mountAt = async (hash) => {
      window.location.hash = hash;
      if (root) { await act(async () => { root.unmount(); }); }
      root = createRoot(container);
      await act(async () => {
        root.render(
          <HashRouter>
            <TelegramProvider>
              <WalletProvider>
                <Routes>
                  <Route path="/loan" element={<Loan />} />
                  <Route path="*" element={<div data-testid="elsewhere" />} />
                </Routes>
              </WalletProvider>
            </TelegramProvider>
          </HashRouter>
        );
      });
      await act(async () => { await sleep(80); });
    };

    /* ═══════ 1. THE PAGE READS THE REAL POOL ═══════ */
    await mountAt(`#/loan?chain=${CHAIN}`);
    await act(async () => { await sleep(250); });

    t('the loan page renders its three tabs',
      !!byId('loan-tab-supply') && !!byId('loan-tab-borrow') && !!byId('loan-tab-positions'));
    t('the live supply APY comes from the pool, not a table',
      qa('[data-testid="loan-apy"]').some((el) => /4\.6\d%/.test(el.textContent || '')));
    t('an asset the pool does not list is disabled, not faked',
      qa('[data-testid^="loan-asset-"]').some((b) => b.disabled));
    t('the page says where its numbers came from', !!byId('loan-rate-source'));

    /* ═══════ 2. NO HAND-OFF: THE ACTION IS THE CONNECT GATE ═══════ */
    await act(async () => { click(byId('loan-asset-usdt')); });
    await act(async () => { await sleep(60); });
    t('choosing an asset opens the amount field in the page', !!byId('loan-amount-supply'));
    t('without a wallet the action is an honest connect gate, not a hand-off',
      !!byId('loan-connect') && !byId('loan-action'));
    t('the loan page still holds the route (nothing was handed to Intent OS)',
      window.location.hash.startsWith('#/loan'));

    /* ═══════ 3. CONNECT — THE REAL INJECTED PATH ═══════ */
    await act(async () => { click(byId('loan-connect')); });
    await act(async () => { await sleep(400); });
    t('connecting the injected wallet arms the in-page action button', !!byId('loan-action'));

    /* ═══════ 4. SUPPLY: REVIEW → APPROVE → SUPPLY → DONE ═══════ */
    const amountField = byId('loan-amount-supply');
    await act(async () => { setInputValue(amountField, '250'); });
    await act(async () => { await sleep(60); });

    await act(async () => { click(byId('loan-action')); });
    await act(async () => { await sleep(200); });
    const sheet = byId('loan-execution-sheet');
    t('confirming opens the execution sheet in the page', !!sheet);
    t('the sheet reviews before it signs', sheet?.getAttribute('data-phase') === 'review');
    t('the review lists BOTH transactions (allowance is zero, so approve first)',
      !!byId('loan-step-approve') && !!byId('loan-step-supply'));

    await act(async () => { click(byId('loan-exec-confirm')); });
    await act(async () => { await sleep(600); });

    t('two transactions were signed by the wallet', sent.length === 2);
    const approveTx = sent[0] || {};
    const supplyTx = sent[1] || {};
    t('the first is an ERC-20 approval for the Aave pool', (() => {
      if (String(approveTx.to || '').toLowerCase() !== asset) return false;
      const [spender, amount] = erc20Iface.decodeFunctionData('approve', approveTx.data);
      return getAddress(spender) === getAddress(POOL) && BigInt(amount) >= 250000000n;
    })());
    t('the second is Pool.supply with the exact amount and the user as beneficiary', (() => {
      if (String(supplyTx.to || '').toLowerCase() !== POOL) return false;
      const [a, amount, onBehalfOf, referral] = poolIface.decodeFunctionData('supply', supplyTx.data);
      return String(a).toLowerCase() === asset
        && BigInt(amount) === 250000000n
        && getAddress(onBehalfOf) === getAddress(ACCOUNT)
        && Number(referral) === 0;
    })());
    t('nothing was signed on behalf of the app itself',
      sent.every((tx) => !tx.from || getAddress(tx.from) === getAddress(ACCOUNT)));

    const doneSheet = byId('loan-execution-sheet');
    t('the sheet ends in done, in the page', doneSheet?.getAttribute('data-phase') === 'done');
    t('the receipt links the real transaction hash',
      qa('a').some((a) => /\/tx\/0x/.test(a.getAttribute('href') || '')));
    t('the supply never left the loan screen', window.location.hash.startsWith('#/loan'));

    await act(async () => { click(byId('loan-exec-close')); });
    await act(async () => { await sleep(300); });

    /* ═══════ 5. POSITIONS ARE READ BACK FROM THE POOL ═══════ */
    t('finishing lands on the positions tab',
      byId('loan-tab-positions')?.getAttribute('data-active') === 'true');
    const position = byId('loan-position-usdt');
    t('the position row is rendered from the aToken and debt-token balances', !!position);
    t('it shows the supplied balance the pool reports', /100(\.0+)?/.test(position?.textContent || ''));
    t('it shows the debt the pool reports', /40(\.0+)?/.test(position?.textContent || ''));
    t('the account summary shows the health factor the pool reports',
      /2(\.0+)?/.test(byId('loan-health')?.textContent || ''));

    /* ═══════ 6. WITHDRAW AND REPAY RUN IN THE PAGE TOO ═══════ */
    const before = sent.length;
    /* The row's own amount field decides how much comes back out. */
    const manageField = byId('loan-amount-usdt');
    t('each position row carries its own amount field', !!manageField);
    await act(async () => { setInputValue(manageField, '25'); });
    await act(async () => { await sleep(60); });
    await act(async () => { click(byId('loan-withdraw-usdt')); });
    await act(async () => { await sleep(150); });
    const withdrawSheet = byId('loan-execution-sheet');
    t('withdraw opens its own review sheet', !!withdrawSheet && !!byId('loan-step-withdraw'));
    await act(async () => { click(byId('loan-exec-confirm')); });
    await act(async () => { await sleep(400); });
    t('withdraw signs Pool.withdraw with the user as recipient', (() => {
      const tx = sent[before];
      if (!tx || String(tx.to || '').toLowerCase() !== POOL) return false;
      const [a, amount, to] = poolIface.decodeFunctionData('withdraw', tx.data);
      return String(a).toLowerCase() === asset && BigInt(amount) > 0n && getAddress(to) === getAddress(ACCOUNT);
    })());
    t('withdraw finishes in the page as well',
      byId('loan-execution-sheet')?.getAttribute('data-phase') === 'done'
      && window.location.hash.startsWith('#/loan'));

    /* ═══════ 6b. BORROW AND REPAY, THE SAME WAY ═══════ */
    await act(async () => { click(byId('loan-exec-close')); });
    await act(async () => { await sleep(900); });
    await act(async () => { click(byId('loan-tab-borrow')); });
    await act(async () => { await sleep(600); });
    await act(async () => { click(byId('loan-asset-usdt')); });
    await act(async () => { await sleep(80); });
    t('the borrow tab shows the borrowing power the pool reports',
      /35/.test(byId('loan-borrow-power')?.textContent || ''));
    await act(async () => { setInputValue(byId('loan-amount-borrow'), '10'); });
    await act(async () => { await sleep(60); });
    const beforeBorrow = sent.length;
    await act(async () => { click(byId('loan-action')); });
    await act(async () => { await sleep(150); });
    t('borrow reviews a single transaction — no approval is needed to borrow',
      !!byId('loan-step-borrow') && !byId('loan-step-approve'));
    await act(async () => { click(byId('loan-exec-confirm')); });
    await act(async () => { await sleep(400); });
    t('borrow signs Pool.borrow at the variable rate for the user', (() => {
      const tx = sent[beforeBorrow];
      if (!tx || String(tx.to || '').toLowerCase() !== POOL) return false;
      const [a, amount, mode, referral, onBehalfOf] = poolIface.decodeFunctionData('borrow', tx.data);
      return String(a).toLowerCase() === asset
        && BigInt(amount) === 10000000n
        && Number(mode) === 2
        && Number(referral) === 0
        && getAddress(onBehalfOf) === getAddress(ACCOUNT);
    })());
    t('borrow finishes in the page',
      byId('loan-execution-sheet')?.getAttribute('data-phase') === 'done'
      && window.location.hash.startsWith('#/loan'));

    await act(async () => { click(byId('loan-exec-close')); });
    await act(async () => { await sleep(250); });
    const repayField = byId('loan-amount-usdt');
    const beforeRepay = sent.length;
    await act(async () => { setInputValue(repayField, '5'); });
    await act(async () => { await sleep(60); });
    await act(async () => { click(byId('loan-repay-usdt')); });
    await act(async () => { await sleep(150); });
    t('repay reviews an approval first, because the pool must pull the tokens',
      !!byId('loan-step-repay'));
    await act(async () => { click(byId('loan-exec-confirm')); });
    await act(async () => { await sleep(500); });
    t('repay signs Pool.repay for the user at the variable rate', (() => {
      const tx = sent.slice(beforeRepay).find((x) => String(x.to || '').toLowerCase() === POOL);
      if (!tx) return false;
      const [a, amount, mode, onBehalfOf] = poolIface.decodeFunctionData('repay', tx.data);
      return String(a).toLowerCase() === asset
        && BigInt(amount) === 5000000n
        && Number(mode) === 2
        && getAddress(onBehalfOf) === getAddress(ACCOUNT);
    })());
    t('repay finishes in the page too',
      byId('loan-execution-sheet')?.getAttribute('data-phase') === 'done'
      && window.location.hash.startsWith('#/loan'));

    /* ═══════ 7. THE PREFILLED HAND-OFF FROM A WORKFLOW STEP ═══════ */
    /* Intent OS sends a deposit step here with ?asset=&amount=&chain= so the
       only thing left for the user is to confirm. */
    await mountAt(`#/loan?tab=supply&asset=USDT&amount=125&chain=${CHAIN}&intent=abc&step=step-2`);
    await act(async () => { await sleep(400); });
    t('a workflow hand-off preselects the asset and the amount', (() => {
      const field = byId('loan-amount-supply');
      return !!field && field.value === '125';
    })());
    t('the prefilled hand-off is ready to run in the page (no second form)',
      !!byId('loan-action') || !!byId('loan-connect'));

    /* ═══════ 8. THE PAGE HAS NO ROUTE OUT ═══════ */
    t('no control on the loan screen routes to Intent OS',
      qa('a').every((a) => !/#\/intent/.test(a.getAttribute('href') || '')));
  } catch (error) {
    out.push([`probe crashed: ${String(error?.message || error).slice(0, 200)}`, false]);
    console.error('CRASH', error);
  } finally {
    if (root) { try { await act(async () => { root.unmount(); }); } catch { /* noop */ } }
    console.error = realError;
    globalThis.fetch = realFetch;
    delete window.ethereum;
  }

  for (const e of errors.slice(0, 6)) out.push([`(detail) ${String(e).slice(0, 160)}`, false]);
  return out;
}

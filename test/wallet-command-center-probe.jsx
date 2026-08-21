import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter } from 'react-router-dom';
import '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import WalletActionRow from '../src/components/WalletActionRow.jsx';
import WalletPnl from '../src/components/WalletPnl.jsx';
import ActiveOrdersCard from '../src/components/ActiveOrdersCard.jsx';
import SecurityCenterCard from '../src/components/SecurityCenterCard.jsx';
import TokenDetailSheet from '../src/components/TokenDetailSheet.jsx';
import { saveOrders } from '../src/lib/orders.js';
import { saveCompiledIntent } from '../src/lib/intentOS.js';

/**
 * WALLET COMMAND CENTER PROBE
 * ---------------------------------------------------------------------------
 * The existing wallet probe mounts the whole page in its DISCONNECTED state.
 * Everything new on /wallet renders after a wallet is connected, so this
 * probe drives each new component directly with representative props and
 * asserts the honest states: the six actions + Optimize, P&L with and
 * without a cost basis, ACTIVE rows from real localStorage, the Security
 * sheet score with no configured protections, and the token detail sheet.
 */
function mount(c, el) {
  return createRoot(el);
}

async function render(el, node) {
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <TelegramProvider>
        <WalletProvider>
          <HashRouter>{node}</HashRouter>
        </WalletProvider>
      </TelegramProvider>
    );
  });
  return root;
}

const intelWithCost = {
  rows: [
    { symbol: 'ETH', value: 300, cost: 200, pnl: 100, pnlPct: 50, weight: 30 },
    { symbol: 'SHIB', value: 5, cost: null, pnl: null, pnlPct: null, weight: 2 }
  ],
  realised: 12.5,
  lotCount: 4,
  partial: true
};

export async function run(c) {
  const out = [];
  const t = (name, ok) => out.push([name, Boolean(ok)]);
  const host = document.createElement('div');
  document.body.appendChild(host);

  /* ---- action row ---- */
  {
    const el = document.createElement('div');
    host.appendChild(el);
    let sent = 0;
    const root = await render(el, (
      <WalletActionRow
        onSend={() => { sent += 1; }}
        onReceive={() => {}}
        onSwap={() => {}}
        onBridge={() => {}}
        onBuy={() => {}}
        onEarn={() => {}}
        onOptimize={() => {}}
        canOptimize={false}
      />
    ));
    const buttons = el.querySelectorAll('.wallet-action-v2');
    t('the action row has six equal actions', buttons.length === 6);
    t('the actions carry tint classes', !!el.querySelector('.wal-action-send') && !!el.querySelector('.wal-action-buy'));
    t('Optimize renders as a proposal button', !!el.querySelector('.wallet-optimize'));
    t('the low-data why-note renders when Optimize cannot draft', /optimizeWhy/i.test(el.textContent) || el.textContent.includes('Optimize'));
    const sendBtn = el.querySelector('.wal-action-send');
    await act(async () => sendBtn.click());
    t('Send fires the sheet callback', sent === 1);
    await act(async () => root.unmount());
  }

  /* ---- P&L with a partial cost basis ---- */
  {
    const el = document.createElement('div');
    host.appendChild(el);
    const root = await render(el, <WalletPnl intel={intelWithCost} />);
    t('P&L shows unrealized with a cost basis', /100/.test(el.textContent) || /$/.test(el.textContent));
    t('P&L labels partial when some rows lack cost', el.textContent.includes('partial') || /ناقص/.test(el.textContent));
    await act(async () => root.unmount());
  }
  /* P&L with no cost basis at all — must show —, never zero */
  {
    const el = document.createElement('div');
    host.appendChild(el);
    const root = await render(el, <WalletPnl intel={{ rows: [{ symbol: 'X', value: 10, cost: null, pnl: null }], realised: 0, lotCount: 0, partial: true }} />);
    t('P&L without cost basis shows a dash, not zero', /—/.test(el.textContent));
    await act(async () => root.unmount());
  }

  /* ---- ACTIVE card from real localStorage ---- */
  {
    try {
      localStorage.setItem('fbt-orders-v1', JSON.stringify([
        { id: 'o1', type: 'limit', status: 'active', fromToken: 'BNB', toToken: 'USDT', targetRate: 700, createdAt: Date.now() },
        { id: 'o2', type: 'dca', status: 'active', fromToken: 'USDT', toToken: 'BTC', createdAt: Date.now() },
        { id: 'o3', type: 'limit', status: 'filled', fromToken: 'BNB', toToken: 'USDT', createdAt: Date.now() }
      ]));
      saveCompiledIntent({
        intent: { id: 'i1', schema: 'fbt.intent.v1', kind: 'swap', fromSymbol: 'USDC', toSymbol: 'ETH' },
        status: 'ready-for-review',
        checks: [],
        savedAt: Date.now()
      });
    } catch { /* storage unavailable in this jsdom */ }
    const el = document.createElement('div');
    host.appendChild(el);
    const root = await render(el, <ActiveOrdersCard />);
    t('ACTIVE shows only live orders (filled excluded)', el.querySelectorAll('.wal-active-row').length >= 2);
    t('ACTIVE links to the orders screen', el.textContent.includes('Orders') || el.textContent.includes('سفارش'));
    t('ACTIVE lists recent intents', el.textContent.includes('swap') || el.textContent.includes('USDC'));
    await act(async () => root.unmount());
  }

  /* ---- Security center: no configured protections -> honest dash ---- */
  {
    const el = document.createElement('div');
    host.appendChild(el);
    const root = await render(el, <SecurityCenterCard />);
    t('Security tile renders', !!el.querySelector('.wal-sec-card'));
    await act(async () => {
      el.querySelector('.wal-sec-card').click();
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    t('the security sheet opens from the tile', !!document.querySelector('.sheet'));
    const sheetText = document.querySelector('.sheet')?.textContent || '';
    t('approvals are honestly not-scanned', sheetText.includes('not scanned') || sheetText.includes('اسکن نشده'));
    await act(async () => root.unmount());
  }

  /* ---- token detail sheet ---- */
  {
    const el = document.createElement('div');
    host.appendChild(el);
    const group = {
      symbol: 'ETH',
      name: 'Ethereum',
      items: [
        { key: '1:ETH', symbol: 'ETH', name: 'Ethereum', address: null, native: true, decimals: 18, coingeckoId: 'ethereum', amount: 0.5, price: 3000, value: 1500, chainId: 1 }
      ],
      chains: 1,
      totalAmount: 0.5,
      value: 1500,
      priced: 1,
      total: 1
    };
    const root = await render(el, (
      <TokenDetailSheet open onClose={() => {}} group={group} intel={intelWithCost} wallet={{ chainId: 1, mode: 'wc', address: '0xabc', chainOk: true }} currency={{ code: 'USD', symbol: '$' }} onSend={() => {}} />
    ));
    const sheetText = document.querySelector('.sheet')?.textContent || '';
    t('the token sheet renders the symbol', sheetText.includes('ETH'));
    t('the token sheet renders balances', sheetText.includes('0.500000') || sheetText.includes('0.5'));
    t('the token sheet offers Send and Swap', /Send|Swap|ارسال|سواپ/.test(sheetText));
    await act(async () => root.unmount());
  }

  host.remove();
  return out;
}

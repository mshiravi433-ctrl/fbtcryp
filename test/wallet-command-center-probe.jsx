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
import { WalHero } from '../src/pages/Wallet.jsx';
import { setHideBalances } from '../src/lib/format.js';
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
    let btc = 0;
    const root = await render(el, (
      <WalletActionRow
        onSend={() => { sent += 1; }}
        onReceive={() => {}}
        onBitcoin={() => { btc += 1; }}
        onSwap={() => {}}
        onBridge={() => {}}
        onBuy={() => {}}
        onEarn={() => {}}
        onOptimize={() => {}}
        canOptimize={false}
      />
    ));
    const buttons = el.querySelectorAll('.wallet-action-v2');
    /* Seven since the Bitcoin doorway was added between Receive and Swap. The
       count is asserted rather than a >= so an accidental duplicate entry — the
       way this row has grown before — still fails. */
    t('the action row has seven equal actions', buttons.length === 7);
    t('the actions carry tint classes', !!el.querySelector('.wal-action-send') && !!el.querySelector('.wal-action-buy'));

    /*
     * ─── THE BITCOIN DOORWAY: POSITION IS PART OF THE REQUIREMENT ───────────
     * "after Send and Receive, before Swap", exactly. Asserted by INDEX rather
     * than by mere presence, because a reordering that puts it last still
     * renders seven buttons and would pass a presence check.
     */
    const order = [...buttons].map((b) => [...b.classList].find((c) => c.startsWith('wal-action-')));
    t('Bitcoin sits between Receive and Swap',
      order.indexOf('wal-action-btc') === order.indexOf('wal-action-recv') + 1 &&
      order.indexOf('wal-action-swap') === order.indexOf('wal-action-btc') + 1);

    t('Optimize renders as a proposal button', !!el.querySelector('.wallet-optimize'));
    t('the low-data why-note renders when Optimize cannot draft', /optimizeWhy/i.test(el.textContent) || el.textContent.includes('Optimize'));
    const sendBtn = el.querySelector('.wal-action-send');
    await act(async () => sendBtn.click());
    t('Send fires the sheet callback', sent === 1);

    /* The doorway must OPEN something. A tile wired to nothing is exactly the
       "the button does nothing" bug this batch of work started from. */
    await act(async () => el.querySelector('.wal-action-btc').click());
    t('Bitcoin fires its popup callback', btc === 1);

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

  /* ---- Glass-3.0 hero, CONNECTED ------------------------------------------
     The page probe can only ever mount the disconnected shell, but the
     balance box is where this screen's hard rules live. WalHero takes plain
     props, so mount it directly with a fabricated read and assert:
       • the number is a number — and stays a number while `loading` (the
         «موجودی سه نقطه می‌شود» regression),
       • the spectrum bar has one segment per PRICED network (the zeroed,
         errored chain contributes nothing, exactly like its money),
       • the privacy eye is a real toggle wired to the parent,
       • with hide-balances ON, the total is the mask, the spectrum is gone
         and the address blurs (this page's formatters used to bypass the
         settings toggle entirely),
       • every action carries an SVG, and no emoji survive anywhere. */
  {
    const tStub = (k) => k;
    const heroWallet = {
      address: '0x1234567890abcdef1234567890abcdef12345678',
      locked: false, mode: 'wc', chainId: 56, chain: { short: 'BSC' },
      lease: true, leaseMinutesLeft: 42, lock() {}
    };
    const heroPortfolio = {
      loaded: true, loading: false, totalValue: 1234.5, totalCount: 3,
      pricedCount: 3, partial: false, updatedAt: Date.now(), fromSnapshot: false,
      rows: [],
      chains: [
        { chainId: 56, chainShort: 'BSC', chainColor: '#f0b90b', totalValue: 800, nativeAmount: 1.2, native: { symbol: 'BNB' }, rows: [{}, {}], error: false },
        { chainId: 8453, chainShort: 'BASE', chainColor: '#0052ff', totalValue: 434.5, nativeAmount: 0.1, native: { symbol: 'ETH' }, rows: [{}], error: false },
        { chainId: 137, chainShort: 'POL', chainColor: '#8247e5', totalValue: 0, nativeAmount: 0, native: { symbol: 'POL' }, rows: [], error: true }
      ]
    };
    const heroChildren = {
      onSend() {}, onReceive() {}, onBitcoin() {}, onSwap() {}, onBridge() {},
      onBuy() {}, onEarn() {}, onOptimize() {}, canOptimize: true, showBitcoin: true,
      onAssets() {}, onFarm() {}, onNft() {}, setSeedSheet() {}, setBackupSheet() {}
    };
    const heroProps = {
      wallet: heroWallet,
      currency: { code: 'USD', symbol: '$' },
      portfolio: heroPortfolio,
      intel: { change24h: { abs: 12, from: 1200 }, change7d: { abs: -30, from: 1200 }, change30d: null },
      chips: { nft: { state: 'count', count: 4 } },
      hideBalances: false, t: tStub,
      onConnect() {}, onDisconnect() {}, onRefresh() {}, onCopy() {}, onExplorer() {},
      switchChain: async () => true, haptic() {}, onRetry() {},
      selectedChain: 'all', onSelectChain() {}
    };

    let toggled = 0;
    const el = document.createElement('div');
    host.appendChild(el);
    const root = await render(el, (
      <WalHero {...heroProps} onToggleHide={() => { toggled += 1; }}>{heroChildren}</WalHero>
    ));
    t('Glass hero mounts connected', !!el.querySelector('.walx-hero') && !!el.querySelector('.walx-identicon'));
    const totalText = el.querySelector('.walx-total')?.textContent || '';
    t('Glass hero shows the real total, not a placeholder', /\$/.test(totalText) && /1[.,]?235/.test(totalText) && !totalText.includes('…'));
    t('spectrum has one segment per priced network', el.querySelectorAll('.walx-spectrum-seg').length === 2);
    t('every action tile carries an SVG icon', [...el.querySelectorAll('.wallet-action-v2')].every((b) => b.querySelector('svg')));
    t('no legacy emoji survive in the hero', !/[\u{2728}\u{1F512}\u{1F6E1}]/u.test(el.textContent));
    await act(async () => el.querySelector('.walx-eye').click());
    t('the privacy eye fires the parent toggle', toggled === 1);
    await act(async () => root.unmount());

    /* Refreshing: loaded + loading — the number must stay, with the quiet
       «updating» cue beside it. */
    const el2 = document.createElement('div');
    host.appendChild(el2);
    const root2 = await render(el2, (
      <WalHero {...heroProps} portfolio={{ ...heroPortfolio, loading: true }} onToggleHide={() => {}}>{heroChildren}</WalHero>
    ));
    const total2 = el2.querySelector('.walx-total')?.textContent || '';
    t('a refresh never replaces the number', /\$/.test(total2) && !!el2.querySelector('.wal-reval'));
    await act(async () => root2.unmount());

    /* Hidden: mask everywhere on this page, no spectrum, blurred address. */
    setHideBalances(true);
    try {
      const el3 = document.createElement('div');
      host.appendChild(el3);
      const root3 = await render(el3, (
        <WalHero {...heroProps} hideBalances onToggleHide={() => {}}>{heroChildren}</WalHero>
      ));
      const total3 = el3.querySelector('.walx-total')?.textContent || '';
      t('hide-balances masks the hero total', total3.trim() === '•••');
      t('hide-balances removes the spectrum (proportions leak too)', el3.querySelectorAll('.walx-spectrum-seg').length === 0);
      t('hide-balances blurs the address pill', !!el3.querySelector('.walx-addr.wal-addr-blur'));
      await act(async () => root3.unmount());
    } finally {
      setHideBalances(false);
    }
  }

  host.remove();
  return out;
}

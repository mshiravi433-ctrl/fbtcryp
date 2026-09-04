/**
 * Mounted UI probe for the isolated Persian Buy tab. Network calls are stubs:
 * this asserts visibility and the no-picker/no-manual-wallet surface without
 * producing a payment preview or wallet signature.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import i18n, { setLanguage } from '../src/i18n/index.js';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import BuySellPanel from '../src/components/BuySellPanel.jsx';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const capability = {
  schema: 'fbt.iran-buy.v1',
  enabled: true,
  asset: 'USDT',
  network: { id: 'ERC20', label: 'ERC20', walletFamily: 'EVM', chainId: 1, chainName: 'Ethereum' },
  limits: { minToman: '50000', maxToman: '10000000' },
  requiresTelegramAuth: true
};

function stubFetch() {
  globalThis.fetch = async (url) => {
    const path = String(url);
    const body = path.includes('/iran/buy/config') ? capability
      : path.includes('/buy-sell/providers') ? { buyAvailable: false, sellAvailable: false, providers: [] }
        : path.includes('/buy-sell/assets') ? { assets: [] }
          : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

export async function run(container) {
  const rows = [];
  const check = (name, ok) => rows.push([name, Boolean(ok)]);
  const previousFetch = globalThis.fetch;
  const oldLanguage = i18n.language;
  const errors = [];
  const previousError = console.error;
  console.error = (...args) => {
    const message = String(args[0] || '');
    if (/act\(|not wrapped|useLayoutEffect|is deprecated|Not implemented/.test(message)) return;
    errors.push(message);
  };
  let root;
  try {
    stubFetch();
    await setLanguage('fa');
    root = createRoot(container);
    await act(async () => { root.render(<WalletProvider><BuySellPanel /></WalletProvider>); });
    await act(async () => { await sleep(100); });

    const topTab = container.querySelector('[data-testid="iran-buy-top-tab"]');
    check('exact fa plus a server capability renders the Iranian-only top tab', Boolean(topTab) && topTab.textContent.includes('فقط برای ایرانیان'));
    check('the ordinary Buy/Sell wizard remains the initial surface', Boolean(container.querySelector('.buy-sell-switch')) && !container.querySelector('[data-testid="iran-buy-panel"]'));

    await act(async () => { topTab?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(80); });
    const iranPanel = container.querySelector('[data-testid="iran-buy-panel"]');
    const subTabs = [...container.querySelectorAll('.iran-buy-subtab [role="tab"]')];
    check('the Iranian tab opens an RTL Persian panel inside Buy/Sell', iranPanel?.getAttribute('dir') === 'rtl' && iranPanel?.getAttribute('lang') === 'fa');
    check('the panel has exactly one sub-tab named خرید', subTabs.length === 1 && subTabs[0].textContent.includes('خرید'));
    check('the panel locks USDT and one backend network instead of rendering asset/network selects',
      iranPanel?.textContent.includes('USDT') && iranPanel?.textContent.includes('ERC20') && iranPanel?.querySelectorAll('select').length === 0);
    check('the disconnected state offers the shared wallet connection path and no manual destination field',
      Boolean(iranPanel?.querySelector('.iran-buy-wallet-action')) && !iranPanel?.querySelector('input[aria-label*="کیف پول مقصد"]'));
    check('the terms stay collapsed until requested, keeping the mobile flow focused', iranPanel?.querySelector('.iran-buy-terms')?.open === false);

    await act(async () => { await i18n.changeLanguage('en'); await sleep(100); });
    check('English never renders the Iranian-only top tab or panel', !container.querySelector('[data-testid="iran-buy-top-tab"]') && !container.querySelector('[data-testid="iran-buy-panel"]'));

    await act(async () => { await i18n.changeLanguage('fa-IR'); await sleep(100); });
    check('fa-IR still shows the Iranian-only tab', Boolean(container.querySelector('[data-testid="iran-buy-top-tab"]')));
    check('mounting and locale changes produced no unexpected React error', errors.length === 0);
  } finally {
    if (root) await act(async () => { root.unmount(); });
    globalThis.fetch = previousFetch;
    console.error = previousError;
    await i18n.changeLanguage(oldLanguage || 'en');
  }
  return rows;
}

export default run;

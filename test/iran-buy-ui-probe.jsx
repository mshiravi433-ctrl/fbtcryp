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
  requiresTelegramAuth: true,
  payment: { provider: 'zarinpal', mode: 'REDIRECT', currency: 'TOMAN' },
  readiness: []
};
const disabledCapability = {
  schema: 'fbt.iran-buy.v1',
  enabled: false,
  asset: null,
  network: null,
  limits: null,
  requiresTelegramAuth: true,
  readiness: ['PAYMENT', 'EXCHANGE']
};
/* A disabled rail WITH a server-approved bitpin link: the referral path. */
const referralCapability = {
  ...disabledCapability,
  referral: {
    partner: 'bitpin',
    url: 'https://bitpin.ir/register?ref=ABC123',
    discountNote: 'تخفیف دائمی کارمزد',
    network: { id: 'ERC20', label: 'ERC20', chainId: 1 }
  }
};
const WALLET_ADDRESS = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
/* Minimal injected-wallet stub: enough for BrowserProvider to "connect". */
function stubEthereum() {
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [WALLET_ADDRESS];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'net_version') return '1';
      return null;
    },
    on() {},
    removeListener() {}
  };
}
const rate = {
  schema: 'fbt.iran-buy-rate.v1',
  available: true,
  symbol: 'USDTTMN',
  buyPrice: '62500',
  sellPrice: '62400',
  lastPrice: '62450',
  change24h: -1.2,
  source: 'wallex-public-markets'
};

function stubFetch(capabilityBody = capability) {
  globalThis.fetch = async (url) => {
    const path = String(url);
    const body = path.includes('/iran/buy/rate') ? rate
      : path.includes('/iran/buy/config') ? capabilityBody
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
    check('the live direct rail renders no referral card or guide anywhere',
      !container.querySelector('[data-testid="iran-buy-referral"]') && !container.querySelector('[data-testid="iran-buy-referral-guide"]'));

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
    check('the live Toman rate from the public market endpoint is shown with its source',
      iranPanel?.querySelector('[data-testid="iran-buy-rate"]')?.textContent.includes('۶۲٬۵۰۰'));
    check('the four-step journey is explained before anything is signed or paid',
      iranPanel?.querySelectorAll('.iran-buy-guide li').length === 4);

    const amountInput = iranPanel?.querySelector('.iran-buy-amount input');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(amountInput, '1250000');
      amountInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      await sleep(40);
    });
    check('a Toman amount produces a labelled estimate instead of a promised amount',
      container.querySelector('[data-testid="iran-buy-estimate"]')?.textContent.includes('۲۰')
      && container.querySelector('[data-testid="iran-buy-estimate"]')?.textContent.includes('USDT'));

    /* Not-yet-live deployment: the tab must stay a complete, honest surface. */
    await act(async () => { root.unmount(); });
    stubFetch(disabledCapability);
    root = createRoot(container);
    await act(async () => { root.render(<WalletProvider><BuySellPanel /></WalletProvider>); });
    await act(async () => { await sleep(120); });
    await act(async () => {
      container.querySelector('[data-testid="iran-buy-top-tab"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(80);
    });
    const closedPanel = container.querySelector('[data-testid="iran-buy-panel"]');
    check('a disabled deployment still shows the rate, calculator, wallet check and journey',
      Boolean(closedPanel?.querySelector('[data-testid="iran-buy-rate"]'))
      && Boolean(closedPanel?.querySelector('.iran-buy-amount input'))
      && Boolean(closedPanel?.querySelector('.iran-buy-destination'))
      && closedPanel?.querySelectorAll('.iran-buy-guide li').length === 4);
    check('a disabled deployment explains what is missing and offers no payable action',
      closedPanel?.querySelectorAll('.iran-buy-readiness li').length === 2
      && Boolean(closedPanel?.querySelector('[data-testid="iran-buy-unavailable"]'))
      && closedPanel?.querySelector('[data-testid="iran-buy-disabled-cta"]')?.disabled === true
      && !closedPanel?.querySelector('[data-testid="iran-buy-pay"]'));

    /* ── Referral mode: rail closed + a server-approved bitpin link ────────── */
    await act(async () => { root.unmount(); });
    stubFetch(referralCapability);
    root = createRoot(container);
    await act(async () => { root.render(<WalletProvider><BuySellPanel /></WalletProvider>); });
    await act(async () => { await sleep(120); });
    await act(async () => {
      container.querySelector('[data-testid="iran-buy-top-tab"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(80);
    });
    const referralPanel = container.querySelector('[data-testid="iran-buy-panel"]');
    const flow = referralPanel?.querySelector('[data-testid="iran-buy-referral-flow"]');
    const guide = flow?.querySelector('[data-testid="iran-buy-referral-guide"]');
    check('a server-approved referral renders its card, disclosure and guide; the dead disabled CTA is gone',
      Boolean(flow?.querySelector('[data-testid="iran-buy-referral"]'))
      && Boolean(flow?.querySelector('[data-testid="iran-buy-referral-disclosure"]'))
      && Boolean(flow?.querySelector('[data-testid="iran-buy-referral-perk"]'))
      && !referralPanel?.querySelector('[data-testid="iran-buy-disabled-cta"]'));
    check('the guide ships collapsed and offers connect instead of any address while the wallet is away',
      guide?.open === false
      && Boolean(flow?.querySelector('[data-testid="iran-buy-address-connect"]'))
      && !flow?.querySelector('[data-testid="iran-buy-address-value"]'));
    check('the referral flow adds no manual address field and no asset/network picker',
      !flow?.querySelector('input, textarea, select') && referralPanel?.querySelectorAll('select').length === 0);
    check('the swap CTA sits outside the guide, so it is reachable while the guide is closed',
      Boolean(flow?.querySelector('[data-testid="iran-buy-referral-swap-cta"]'))
      && !flow?.querySelector('[data-testid="iran-buy-referral-swap-cta"]')?.closest('details'));
    check('the referral block names only USDT and no other asset',
      !/BTC|SOL|BNB|DOGE|TRX|XRP|ADA|LTC|SHIB|ETC\b/i.test(flow?.textContent || ''));

    /* Opening the link: new-tab opener wired to the exact server-sent URL. */
    const openedUrls = [];
    const previousOpen = window.open;
    window.open = (url, target, features) => { openedUrls.push({ url, target, features }); return {}; };
    let referralEvent = null;
    const onReferralEvent = (event) => { if (event.detail?.type === 'iranBuy.referralClicked') referralEvent = event.detail; };
    window.addEventListener('fbt:ai-event', onReferralEvent);
    await act(async () => {
      flow?.querySelector('[data-testid="iran-buy-referral-cta"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(40);
    });
    check('the CTA opens exactly the https link the server sent, in a new noopener tab',
      openedUrls.length === 1 && openedUrls[0].url === 'https://bitpin.ir/register?ref=ABC123'
      && new URL(openedUrls[0].url).protocol === 'https:' && new URL(openedUrls[0].url).hostname === 'bitpin.ir'
      && openedUrls[0].target === '_blank' && /noopener/.test(openedUrls[0].features || ''));
    check('the click emits one anonymous partner-only event, with no address, id or amount',
      referralEvent && JSON.stringify(referralEvent.payload).includes('bitpin')
      && !/0x|Address|amount/i.test(JSON.stringify(referralEvent.payload || {})));
    window.removeEventListener('fbt:ai-event', onReferralEvent);

    /* Popup blocked → manual copy fallback, never a dead click. */
    window.open = () => null;
    await act(async () => {
      flow?.querySelector('[data-testid="iran-buy-referral-cta"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(40);
    });
    check('a blocked popup surfaces the link for manual opening instead of doing nothing',
      Boolean(flow?.querySelector('[data-testid="iran-buy-referral-manual"] a[href="https://bitpin.ir/register?ref=ABC123"]')));
    window.open = previousOpen;

    /* Connected wallet on the right chain: the full address appears. */
    stubEthereum();
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await act(async () => { root.render(<WalletProvider><BuySellPanel /></WalletProvider>); });
    await act(async () => { await sleep(120); });
    await act(async () => {
      container.querySelector('[data-testid="iran-buy-top-tab"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(80);
    });
    const connectedPanel = container.querySelector('[data-testid="iran-buy-panel"]');
    await act(async () => {
      connectedPanel?.querySelector('[data-testid="iran-buy-address-connect"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(120);
    });
    /* The sheet portals to document.body, so its options are found there. */
    const metamaskOption = [...document.querySelectorAll('.wallet-option')].find((button) => button.textContent.includes('MetaMask'));
    await act(async () => {
      metamaskOption?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(400);
    });
    const connectedFlow = connectedPanel?.querySelector('[data-testid="iran-buy-referral-flow"]');
    check('a connected wallet on the target chain renders its FULL address, character-exact',
      connectedFlow?.querySelector('[data-testid="iran-buy-address-value"]')?.textContent === WALLET_ADDRESS);
    let copiedValue = null;
    try {
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (value) => { copiedValue = value; } }, configurable: true });
    } catch { /* clipboard stubbing unavailable — the copy check then reports the stored value */ }
    await act(async () => {
      connectedFlow?.querySelector('[data-testid="iran-buy-address-copy"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(60);
    });
    check('the copy button copies exactly the address and nothing else', copiedValue === WALLET_ADDRESS);
    check('the guide warns that a wrong network selection loses the funds',
      /شبکهٔ اشتباه|از دست رفتن/.test(connectedFlow?.querySelector('.iran-buy-address-warning')?.textContent || ''));
    await act(async () => {
      connectedFlow?.querySelector('[data-testid="iran-buy-referral-swap-cta"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await sleep(30);
    });
    check('opening the guide, swapping and unmounting produced no unexpected React error', errors.length === 0);
    delete window.ethereum;
    try { delete window.navigator.clipboard; } catch { /* optional stub cleanup */ }

    await act(async () => { root.unmount(); });
    stubFetch();
    root = createRoot(container);
    await act(async () => { root.render(<WalletProvider><BuySellPanel /></WalletProvider>); });
    await act(async () => { await sleep(120); });

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

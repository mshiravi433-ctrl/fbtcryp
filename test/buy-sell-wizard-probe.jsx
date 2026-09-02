/**
 * BUY / SELL WIZARD — DRIVEN LIKE A USER DRIVES IT.
 * ---------------------------------------------------------------------------
 * The report this suite exists for: «صفحه خرید و فروش دکمه بعدی و تایید ندارد
 * فقط دکمه قبلی دارد» — the Buy / Sell screen has no Next and no Confirm, only
 * a Back button.
 *
 * No source-level grep could have caught it. The literals were all in the file
 * and the locale keys all existed; what was missing was the ACTION on the last
 * screen of the wizard (the review step rendered a nav row containing only
 * "Back", with the real call to action buried further down the card and, in
 * the tracked flow, permanently disabled because the country field started
 * empty). A user reads a greyed, unexplained control as an absent one.
 *
 * So this mounts the REAL panel and walks it end to end, in both provider
 * states, asserting on the rendered buttons:
 *
 *   · every step shows BOTH a back control and a forward/primary action
 *   · a gated action always prints the reason it is gated
 *   · typing a valid value ungates the very next tap
 *   · the review step's primary action is present, labelled and pressable —
 *     the guided hand-off when the tracked flow is unconfigured, and the
 *     quote / prepare / confirm chain when it is configured
 *
 * The network is stubbed at fetch, and the external opener is stubbed at
 * the host opener, so nothing here reaches a provider.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import '../src/i18n/index.js';
import BuySellPanel from '../src/components/BuySellPanel.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WALLET = '0x1111111111111111111111111111111111111111';

/** A React-controlled input only sees a change when the value is set through
 *  the prototype setter — a raw assignment updates React's own tracker and the
 *  subsequent event looks like "no change". */
const type = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const CONFIG_REQUIRED = {
  custody: 'NON_CUSTODIAL',
  fbtFee: 0,
  buyAvailable: false,
  sellAvailable: false,
  providers: [{ id: 'ramp', name: 'Ramp Network', status: 'CONFIGURATION_REQUIRED', available: false, onRamp: false, offRamp: false, paymentMethods: ['CARD_PAYMENT'] }]
};

const LIVE = {
  custody: 'NON_CUSTODIAL',
  fbtFee: 0,
  buyAvailable: true,
  sellAvailable: true,
  providers: [{ id: 'ramp', name: 'Ramp Network', status: 'AVAILABLE', available: true, onRamp: true, offRamp: true, paymentMethods: ['CARD_PAYMENT', 'SEPA'] }]
};

const ASSETS = { assets: [{ asset: 'USDT', network: 'arbitrum' }, { asset: 'USDC', network: 'base' }] };

const QUOTE = {
  quote: {
    quoteId: 'q_1', side: 'BUY', asset: 'USDT', network: 'arbitrum', fiatCurrency: 'USD',
    fiatAmount: 100, cryptoAmount: 99.4, assetPrice: 1.0006, totalPayable: 100, fbtFee: 0,
    paymentMethod: 'CARD_PAYMENT', providerFees: [], expiresAt: new Date(Date.now() + 300_000).toISOString()
  }
};

const ORDER = {
  orderAccessToken: 'tok_1',
  order: {
    orderId: 'o_1', status: 'AWAITING_CONFIRMATION', side: 'BUY', asset: 'USDT', network: 'arbitrum',
    cryptoAmount: 99.4, walletAddress: WALLET, provider: 'ramp',
    paymentStatus: 'PENDING', settlementStatus: 'PENDING', verificationStatus: 'PENDING'
  },
};

function stubFetch(providers) {
  globalThis.fetch = async (url) => {
    const path = String(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.includes('/buy-sell/providers')) return json(providers);
    if (path.includes('/buy-sell/assets')) return json(ASSETS);
    if (path.includes('/buy-sell/quote')) return json(QUOTE);
    if (path.includes('/buy-sell/checkout')) {
      return json({ order: { ...ORDER.order, status: 'CHECKOUT_CREATED' }, checkoutUrl: 'https://app.rampnetwork.com/?swapAsset=ARBITRUM_USDT' });
    }
    if (path.includes('/buy-sell/order')) return json(ORDER);
    return json({});
  };
}

export async function run(container) {
  const out = [];
  const t = (name, ok) => { out.push([name, Boolean(ok)]); console.log((ok ? '✓ ' : '✗ ') + name); };

  const realError = console.error;
  const errors = [];
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (/useLayoutEffect|act\(|not wrapped|Not implemented|is deprecated|Future Flag/.test(s)) return;
    errors.push(s);
  };
  const realFetch = globalThis.fetch;
  /* The order-access capability is kept in sessionStorage (never a URL), so a
     host that does not expose one turns the confirm step into an
     ORDER_ACCESS_UNAVAILABLE. Real browsers always have it; the shared jsdom
     harness does not necessarily, so provide one for the duration. */
  const realSession = globalThis.sessionStorage;
  if (!realSession) {
    const store = new Map();
    const shim = {
      getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)); },
      removeItem: (k) => { store.delete(String(k)); },
      clear: () => store.clear()
    };
    Object.defineProperty(globalThis, 'sessionStorage', { value: shim, configurable: true });
    try { window.sessionStorage = shim; } catch { /* jsdom may protect it */ }
  }

  const realOpen = window.open;
  const realTelegram = window.Telegram;
  let opened = null;
  window.open = (url) => { opened = url; return { closed: false, focus() {} }; };
  /* openUrl() prefers the host opener (Telegram Mini App) over the Capacitor
     plugin and the plain tab. Stubbing that layer keeps the probe from
     reaching into a native plugin that does not exist under jsdom, while
     still proving the button reached the real openUrl() call. */
  const webApp = new Proxy({ openLink: (url) => { opened = url; } }, {
    /* Anything else a co-resident suite might call on the shared global (a
       deferred `ready()` from another mounted probe, for instance) answers
       with a harmless no-op instead of crashing the run. */
    get: (target, prop) => (prop in target ? target[prop] : () => {})
  });
  window.Telegram = { WebApp: webApp };

  const mount = async (providers) => {
    stubFetch(providers);
    container.innerHTML = '';
    const root = createRoot(container);
    await act(async () => { root.render(<BuySellPanel />); });
    await act(async () => { await sleep(60); });
    return root;
  };

  const nav = () => container.querySelector('.bsw-nav');
  const backBtn = () => container.querySelector('.bsw-back');
  const nextBtn = () => container.querySelector('.bsw-next');
  const blocked = () => container.querySelector('.bsw-blocked');
  const activeStep = () => {
    const items = [...container.querySelectorAll('.bsw-stepper li')];
    return items.findIndex((li) => li.classList.contains('active'));
  };
  /* AnimatePresence runs in `wait` mode: the outgoing step must finish
     leaving before the incoming one mounts, so a step change is not settled
     on the next tick. Wait past the exit + enter durations. */
  const click = async (el) => {
    await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await sleep(20); });
    await act(async () => { await sleep(420); });
  };
  const enter = async (el, value) => { await act(async () => { type(el, value); await sleep(20); }); };

  try {
    /* ── A. the no-registration (guided) provider state ───────────────────── */
    let root = await mount(CONFIG_REQUIRED);

    t('the wizard mounts on the amount step', activeStep() === 0);
    t('step 1 shows a navigation bar, not a bare card', Boolean(nav()));
    t('step 1 offers BOTH a back control and a forward action', Boolean(backBtn()) && Boolean(nextBtn()));
    t('the forward action carries a label', (nextBtn()?.textContent || '').trim().length > 0);
    t('with no amount typed the forward action is gated', nextBtn().disabled === true);
    t('...and the reason it is gated is printed on screen', Boolean(blocked()) && blocked().textContent.trim().length > 0);

    const amountInput = container.querySelector('.bsw-amount input');
    await enter(amountInput, '100');
    t('typing an amount ungates the forward action', nextBtn().disabled === false);
    t('...and clears the printed reason', !blocked());

    await click(nextBtn());
    t('the forward action actually advances to the wallet step', activeStep() === 1);

    t('the wallet step still shows both controls', Boolean(backBtn()) && Boolean(nextBtn()));
    t('an empty wallet gates the forward action, and says so', nextBtn().disabled === true && Boolean(blocked()));
    await enter(container.querySelector('.bsw-wallet input'), '0xnope');
    t('an invalid address keeps the forward action gated', nextBtn().disabled === true);
    await enter(container.querySelector('.bsw-wallet input'), WALLET);
    t('a valid address ungates it', nextBtn().disabled === false);

    await click(nextBtn());
    t('the asset step is reachable', activeStep() === 2);
    t('the asset step shows both controls, forward enabled', Boolean(backBtn()) && nextBtn().disabled === false);

    await click(nextBtn());
    t('the review step is reachable', activeStep() === 3);

    /* THE REPORTED BUG, EXACTLY. */
    t('THE REVIEW STEP HAS A PRIMARY ACTION, NOT ONLY A BACK BUTTON', Boolean(nextBtn()));
    t('...it is labelled with the real next move, not an empty chevron', (nextBtn()?.textContent || '').trim().length > 2);
    t('...it is pressable (nothing silently gates the hand-off)', nextBtn().disabled === false);
    t('...and Back is still there beside it', Boolean(backBtn()));
    t('the guided hand-off names the destination provider', /Ramp/.test(nextBtn().textContent));

    await click(nextBtn());
    t('pressing it opens the provider checkout', typeof opened === 'string' && opened.includes('rampnetwork.com'));
    t('the prefilled hand-off carries the wallet address', String(opened).toLowerCase().includes(WALLET.toLowerCase()));
    t('after the hand-off the action bar is still complete', Boolean(backBtn()) && Boolean(nextBtn()));
    t('...and the action becomes "reopen", so the screen is never a dead end', nextBtn().disabled === false);

    await click(backBtn());
    t('Back still works from the review step', activeStep() === 2);

    await act(async () => { root.unmount(); });

    /* ── B. the configured, order-tracked provider state ──────────────────── */
    opened = null;
    root = await mount(LIVE);

    await enter(container.querySelector('.bsw-amount input'), '100');
    await click(nextBtn());
    await enter(container.querySelector('.bsw-wallet input'), WALLET);
    await click(nextBtn());
    await click(nextBtn());
    t('the tracked flow reaches its review step', activeStep() === 3);

    const countryInput = [...container.querySelectorAll('.ord-field input')].pop();
    t('the review step exposes the country the provider requires', Boolean(countryInput));

    t('the tracked review step has a primary action too', Boolean(nextBtn()) && (nextBtn().textContent || '').trim().length > 2);

    /* An empty country is the historical trap: the only enabled control was
       "Back". Either it is prefilled from the locale, or the block is named. */
    if (!countryInput.value) {
      t('an empty country names itself instead of silently disabling the action', Boolean(blocked()));
      await enter(countryInput, 'DE');
    } else {
      t('the country is prefilled from the locale so the step arrives ready', /^[A-Z]{2}$/.test(countryInput.value));
    }
    t('with a country present the quote action is pressable', nextBtn().disabled === false);

    await click(nextBtn());
    t('the quote action fetches and renders a quote', Boolean(container.querySelector('.buy-sell-summary')));
    t('...and the action bar advances to preparing the order', /\S/.test(nextBtn().textContent) && nextBtn().disabled === false);

    await click(nextBtn());
    t('the order is prepared and the confirmation copy is shown', Boolean(container.querySelector('.buy-sell-confirm')));
    t('THE CONFIRM ACTION EXISTS AND IS PRESSABLE', Boolean(nextBtn()) && nextBtn().disabled === false);

    await click(nextBtn());
    t('confirming opens the hosted checkout', typeof opened === 'string' && opened.includes('rampnetwork.com'));

    t('no React error was raised while driving the whole wizard', errors.length === 0);
    if (errors.length) console.log('   first error:', errors[0].slice(0, 300));

    await act(async () => { root.unmount(); });
  } finally {
    console.error = realError;
    globalThis.fetch = realFetch;
    window.open = realOpen;
    window.Telegram = realTelegram;
    if (!realSession) { try { delete globalThis.sessionStorage; } catch { /* leave the shim */ } }
  }

  return out;
}

export default run;
